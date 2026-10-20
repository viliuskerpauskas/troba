import { createDb, schema, type Db } from "@troba/db";
import { createTestDatabase } from "@troba/db/test-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { archiveAccount, createAccount, listAccounts } from "./accounts";
import { listCategories } from "./categories";
import { ensureMoneyDefaults } from "./defaults";
import {
  createTransaction,
  deleteTransaction,
  getTransaction,
  listTransactions,
  transactionListLimit,
  updateTransaction,
  type NewTransaction,
} from "./transactions";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Db;
let userCount = 0;

// A user with the money defaults: a Cash account (EUR) and the default categories.
async function createUser() {
  const [user] = await db
    .insert(schema.users)
    .values({ name: "Example User", email: `transactions${++userCount}@example.test` })
    .returning({ id: schema.users.id });
  const userId = user!.id;
  await ensureMoneyDefaults(db, userId);
  const [cash] = await listAccounts(db, userId);
  const categories = await listCategories(db, userId);
  const category = (name: string) => categories.find((c) => c.name === name)!.id;
  return { userId, cashId: cash!.id, category };
}

async function createOk(userId: string, input: NewTransaction) {
  const result = await createTransaction(db, userId, input);
  if (!result.ok) throw new Error(`createTransaction failed: ${result.reason}`);
  return result.transaction;
}

describe("transactions", () => {
  beforeAll(async () => {
    database = await createTestDatabase();
    db = createDb(database.url);
  });
  afterAll(async () => {
    await db?.$client.end();
    await database?.drop();
  });

  it("adds a manual expense in the account's currency and lists it", async () => {
    const { userId, cashId, category } = await createUser();

    const result = await createTransaction(db, userId, {
      accountId: cashId,
      bookedOn: "2026-10-03",
      amountCents: 1250n,
      direction: "expense",
      counterparty: " GROCERY MART ",
      description: "Weekly shop",
      categoryId: category("Food"),
      note: "Split with a friend",
    });

    const expected = {
      accountId: cashId,
      accountName: "Cash",
      bookedOn: "2026-10-03",
      amountCents: -1250n,
      currency: "EUR",
      counterparty: "GROCERY MART",
      description: "Weekly shop",
      categoryId: category("Food"),
      categoryName: "Food",
      categorySource: "manual",
      note: "Split with a friend",
      source: "manual",
    };
    expect(result).toMatchObject({ ok: true, transaction: expected });
    expect(await listTransactions(db, userId)).toMatchObject([expected]);
  });

  it("adds income as a positive amount, with empty optional fields left out", async () => {
    const { userId, cashId } = await createUser();

    const created = await createOk(userId, {
      accountId: cashId,
      bookedOn: "2026-10-01",
      amountCents: 250000n,
      direction: "income",
      counterparty: "  ",
      description: "",
    });

    expect(created).toMatchObject({
      amountCents: 250000n,
      counterparty: null,
      description: null,
      categoryId: null,
      categoryName: null,
      categorySource: null,
      note: null,
    });
  });

  it("lists the latest ${transactionListLimit} by default", async () => {
    const { userId, cashId } = await createUser();
    await db.insert(schema.moneyTransactions).values(
      Array.from({ length: transactionListLimit + 1 }, (_, day) => ({
        userId,
        accountId: cashId,
        bookedOn: `2025-${String(1 + Math.floor(day / 28)).padStart(2, "0")}-${String(1 + (day % 28)).padStart(2, "0")}`,
        amountCents: -100n,
        currency: "EUR",
        source: "manual" as const,
      })),
    );

    const listed = await listTransactions(db, userId);

    expect(listed).toHaveLength(transactionListLimit);
    expect(listed.at(-1)!.bookedOn).not.toBe("2025-01-01");
  });

  it.each([0n, -500n])("refuses an amount of %s", async (amountCents) => {
    const { userId, cashId } = await createUser();
    const details = { accountId: cashId, bookedOn: "2026-10-05", direction: "expense" } as const;
    const created = await createOk(userId, { ...details, amountCents: 100n });

    expect(await createTransaction(db, userId, { ...details, amountCents })).toEqual({
      ok: false,
      reason: "invalid-amount",
    });
    expect(
      await updateTransaction(db, userId, {
        transactionId: created.id,
        details: { ...details, amountCents },
        categoryId: null,
        note: null,
      }),
    ).toEqual({ ok: false, reason: "invalid-amount" });
    expect(await listTransactions(db, userId)).toEqual([created]);
  });

  it("lists the newest first, the latest added first within a day, up to the limit", async () => {
    const { userId, cashId } = await createUser();
    const add = (bookedOn: string, description: string) =>
      createOk(userId, {
        accountId: cashId,
        bookedOn,
        amountCents: 100n,
        direction: "expense",
        description,
      });
    await add("2026-09-30", "older");
    await add("2026-10-02", "newest");
    await add("2026-10-01", "first that day");
    await add("2026-10-01", "second that day");

    const listed = await listTransactions(db, userId);
    expect(listed.map((t) => t.description)).toEqual([
      "newest",
      "second that day",
      "first that day",
      "older",
    ]);
    expect((await listTransactions(db, userId, { limit: 2 })).map((t) => t.description)).toEqual([
      "newest",
      "second that day",
    ]);
  });

  it("uses the account's currency", async () => {
    const { userId } = await createUser();
    const usd = await createAccount(db, userId, { name: "Travel", type: "other", currency: "USD" });
    if (!usd.ok) throw new Error(usd.reason);

    const created = await createOk(userId, {
      accountId: usd.account.id,
      bookedOn: "2026-10-05",
      amountCents: 999n,
      direction: "expense",
    });

    expect(created).toMatchObject({ currency: "USD", accountName: "Travel" });
  });

  it("refuses an archived account", async () => {
    const { userId, cashId } = await createUser();
    await archiveAccount(db, userId, { accountId: cashId });

    const result = await createTransaction(db, userId, {
      accountId: cashId,
      bookedOn: "2026-10-05",
      amountCents: 100n,
      direction: "expense",
    });

    expect(result).toEqual({ ok: false, reason: "account-not-found" });
    expect(await listTransactions(db, userId)).toEqual([]);
  });

  describe("editing", () => {
    it("changes every field of a manual transaction", async () => {
      const { userId, cashId, category } = await createUser();
      const bank = await createAccount(db, userId, { name: "Card", type: "bank", currency: "USD" });
      if (!bank.ok) throw new Error(bank.reason);
      const created = await createOk(userId, {
        accountId: cashId,
        bookedOn: "2026-10-03",
        amountCents: 1250n,
        direction: "expense",
        counterparty: "GROCERY MART",
        categoryId: category("Food"),
      });

      const result = await updateTransaction(db, userId, {
        transactionId: created.id,
        details: {
          accountId: bank.account.id,
          bookedOn: "2026-10-04",
          amountCents: 4000n,
          direction: "income",
          counterparty: "Example Employer",
          description: "Refund",
        },
        categoryId: category("Income"),
        note: "  ",
      });

      const expected = {
        id: created.id,
        accountId: bank.account.id,
        bookedOn: "2026-10-04",
        amountCents: 4000n,
        currency: "USD",
        counterparty: "Example Employer",
        description: "Refund",
        categoryName: "Income",
        note: null,
      };
      expect(result).toMatchObject({ ok: true, transaction: expected });
      expect(await getTransaction(db, userId, created.id)).toMatchObject(expected);
    });

    it("changes only the category and note of an imported transaction", async () => {
      const { userId, cashId, category } = await createUser();
      const imported = await insertImported(userId, cashId);

      const recategorized = await updateTransaction(db, userId, {
        transactionId: imported,
        categoryId: category("Food"),
        note: "Team lunch",
      });
      const changed = await updateTransaction(db, userId, {
        transactionId: imported,
        details: {
          accountId: cashId,
          bookedOn: "2026-10-04",
          amountCents: 1n,
          direction: "expense",
        },
        categoryId: null,
        note: null,
      });

      expect(recategorized).toMatchObject({
        ok: true,
        transaction: { categoryName: "Food", note: "Team lunch", amountCents: -4250n },
      });
      expect(changed).toEqual({ ok: false, reason: "imported" });
      expect(await getTransaction(db, userId, imported)).toMatchObject({
        bookedOn: "2026-10-02",
        amountCents: -4250n,
        categoryName: "Food",
        categorySource: "manual",
        note: "Team lunch",
      });
    });

    it("keeps a rule's category a rule's until the category is changed by hand", async () => {
      const { userId, cashId, category } = await createUser();
      const imported = await insertImported(userId, cashId, {
        categoryId: category("Food"),
        categorySource: "rule",
      });
      const edit = (categoryId: string | null) =>
        updateTransaction(db, userId, { transactionId: imported, categoryId, note: "Lunch" });

      expect(await edit(category("Food"))).toMatchObject({
        transaction: { categoryName: "Food", categorySource: "rule", note: "Lunch" },
      });
      expect(await edit(null)).toMatchObject({
        transaction: { categoryId: null, categorySource: null },
      });
      expect(await edit(category("Bills"))).toMatchObject({
        transaction: { categoryName: "Bills", categorySource: "manual" },
      });
    });

    it("keeps a transaction in its archived account, but won't move one into another", async () => {
      const { userId, cashId } = await createUser();
      const old = await createAccount(db, userId, { name: "Old", type: "cash", currency: "EUR" });
      if (!old.ok) throw new Error(old.reason);
      const created = await createOk(userId, {
        accountId: cashId,
        bookedOn: "2026-10-03",
        amountCents: 500n,
        direction: "expense",
      });
      const details = {
        bookedOn: "2026-10-03",
        amountCents: 700n,
        direction: "expense",
      } as const;
      await archiveAccount(db, userId, { accountId: old.account.id });

      const moved = await updateTransaction(db, userId, {
        transactionId: created.id,
        details: { ...details, accountId: old.account.id },
        categoryId: null,
        note: null,
      });
      await archiveAccount(db, userId, { accountId: cashId });
      const stayed = await updateTransaction(db, userId, {
        transactionId: created.id,
        details: { ...details, accountId: cashId },
        categoryId: null,
        note: null,
      });

      expect(moved).toEqual({ ok: false, reason: "account-not-found" });
      expect(stayed).toMatchObject({ ok: true, transaction: { amountCents: -700n } });
    });
  });

  it("deletes a transaction, manual or imported", async () => {
    const { userId, cashId } = await createUser();
    const manual = await createOk(userId, {
      accountId: cashId,
      bookedOn: "2026-10-03",
      amountCents: 500n,
      direction: "expense",
    });
    const imported = await insertImported(userId, cashId);

    expect(await deleteTransaction(db, userId, { transactionId: manual.id })).toBe(true);
    expect(await deleteTransaction(db, userId, { transactionId: imported })).toBe(true);
    expect(await deleteTransaction(db, userId, { transactionId: imported })).toBe(false);
    expect(await listTransactions(db, userId)).toEqual([]);
  });

  // An id from the client is a candidate, never proof of ownership.
  it("never shows or changes another user's transactions, accounts or categories", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const alicesOwn = await createOk(alice.userId, {
      accountId: alice.cashId,
      bookedOn: "2026-10-03",
      amountCents: 500n,
      direction: "expense",
      categoryId: alice.category("Food"),
      note: "Alice's",
    });
    const bobsDetails = {
      accountId: bob.cashId,
      bookedOn: "2026-10-03",
      amountCents: 100n,
      direction: "expense",
    } as const;

    expect(await listTransactions(db, bob.userId)).toEqual([]);
    expect(await getTransaction(db, bob.userId, alicesOwn.id)).toBeNull();
    expect(
      await updateTransaction(db, bob.userId, {
        transactionId: alicesOwn.id,
        categoryId: null,
        note: "Bob's",
      }),
    ).toEqual({ ok: false, reason: "not-found" });
    expect(await deleteTransaction(db, bob.userId, { transactionId: alicesOwn.id })).toBe(false);
    expect(
      await createTransaction(db, bob.userId, { ...bobsDetails, accountId: alice.cashId }),
    ).toEqual({ ok: false, reason: "account-not-found" });
    expect(
      await createTransaction(db, bob.userId, {
        ...bobsDetails,
        categoryId: alice.category("Food"),
      }),
    ).toEqual({ ok: false, reason: "category-not-found" });

    const bobsOwn = await createOk(bob.userId, bobsDetails);
    expect(
      await updateTransaction(db, bob.userId, {
        transactionId: bobsOwn.id,
        details: { ...bobsDetails, accountId: alice.cashId },
        categoryId: null,
        note: null,
      }),
    ).toEqual({ ok: false, reason: "account-not-found" });
    expect(
      await updateTransaction(db, bob.userId, {
        transactionId: bobsOwn.id,
        categoryId: alice.category("Food"),
        note: null,
      }),
    ).toEqual({ ok: false, reason: "category-not-found" });

    expect(await listTransactions(db, alice.userId)).toEqual([alicesOwn]);
    expect(await listTransactions(db, bob.userId)).toEqual([
      expect.objectContaining({ id: bobsOwn.id, accountId: bob.cashId, categoryId: null }),
    ]);
  });
});

// An imported transaction, as the CSV import will write it.
async function insertImported(
  userId: string,
  accountId: string,
  values: Partial<typeof schema.moneyTransactions.$inferInsert> = {},
) {
  const [row] = await db
    .insert(schema.moneyTransactions)
    .values({
      ...values,
      userId,
      accountId,
      bookedOn: "2026-10-02",
      amountCents: -4250n,
      currency: "EUR",
      counterparty: "CAFE EXAMPLE",
      source: "csv_import",
      dedupKey: "tx:example-1",
    })
    .returning({ id: schema.moneyTransactions.id });
  return row!.id;
}
