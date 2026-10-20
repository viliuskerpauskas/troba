import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readCsv, type CsvTable } from "./csv";
import {
  headerFingerprint,
  importProfileSchema,
  parseRows,
  type ImportProfile,
  type ParsedRow,
} from "./profile";

const fixtures = path.join(import.meta.dirname, "../../../test/fixtures/csv");

function fixture(name: string, profile: ImportProfile): CsvTable {
  const result = readCsv(readFileSync(path.join(fixtures, name)), profile);
  if (!result.ok) throw new Error(`fixture ${name}: ${result.reason}`);
  return result;
}

function omit<T extends object, K extends keyof T>(object: T, keys: K[]): Omit<T, K> {
  return Object.fromEntries(
    Object.entries(object).filter(([key]) => !keys.includes(key as K)),
  ) as Omit<T, K>;
}

function table(text: string, profile: ImportProfile): CsvTable {
  const result = readCsv(new TextEncoder().encode(text), profile);
  if (!result.ok) throw new Error(result.reason);
  return result;
}

const ownIban = "DE89370400440532013000";

// Example Bank, style 1: one signed amount column, a transaction id, day-first dates.
const signedProfile: ImportProfile = {
  name: "Example Bank (signed)",
  skipLines: 0,
  delimiter: null,
  encoding: "utf-8",
  decimalSeparator: ".",
  dateFormat: "DD/MM/YYYY",
  columns: {
    transactionId: "Transaction ID",
    bookingDate: "Posted",
    transactionDate: "Transaction Date",
    amount: "Amount",
    currency: "Currency",
    counterparty: "Payee",
    counterpartyIban: "Payee Account",
    description: "Details",
    transactionType: "Type",
    ownIban: "Account",
  },
  debitValues: null,
};

// Example Bank, style 2: unsigned amounts with a D/C column, decimal comma, a preamble line, a
// trailing delimiter, the operation's own amount and currency, and no transaction id.
const debitCreditProfile: ImportProfile = {
  name: "Example Bank (D/C)",
  skipLines: 1,
  delimiter: ";",
  encoding: "utf-8",
  decimalSeparator: ",",
  dateFormat: "YYYY-MM-DD",
  columns: {
    bookingDate: "Date",
    amount: "Amount",
    debitCredit: "D/C",
    currency: "Currency",
    originalAmount: "Orig. amount",
    originalCurrency: "Orig. currency",
    counterparty: "Counterparty",
    counterpartyIban: "Counterparty account",
    description: "Purpose",
    ownIban: "Own account",
  },
  debitValues: ["D"],
};

const summary = (row: ParsedRow) => [row.bookedOn, row.amountCents, row.counterparty];

describe("importProfileSchema", () => {
  it.each([
    ["the signed", signedProfile],
    ["the debit/credit", debitCreditProfile],
  ])("accepts %s profile", (_, profile) => {
    expect(importProfileSchema.parse(profile)).toEqual(profile);
  });

  it("defaults to UTF-8, a detected delimiter and no preamble", () => {
    const rest = omit(signedProfile, ["encoding", "delimiter", "skipLines"]);

    expect(importProfileSchema.parse(rest)).toMatchObject({
      encoding: "utf-8",
      delimiter: null,
      skipLines: 0,
    });
  });

  it.each([
    ["no booking date column", { columns: { amount: "Amount" } }],
    ["no amount column", { columns: { bookingDate: "Posted" } }],
    ["an unknown field", { columns: { ...signedProfile.columns, balance: "Balance" } }],
    ["a date format it can't read", { dateFormat: "D MMM YYYY" }],
    ["an encoding the platform doesn't know", { encoding: "no-such-code-page" }],
    ["a debit/credit column without debit values", { columns: debitCreditProfile.columns }],
    ["debit values without a debit/credit column", { debitValues: ["D"] }],
    [
      "an original amount without its currency",
      {
        columns: { ...signedProfile.columns, originalAmount: "Orig" },
      },
    ],
    [
      "an original currency without its amount",
      {
        columns: { ...signedProfile.columns, originalCurrency: "Orig cur" },
      },
    ],
  ])("refuses %s", (_, change) => {
    expect(importProfileSchema.safeParse({ ...signedProfile, ...change }).success).toBe(false);
  });
});

describe("headerFingerprint", () => {
  const headers = ["Date", "Amount", "Payee"];

  it("is the same for the same set of headers in any order", () => {
    expect(headerFingerprint(["Payee", "Date", "Amount"])).toBe(headerFingerprint(headers));
  });

  it.each([
    ["a header renamed", ["Date", "Amount", "Payee name"]],
    ["a header added", [...headers, "Balance"]],
    ["a header removed", ["Date", "Amount"]],
    ["a header's case changed", ["date", "Amount", "Payee"]],
  ])("differs with %s", (_, other) => {
    expect(headerFingerprint(other)).not.toBe(headerFingerprint(headers));
  });

  it("doesn't confuse headers that contain the joining character", () => {
    expect(headerFingerprint(["a\nb", "c"])).not.toBe(headerFingerprint(["a", "b\nc"]));
  });
});

describe("parseRows", () => {
  it("prefers the transaction date, falls back to the booking date, and keeps refunds and fees", () => {
    const result = parseRows(signedProfile, fixture("example-bank-signed.csv", signedProfile));

    expect(result.ok && result.rows.map(summary)).toEqual([
      ["2026-03-01", -4215n, "GROCERY MART"],
      ["2026-03-03", 150000n, "ACME LTD"],
      ["2026-03-04", 1299n, "STREAMING CO"], // a refund, with no transaction date
      ["2026-03-05", -150n, "EXAMPLE BANK"], // a fee
      ["2026-03-06", -2340n, 'CAFE "SUNNY"'],
    ]);
    expect(result.ok && result.rows[1]!.counterpartyIban).toBe("GB82WEST12345698765432");
  });

  it("reads an unsigned export with a debit/credit column", () => {
    const result = parseRows(
      debitCreditProfile,
      fixture("example-bank-debit-credit.csv", debitCreditProfile),
    );

    expect(result).toMatchObject({ ok: true, ownIban, failed: [] });
    expect(result.ok && result.rows.map(summary)).toEqual([
      ["2026-03-01", -4215n, "GROCERY MART"],
      ["2026-03-02", 150000n, "ACME LTD"],
      ["2026-03-03", -1840n, "BOOK SHOP INC"],
      ["2026-03-04", -99n, "EXAMPLE BANK"],
      ["2026-03-05", -500n, "PARKING CO"],
      ["2026-03-05", -500n, "PARKING CO"],
      ["2026-03-06", 4215n, "GROCERY MART"],
      ["2026-03-07", -25000n, "SAVINGS"],
    ]);
  });

  it("keeps the original amount only when its currency differs", () => {
    const result = parseRows(
      debitCreditProfile,
      fixture("example-bank-debit-credit.csv", debitCreditProfile),
    );
    const original = (row: ParsedRow) => [
      row.currency,
      row.originalAmountCents,
      row.originalCurrency,
    ];

    expect(result.ok && result.rows.slice(0, 3).map(original)).toEqual([
      ["EUR", null, null],
      ["EUR", null, null],
      ["EUR", -2000n, "USD"],
    ]);
  });

  describe("dedup key", () => {
    const parseDebitCredit = (text?: string) => {
      const result = parseRows(
        debitCreditProfile,
        text
          ? table(text, debitCreditProfile)
          : fixture("example-bank-debit-credit.csv", debitCreditProfile),
      );
      if (!result.ok) throw new Error(result.reason);
      return result.rows.map((row) => row.dedupKey);
    };

    it("is tx: and the transaction id when the profile maps one", () => {
      const result = parseRows(signedProfile, fixture("example-bank-signed.csv", signedProfile));

      expect(result.ok && result.rows.map((row) => row.dedupKey)).toEqual([
        "tx:T1001",
        "tx:T1002",
        "tx:T1003",
        "tx:T1004",
        "tx:T1005",
      ]);
    });

    it("is otherwise a hash of the row plus an occurrence index for identical rows", () => {
      const keys = parseDebitCredit();

      for (const key of keys) expect(key).toMatch(/^row:[0-9a-f]{64}:\d+$/);
      expect(new Set(keys).size).toBe(keys.length);
      // The two identical parking rows differ only in their occurrence index.
      expect(keys[4]!.replace(/:0$/, "")).toBe(keys[5]!.replace(/:1$/, ""));
    });

    it("is the same when the same file is parsed again", () => {
      expect(parseDebitCredit()).toEqual(parseDebitCredit());
    });

    it("changes with each of date, amount, direction, counterparty and description", () => {
      const head =
        "x;\nDate;Amount;D/C;Currency;Orig. amount;Orig. currency;Counterparty;Counterparty account;Purpose;Own account;\n";
      const line = (fields: string[]) => `${fields.join(";")};\n`;
      const base = ["2026-03-05", "5,00", "D", "EUR", "", "", "PARKING CO", "", "Parking", ""];
      const variants = [
        base,
        base.with(0, "2026-03-06"),
        base.with(1, "5,01"),
        base.with(2, "C"),
        base.with(6, "PARKING LTD"),
        base.with(8, "Parking garage"),
      ];

      const keys = parseDebitCredit(head + variants.map(line).join(""));

      expect(new Set(keys).size).toBe(variants.length);
      expect(keys.every((key) => key.endsWith(":0"))).toBe(true);
    });

    it("falls back to the hash when the transaction id is empty", () => {
      const text = "Transaction ID,Posted,Amount\n,02/03/2026,-1.00\n";
      const profile: ImportProfile = {
        ...signedProfile,
        columns: { transactionId: "Transaction ID", bookingDate: "Posted", amount: "Amount" },
      };
      const result = parseRows(profile, table(text, profile));

      expect(result.ok && result.rows[0]!.dedupKey).toMatch(/^row:[0-9a-f]{64}:0$/);
    });
  });

  it("rejects a file without a column the profile maps, naming the missing headers", () => {
    const text = "Transaction ID,Posted,Amount,Payee\nT1,02/03/2026,-1.00,SHOP\n";

    expect(parseRows(signedProfile, table(text, signedProfile))).toEqual({
      ok: false,
      reason: "missing-columns",
      columns: ["Transaction Date", "Currency", "Payee Account", "Details", "Type", "Account"],
    });
  });

  it("rejects a file with more than one own IBAN", () => {
    const text =
      "Transaction ID,Posted,Transaction Date,Amount,Currency,Payee,Payee Account,Details,Type,Account\n" +
      "T1,02/03/2026,,-1.00,EUR,SHOP,,,CARD,DE89370400440532013000\n" +
      "T2,02/03/2026,,-1.00,EUR,SHOP,,,CARD,NL91ABNA0417164300\n";

    expect(parseRows(signedProfile, table(text, signedProfile))).toEqual({
      ok: false,
      reason: "multiple-own-ibans",
    });
  });

  it("reports rows it can't read, with a reason, and parses the rest", () => {
    const profile: ImportProfile = {
      ...debitCreditProfile,
      skipLines: 0,
      columns: {
        bookingDate: "Date",
        amount: "Amount",
        debitCredit: "D/C",
        currency: "Currency",
        originalAmount: "Orig",
        originalCurrency: "Orig cur",
        ownIban: "Own",
      },
    };
    const text = [
      "Date;Amount;D/C;Currency;Orig;Orig cur;Own",
      "2026-02-30;1,00;D;EUR;;;", // no such day
      "01.03.2026;1,00;D;EUR;;;", // not the profile's date format
      "2026-03-01;1,005;D;EUR;;;", // a third decimal
      "2026-03-01;;D;EUR;;;",
      "2026-03-01;1,00;;EUR;;;",
      "2026-03-01;1,00;D;euro;;;",
      "2026-03-01;1,00;D;EUR;x;USD;",
      "2026-03-01;1,00;D;EUR;;;DE00 1234",
      "2026-03-01;1,00;X;eur;;;",
    ].join("\n");

    const result = parseRows(profile, table(text, profile));

    expect(result.ok && result.failed).toEqual([
      { row: 1, reason: "invalid-date" },
      { row: 2, reason: "invalid-date" },
      { row: 3, reason: "invalid-amount" },
      { row: 4, reason: "invalid-amount" },
      { row: 5, reason: "invalid-debit-credit" },
      { row: 6, reason: "invalid-currency" },
      { row: 7, reason: "invalid-original-amount" },
      { row: 8, reason: "invalid-own-iban" },
    ]);
    // An indicator that isn't a debit value is a credit; the currency is upper-cased.
    expect(result.ok && result.rows.map((row) => [row.row, row.amountCents, row.currency])).toEqual(
      [[9, 100n, "EUR"]],
    );
  });

  it("compares the original currency with the account's when there is no currency column", () => {
    const profile = {
      ...debitCreditProfile,
      columns: omit(debitCreditProfile.columns, ["currency"]),
    };
    const csv = fixture("example-bank-debit-credit.csv", profile);

    const inEuro = parseRows(profile, csv, { accountCurrency: "EUR" });
    expect(inEuro.ok && inEuro.rows.map((row) => row.originalCurrency)).toEqual([
      null,
      null,
      "USD",
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(inEuro.ok && inEuro.rows[0]!.currency).toBeNull();
  });

  it("reads a signed-amount export", () => {
    const result = parseRows(signedProfile, fixture("example-bank-signed.csv", signedProfile));

    expect(result).toMatchObject({ ok: true, ownIban, failed: [] });
    expect(result.ok && result.rows[0]).toEqual({
      row: 1,
      bookedOn: "2026-03-01",
      amountCents: -4215n,
      currency: "EUR",
      originalAmountCents: null,
      originalCurrency: null,
      counterparty: "GROCERY MART",
      counterpartyIban: null,
      description: "Card purchase",
      bankTxType: "CARD",
      ownIban,
      dedupKey: "tx:T1001",
      raw: {
        "Transaction ID": "T1001",
        Posted: "02/03/2026",
        "Transaction Date": "01/03/2026",
        Amount: "-42.15",
        Currency: "EUR",
        Payee: "GROCERY MART",
        "Payee Account": "",
        Details: "Card purchase",
        Type: "CARD",
        Account: "DE89 3704 0044 0532 0130 00",
      },
    });
  });
});
