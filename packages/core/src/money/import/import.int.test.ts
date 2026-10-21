import { readFileSync } from "node:fs";
import path from "node:path";
import { createDb, schema, type Db } from "@troba/db";
import { createTestDatabase } from "@troba/db/test-database";
import { rowsOwnedBy } from "@troba/db/user-tables";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { archiveAccount, createAccount, listAccounts } from "../accounts";
import { deleteCategory, listCategories, renameCategory } from "../categories";
import { ensureMoneyDefaults } from "../defaults";
import { listTransactions } from "../transactions";
import {
  commitImport,
  maxImportFileBytes,
  previewImport,
  type CommitImportResult,
  type ImportInput,
} from "./import";
import type { ImportProfile } from "./profile";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Db;
let userCount = 0;

const fixtures = path.join(import.meta.dirname, "../../../test/fixtures/csv");
const signedFile = readFileSync(path.join(fixtures, "example-bank-signed.csv"));
const ownIban = "DE89370400440532013000";

// The signed fixture's format: a transaction id, an own-account column and a counterparty IBAN.
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

// The debit/credit fixture's format: unsigned amounts, a D/C column, a preamble line.
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

async function createUser() {
  const [user] = await db
    .insert(schema.users)
    .values({ name: "Example User", email: `import${++userCount}@example.test` })
    .returning({ id: schema.users.id });
  await ensureMoneyDefaults(db, user!.id);
  return user!.id;
}

async function createBankAccount(userId: string, iban: string, currency = "EUR") {
  const result = await createAccount(db, userId, {
    name: "Example Bank",
    type: "bank",
    currency,
    iban,
  });
  if (!result.ok) throw new Error(`createAccount failed: ${result.reason}`);
  return result.account;
}

function signedInput(overrides: Partial<ImportInput> = {}): ImportInput {
  return { profile: signedProfile, filename: "statement.csv", bytes: signedFile, ...overrides };
}

// A signed-format file of count generated rows, then the extra lines.
function generatedFile(count: number, extra: string[] = []) {
  const [header] = signedFile.toString("utf8").split("\n");
  const rows = Array.from(
    { length: count },
    (_, i) => `X${i},02/03/2026,01/03/2026,-1.00,EUR,GROCERY MART,,Card purchase,CARD,${ownIban}`,
  );
  return Buffer.from([header, ...rows, ...extra].join("\n"));
}

// Nothing reads import records back yet.
async function importRecord(userId: string, result: CommitImportResult) {
  if (!result.ok) throw new Error(`commitImport failed: ${result.reason}`);
  const [record] = await db
    .select({
      rowsParsed: schema.moneyImports.rowsParsed,
      rowsNew: schema.moneyImports.rowsNew,
      rowsDuplicate: schema.moneyImports.rowsDuplicate,
      rowsFailed: schema.moneyImports.rowsFailed,
    })
    .from(schema.moneyImports)
    .where(
      and(eq(schema.moneyImports.userId, userId), eq(schema.moneyImports.id, result.importId)),
    );
  return record;
}

describe("import", () => {
  beforeAll(async () => {
    database = await createTestDatabase();
    db = createDb(database.url);
  });
  afterAll(async () => {
    await db?.$client.end();
    await database?.drop();
  });

  it("previews a file for the account with its own IBAN", async () => {
    const userId = await createUser();
    const account = await createBankAccount(userId, ownIban);

    const preview = await previewImport(db, userId, signedInput());

    expect(preview).toEqual({
      ok: true,
      account: expect.objectContaining({ id: account.id }),
      rowsParsed: 5,
      rowsNew: 5,
      rowsDuplicate: 0,
      failed: [],
      debitCredit: null,
    });
  });

  it("previews the debit/credit indicators a file uses", async () => {
    const userId = await createUser();
    await createBankAccount(userId, ownIban);

    const preview = await previewImport(db, userId, {
      profile: debitCreditProfile,
      filename: "statement.csv",
      bytes: readFileSync(path.join(fixtures, "example-bank-debit-credit.csv")),
    });

    expect(preview).toMatchObject({
      ok: true,
      rowsNew: 8,
      debitCredit: [
        { value: "D", debit: true, rows: 6 },
        { value: "C", debit: false, rows: 2 },
      ],
    });
  });

  it("commits the new rows with the bank's raw row, and a re-import adds none", async () => {
    const userId = await createUser();
    const account = await createBankAccount(userId, ownIban);

    const first = await commitImport(db, userId, signedInput());
    const again = await commitImport(db, userId, signedInput());

    expect(first).toMatchObject({ ok: true, rowsParsed: 5, rowsNew: 5, rowsDuplicate: 0 });
    expect(again).toMatchObject({ ok: true, rowsParsed: 5, rowsNew: 0, rowsDuplicate: 5 });
    expect(await importRecord(userId, again)).toEqual({
      rowsParsed: 5,
      rowsNew: 0,
      rowsDuplicate: 5,
      rowsFailed: 0,
    });
    expect(await previewImport(db, userId, signedInput())).toMatchObject({
      rowsNew: 0,
      rowsDuplicate: 5,
    });
    const saved = await listTransactions(db, userId);
    expect(saved).toHaveLength(5);
    expect(saved).toContainEqual(
      expect.objectContaining({
        accountId: account.id,
        bookedOn: "2026-03-01",
        amountCents: -4215n,
        currency: "EUR",
        counterparty: "GROCERY MART",
        description: "Card purchase",
        source: "csv_import",
      }),
    );
    // Nothing reads raw back yet; it is kept for debugging and re-parsing.
    const [grocery] = await db
      .select({ raw: schema.moneyTransactions.raw, importId: schema.moneyTransactions.importId })
      .from(schema.moneyTransactions)
      .where(
        and(
          eq(schema.moneyTransactions.userId, userId),
          eq(schema.moneyTransactions.counterparty, "GROCERY MART"),
        ),
      );
    expect(grocery).toEqual({
      importId: first.ok ? first.importId : null,
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

  it("counts rows overlapping an earlier import as duplicates", async () => {
    const userId = await createUser();
    await createBankAccount(userId, ownIban);
    const [header, ...lines] = signedFile.toString("utf8").trimEnd().split("\n");
    const file = (rows: string[]) => Buffer.from([header, ...rows].join("\n"));

    await commitImport(db, userId, signedInput({ bytes: file(lines.slice(0, 3)) }));
    const overlapping = await commitImport(
      db,
      userId,
      signedInput({ bytes: file(lines.slice(1)) }),
    );

    expect(overlapping).toMatchObject({ ok: true, rowsNew: 2, rowsDuplicate: 2 });
    expect(await listTransactions(db, userId)).toHaveLength(5);
  });

  it("saves nothing when the commit fails part-way", async () => {
    const userId = await createUser();
    await createBankAccount(userId, ownIban);
    const before = await rowsOwnedBy(db, userId);
    // The file's last row fails on insert, in a later insert statement than the first rows.
    const bytes = generatedFile(1500, [
      `Y1,07/03/2026,06/03/2026,-23.40,EUR,CAFE,,Card purchase,CARD,${ownIban}`,
    ]);
    await db.$client.query(`
      create function fail_on_cafe() returns trigger language plpgsql as $$
      begin
        if new.counterparty = 'CAFE' then raise exception 'forced failure'; end if;
        return new;
      end $$;
      create trigger fail_on_cafe before insert on money_transactions
        for each row execute function fail_on_cafe();
    `);

    try {
      await expect(commitImport(db, userId, signedInput({ bytes }))).rejects.toThrow();
    } finally {
      await db.$client.query(`
        drop trigger fail_on_cafe on money_transactions;
        drop function fail_on_cafe();
      `);
    }

    expect(await rowsOwnedBy(db, userId)).toEqual(before);
    expect(await commitImport(db, userId, signedInput({ bytes }))).toMatchObject({
      ok: true,
      rowsNew: 1501,
    });
  });

  it("offers to create a bank account for an IBAN the user has no account for", async () => {
    const userId = await createUser();

    const preview = await previewImport(db, userId, signedInput());
    const commit = await commitImport(db, userId, signedInput());

    const offer = { ok: false, reason: "unknown-account", iban: ownIban, currency: "EUR" };
    expect(preview).toEqual(offer);
    expect(commit).toEqual(offer);
    await createBankAccount(userId, ownIban);
    expect(await previewImport(db, userId, signedInput())).toMatchObject({ ok: true, rowsNew: 5 });
  });

  it("offers the file's currency for the new account", async () => {
    const userId = await createUser();
    const bytes = Buffer.from(signedFile.toString("utf8").replaceAll(",EUR,", ",USD,"));

    expect(await previewImport(db, userId, signedInput({ bytes }))).toEqual({
      ok: false,
      reason: "unknown-account",
      iban: ownIban,
      currency: "USD",
    });
  });

  it("fails rows in a currency other than the account's, listed in row order", async () => {
    const userId = await createUser();
    await createBankAccount(userId, ownIban);
    const bytes = Buffer.from(
      signedFile
        .toString("utf8")
        .replace('"1,500.00",EUR', '"1,500.00",USD')
        .replace("12.99,EUR", "12.99,usd")
        .replace("-1.50", "one fifty"),
    );

    const result = await commitImport(db, userId, signedInput({ bytes }));

    expect(result).toMatchObject({
      ok: true,
      rowsNew: 2,
      failed: [
        { row: 2, reason: "currency-mismatch" },
        { row: 3, reason: "currency-mismatch" },
        { row: 4, reason: "invalid-amount" },
      ],
    });
    const saved = await listTransactions(db, userId);
    expect(saved.map((t) => t.currency)).toEqual(["EUR", "EUR"]);
  });

  it(`refuses a file over ${maxImportFileBytes} bytes before reading it`, async () => {
    const userId = await createUser();
    await createBankAccount(userId, ownIban);
    const bytes = new Uint8Array(maxImportFileBytes + 1);

    const tooLarge = { ok: false, reason: "file-too-large" };
    expect(await previewImport(db, userId, signedInput({ bytes }))).toEqual(tooLarge);
    expect(await commitImport(db, userId, signedInput({ bytes }))).toEqual(tooLarge);
    // The limit itself is allowed (this file is refused for its content instead).
    const atLimit = signedInput({ bytes: new Uint8Array(maxImportFileBytes) });
    expect(await previewImport(db, userId, atLimit)).not.toMatchObject(tooLarge);
  });

  it("rejects a file with more than one own IBAN, saving nothing", async () => {
    const userId = await createUser();
    await createBankAccount(userId, ownIban);
    const otherIban = "GB82 WEST 1234 5698 7654 32";
    const bytes = Buffer.from(
      signedFile.toString("utf8").replace(/DE89 3704 0044 0532 0130 00\s*$/, otherIban),
    );
    const before = await rowsOwnedBy(db, userId);

    const rejected = { ok: false, reason: "multiple-own-ibans" };
    expect(await previewImport(db, userId, signedInput({ bytes }))).toEqual(rejected);
    expect(await commitImport(db, userId, signedInput({ bytes }))).toEqual(rejected);
    expect(await rowsOwnedBy(db, userId)).toEqual(before);
  });

  it("rejects a file missing a column its profile maps", async () => {
    const userId = await createUser();
    await createBankAccount(userId, ownIban);
    const bytes = Buffer.from(signedFile.toString("utf8").replace("Details", "Notes"));

    expect(await commitImport(db, userId, signedInput({ bytes }))).toEqual({
      ok: false,
      reason: "missing-columns",
      columns: ["Details"],
    });
    expect(await listTransactions(db, userId)).toEqual([]);
  });

  it("reports rows that fail to parse, with their reasons, and saves the rest", async () => {
    const userId = await createUser();
    await createBankAccount(userId, ownIban);
    const bytes = Buffer.from(
      signedFile.toString("utf8").replace("-1.50", "one fifty").replace("06/03/2026", "31/02/2026"),
    );

    const failed = [
      { row: 4, reason: "invalid-amount" },
      { row: 5, reason: "invalid-date" },
    ];
    expect(await previewImport(db, userId, signedInput({ bytes }))).toMatchObject({
      ok: true,
      rowsParsed: 5,
      rowsNew: 3,
      failed,
    });
    const committed = await commitImport(db, userId, signedInput({ bytes }));
    expect(committed).toMatchObject({ ok: true, rowsNew: 3, failed });
    expect(await importRecord(userId, committed)).toEqual({
      rowsParsed: 5,
      rowsNew: 3,
      rowsDuplicate: 0,
      rowsFailed: 2,
    });
    expect(await listTransactions(db, userId)).toHaveLength(3);
  });

  it("imports a file too large for one statement", async () => {
    const userId = await createUser();
    const account = await createBankAccount(userId, ownIban);
    // Postgres binds at most 65,535 parameters per statement: more rows than that in one insert
    // or one dedup lookup (a parameter per row) would fail. Short rows keep the file small.
    const count = 70_000;
    const profile: ImportProfile = {
      ...signedProfile,
      columns: { transactionId: "Id", bookingDate: "Posted", amount: "Amount" },
    };
    const rows = Array.from({ length: count }, (_, i) => `X${i},02/03/2026,-1.00`);
    const input = signedInput({
      profile,
      accountId: account.id,
      bytes: Buffer.from(["Id,Posted,Amount", ...rows].join("\n")),
    });

    expect(await commitImport(db, userId, input)).toMatchObject({ rowsNew: count });
    expect(await previewImport(db, userId, input)).toMatchObject({
      rowsNew: 0,
      rowsDuplicate: count,
    });
    expect(await commitImport(db, userId, input)).toMatchObject({
      rowsNew: 0,
      rowsDuplicate: count,
    });
  }, 60_000);

  describe("without an own-IBAN column", () => {
    // No currency column either, so rows take the account's currency.
    const columns = { ...signedProfile.columns };
    delete columns.ownIban;
    delete columns.currency;
    const profile: ImportProfile = { ...signedProfile, columns };

    it("needs the user to pick the account", async () => {
      const userId = await createUser();

      expect(await previewImport(db, userId, signedInput({ profile }))).toEqual({
        ok: false,
        reason: "account-required",
      });
    });

    it("imports into the picked account, in its currency", async () => {
      const userId = await createUser();
      const account = await createBankAccount(userId, ownIban, "USD");

      const result = await commitImport(
        db,
        userId,
        signedInput({ profile, accountId: account.id }),
      );

      expect(result).toMatchObject({ ok: true, rowsNew: 5 });
      const saved = await listTransactions(db, userId);
      expect(saved.map((t) => [t.accountId, t.currency])).toEqual(
        Array(5).fill([account.id, "USD"]),
      );
    });

    it("refuses an archived account, or one that isn't the user's", async () => {
      const userId = await createUser();
      const otherUserId = await createUser();
      const others = await createBankAccount(otherUserId, ownIban);
      const archived = await createBankAccount(userId, ownIban);
      await archiveAccount(db, userId, { accountId: archived.id });

      for (const accountId of [others.id, archived.id]) {
        expect(await commitImport(db, userId, signedInput({ profile, accountId }))).toEqual({
          ok: false,
          reason: "account-not-found",
        });
      }
      expect(await rowsOwnedBy(db, otherUserId)).toMatchObject({ money_transactions: 0 });
    });
  });

  it("refuses a picked account that isn't the file's own IBAN", async () => {
    const userId = await createUser();
    await createBankAccount(userId, ownIban);
    const [cash] = await listAccounts(db, userId);

    expect(await previewImport(db, userId, signedInput({ accountId: cash!.id }))).toEqual({
      ok: false,
      reason: "account-mismatch",
    });
  });

  describe("transfer detection", () => {
    it("puts a row whose counterparty is one of the user's accounts in Transfers", async () => {
      const userId = await createUser();
      await createBankAccount(userId, ownIban);
      // Row T1002's counterparty IBAN, as another of the user's accounts.
      await createBankAccount(userId, "GB82WEST12345698765432");

      await commitImport(db, userId, signedInput());

      const saved = await listTransactions(db, userId);
      const categorized = saved.filter((t) => t.categoryId !== null);
      expect(categorized).toEqual([
        expect.objectContaining({
          counterparty: "ACME LTD",
          categoryName: "Transfers",
          categorySource: "transfer",
        }),
      ]);
    });

    it("finds Transfers after a rename and a refused delete", async () => {
      const userId = await createUser();
      await createBankAccount(userId, ownIban);
      await createBankAccount(userId, "GB82WEST12345698765432");
      const transfers = (await listCategories(db, userId)).find((c) => c.name === "Transfers")!;
      await renameCategory(db, userId, { categoryId: transfers.id, name: "Between my accounts" });
      expect(await deleteCategory(db, userId, { categoryId: transfers.id })).toBe(false);

      await commitImport(db, userId, signedInput());

      const acme = (await listTransactions(db, userId)).find((t) => t.counterparty === "ACME LTD");
      expect(acme).toMatchObject({
        categoryId: transfers.id,
        categoryName: "Between my accounts",
        categorySource: "transfer",
      });
    });

    it("leaves transfers uncategorized for a user who deleted Transfers before it was kept", async () => {
      const userId = await createUser();
      await createBankAccount(userId, ownIban);
      await createBankAccount(userId, "GB82WEST12345698765432");
      const transfers = (await listCategories(db, userId)).find((c) => c.name === "Transfers")!;
      await db
        .delete(schema.moneyCategories)
        .where(
          and(
            eq(schema.moneyCategories.id, transfers.id),
            eq(schema.moneyCategories.userId, userId),
          ),
        );

      expect(await commitImport(db, userId, signedInput())).toMatchObject({ rowsNew: 5 });

      const acme = (await listTransactions(db, userId)).find((t) => t.counterparty === "ACME LTD");
      expect(acme).toMatchObject({ categoryId: null, categorySource: null });
    });

    it("leaves rows uncategorized when no counterparty is the user's", async () => {
      const userId = await createUser();
      await createBankAccount(userId, ownIban);
      const otherUserId = await createUser();
      await createBankAccount(otherUserId, "GB82WEST12345698765432");

      await commitImport(db, userId, signedInput());

      const saved = await listTransactions(db, userId);
      expect(saved.map((t) => [t.categoryId, t.categorySource])).toEqual(
        Array(5).fill([null, null]),
      );
    });
  });

  describe("between users", () => {
    async function createProfile(userId: string) {
      const [profile] = await db
        .insert(schema.moneyImportProfiles)
        .values({
          userId,
          name: signedProfile.name,
          headerFingerprint: "fingerprint",
          decimalSeparator: signedProfile.decimalSeparator,
          dateFormat: signedProfile.dateFormat,
          columns: signedProfile.columns,
        })
        .returning({ id: schema.moneyImportProfiles.id });
      return profile!.id;
    }

    it("doesn't count another user's rows as duplicates", async () => {
      const userA = await createUser();
      const userB = await createUser();
      await createBankAccount(userA, ownIban);
      await createBankAccount(userB, ownIban);

      await commitImport(db, userA, signedInput());

      expect(await previewImport(db, userB, signedInput())).toMatchObject({ rowsNew: 5 });
      expect(await commitImport(db, userB, signedInput())).toMatchObject({ rowsNew: 5 });
      expect(await listTransactions(db, userA)).toHaveLength(5);
      expect(await listTransactions(db, userB)).toHaveLength(5);
    });

    it("never matches another user's account by IBAN", async () => {
      const userA = await createUser();
      const userB = await createUser();
      await createBankAccount(userA, ownIban);

      expect(await commitImport(db, userB, signedInput())).toMatchObject({
        ok: false,
        reason: "unknown-account",
      });
      expect(await rowsOwnedBy(db, userA)).toMatchObject({
        money_imports: 0,
        money_transactions: 0,
      });
    });

    it("records the user's own profile on the import, and refuses another's", async () => {
      const userA = await createUser();
      const userB = await createUser();
      await createBankAccount(userB, ownIban);
      const profileA = await createProfile(userA);
      const profileB = await createProfile(userB);

      const refused = await commitImport(db, userB, signedInput({ profileId: profileA }));
      const committed = await commitImport(db, userB, signedInput({ profileId: profileB }));

      expect(refused).toEqual({ ok: false, reason: "profile-not-found" });
      expect(await previewImport(db, userB, signedInput({ profileId: profileA }))).toEqual(refused);
      // Nothing reads imports back yet.
      const imports = await db
        .select({
          id: schema.moneyImports.id,
          profileId: schema.moneyImports.profileId,
          filename: schema.moneyImports.filename,
          rowsParsed: schema.moneyImports.rowsParsed,
          rowsNew: schema.moneyImports.rowsNew,
          rowsDuplicate: schema.moneyImports.rowsDuplicate,
          rowsFailed: schema.moneyImports.rowsFailed,
        })
        .from(schema.moneyImports)
        .where(eq(schema.moneyImports.userId, userB));
      expect(imports).toEqual([
        {
          id: committed.ok ? committed.importId : null,
          profileId: profileB,
          filename: "statement.csv",
          rowsParsed: 5,
          rowsNew: 5,
          rowsDuplicate: 0,
          rowsFailed: 0,
        },
      ]);
    });
  });
});
