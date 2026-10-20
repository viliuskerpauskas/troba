import { createHash } from "node:crypto";
import { z } from "zod";
import { parseCents } from "../cents";
import { parseIban } from "../iban";
import { delimiters, type CsvTable } from "./csv";

// Import profiles (SPEC-money M3, "Import profile"): a user's description of their bank's CSV
// format, stored in their own data, so no bank-specific code ships in the repo. This file turns a
// table read by ./csv.ts into ParsedRows; matching them against accounts and saving them is
// ./import.ts's job.
//
// Descriptions and raw rows can hold masked card numbers: never log them.

export const dateFormats = [
  "YYYY-MM-DD",
  "YYYY/MM/DD",
  "YYYY.MM.DD",
  "DD.MM.YYYY",
  "DD/MM/YYYY",
  "DD-MM-YYYY",
  "MM/DD/YYYY",
] as const;
export type DateFormat = (typeof dateFormats)[number];

const header = z.string().min(1).max(200);

function isKnownEncoding(label: string): boolean {
  try {
    new TextDecoder(label);
    return true;
  } catch {
    return false;
  }
}

export const importProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    skipLines: z.int().min(0).max(100).default(0),
    // Null: detected per file.
    delimiter: z.enum(delimiters).nullable().default(null),
    // A WHATWG label, e.g. a windows-125x code page.
    encoding: z.string().max(40).refine(isKnownEncoding).default("utf-8"),
    decimalSeparator: z.enum([".", ","]),
    dateFormat: z.enum(dateFormats),
    // Field → header in the file.
    columns: z.strictObject({
      bookingDate: header,
      transactionDate: header.optional(),
      amount: header,
      debitCredit: header.optional(),
      currency: header.optional(),
      originalAmount: header.optional(),
      originalCurrency: header.optional(),
      counterparty: header.optional(),
      counterpartyIban: header.optional(),
      description: header.optional(),
      transactionId: header.optional(),
      transactionType: header.optional(),
      ownIban: header.optional(),
    }),
    // With an unsigned amount and a debit/credit column: the indicator values that mean a debit.
    debitValues: z.array(z.string().trim().min(1).max(40)).min(1).max(20).nullable(),
  })
  .refine(
    (profile) => (profile.columns.debitCredit === undefined) === (profile.debitValues === null),
    {
      message: "A debit/credit column needs debit values, and debit values need the column.",
      path: ["debitValues"],
    },
  )
  .refine(
    ({ columns }) =>
      (columns.originalAmount === undefined) === (columns.originalCurrency === undefined),
    {
      message: "The original amount and original currency are mapped together.",
      path: ["columns"],
    },
  );

export type ImportProfile = z.infer<typeof importProfileSchema>;
export type ImportField = keyof ImportProfile["columns"];

// Identifies a format by its exact set of headers, so a later upload finds its profile. Column
// order is ignored: some banks let the user reorder an export's columns.
export function headerFingerprint(headers: string[]): string {
  const set = [...new Set(headers)].sort();
  return createHash("sha256").update(JSON.stringify(set)).digest("hex");
}

export type ParsedRow = {
  // 1-based, counting data rows below the header.
  row: number;
  // The transaction date when the profile maps one (when the money was spent), else the booking
  // date. YYYY-MM-DD.
  bookedOn: string;
  // Negative is a debit. In the account's currency.
  amountCents: bigint;
  // Null: the account's.
  currency: string | null;
  originalAmountCents: bigint | null;
  originalCurrency: string | null;
  counterparty: string | null;
  counterpartyIban: string | null;
  description: string | null;
  bankTxType: string | null;
  ownIban: string | null;
  dedupKey: string;
  // Header → cell, as the bank wrote it.
  raw: Record<string, string>;
};

export type RowFailure = {
  row: number;
  reason:
    | "invalid-date"
    | "invalid-amount"
    | "invalid-debit-credit"
    | "invalid-currency"
    | "invalid-original-amount"
    | "invalid-own-iban";
};

export type ParseRowsResult =
  | {
      ok: true;
      // The account the file belongs to, when the profile maps an own-IBAN column.
      ownIban: string | null;
      rows: ParsedRow[];
      failed: RowFailure[];
    }
  // The whole file is refused: nothing in it may be saved.
  | { ok: false; reason: "missing-columns"; columns: string[] }
  | { ok: false; reason: "multiple-own-ibans" };

export type ParseRowsOptions = {
  // Compared with the original currency when the profile maps no currency column.
  accountCurrency?: string;
};

const currencyCode = /^[A-Z]{3}$/;

function withSign(cents: bigint, sign: 1n | -1n): bigint {
  return (cents < 0n ? -cents : cents) * sign;
}

export function parseRows(
  profile: ImportProfile,
  table: CsvTable,
  options: ParseRowsOptions = {},
): ParseRowsResult {
  // A header the profile maps but the file lacks means a different format, not empty cells.
  const missing = Object.values(profile.columns).filter((name) => !table.headers.includes(name));
  if (missing.length > 0) return { ok: false, reason: "missing-columns", columns: missing };

  // The first of two equal headers.
  const index = new Map(table.headers.map((name, i) => [name, i] as const).reverse());
  const rows: ParsedRow[] = [];
  const failed: RowFailure[] = [];
  const ownIbans = new Set<string>();

  // The bank's transaction id when there is one. Otherwise the row's hash (the amount's sign
  // carries debit/credit), numbered so that identical rows in one file, two equal coffees on one
  // day, stay two transactions while a re-import of the same file matches them again.
  const occurrences = new Map<string, number>();
  const dedupKey = (transactionId: string, fields: (string | bigint | null)[]): string => {
    if (transactionId) return `tx:${transactionId}`;
    const hash = createHash("sha256")
      .update(JSON.stringify(fields.map((field) => field?.toString() ?? null)))
      .digest("hex");
    const occurrence = occurrences.get(hash) ?? 0;
    occurrences.set(hash, occurrence + 1);
    return `row:${hash}:${occurrence}`;
  };

  table.rows.forEach((cells, i) => {
    const row = i + 1;
    const raw = Object.fromEntries(table.headers.map((name, j) => [name, cells[j] ?? ""]));
    const cell = (field: ImportField): string => {
      const name = profile.columns[field];
      const j = name === undefined ? undefined : index.get(name);
      return j === undefined ? "" : (cells[j] ?? "").trim();
    };
    const text = (field: ImportField): string | null => cell(field) || null;

    const bookedOn = parseDate(cell("transactionDate") || cell("bookingDate"), profile.dateFormat);
    if (!bookedOn) return failed.push({ row, reason: "invalid-date" });

    const amount = parseCents(cell("amount"), { decimalSeparator: profile.decimalSeparator });
    if (amount === null) return failed.push({ row, reason: "invalid-amount" });
    let amountCents = amount;
    if (profile.columns.debitCredit !== undefined) {
      const indicator = cell("debitCredit");
      if (!indicator) return failed.push({ row, reason: "invalid-debit-credit" });
      amountCents = withSign(amount, profile.debitValues?.includes(indicator) ? -1n : 1n);
    }

    const currency = text("currency")?.toUpperCase() ?? null;
    if (currency !== null && !currencyCode.test(currency)) {
      return failed.push({ row, reason: "invalid-currency" });
    }

    // A purchase in another currency: the bank's amount is converted, the original is kept.
    let originalAmountCents: bigint | null = null;
    let originalCurrency = text("originalCurrency")?.toUpperCase() ?? null;
    const accountCurrency = currency ?? options.accountCurrency ?? null;
    if (originalCurrency !== null && originalCurrency !== accountCurrency) {
      if (!currencyCode.test(originalCurrency)) {
        return failed.push({ row, reason: "invalid-currency" });
      }
      const original = parseCents(cell("originalAmount"), {
        decimalSeparator: profile.decimalSeparator,
      });
      if (original === null) return failed.push({ row, reason: "invalid-original-amount" });
      originalAmountCents = withSign(original, amountCents < 0n ? -1n : 1n);
    } else originalCurrency = null;

    let ownIban: string | null = null;
    if (cell("ownIban")) {
      ownIban = parseIban(cell("ownIban"));
      if (!ownIban) return failed.push({ row, reason: "invalid-own-iban" });
      ownIbans.add(ownIban);
    }

    const counterparty = text("counterparty");
    const description = text("description");
    rows.push({
      row,
      bookedOn,
      amountCents,
      currency,
      originalAmountCents,
      originalCurrency,
      counterparty,
      // Not every bank writes an IBAN here; only an IBAN can match an own account.
      counterpartyIban: parseIban(cell("counterpartyIban")),
      description,
      bankTxType: text("transactionType"),
      ownIban,
      dedupKey: dedupKey(cell("transactionId"), [bookedOn, amountCents, counterparty, description]),
      raw,
    });
  });

  // One file is one account's statement.
  if (ownIbans.size > 1) return { ok: false, reason: "multiple-own-ibans" };
  return { ok: true, ownIban: [...ownIbans][0] ?? null, rows, failed };
}

const datePatterns: Record<DateFormat, RegExp> = Object.fromEntries(
  dateFormats.map((format) => [
    format,
    new RegExp(
      `^${format
        .replace(/[./-]/g, "\\$&")
        .replace("YYYY", "(?<year>\\d{4})")
        .replace("MM", "(?<month>\\d{1,2})")
        .replace("DD", "(?<day>\\d{1,2})")}$`,
    ),
  ]),
) as Record<DateFormat, RegExp>;

// YYYY-MM-DD, or null unless it is a real calendar date in the profile's format.
function parseDate(text: string, format: DateFormat): string | null {
  const groups = datePatterns[format].exec(text)?.groups;
  if (!groups) return null;
  const [year, month, day] = [groups.year, groups.month, groups.day].map(Number) as [
    number,
    number,
    number,
  ];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1) return null;
  return date.toISOString().slice(0, 10);
}
