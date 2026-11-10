import { createDb, schema, type Db } from "@troba/db";
import { createTestDatabase } from "@troba/db/test-database";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startJobQueue, type JobQueue } from "../../jobs/queue";
import { createAccount } from "../accounts";
import { ensureMoneyDefaults } from "../defaults";
import { commitImport, previewImport } from "./import";
import {
  commitPdfImport,
  previewPdfImport,
  readPdfImport,
  startPdfImport,
  type StatementModelClient,
} from "./pdf-import";
import type { ImportProfile } from "./profile";
import { writeWorkbook } from "./spreadsheet-fixture";

// Mixed formats (T155): a PDF row's dedup key differs from a CSV or spreadsheet row's, so the
// preview warns when the account already has rows of the other kind in the file's date range.
// Overlapping PDFs still recognise each other's rows.

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Db;
let queue: JobQueue;
let userCount = 0;

// Fictional IBANs from the published test ranges.
const ownIban = "DE89370400440532013000";
const otherOwnIban = "GB82WEST12345698765432";

const profile: ImportProfile = {
  name: "Example Bank",
  skipLines: 0,
  delimiter: ",",
  encoding: "utf-8",
  decimalSeparator: ".",
  dateFormat: "YYYY-MM-DD",
  columns: { bookingDate: "Date", amount: "Amount", ownIban: "Account" },
  debitValues: null,
};

type Row = [date: string, amount: string];

function csv(rows: Row[], iban = ownIban) {
  const lines = rows.map(([date, amount]) => `${date},${amount},${iban}`);
  return new TextEncoder().encode(["Date,Amount,Account", ...lines].join("\n") + "\n");
}

function answer(rows: Row[], iban = ownIban) {
  return {
    isStatement: true,
    accountIbans: [iban],
    currency: "EUR",
    openingBalance: null,
    closingBalance: null,
    transactions: rows.map(([bookingDate, amount]) => ({
      bookingDate,
      amount,
      currency: "EUR",
      counterparty: "GROCERY MART",
      counterpartyIban: null,
      description: null,
    })),
  };
}

async function createUser() {
  const [user] = await db
    .insert(schema.users)
    .values({ name: "Example User", email: `mixed${++userCount}@example.test` })
    .returning({ id: schema.users.id });
  await ensureMoneyDefaults(db, user!.id);
  return user!.id;
}

async function createBankAccount(userId: string, iban = ownIban) {
  const result = await createAccount(db, userId, {
    name: "Example Bank",
    type: "bank",
    currency: "EUR",
    iban,
  });
  if (!result.ok) throw new Error(`createAccount failed: ${result.reason}`);
  return result.account;
}

// A PDF import of the user's, read with a fake client answering `value`.
async function readPdf(userId: string, value: unknown) {
  const started = await startPdfImport(
    db,
    userId,
    { filename: "statement.pdf", bytes: new TextEncoder().encode("%PDF-1.7\n") },
    { queue },
  );
  if (!started.ok) throw new Error(`startPdfImport failed: ${started.reason}`);
  const client: StatementModelClient = { readStatement: async () => value };
  await readPdfImport(db, userId, started.pdfImportId, { client });
  return started.pdfImportId;
}

async function importCsv(userId: string, bytes: Uint8Array) {
  const result = await commitImport(db, userId, { profile, filename: "statement.csv", bytes });
  if (!result.ok) throw new Error(`commitImport failed: ${result.reason}`);
}

async function importPdf(userId: string, rows: Row[], iban = ownIban) {
  const pdfImportId = await readPdf(userId, answer(rows, iban));
  const result = await commitPdfImport(db, userId, { pdfImportId });
  if (!result.ok) throw new Error(`commitPdfImport failed: ${result.reason}`);
  return result;
}

async function previewPdf(userId: string, rows: Row[]) {
  return previewPdfImport(db, userId, { pdfImportId: await readPdf(userId, answer(rows)) });
}

describe("mixed formats", () => {
  beforeAll(async () => {
    database = await createTestDatabase();
    db = createDb(database.url);
    queue = await startJobQueue(database.url);
  });
  afterAll(async () => {
    await queue?.stop({ graceful: false });
    await db?.$client.end();
    await database?.drop();
  });

  describe("previewing a PDF", () => {
    it("warns when the account has CSV rows in the statement's date range", async () => {
      const userId = await createUser();
      await createBankAccount(userId);
      await importCsv(userId, csv([["2026-03-10", "-4.20"]]));

      expect(
        await previewPdf(userId, [
          ["2026-03-01", "-1.00"],
          ["2026-03-31", "-2.00"],
        ]),
      ).toMatchObject({ ok: true, mixedFormats: true });
    });

    it("counts the range's first and last days", async () => {
      const userId = await createUser();
      await createBankAccount(userId);
      await importCsv(userId, csv([["2026-03-31", "-4.20"]]));

      expect(
        await previewPdf(userId, [
          ["2026-03-01", "-1.00"],
          ["2026-03-31", "-2.00"],
        ]),
      ).toMatchObject({ mixedFormats: true });
    });

    it("doesn't warn when the CSV rows are outside the statement's date range", async () => {
      const userId = await createUser();
      await createBankAccount(userId);
      await importCsv(
        userId,
        csv([
          ["2026-02-28", "-4.20"],
          ["2026-04-01", "-4.20"],
        ]),
      );

      expect(
        await previewPdf(userId, [
          ["2026-03-01", "-1.00"],
          ["2026-03-31", "-2.00"],
        ]),
      ).toMatchObject({ ok: true, mixedFormats: false });
    });

    it("doesn't warn about CSV rows in another account", async () => {
      const userId = await createUser();
      await createBankAccount(userId);
      await createBankAccount(userId, otherOwnIban);
      await importCsv(userId, csv([["2026-03-10", "-4.20"]], otherOwnIban));

      expect(await previewPdf(userId, [["2026-03-10", "-1.00"]])).toMatchObject({
        mixedFormats: false,
      });
    });

    it("doesn't warn about the account's earlier PDF rows", async () => {
      const userId = await createUser();
      await createBankAccount(userId);
      await importPdf(userId, [["2026-03-10", "-4.20"]]);

      expect(await previewPdf(userId, [["2026-03-10", "-1.00"]])).toMatchObject({
        mixedFormats: false,
      });
    });

    it("doesn't warn about manually entered transactions", async () => {
      const userId = await createUser();
      const account = await createBankAccount(userId);
      await db.insert(schema.moneyTransactions).values({
        userId,
        accountId: account.id,
        bookedOn: "2026-03-10",
        amountCents: -420n,
        currency: "EUR",
        source: "manual",
      });

      expect(await previewPdf(userId, [["2026-03-10", "-1.00"]])).toMatchObject({
        mixedFormats: false,
      });
    });
  });

  describe("previewing a CSV or spreadsheet", () => {
    it("warns about a CSV when the account has PDF rows in the file's date range", async () => {
      const userId = await createUser();
      await createBankAccount(userId);
      await importPdf(userId, [["2026-03-10", "-4.20"]]);

      expect(
        await previewImport(db, userId, {
          profile,
          filename: "statement.csv",
          bytes: csv([
            ["2026-03-01", "-1.00"],
            ["2026-03-31", "-2.00"],
          ]),
        }),
      ).toMatchObject({ ok: true, mixedFormats: true });
    });

    it("warns about a spreadsheet the same way", async () => {
      const userId = await createUser();
      await createBankAccount(userId);
      await importPdf(userId, [["2026-03-10", "-4.20"]]);
      const bytes = writeWorkbook([
        ["Date", "Amount", "Account"],
        [{ date: "2026-03-01" }, -1, ownIban],
        [{ date: "2026-03-31" }, -2, ownIban],
      ]);

      expect(
        await previewImport(db, userId, { profile, filename: "statement.xlsx", bytes }),
      ).toMatchObject({ ok: true, mixedFormats: true });
    });

    it("doesn't warn when the PDF rows are outside the file's date range", async () => {
      const userId = await createUser();
      await createBankAccount(userId);
      await importPdf(userId, [["2026-04-01", "-4.20"]]);

      expect(
        await previewImport(db, userId, {
          profile,
          filename: "statement.csv",
          bytes: csv([["2026-03-31", "-1.00"]]),
        }),
      ).toMatchObject({ ok: true, mixedFormats: false });
    });

    it("doesn't warn about the account's earlier CSV rows", async () => {
      const userId = await createUser();
      await createBankAccount(userId);
      await importCsv(userId, csv([["2026-03-10", "-4.20"]]));

      expect(
        await previewImport(db, userId, {
          profile,
          filename: "statement.csv",
          bytes: csv([["2026-03-10", "-1.00"]]),
        }),
      ).toMatchObject({ ok: true, mixedFormats: false });
    });
  });

  it("adds each transaction of two overlapping PDFs once", async () => {
    const userId = await createUser();
    await createBankAccount(userId);
    const first = await importPdf(userId, [
      ["2026-03-01", "-1.00"],
      ["2026-03-15", "-4.20"],
      ["2026-03-15", "-4.20"],
      ["2026-03-20", "-9.99"],
    ]);
    const second = await importPdf(userId, [
      ["2026-03-15", "-4.20"],
      ["2026-03-15", "-4.20"],
      ["2026-03-20", "-9.99"],
      ["2026-04-02", "-3.00"],
    ]);

    expect(first).toMatchObject({ rowsNew: 4, rowsDuplicate: 0 });
    expect(second).toMatchObject({ rowsNew: 1, rowsDuplicate: 3 });
    const saved = await db
      .select({
        bookedOn: schema.moneyTransactions.bookedOn,
        amountCents: schema.moneyTransactions.amountCents,
      })
      .from(schema.moneyTransactions)
      .where(eq(schema.moneyTransactions.userId, userId))
      .orderBy(asc(schema.moneyTransactions.bookedOn), asc(schema.moneyTransactions.amountCents));
    expect(saved).toEqual([
      { bookedOn: "2026-03-01", amountCents: -100n },
      { bookedOn: "2026-03-15", amountCents: -420n },
      { bookedOn: "2026-03-15", amountCents: -420n },
      { bookedOn: "2026-03-20", amountCents: -999n },
      { bookedOn: "2026-04-02", amountCents: -300n },
    ]);
  });
});
