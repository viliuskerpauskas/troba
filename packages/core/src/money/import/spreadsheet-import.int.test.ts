import { createDb, schema, type Db } from "@troba/db";
import { createTestDatabase } from "@troba/db/test-database";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAccount } from "../accounts";
import { ensureMoneyDefaults } from "../defaults";
import { listTransactions } from "../transactions";
import { commitImport, previewImport, type ImportInput } from "./import";
import { definePreset } from "./presets";
import type { ImportProfile } from "./profile";
import { matchImportProfile, saveImportProfile, type SavedImportProfile } from "./profiles";
import { resolveImportFormat } from "./resolve";
import {
  encryptedWorkbook,
  writeWorkbook,
  type FixtureBookType,
  type FixtureCell,
} from "./spreadsheet-fixture";

// Spreadsheet statement files at the import seam (SPEC-money M3, ADR-0019): found by their
// headers among profiles and presets of their own kind, previewed and committed like a CSV.

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Db;
let userCount = 0;

const ownIban = "DE89370400440532013000";
const headers = ["Booked", "Amount", "Currency", "Payee", "Account"];

// A statement title, then typed dates and amounts, as a bank's spreadsheet export has them.
const statementRows: FixtureCell[][] = [
  ["Example Bank statement"],
  headers,
  [{ date: "2026-03-01" }, -4.2, "EUR", "GROCERY MART", ownIban],
  [{ date: "2026-03-02" }, -0.1, "EUR", "CORNER CAFE", ownIban],
  [{ date: "2026-03-02" }, -0.1, "EUR", "CORNER CAFE", ownIban],
  [{ date: "2026-03-05" }, 1234.56, "EUR", "EXAMPLE EMPLOYER", ownIban],
];

// Day-first text dates and decimal commas: what typed cells must not be read as.
const sheetProfile: ImportProfile = {
  name: "Example Bank (sheet)",
  skipLines: 1,
  delimiter: null,
  encoding: "utf-8",
  decimalSeparator: ",",
  dateFormat: "DD.MM.YYYY",
  columns: {
    bookingDate: "Booked",
    amount: "Amount",
    currency: "Currency",
    counterparty: "Payee",
    ownIban: "Account",
  },
  debitValues: null,
};

// The same headers in a CSV.
const csvFile = Buffer.from(
  [
    "Example Bank statement",
    headers.join(";"),
    `01.03.2026;-4,20;EUR;GROCERY MART;${ownIban}`,
  ].join("\n"),
);

async function createUser() {
  const [user] = await db
    .insert(schema.users)
    .values({ name: "Example User", email: `sheet${++userCount}@example.test` })
    .returning({ id: schema.users.id });
  await ensureMoneyDefaults(db, user!.id);
  return user!.id;
}

async function createBankAccount(userId: string) {
  const result = await createAccount(db, userId, {
    name: "Example Bank",
    type: "bank",
    currency: "EUR",
    iban: ownIban,
  });
  if (!result.ok) throw new Error(result.reason);
  return result.account;
}

async function saveProfile(userId: string, bytes: Uint8Array, profile = sheetProfile) {
  const saved = await saveImportProfile(db, userId, { profile, bytes });
  if (!saved.ok) throw new Error(saved.reason);
  return saved.profile;
}

function input(bytes: Uint8Array, profile: SavedImportProfile): ImportInput {
  return { profile, profileId: profile.id, filename: "statement.xlsx", bytes };
}

beforeAll(async () => {
  database = await createTestDatabase();
  db = createDb(database.url);
});

afterAll(async () => {
  await db?.$client.end();
  await database?.drop();
});

describe("spreadsheet import", () => {
  it.each<FixtureBookType>(["xlsx", "xls", "ods"])(
    "resolves, previews and commits an %s statement to the cent",
    async (bookType) => {
      const userId = await createUser();
      const account = await createBankAccount(userId);
      const bytes = writeWorkbook(statementRows, { bookType });

      expect(await resolveImportFormat(db, userId, bytes)).toEqual({
        kind: "unknown",
        reason: "no-match",
      });
      const profile = await saveProfile(userId, bytes);
      expect(profile.kind).toBe("spreadsheet");
      expect(await resolveImportFormat(db, userId, bytes)).toMatchObject({
        kind: "profile",
        source: "saved",
        profile: { id: profile.id },
      });

      expect(await previewImport(db, userId, input(bytes, profile))).toMatchObject({
        ok: true,
        account: { id: account.id },
        rowsParsed: 4,
        rowsNew: 4,
        rowsDuplicate: 0,
        failed: [],
      });
      const committed = await commitImport(db, userId, input(bytes, profile));
      expect(committed).toMatchObject({ ok: true, rowsNew: 4 });

      const saved = await listTransactions(db, userId);
      expect(
        saved
          .map(({ bookedOn, amountCents, counterparty }) => [bookedOn, amountCents, counterparty])
          .sort(),
      ).toEqual(
        [
          ["2026-03-01", -420n, "GROCERY MART"],
          ["2026-03-02", -10n, "CORNER CAFE"],
          ["2026-03-02", -10n, "CORNER CAFE"],
          ["2026-03-05", 123456n, "EXAMPLE EMPLOYER"],
        ].sort(),
      );
    },
  );

  it("adds nothing when the same spreadsheet is imported again", async () => {
    const userId = await createUser();
    await createBankAccount(userId);
    const bytes = writeWorkbook(statementRows);
    const profile = await saveProfile(userId, bytes);
    await commitImport(db, userId, input(bytes, profile));

    expect(await previewImport(db, userId, input(bytes, profile))).toMatchObject({
      ok: true,
      rowsNew: 0,
      rowsDuplicate: 4,
    });
    expect(await commitImport(db, userId, input(bytes, profile))).toMatchObject({
      ok: true,
      rowsNew: 0,
      rowsDuplicate: 4,
    });
  });

  it("doesn't match a CSV profile to a spreadsheet with the same headers", async () => {
    const userId = await createUser();
    const csvProfile = await saveProfile(userId, csvFile, { ...sheetProfile, delimiter: ";" });
    expect(csvProfile.kind).toBe("text");

    expect(await matchImportProfile(db, userId, writeWorkbook(statementRows))).toBeNull();
    expect(await resolveImportFormat(db, userId, writeWorkbook(statementRows))).toEqual({
      kind: "unknown",
      reason: "no-match",
    });
  });

  it("doesn't match a spreadsheet profile to a CSV with the same headers", async () => {
    const userId = await createUser();
    await saveProfile(userId, writeWorkbook(statementRows));

    expect(await matchImportProfile(db, userId, csvFile)).toBeNull();
  });

  it("refuses to read a file with a profile of the other kind", async () => {
    const userId = await createUser();
    await createBankAccount(userId);
    const csvProfile = await saveProfile(userId, csvFile, { ...sheetProfile, delimiter: ";" });

    const bytes = writeWorkbook(statementRows);
    expect(await previewImport(db, userId, input(bytes, csvProfile))).toEqual({
      ok: false,
      reason: "wrong-file-kind",
    });
    expect(await commitImport(db, userId, input(bytes, csvProfile))).toEqual({
      ok: false,
      reason: "wrong-file-kind",
    });
  });

  it("finds a spreadsheet preset for a spreadsheet only", async () => {
    const preset = definePreset({
      id: "example-bank-sheet",
      kind: "spreadsheet",
      headers,
      profile: { ...sheetProfile, name: "Example Bank" },
    });
    const userId = await createUser();

    expect(await resolveImportFormat(db, userId, csvFile, { presets: [preset] })).toEqual({
      kind: "unknown",
      reason: "no-match",
    });
    const resolved = await resolveImportFormat(db, userId, writeWorkbook(statementRows), {
      presets: [preset],
    });
    expect(resolved).toMatchObject({
      kind: "profile",
      source: "preset",
      profile: { name: "Example Bank", kind: "spreadsheet" },
    });
  });

  it("doesn't take a text preset for a spreadsheet with its headers", async () => {
    const preset = definePreset({
      id: "example-bank-csv",
      headers,
      profile: { ...sheetProfile, name: "Example Bank", delimiter: ";" },
    });
    const userId = await createUser();

    expect(
      await resolveImportFormat(db, userId, writeWorkbook(statementRows), { presets: [preset] }),
    ).toEqual({ kind: "unknown", reason: "no-match" });
    expect(await resolveImportFormat(db, userId, csvFile, { presets: [preset] })).toMatchObject({
      kind: "profile",
      source: "preset",
      profile: { kind: "text" },
    });
  });

  it("refuses an unreadable workbook and saves nothing", async () => {
    const userId = await createUser();
    await createBankAccount(userId);
    const profile = await saveProfile(userId, writeWorkbook(statementRows));

    for (const bytes of [encryptedWorkbook(), writeWorkbook(statementRows).subarray(0, 300)]) {
      expect(await saveImportProfile(db, userId, { profile: sheetProfile, bytes })).toEqual({
        ok: false,
        reason: "unreadable-workbook",
      });
      expect(await previewImport(db, userId, input(bytes, profile))).toEqual({
        ok: false,
        reason: "unreadable-workbook",
      });
      expect(await commitImport(db, userId, input(bytes, profile))).toEqual({
        ok: false,
        reason: "unreadable-workbook",
      });
    }
    expect(
      await db.$count(schema.moneyTransactions, eq(schema.moneyTransactions.userId, userId)),
    ).toBe(0);
    expect(await db.$count(schema.moneyImports, eq(schema.moneyImports.userId, userId))).toBe(0);
  });

  it("gives a profile saved before kinds existed the text kind", async () => {
    const userId = await createUser();
    await db.execute(sql`
      insert into money_import_profiles
        (user_id, name, header_fingerprint, decimal_separator, date_format, columns)
      values (${userId}, 'Older profile', 'fingerprint', '.', 'YYYY-MM-DD', '{}'::jsonb)`);

    const [row] = await db
      .select({ kind: schema.moneyImportProfiles.kind })
      .from(schema.moneyImportProfiles)
      .where(
        and(
          eq(schema.moneyImportProfiles.userId, userId),
          eq(schema.moneyImportProfiles.name, "Older profile"),
        ),
      );
    expect(row).toEqual({ kind: "text" });
  });
});
