import { createDb, schema, type Db } from "@troba/db";
import { createTestDatabase } from "@troba/db/test-database";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAccount } from "./accounts";
import { createCategory } from "./categories";
import {
  applyRulesToUncategorized,
  createRule,
  deleteRule,
  listRules,
  maxRules,
  moveRule,
} from "./rules";
import { createTransaction, getTransaction } from "./transactions";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Db;
let userCount = 0;

async function createUser() {
  const [user] = await db
    .insert(schema.users)
    .values({ name: "Example User", email: `rules${++userCount}@example.test` })
    .returning({ id: schema.users.id });
  return user!.id;
}

async function createRuleOk(userId: string, input: Parameters<typeof createRule>[2]) {
  const result = await createRule(db, userId, input);
  if (!result.ok) throw new Error(`createRule failed: ${result.reason}`);
  return result.rule;
}

async function createCash(userId: string) {
  const account = await createAccount(db, userId, { name: "Cash", type: "cash", currency: "EUR" });
  if (!account.ok) throw new Error(`createAccount failed: ${account.reason}`);
  return account.account;
}

async function createExpense(userId: string, input: { counterparty: string; categoryId?: string }) {
  const result = await createTransaction(db, userId, {
    accountId: (await createCash(userId)).id,
    bookedOn: "2026-10-01",
    amountCents: 1250n,
    direction: "expense",
    ...input,
  });
  if (!result.ok) throw new Error(`createTransaction failed: ${result.reason}`);
  return result.transaction;
}

describe("rules", () => {
  beforeAll(async () => {
    database = await createTestDatabase();
    db = createDb(database.url);
  });
  afterAll(async () => {
    await db?.$client.end();
    await database?.drop();
  });

  it("adds rules at the end of the user's order", async () => {
    const userId = await createUser();
    const food = await createCategory(db, userId, { name: "Food" });
    const bills = await createCategory(db, userId, { name: "Bills" });

    const first = await createRuleOk(userId, {
      field: "counterparty",
      pattern: "  GROCERY MART ",
      categoryId: food.id,
    });
    await createRuleOk(userId, { field: "description", pattern: "fee", categoryId: bills.id });

    expect(first).toMatchObject({ pattern: "GROCERY MART", categoryName: "Food" });
    expect(await listRules(db, userId)).toEqual([
      first,
      expect.objectContaining({
        field: "description",
        pattern: "fee",
        categoryId: bills.id,
        categoryName: "Bills",
      }),
    ]);
  });

  it("refuses another user's category, and lists no one else's rules", async () => {
    const owner = await createUser();
    const other = await createUser();
    const food = await createCategory(db, owner, { name: "Food" });
    await createRuleOk(owner, { field: "counterparty", pattern: "MART", categoryId: food.id });

    expect(
      await createRule(db, other, { field: "counterparty", pattern: "MART", categoryId: food.id }),
    ).toEqual({ ok: false, reason: "category-not-found" });
    expect(await listRules(db, other)).toEqual([]);
  });

  it("moves a rule up or down past its neighbour", async () => {
    const userId = await createUser();
    const food = await createCategory(db, userId, { name: "Food" });
    for (const pattern of ["A", "B", "C"]) {
      await createRuleOk(userId, { field: "counterparty", pattern, categoryId: food.id });
    }
    const patterns = async () => (await listRules(db, userId)).map((rule) => rule.pattern);
    const id = async (pattern: string) =>
      (await listRules(db, userId)).find((rule) => rule.pattern === pattern)!.id;

    expect(await moveRule(db, userId, { ruleId: await id("C"), direction: "up" })).toBe(true);
    expect(await patterns()).toEqual(["A", "C", "B"]);
    expect(await moveRule(db, userId, { ruleId: await id("A"), direction: "down" })).toBe(true);
    expect(await patterns()).toEqual(["C", "A", "B"]);
    // Already first: nothing to move past.
    expect(await moveRule(db, userId, { ruleId: await id("C"), direction: "up" })).toBe(true);
    expect(await patterns()).toEqual(["C", "A", "B"]);
  });

  it("deletes a rule", async () => {
    const userId = await createUser();
    const food = await createCategory(db, userId, { name: "Food" });
    const kept = await createRuleOk(userId, {
      field: "counterparty",
      pattern: "A",
      categoryId: food.id,
    });
    const gone = await createRuleOk(userId, {
      field: "counterparty",
      pattern: "B",
      categoryId: food.id,
    });

    expect(await deleteRule(db, userId, { ruleId: gone.id })).toBe(true);

    expect(await listRules(db, userId)).toEqual([kept]);
  });

  it("doesn't move or delete another user's rule", async () => {
    const owner = await createUser();
    const other = await createUser();
    const food = await createCategory(db, owner, { name: "Food" });
    const first = await createRuleOk(owner, {
      field: "counterparty",
      pattern: "A",
      categoryId: food.id,
    });
    const second = await createRuleOk(owner, {
      field: "counterparty",
      pattern: "B",
      categoryId: food.id,
    });

    expect(await moveRule(db, other, { ruleId: second.id, direction: "up" })).toBe(false);
    expect(await deleteRule(db, other, { ruleId: first.id })).toBe(false);

    expect(await listRules(db, owner)).toEqual([first, second]);
  });

  describe("applying rules to uncategorized transactions", () => {
    it("fills a missing category with the first matching rule's", async () => {
      const userId = await createUser();
      const food = await createCategory(db, userId, { name: "Food" });
      const shopping = await createCategory(db, userId, { name: "Shopping" });
      await createRuleOk(userId, { field: "counterparty", pattern: "mart", categoryId: food.id });
      await createRuleOk(userId, {
        field: "counterparty",
        pattern: "GROCERY",
        categoryId: shopping.id,
      });
      const grocery = await createExpense(userId, { counterparty: "GROCERY MART" });
      const other = await createExpense(userId, { counterparty: "GROCERY STORE" });
      const unmatched = await createExpense(userId, { counterparty: "CAFE" });

      expect(await applyRulesToUncategorized(db, userId)).toBe(2);

      expect(await getTransaction(db, userId, grocery.id)).toMatchObject({
        categoryId: food.id,
        categorySource: "rule",
      });
      expect(await getTransaction(db, userId, other.id)).toMatchObject({
        categoryId: shopping.id,
        categorySource: "rule",
      });
      expect(await getTransaction(db, userId, unmatched.id)).toMatchObject({
        categoryId: null,
        categorySource: null,
      });
    });

    it("never overwrites a category set by hand", async () => {
      const userId = await createUser();
      const food = await createCategory(db, userId, { name: "Food" });
      const gifts = await createCategory(db, userId, { name: "Gifts" });
      await createRuleOk(userId, { field: "counterparty", pattern: "MART", categoryId: food.id });
      const present = await createExpense(userId, {
        counterparty: "GROCERY MART",
        categoryId: gifts.id,
      });

      expect(await applyRulesToUncategorized(db, userId)).toBe(0);

      expect(await getTransaction(db, userId, present.id)).toMatchObject({
        categoryId: gifts.id,
        categorySource: "manual",
      });
    });

    it("uses only the user's rules on only the user's transactions", async () => {
      const owner = await createUser();
      const other = await createUser();
      const food = await createCategory(db, owner, { name: "Food" });
      await createRuleOk(owner, { field: "counterparty", pattern: "MART", categoryId: food.id });
      const theirs = await createExpense(other, { counterparty: "GROCERY MART" });

      expect(await applyRulesToUncategorized(db, other)).toBe(0);
      expect(await applyRulesToUncategorized(db, owner)).toBe(0);

      expect(await getTransaction(db, other, theirs.id)).toMatchObject({ categoryId: null });
    });

    it("gets through more transactions than one read holds", async () => {
      const userId = await createUser();
      const food = await createCategory(db, userId, { name: "Food" });
      await createRuleOk(userId, { field: "description", pattern: "lunch", categoryId: food.id });
      const { id: accountId } = await createCash(userId);
      const count = 12_345;
      for (let i = 0; i < count; i += 1000) {
        await db.insert(schema.moneyTransactions).values(
          Array.from({ length: Math.min(1000, count - i) }, (_, j) => ({
            userId,
            accountId,
            // Many on one day, so the order within a day matters too.
            bookedOn: `2026-10-0${((i + j) % 3) + 1}`,
            amountCents: -500n,
            currency: "EUR",
            description: (i + j) % 2 === 0 ? "Lunch" : "Bus",
            source: "manual" as const,
          })),
        );
      }

      expect(await applyRulesToUncategorized(db, userId)).toBe(Math.ceil(count / 2));
    });
  });

  it("refuses an empty pattern", async () => {
    const userId = await createUser();
    const food = await createCategory(db, userId, { name: "Food" });

    expect(
      await createRule(db, userId, { field: "counterparty", pattern: "   ", categoryId: food.id }),
    ).toEqual({ ok: false, reason: "empty-pattern" });
  });

  it("keeps the cap and distinct positions when rules are created at once", async () => {
    const userId = await createUser();
    const food = await createCategory(db, userId, { name: "Food" });
    await db.insert(schema.moneyRules).values(
      Array.from({ length: maxRules - 5 }, (_, i) => ({
        userId,
        field: "counterparty" as const,
        pattern: `SHOP ${i}`,
        categoryId: food.id,
        position: i + 1,
      })),
    );

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        createRule(db, userId, { field: "counterparty", pattern: `NEW ${i}`, categoryId: food.id }),
      ),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(5);
    const positions = await db
      .select({ position: schema.moneyRules.position })
      .from(schema.moneyRules)
      .where(eq(schema.moneyRules.userId, userId));
    expect(new Set(positions.map((row) => row.position)).size).toBe(maxRules);
  });

  it("refuses a rule past the cap", async () => {
    const userId = await createUser();
    const food = await createCategory(db, userId, { name: "Food" });
    await db.insert(schema.moneyRules).values(
      Array.from({ length: maxRules }, (_, i) => ({
        userId,
        field: "counterparty" as const,
        pattern: `SHOP ${i}`,
        categoryId: food.id,
        position: i + 1,
      })),
    );

    expect(
      await createRule(db, userId, { field: "counterparty", pattern: "MART", categoryId: food.id }),
    ).toEqual({ ok: false, reason: "too-many-rules" });
  });
});
