import { createHash } from "node:crypto";
import { z } from "zod";
import { parseCents } from "../cents";
import { parseIban } from "../iban";
import { delimiters, isKnownEncoding, type CsvTable } from "./csv";

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

const headerName = z.string().min(1).max(200);

// The fields alone, for validating one of them (a form's read settings) without the whole profile.
export const importProfileFields = z.object({
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
    bookingDate: headerName,
    transactionDate: headerName.optional(),
    amount: headerName,
    debitCredit: headerName.optional(),
    currency: headerName.optional(),
    originalAmount: headerName.optional(),
    originalCurrency: headerName.optional(),
    counterparty: headerName.optional(),
    counterpartyIban: headerName.optional(),
    description: headerName.optional(),
    transactionId: headerName.optional(),
    transactionType: headerName.optional(),
    ownIban: headerName.optional(),
  }),
  // With an unsigned amount and a debit/credit column: the indicator values that mean a debit,
  // compared ignoring case.
  debitValues: z.array(z.string().trim().min(1).max(40)).min(1).max(20).nullable(),
});

export const importProfileSchema = importProfileFields
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

// Identifies a format by its exact headers, so a later upload finds its profile. Column order is
// ignored: some banks let the user reorder an export's columns.
export function headerFingerprint(headers: string[]): string {
  return createHash("sha256")
    .update(JSON.stringify([...headers].sort()))
    .digest("hex");
}

export type ParsedRow = {
  // 1-based, counting data rows below the header.
  row: number;
  // The transaction date when the profile maps one (when the money was spent), else the booking
  // date. YYYY-MM-DD.
  bookedOn: string;
  // Negative is a debit. In the account's currency.
  amountCents: bigint;
  // The file's, else the account's.
  currency: string;
  // Only when the original currency differs from currency.
  originalAmountCents: bigint | null;
  originalCurrency: string | null;
  counterparty: string | null;
  counterpartyIban: string | null;
  description: string | null;
  bankTxType: string | null;
  dedupKey: string;
  // Header → cell, as the bank wrote it.
  raw: Record<string, string>;
};

export type RowFailureReason =
  | "invalid-date"
  | "invalid-amount"
  | "invalid-debit-credit"
  | "invalid-currency"
  | "invalid-original-amount"
  | "invalid-own-iban"
  | "duplicate-transaction-id";

export type RowFailure = { row: number; reason: RowFailureReason };

export type ParseRowsResult =
  | {
      ok: true;
      // The account the file belongs to, when the profile maps an own-IBAN column.
      ownIban: string | null;
      rows: ParsedRow[];
      failed: RowFailure[];
      // With a debit/credit column: each indicator seen (upper case) and how many rows had it.
      // Any value that isn't a debit value reads as a credit, so the preview shows these for the
      // user to spot a mistyped debit value. Null without the column.
      debitCredit: DebitCreditCount[] | null;
    }
  // The whole file is refused: nothing in it may be saved.
  | { ok: false; reason: "missing-columns"; columns: string[] }
  | { ok: false; reason: "multiple-own-ibans" };

export type DebitCreditCount = { value: string; debit: boolean; rows: number };

export type ParseRowsOptions = {
  // The currency of the account the rows go to: the default when the profile maps no currency
  // column, and what an original amount is compared with.
  accountCurrency: string;
};

export function parseRows(
  profile: ImportProfile,
  table: CsvTable,
  options: ParseRowsOptions,
): ParseRowsResult {
  // A header the profile maps but the file lacks means a different format, not empty cells.
  const missing = Object.values(profile.columns).filter((name) => !table.headers.includes(name));
  if (missing.length > 0) return { ok: false, reason: "missing-columns", columns: missing };

  const accountCurrency = options.accountCurrency.toUpperCase();
  if (!currencyCode.test(accountCurrency)) throw new Error("accountCurrency is not a currency");

  // A bank that repeats a header: the first is the one read. Raw keeps every cell, the later
  // ones under "<header> (2)" and on, skipping names the file itself uses.
  const columnIndex = new Map<string, number>();
  const rawNameSet = new Set(table.headers);
  const rawNames = table.headers.map((name, i) => {
    if (!columnIndex.has(name)) {
      columnIndex.set(name, i);
      return name;
    }
    let n = 2;
    while (rawNameSet.has(`${name} (${n})`)) n++;
    rawNameSet.add(`${name} (${n})`);
    return `${name} (${n})`;
  });

  const rows: ParsedRow[] = [];
  const failed: RowFailure[] = [];
  const ownIbans = new Set<string>();
  const transactionIds = new Set<string>();
  const occurrences = new Map<string, number>();
  const indicators = new Map<string, DebitCreditCount>();

  for (const [i, cells] of table.rows.entries()) {
    const row = i + 1;
    const cell = (field: ImportField): string => {
      const name = profile.columns[field];
      const j = name === undefined ? undefined : columnIndex.get(name);
      return j === undefined ? "" : (cells[j] ?? "").trim();
    };
    const indicator = cell("debitCredit").toUpperCase();
    if (indicator) {
      const seen = indicators.get(indicator) ?? {
        value: indicator,
        debit: isDebit(profile, indicator),
        rows: 0,
      };
      seen.rows++;
      indicators.set(indicator, seen);
    }
    const parsed = parseRow(profile, cell, accountCurrency);
    if (typeof parsed === "string") {
      failed.push({ row, reason: parsed });
      continue;
    }

    let dedupKey: string;
    if (parsed.transactionId) {
      // The unique dedup index would silently keep only one of them.
      if (transactionIds.has(parsed.transactionId)) {
        failed.push({ row, reason: "duplicate-transaction-id" });
        continue;
      }
      transactionIds.add(parsed.transactionId);
      dedupKey = `tx:${parsed.transactionId}`;
    } else {
      // The row's hash (the amount's sign carries debit/credit), numbered so that identical rows
      // in one file, two equal coffees on one day, stay two transactions while a re-import of
      // the same file matches them again.
      const hash = createHash("sha256")
        .update(JSON.stringify(parsed.hashed.map((field) => field?.toString() ?? null)))
        .digest("hex");
      const occurrence = occurrences.get(hash) ?? 0;
      occurrences.set(hash, occurrence + 1);
      dedupKey = `row:${hash}:${occurrence}`;
    }

    if (parsed.ownIban) ownIbans.add(parsed.ownIban);
    const raw = Object.fromEntries(rawNames.map((name, j) => [name, cells[j] ?? ""]));
    rows.push({ row, ...parsed.fields, dedupKey, raw });
  }

  // One file is one account's statement.
  if (ownIbans.size > 1) return { ok: false, reason: "multiple-own-ibans" };
  return {
    ok: true,
    ownIban: [...ownIbans][0] ?? null,
    rows,
    failed,
    debitCredit: profile.columns.debitCredit === undefined ? null : [...indicators.values()],
  };
}

type RowFields = Omit<ParsedRow, "row" | "dedupKey" | "raw">;

// One row's fields, or why it can't be read.
function parseRow(
  profile: ImportProfile,
  cell: (field: ImportField) => string,
  accountCurrency: string,
):
  | {
      fields: RowFields;
      ownIban: string | null;
      transactionId: string;
      hashed: (string | bigint | null)[];
    }
  | RowFailureReason {
  const text = (field: ImportField): string | null => cell(field) || null;
  const amountOf = (field: ImportField) =>
    parseCents(cell(field), { decimalSeparator: profile.decimalSeparator });
  // Undefined: not a currency code.
  const currencyOf = (field: ImportField): string | null | undefined => {
    const code = text(field)?.toUpperCase() ?? null;
    return code === null || currencyCode.test(code) ? code : undefined;
  };

  const bookedOn = parseDate(cell("transactionDate") || cell("bookingDate"), profile.dateFormat);
  if (!bookedOn) return "invalid-date";

  const amount = amountOf("amount");
  if (amount === null) return "invalid-amount";
  let amountCents = amount;
  if (profile.columns.debitCredit !== undefined) {
    const indicator = cell("debitCredit").toUpperCase();
    if (!indicator) return "invalid-debit-credit";
    const debit = isDebit(profile, indicator);
    amountCents = withSign(amount, debit ? -1n : 1n);
  }

  const fileCurrency = currencyOf("currency");
  if (fileCurrency === undefined) return "invalid-currency";
  const currency = fileCurrency ?? accountCurrency;

  // A purchase in another currency: the bank's amount is converted, the original is kept.
  let originalAmountCents: bigint | null = null;
  let originalCurrency = currencyOf("originalCurrency");
  if (originalCurrency === undefined) return "invalid-currency";
  if (originalCurrency !== null && originalCurrency !== currency) {
    const original = amountOf("originalAmount");
    if (original === null) return "invalid-original-amount";
    originalAmountCents = withSign(original, amountCents < 0n ? -1n : 1n);
  } else originalCurrency = null;

  let ownIban: string | null = null;
  if (cell("ownIban")) {
    ownIban = parseIban(cell("ownIban"));
    if (!ownIban) return "invalid-own-iban";
  }

  const counterparty = text("counterparty");
  const description = text("description");
  return {
    fields: {
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
    },
    ownIban,
    transactionId: cell("transactionId"),
    hashed: [bookedOn, amountCents, counterparty, description],
  };
}

const currencyCode = /^[A-Z]{3}$/;

// Debit values are compared ignoring case; indicator is upper case.
function isDebit(profile: ImportProfile, indicator: string): boolean {
  return profile.debitValues?.some((value) => value.toUpperCase() === indicator) ?? false;
}

function withSign(cents: bigint, sign: 1n | -1n): bigint {
  return (cents < 0n ? -cents : cents) * sign;
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
  // Date.UTC also reads years 0–99 as 1900–1999.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1) return null;
  return date.toISOString().slice(0, 10);
}
