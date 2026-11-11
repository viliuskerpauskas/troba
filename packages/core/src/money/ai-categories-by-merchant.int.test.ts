import { createDb, type Db } from "@troba/db";
import { createTestDatabase } from "@troba/db/test-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMoneyUser, insertImportedRows, type MoneyUser } from "./ai-categories-fixture";
import { listSuggestionsByMerchant } from "./ai-categories-by-merchant";
import { acceptSuggestion, countPendingSuggestions } from "./ai-categories-review";

// The pending suggestions grouped by merchant (SPEC-money M5 story 8, ADR-0016), against real
// Postgres. The suggestions are put on the rows the way the engine leaves them.

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Db;

type Row = Partial<Parameters<typeof insertImportedRows>[2][number]>;

function insertRows(user: MoneyUser, rows: Row[]): Promise<string[]> {
  return insertImportedRows(
    db,
    user,
    rows.map((row) => ({
      suggestionAskedAt: new Date(),
      categorySource: row.categoryId ? ("rule" as const) : null,
      ...row,
    })),
  );
}

describe("listSuggestionsByMerchant", () => {
  beforeAll(async () => {
    database = await createTestDatabase();
    db = createDb(database.url);
  });
  afterAll(async () => {
    await db?.$client.end();
    await database?.drop();
  });

  it("lists each merchant with a pending suggestion once, with the rows a decision covers and their total", async () => {
    const user = await createMoneyUser(db);
    const other = await createMoneyUser(db);
    const food = user.category("Food");
    const [, newest] = await insertRows(user, [
      { counterparty: "GROCERY MART", suggestedCategoryId: food, bookedOn: "2026-10-01" },
      { counterparty: "GROCERY MART", suggestedCategoryId: food, bookedOn: "2026-10-09" },
      // Same merchant in another case, with nothing suggested: accepting covers it too.
      { counterparty: " Grocery Mart ", bookedOn: "2026-10-12", amountCents: -500n },
      // Already categorized: no decision touches it.
      { counterparty: "GROCERY MART", categoryId: user.category("Shopping") },
      {
        counterparty: null,
        description: "BOOK NOOK",
        suggestedCategoryId: user.category("Shopping"),
      },
      // Asked, nothing suggested: not pending.
      { counterparty: "MYSTERY SHOP" },
    ]);
    // Another user's rows of the same merchant are never counted or shown.
    await insertRows(other, [
      { counterparty: "GROCERY MART", suggestedCategoryId: other.category("Food") },
      { counterparty: "CORNER CAFE", suggestedCategoryId: other.category("Food") },
    ]);

    const groups = await listSuggestionsByMerchant(db, user.userId);

    expect(groups).toEqual([
      {
        transactionId: newest,
        counterparty: "GROCERY MART",
        description: null,
        suggestedCategoryId: food,
        suggestedCategoryName: "Food",
        rows: 3,
        totals: [{ currency: "EUR", amountCents: -3000n }],
      },
      {
        transactionId: expect.any(String),
        counterparty: null,
        description: "BOOK NOOK",
        suggestedCategoryId: user.category("Shopping"),
        suggestedCategoryName: "Shopping",
        rows: 1,
        totals: [{ currency: "EUR", amountCents: -1250n }],
      },
    ]);
    // As many merchants as the "Accept all" strip names.
    expect((await countPendingSuggestions(db, user.userId)).merchants).toBe(groups.length);
  });

  it("totals each currency apart", async () => {
    const user = await createMoneyUser(db);
    const food = user.category("Food");
    await insertRows(user, [
      { counterparty: "GROCERY MART", suggestedCategoryId: food, currency: "EUR" },
      {
        counterparty: "GROCERY MART",
        suggestedCategoryId: food,
        currency: "USD",
        amountCents: -200n,
      },
      {
        counterparty: "GROCERY MART",
        suggestedCategoryId: food,
        currency: "USD",
        amountCents: -300n,
      },
    ]);

    const [group] = await listSuggestionsByMerchant(db, user.userId);

    expect(group).toMatchObject({
      rows: 3,
      totals: [
        { currency: "EUR", amountCents: -1250n },
        { currency: "USD", amountCents: -500n },
      ],
    });
  });

  it("gives a row to accept that settles the whole group, as accepting that row does", async () => {
    const user = await createMoneyUser(db);
    const food = user.category("Food");
    await insertRows(user, [
      { counterparty: "GROCERY MART", suggestedCategoryId: food },
      { counterparty: "grocery mart" },
      { counterparty: "CORNER CAFE", suggestedCategoryId: food },
    ]);
    const [grocery] = (await listSuggestionsByMerchant(db, user.userId)).filter(
      (group) => group.counterparty === "GROCERY MART",
    );

    expect(await acceptSuggestion(db, user.userId, grocery!.transactionId)).toMatchObject({
      ok: true,
      rows: grocery!.rows,
    });
    expect((await listSuggestionsByMerchant(db, user.userId)).map((g) => g.counterparty)).toEqual([
      "CORNER CAFE",
    ]);
  });

  it("lists the merchants with the most rows first, up to the limit", async () => {
    const user = await createMoneyUser(db);
    const food = user.category("Food");
    await insertRows(user, [
      { counterparty: "CORNER CAFE", suggestedCategoryId: food },
      { counterparty: "GROCERY MART", suggestedCategoryId: food },
      { counterparty: "GROCERY MART", suggestedCategoryId: food },
      { counterparty: "BOOK NOOK", suggestedCategoryId: food },
    ]);

    const groups = await listSuggestionsByMerchant(db, user.userId, { limit: 2 });

    expect(groups.map((group) => [group.counterparty, group.rows])).toEqual([
      ["GROCERY MART", 2],
      ["BOOK NOOK", 1],
    ]);
  });

  it("is empty when nothing is pending", async () => {
    const user = await createMoneyUser(db);
    await insertRows(user, [{ counterparty: "GROCERY MART" }]);

    expect(await listSuggestionsByMerchant(db, user.userId)).toEqual([]);
  });
});
