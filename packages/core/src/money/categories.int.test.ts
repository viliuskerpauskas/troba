import { createDb, schema, type Db } from "@troba/db";
import { createTestDatabase } from "@troba/db/test-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAccount } from "./accounts";
import {
  createCategory,
  deleteCategory,
  getCategory,
  listCategories,
  renameCategory,
} from "./categories";
import { ensureMoneyDefaults } from "./defaults";
import { createTransaction, getTransaction } from "./transactions";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Db;
let userCount = 0;

async function createUser() {
  const [user] = await db
    .insert(schema.users)
    .values({ name: "Example User", email: `categories${++userCount}@example.test` })
    .returning({ id: schema.users.id });
  return user!.id;
}

async function createExpense(userId: string, categoryId: string) {
  const account = await createAccount(db, userId, { name: "Cash", type: "cash", currency: "EUR" });
  if (!account.ok) throw new Error(`createAccount failed: ${account.reason}`);
  const result = await createTransaction(db, userId, {
    accountId: account.account.id,
    bookedOn: "2026-10-01",
    amountCents: 1250n,
    direction: "expense",
    counterparty: "GROCERY MART",
    categoryId,
  });
  if (!result.ok) throw new Error(`createTransaction failed: ${result.reason}`);
  return result.transaction;
}

describe("categories", () => {
  beforeAll(async () => {
    database = await createTestDatabase();
    db = createDb(database.url);
  });
  afterAll(async () => {
    await db?.$client.end();
    await database?.drop();
  });

  it("creates a category that counts as spending", async () => {
    const userId = await createUser();

    const category = await createCategory(db, userId, { name: "  Pets " });

    expect(category).toMatchObject({ name: "Pets", excludedFromSpending: false });
    expect(await listCategories(db, userId)).toEqual([category]);
  });

  it("gets one of the user's categories by id, and not another user's", async () => {
    const owner = await createUser();
    const other = await createUser();
    const category = await createCategory(db, owner, { name: "Pets" });

    expect(await getCategory(db, owner, category.id)).toEqual(category);
    expect(await getCategory(db, other, category.id)).toBeNull();
  });

  it("renames a category", async () => {
    const userId = await createUser();
    const category = await createCategory(db, userId, { name: "Pets" });

    expect(await renameCategory(db, userId, { categoryId: category.id, name: " Animals " })).toBe(
      true,
    );

    expect(await listCategories(db, userId)).toMatchObject([{ id: category.id, name: "Animals" }]);
  });

  it("doesn't rename another user's category", async () => {
    const owner = await createUser();
    const other = await createUser();
    const category = await createCategory(db, owner, { name: "Pets" });

    expect(await renameCategory(db, other, { categoryId: category.id, name: "Mine" })).toBe(false);

    expect(await listCategories(db, owner)).toMatchObject([{ name: "Pets" }]);
  });

  it("deletes a category and leaves its transactions uncategorized", async () => {
    const userId = await createUser();
    const pets = await createCategory(db, userId, { name: "Pets" });
    const food = await createCategory(db, userId, { name: "Food" });
    const vet = await createExpense(userId, pets.id);
    const lunch = await createExpense(userId, food.id);

    expect(await deleteCategory(db, userId, { categoryId: pets.id })).toBe(true);

    expect(await listCategories(db, userId)).toEqual([food]);
    // No source left either: rules may categorize it again.
    expect(await getTransaction(db, userId, vet.id)).toMatchObject({
      categoryId: null,
      categorySource: null,
    });
    expect(await getTransaction(db, userId, lunch.id)).toMatchObject({
      categoryId: food.id,
      categorySource: "manual",
    });
  });

  it("doesn't delete another user's category or touch their transactions", async () => {
    const owner = await createUser();
    const other = await createUser();
    const pets = await createCategory(db, owner, { name: "Pets" });
    const vet = await createExpense(owner, pets.id);

    expect(await deleteCategory(db, other, { categoryId: pets.id })).toBe(false);

    expect(await listCategories(db, owner)).toEqual([pets]);
    expect(await getTransaction(db, owner, vet.id)).toMatchObject({ categoryId: pets.id });
  });

  it("refuses to delete Transfers, even renamed, and leaves its transactions alone", async () => {
    const userId = await createUser();
    await ensureMoneyDefaults(db, userId);
    const transfers = (await listCategories(db, userId)).find(
      (category) => category.excludedFromSpending,
    )!;
    await renameCategory(db, userId, { categoryId: transfers.id, name: "Own accounts" });
    const move = await createExpense(userId, transfers.id);

    expect(await deleteCategory(db, userId, { categoryId: transfers.id })).toBe(false);

    expect(await listCategories(db, userId)).toContainEqual({
      ...transfers,
      name: "Own accounts",
    });
    expect(await getTransaction(db, userId, move.id)).toMatchObject({
      categoryId: transfers.id,
      categorySource: "manual",
    });
  });
});
