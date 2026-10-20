import { createDb, schema, type Db } from "@troba/db";
import { createTestDatabase } from "@troba/db/test-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  archiveAccount,
  createAccount,
  listAccounts,
  renameAccount,
  restoreAccount,
} from "./accounts";

// Fictional IBANs with valid check digits.
const iban = "DE50000000000123456789";
const otherIban = "NL13TEST0123456789";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Db;
let userCount = 0;

async function createUser() {
  const [user] = await db
    .insert(schema.users)
    .values({ name: "Example User", email: `accounts${++userCount}@example.test` })
    .returning({ id: schema.users.id });
  return user!.id;
}

async function createOk(userId: string, input: Parameters<typeof createAccount>[2]) {
  const result = await createAccount(db, userId, input);
  if (!result.ok) throw new Error(`createAccount failed: ${result.reason}`);
  return result.account;
}

describe("accounts", () => {
  beforeAll(async () => {
    database = await createTestDatabase();
    db = createDb(database.url);
  });
  afterAll(async () => {
    await db?.$client.end();
    await database?.drop();
  });

  it("creates a bank account with a normalized IBAN", async () => {
    const userId = await createUser();

    const result = await createAccount(db, userId, {
      name: "  Example Bank current ",
      type: "bank",
      currency: "EUR",
      iban: "de50 0000 0000 0123 4567 89",
    });

    expect(result).toMatchObject({
      ok: true,
      account: {
        name: "Example Bank current",
        type: "bank",
        currency: "EUR",
        iban,
        archivedAt: null,
      },
    });
    expect(await listAccounts(db, userId)).toEqual([result.ok && result.account]);
  });

  it("creates accounts without an IBAN, in other currencies", async () => {
    const userId = await createUser();

    await createOk(userId, { name: "Savings jar", type: "other", currency: "USD" });
    await createOk(userId, { name: "Card", type: "bank", currency: "EUR", iban: null });

    expect(await listAccounts(db, userId)).toMatchObject([
      { name: "Savings jar", type: "other", currency: "USD", iban: null },
      { name: "Card", type: "bank", currency: "EUR", iban: null },
    ]);
  });

  it("refuses an IBAN with wrong check digits", async () => {
    const userId = await createUser();

    expect(
      await createAccount(db, userId, {
        name: "Typo",
        type: "bank",
        currency: "EUR",
        iban: "DE51000000000123456789",
      }),
    ).toEqual({ ok: false, reason: "invalid-iban" });
    expect(await listAccounts(db, userId)).toEqual([]);
  });

  it("refuses an IBAN on an account that isn't a bank account", async () => {
    const userId = await createUser();

    expect(
      await createAccount(db, userId, { name: "Wallet", type: "cash", currency: "EUR", iban }),
    ).toEqual({ ok: false, reason: "iban-not-bank" });
  });

  it("allows an IBAN once per user, written any way", async () => {
    const userId = await createUser();
    await createOk(userId, { name: "First", type: "bank", currency: "EUR", iban });

    expect(
      await createAccount(db, userId, {
        name: "Again",
        type: "bank",
        currency: "EUR",
        iban: iban.toLowerCase().replace(/(.{4})/g, "$1 "),
      }),
    ).toEqual({ ok: false, reason: "iban-taken" });
    await createOk(userId, { name: "Other", type: "bank", currency: "EUR", iban: otherIban });

    // Another user can hold the same IBAN (a shared account).
    const otherUser = await createUser();
    await createOk(otherUser, { name: "Shared", type: "bank", currency: "EUR", iban });
  });

  it("renames an account", async () => {
    const userId = await createUser();
    const account = await createOk(userId, { name: "Old", type: "cash", currency: "EUR" });

    expect(await renameAccount(db, userId, { accountId: account.id, name: " New " })).toBe(true);

    expect(await listAccounts(db, userId)).toMatchObject([{ id: account.id, name: "New" }]);
  });

  it("hides archived accounts from pickers but keeps them", async () => {
    const userId = await createUser();
    const kept = await createOk(userId, { name: "Kept", type: "cash", currency: "EUR" });
    const closed = await createOk(userId, { name: "Closed", type: "bank", currency: "EUR", iban });
    const now = new Date("2026-03-01T10:00:00Z");

    expect(await archiveAccount(db, userId, { accountId: closed.id, now })).toBe(true);
    expect(await archiveAccount(db, userId, { accountId: closed.id })).toBe(false);

    expect((await listAccounts(db, userId)).map((account) => account.id)).toEqual([kept.id]);
    expect(await listAccounts(db, userId, { includeArchived: true })).toMatchObject([
      { id: kept.id, archivedAt: null },
      { id: closed.id, archivedAt: now },
    ]);
    // An archived account still owns its IBAN.
    expect(
      await createAccount(db, userId, { name: "Reopened", type: "bank", currency: "EUR", iban }),
    ).toEqual({ ok: false, reason: "iban-taken" });
  });

  it("restores an archived account to the pickers", async () => {
    const userId = await createUser();
    const account = await createOk(userId, { name: "Back", type: "cash", currency: "EUR" });
    await archiveAccount(db, userId, { accountId: account.id });

    expect(await restoreAccount(db, userId, { accountId: account.id })).toBe(true);
    expect(await restoreAccount(db, userId, { accountId: account.id })).toBe(false);

    expect(await listAccounts(db, userId)).toEqual([account]);
  });

  describe("another user", () => {
    it("can't see, rename or archive the owner's accounts", async () => {
      const owner = await createUser();
      const intruder = await createUser();
      const account = await createOk(owner, { name: "Mine", type: "bank", currency: "EUR", iban });

      expect(await listAccounts(db, intruder, { includeArchived: true })).toEqual([]);
      expect(await renameAccount(db, intruder, { accountId: account.id, name: "Theirs" })).toBe(
        false,
      );
      expect(await archiveAccount(db, intruder, { accountId: account.id })).toBe(false);
      expect(await listAccounts(db, owner)).toEqual([account]);

      await archiveAccount(db, owner, { accountId: account.id });
      expect(await restoreAccount(db, intruder, { accountId: account.id })).toBe(false);
      expect(await listAccounts(db, owner)).toEqual([]);
    });
  });
});
