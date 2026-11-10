import { createDb, schema, type Db } from "@troba/db";
import { createTestDatabase } from "@troba/db/test-database";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createMoneyUser,
  insertImportedRows,
  readTransaction,
  testAiCategorizeDailyLimit,
  type MoneyUser,
} from "./ai-categories-fixture";
import {
  suggestCategories,
  type CategorizationModelClient,
  type CategorizationRequest,
} from "./ai-categories";
import {
  acceptAllSuggestions,
  acceptSuggestion,
  countPendingSuggestions,
  dismissSuggestion,
  resetSuggestionAsks,
} from "./ai-categories-review";
import { deleteCategory } from "./categories";
import { monthlyReport } from "./report";
import { updateTransaction } from "./transactions";

// Accepting, dismissing and asking again about suggested categories (SPEC-money M5, ADR-0016),
// against real Postgres. The suggestions are put on the rows the way the engine leaves them.

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Db;

function createUser() {
  return createMoneyUser(db);
}

type Row = {
  counterparty?: string | null;
  description?: string | null;
  categoryId?: string | null;
  suggestedCategoryId?: string | null;
  asked?: boolean;
  source?: "manual" | "csv_import";
  amountCents?: bigint;
};

// Rows as the engine leaves them: `asked` marks one asked about, as a suggestion does.
function insertRows(user: MoneyUser, rows: Row[]): Promise<string[]> {
  return insertImportedRows(
    db,
    user,
    rows.map(({ asked, ...row }) => ({
      categorySource: row.categoryId ? ("rule" as const) : null,
      suggestionAskedAt: asked || row.suggestedCategoryId ? new Date() : null,
      ...row,
    })),
  );
}

// The month's EUR spending by category name (Uncategorized for none), in cents.
function spentBy(report: Awaited<ReturnType<typeof monthlyReport>>): Record<string, bigint> {
  const eur = report.find((currency) => currency.currency === "EUR")!;
  return Object.fromEntries(
    eur.categories.map((category) => [
      category.categoryName ?? "Uncategorized",
      category.spentCents,
    ]),
  );
}

function readRow(userId: string, id: string) {
  return readTransaction(db, userId, id);
}

describe("reviewing suggested categories", () => {
  beforeAll(async () => {
    database = await createTestDatabase();
    db = createDb(database.url);
  });
  afterAll(async () => {
    await db?.$client.end();
    await database?.drop();
  });

  describe("acceptSuggestion", () => {
    it("categorizes every uncategorized row of the merchant as the user's own choice, and moves the totals", async () => {
      const user = await createUser();
      const food = user.category("Food");
      const [first, second, other] = await insertRows(user, [
        { counterparty: "GROCERY MART", suggestedCategoryId: food },
        // Same merchant in another case, and one the model said nothing about.
        { counterparty: "Grocery Mart", asked: true },
        { counterparty: "CORNER CAFE", suggestedCategoryId: food },
      ]);
      const before = await monthlyReport(db, user.userId, "2026-10");

      const result = await acceptSuggestion(db, user.userId, first!);

      expect(result).toEqual({ ok: true, rows: 2, categoryName: "Food" });
      for (const id of [first!, second!]) {
        expect(await readRow(user.userId, id)).toMatchObject({
          categoryId: food,
          categorySource: "manual",
          suggestedCategoryId: null,
        });
      }
      // Another merchant's suggestion is left for its own decision.
      expect(await readRow(user.userId, other!)).toMatchObject({
        categoryId: null,
        suggestedCategoryId: food,
      });
      const after = await monthlyReport(db, user.userId, "2026-10");
      // Two rows of 12.50 moved from Uncategorized to Food; the other merchant stays uncategorized.
      expect(spentBy(before)).toEqual({ Uncategorized: 3750n });
      expect(spentBy(after)).toEqual({ Food: 2500n, Uncategorized: 1250n });
    });

    it("falls back to the description as the merchant when there is no counterparty", async () => {
      const user = await createUser();
      const food = user.category("Food");
      const [first, second] = await insertRows(user, [
        { description: "CARD GROCERY MART", suggestedCategoryId: food },
        { description: "card grocery mart", asked: true },
      ]);

      expect(await acceptSuggestion(db, user.userId, first!)).toMatchObject({ ok: true, rows: 2 });
      expect(await readRow(user.userId, second!)).toMatchObject({ categoryId: food });
    });

    it("never replaces a category that is already set", async () => {
      const user = await createUser();
      const food = user.category("Food");
      const [suggested, byHand] = await insertRows(user, [
        { counterparty: "GROCERY MART", suggestedCategoryId: food },
        { counterparty: "GROCERY MART", categoryId: user.category("Shopping") },
      ]);

      expect(await acceptSuggestion(db, user.userId, suggested!)).toMatchObject({
        ok: true,
        rows: 1,
      });
      expect(await readRow(user.userId, byHand!)).toMatchObject({
        categoryId: user.category("Shopping"),
        categorySource: "rule",
      });
    });

    it("changes nothing when the row has been categorized since", async () => {
      const user = await createUser();
      const [id] = await insertRows(user, [
        { counterparty: "GROCERY MART", suggestedCategoryId: user.category("Food") },
      ]);
      await updateTransaction(db, user.userId, {
        transactionId: id!,
        categoryId: user.category("Shopping"),
        note: null,
      });

      expect(await acceptSuggestion(db, user.userId, id!)).toEqual({
        ok: false,
        reason: "no-suggestion",
      });
      expect(await readRow(user.userId, id!)).toMatchObject({
        categoryId: user.category("Shopping"),
        categorySource: "manual",
      });
    });

    it("changes nothing when the suggested category has been deleted since", async () => {
      const user = await createUser();
      const [id, mate] = await insertRows(user, [
        { counterparty: "GROCERY MART", suggestedCategoryId: user.category("Food") },
        { counterparty: "GROCERY MART", asked: true },
      ]);
      const deleted = await deleteCategory(db, user.userId, { categoryId: user.category("Food") });
      expect(deleted).toBe(true);

      expect(await acceptSuggestion(db, user.userId, id!)).toEqual({
        ok: false,
        reason: "no-suggestion",
      });
      expect(await readRow(user.userId, mate!)).toMatchObject({ categoryId: null });
    });

    it("refuses a row of another user and leaves it alone", async () => {
      const owner = await createUser();
      const intruder = await createUser();
      const [id] = await insertRows(owner, [
        { counterparty: "GROCERY MART", suggestedCategoryId: owner.category("Food") },
      ]);

      expect(await acceptSuggestion(db, intruder.userId, id!)).toEqual({
        ok: false,
        reason: "not-found",
      });
      expect(await readRow(owner.userId, id!)).toMatchObject({
        categoryId: null,
        suggestedCategoryId: owner.category("Food"),
      });
    });

    it("does not touch another user's rows of the same merchant", async () => {
      const user = await createUser();
      const other = await createUser();
      const [mine] = await insertRows(user, [
        { counterparty: "GROCERY MART", suggestedCategoryId: user.category("Food") },
      ]);
      const [theirs] = await insertRows(other, [{ counterparty: "GROCERY MART", asked: true }]);

      await acceptSuggestion(db, user.userId, mine!);

      expect(await readRow(other.userId, theirs!)).toMatchObject({ categoryId: null });
    });

    it("says not-found for an id that does not exist", async () => {
      const user = await createUser();

      expect(
        await acceptSuggestion(db, user.userId, "00000000-0000-4000-8000-000000000000"),
      ).toEqual({ ok: false, reason: "not-found" });
    });
  });

  describe("dismissSuggestion", () => {
    it("clears the merchant's suggestions and keeps the rows marked as asked, so a later run skips them", async () => {
      const user = await createUser();
      const food = user.category("Food");
      const [first, second, other] = await insertRows(user, [
        { counterparty: "GROCERY MART", suggestedCategoryId: food },
        { counterparty: "grocery mart", suggestedCategoryId: food },
        { counterparty: "CORNER CAFE", suggestedCategoryId: food },
      ]);

      expect(await dismissSuggestion(db, user.userId, first!)).toEqual({ ok: true, rows: 2 });

      for (const id of [first!, second!]) {
        expect(await readRow(user.userId, id)).toMatchObject({
          categoryId: null,
          suggestedCategoryId: null,
          suggestionAskedAt: expect.any(Date),
        });
      }
      expect(await readRow(user.userId, other!)).toMatchObject({ suggestedCategoryId: food });

      const requests: CategorizationRequest[] = [];
      const client: CategorizationModelClient = {
        async suggestCategories(request) {
          requests.push(request);
          return { answers: [] };
        },
      };
      await suggestCategories(db, user.userId, { dailyLimit: testAiCategorizeDailyLimit, client });
      expect(requests).toHaveLength(0);
    });

    it("says so, and changes nothing, when the row has no suggestion any more", async () => {
      const user = await createUser();
      const [id] = await insertRows(user, [{ counterparty: "GROCERY MART", asked: true }]);

      expect(await dismissSuggestion(db, user.userId, id!)).toEqual({
        ok: false,
        reason: "no-suggestion",
      });
    });

    it("refuses a row of another user and leaves it alone", async () => {
      const owner = await createUser();
      const intruder = await createUser();
      const [id] = await insertRows(owner, [
        { counterparty: "GROCERY MART", suggestedCategoryId: owner.category("Food") },
      ]);

      expect(await dismissSuggestion(db, intruder.userId, id!)).toEqual({
        ok: false,
        reason: "not-found",
      });
      expect(await readRow(owner.userId, id!)).toMatchObject({
        suggestedCategoryId: owner.category("Food"),
      });
    });
  });

  describe("resetSuggestionAsks", () => {
    it("lets the next run offer dismissed and unplaced merchants to the model again", async () => {
      const user = await createUser();
      const food = user.category("Food");
      const [dismissed, unplaced, pending, categorized] = await insertRows(user, [
        { counterparty: "GROCERY MART", asked: true },
        { counterparty: "MYSTERY SHOP", asked: true },
        { counterparty: "CORNER CAFE", suggestedCategoryId: food },
        { counterparty: "BOOK BARN", categoryId: user.category("Shopping"), asked: true },
      ]);

      const reset = await resetSuggestionAsks(db, user.userId);

      expect(reset).toBe(2);
      const requests: CategorizationRequest[] = [];
      const client: CategorizationModelClient = {
        async suggestCategories(request) {
          requests.push(request);
          return {
            answers: request.payload.merchants.map((merchant) => ({
              merchant: merchant.id,
              category: food,
            })),
          };
        },
      };
      const result = await suggestCategories(db, user.userId, {
        dailyLimit: testAiCategorizeDailyLimit,
        client,
      });

      expect(result).toEqual({ merchantsAsked: 2, rowsSuggested: 2, failed: false, capped: false });
      expect(
        requests.flatMap((r) => r.payload.merchants.map((m) => m.counterparty)).sort(),
      ).toEqual(["GROCERY MART", "MYSTERY SHOP"]);
      expect(await readRow(user.userId, dismissed!)).toMatchObject({ suggestedCategoryId: food });
      expect(await readRow(user.userId, unplaced!)).toMatchObject({ suggestedCategoryId: food });
      // The pending suggestion stays as it was, and a categorized row is not reopened.
      expect(await readRow(user.userId, pending!)).toMatchObject({ suggestedCategoryId: food });
      expect(await readRow(user.userId, categorized!)).toMatchObject({
        categoryId: user.category("Shopping"),
        suggestedCategoryId: null,
        suggestionAskedAt: expect.any(Date),
      });
    });

    it("leaves another user's asked markers alone", async () => {
      const user = await createUser();
      const other = await createUser();
      const [theirs] = await insertRows(other, [{ counterparty: "GROCERY MART", asked: true }]);

      expect(await resetSuggestionAsks(db, user.userId)).toBe(0);
      expect(await readRow(other.userId, theirs!)).toMatchObject({
        suggestionAskedAt: expect.any(Date),
      });
    });
  });

  describe("countPendingSuggestions", () => {
    it("counts the user's uncategorized rows that carry a suggestion, and their merchants", async () => {
      const user = await createUser();
      const other = await createUser();
      const food = user.category("Food");
      await insertRows(user, [
        { counterparty: "GROCERY MART", suggestedCategoryId: food },
        { counterparty: "Grocery Mart", suggestedCategoryId: food },
        { counterparty: null, description: "BOOK NOOK", suggestedCategoryId: food },
        // Asked but nothing suggested, and a categorized row: neither is pending.
        { counterparty: "MYSTERY SHOP", asked: true },
        { counterparty: "CORNER CAFE", categoryId: food },
      ]);
      await insertRows(other, [
        { counterparty: "GROCERY MART", suggestedCategoryId: other.category("Food") },
      ]);

      expect(await countPendingSuggestions(db, user.userId)).toEqual({ rows: 3, merchants: 2 });
    });

    it("is zero for a user with nothing pending", async () => {
      const user = await createUser();
      expect(await countPendingSuggestions(db, user.userId)).toEqual({ rows: 0, merchants: 0 });
    });
  });

  describe("acceptAllSuggestions", () => {
    it("gives each row its own suggested category as the user's choice, and moves the totals", async () => {
      const user = await createUser();
      const food = user.category("Food");
      const shopping = user.category("Shopping");
      const [market, marketAgain, books, unplaced] = await insertRows(user, [
        { counterparty: "GROCERY MART", suggestedCategoryId: food },
        { counterparty: "grocery mart", suggestedCategoryId: food },
        { counterparty: "BOOK NOOK", suggestedCategoryId: shopping },
        { counterparty: "MYSTERY SHOP", asked: true },
      ]);
      const before = await monthlyReport(db, user.userId, "2026-10");

      const result = await acceptAllSuggestions(db, user.userId);

      expect(result).toEqual({ rows: 3, merchants: 2 });
      for (const [id, categoryId] of [
        [market!, food],
        [marketAgain!, food],
        [books!, shopping],
      ] as const) {
        expect(await readRow(user.userId, id)).toMatchObject({
          categoryId,
          categorySource: "manual",
          suggestedCategoryId: null,
        });
      }
      // No suggestion on the row, so there was nothing to accept.
      expect(await readRow(user.userId, unplaced!)).toMatchObject({ categoryId: null });
      expect(spentBy(before)).toEqual({ Uncategorized: 5000n });
      expect(spentBy(await monthlyReport(db, user.userId, "2026-10"))).toEqual({
        Food: 2500n,
        Shopping: 1250n,
        Uncategorized: 1250n,
      });
      expect(await countPendingSuggestions(db, user.userId)).toEqual({ rows: 0, merchants: 0 });
    });

    it("leaves a row categorized in the meantime alone and counts only what it changed", async () => {
      const user = await createUser();
      const food = user.category("Food");
      const shopping = user.category("Shopping");
      const [first, second] = await insertRows(user, [
        { counterparty: "GROCERY MART", suggestedCategoryId: food },
        { counterparty: "BOOK NOOK", suggestedCategoryId: food },
      ]);
      // The user picks a category by hand after the strip was drawn.
      await updateTransaction(db, user.userId, {
        transactionId: first!,
        categoryId: shopping,
        note: null,
      });

      const result = await acceptAllSuggestions(db, user.userId);

      expect(result).toEqual({ rows: 1, merchants: 1 });
      expect(await readRow(user.userId, first!)).toMatchObject({ categoryId: shopping });
      expect(await readRow(user.userId, second!)).toMatchObject({ categoryId: food });
    });

    it("skips a suggestion whose category was deleted since", async () => {
      const user = await createUser();
      const food = user.category("Food");
      const shopping = user.category("Shopping");
      const [gone, kept] = await insertRows(user, [
        { counterparty: "GROCERY MART", suggestedCategoryId: shopping },
        { counterparty: "BOOK NOOK", suggestedCategoryId: food },
      ]);
      await deleteCategory(db, user.userId, { categoryId: shopping });

      expect(await acceptAllSuggestions(db, user.userId)).toEqual({ rows: 1, merchants: 1 });
      expect(await readRow(user.userId, gone!)).toMatchObject({
        categoryId: null,
        suggestedCategoryId: null,
      });
      expect(await readRow(user.userId, kept!)).toMatchObject({ categoryId: food });
    });

    // A category deleted while a page is applied makes the update fail the foreign key check
    // (23503). The race can't be timed from a test, so the failure is injected: a trigger fails
    // the first `failures` updates of money_transactions with the given SQLSTATE, and a sequence,
    // which a rolled-back statement doesn't undo, counts every update attempted.
    async function withFailingUpdates<T>(
      failures: number,
      sqlstate: string,
      run: () => Promise<T>,
    ): Promise<{ outcome: PromiseSettledResult<T>; attempts: number }> {
      await db.execute(sql.raw(`create sequence accept_all_attempts`));
      await db.execute(
        sql.raw(`
          create function fail_accept_all() returns trigger language plpgsql as $$
          begin
            if nextval('accept_all_attempts') <= ${failures} then
              raise exception 'injected failure' using errcode = '${sqlstate}';
            end if;
            return null;
          end $$`),
      );
      await db.execute(
        sql.raw(`
          create trigger fail_accept_all before update on money_transactions
          for each statement execute function fail_accept_all()`),
      );
      try {
        const [outcome] = await Promise.allSettled([run()]);
        const result = await db.execute<{ attempts: string }>(
          sql.raw(`select last_value as attempts from accept_all_attempts`),
        );
        return { outcome: outcome!, attempts: Number(result.rows[0]!.attempts) };
      } finally {
        await db.execute(sql.raw(`drop trigger fail_accept_all on money_transactions`));
        await db.execute(sql.raw(`drop function fail_accept_all()`));
        await db.execute(sql.raw(`drop sequence accept_all_attempts`));
      }
    }

    it("tries a page again after a foreign key failure, and applies it", async () => {
      const user = await createUser();
      const food = user.category("Food");
      const [market, books] = await insertRows(user, [
        { counterparty: "GROCERY MART", suggestedCategoryId: food },
        { counterparty: "BOOK NOOK", suggestedCategoryId: food },
      ]);

      const { outcome, attempts } = await withFailingUpdates(1, "23503", () =>
        acceptAllSuggestions(db, user.userId),
      );

      expect(outcome).toEqual({ status: "fulfilled", value: { rows: 2, merchants: 2 } });
      expect(attempts).toBe(2);
      expect(await readRow(user.userId, market!)).toMatchObject({ categoryId: food });
      expect(await readRow(user.userId, books!)).toMatchObject({ categoryId: food });
    });

    it("gives up on a page after three foreign key failures, with the database's error", async () => {
      const user = await createUser();
      const food = user.category("Food");
      const [market] = await insertRows(user, [
        { counterparty: "GROCERY MART", suggestedCategoryId: food },
      ]);

      const { outcome, attempts } = await withFailingUpdates(10, "23503", () =>
        acceptAllSuggestions(db, user.userId),
      );

      expect(outcome).toMatchObject({ status: "rejected", reason: { cause: { code: "23503" } } });
      expect(attempts).toBe(3);
      expect(await readRow(user.userId, market!)).toMatchObject({
        categoryId: null,
        suggestedCategoryId: food,
      });
    });

    it("does not try a page again after any other failure", async () => {
      const user = await createUser();
      const [market] = await insertRows(user, [
        { counterparty: "GROCERY MART", suggestedCategoryId: user.category("Food") },
      ]);

      // A check constraint failing: not a race that a second attempt gets past.
      const { outcome, attempts } = await withFailingUpdates(1, "23514", () =>
        acceptAllSuggestions(db, user.userId),
      );

      expect(outcome.status).toBe("rejected");
      expect(attempts).toBe(1);
      expect(await readRow(user.userId, market!)).toMatchObject({ categoryId: null });
    });

    it("never touches another user's rows", async () => {
      const user = await createUser();
      const other = await createUser();
      const [mine] = await insertRows(user, [
        { counterparty: "GROCERY MART", suggestedCategoryId: user.category("Food") },
      ]);
      const [theirs] = await insertRows(other, [
        { counterparty: "GROCERY MART", suggestedCategoryId: other.category("Food") },
      ]);

      expect(await acceptAllSuggestions(db, user.userId)).toEqual({ rows: 1, merchants: 1 });
      expect(await readRow(user.userId, mine!)).toMatchObject({
        categoryId: user.category("Food"),
      });
      expect(await readRow(other.userId, theirs!)).toMatchObject({
        categoryId: null,
        suggestedCategoryId: other.category("Food"),
      });
    });

    it("does nothing when nothing is pending", async () => {
      const user = await createUser();
      expect(await acceptAllSuggestions(db, user.userId)).toEqual({ rows: 0, merchants: 0 });
    });

    it("works through a large history in pages", { timeout: 60_000 }, async () => {
      const user = await createUser();
      const food = user.category("Food");
      const shopping = user.category("Shopping");
      // 12,000 rows over 40 merchants, all with a suggestion, and 100 already categorized.
      await db.execute(sql`
        insert into money_transactions
          (user_id, account_id, booked_on, amount_cents, currency, counterparty, source, dedup_key,
           suggested_category_id, suggestion_asked_at)
        select ${user.userId}, ${user.cashId}, '2026-10-05', -1250, 'EUR',
               'MERCHANT ' || (i % 40), 'csv_import', 'bulk-' || i, ${food}, now()
        from generate_series(1, 12000) as i`);
      await db.execute(sql`
        insert into money_transactions
          (user_id, account_id, booked_on, amount_cents, currency, counterparty, source, dedup_key,
           category_id, category_source)
        select ${user.userId}, ${user.cashId}, '2026-10-05', -1250, 'EUR',
               'MERCHANT 0', 'csv_import', 'done-' || i, ${shopping}, 'rule'
        from generate_series(1, 100) as i`);

      expect(await countPendingSuggestions(db, user.userId)).toEqual({
        rows: 12000,
        merchants: 40,
      });
      expect(await acceptAllSuggestions(db, user.userId)).toEqual({ rows: 12000, merchants: 40 });

      const [totals] = await db
        .select({
          food: sql<number>`count(*) filter (where ${schema.moneyTransactions.categoryId} = ${food})::int`,
          shopping: sql<number>`count(*) filter (where ${schema.moneyTransactions.categoryId} = ${shopping})::int`,
          pending: sql<number>`count(*) filter (where ${schema.moneyTransactions.suggestedCategoryId} is not null)::int`,
        })
        .from(schema.moneyTransactions)
        .where(eq(schema.moneyTransactions.userId, user.userId));
      expect(totals).toEqual({ food: 12000, shopping: 100, pending: 0 });
    });
  });
});
