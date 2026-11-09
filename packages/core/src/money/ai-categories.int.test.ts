import { createDb, schema, type Db } from "@troba/db";
import { createTestDatabase } from "@troba/db/test-database";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listAccounts } from "./accounts";
import { aiCategorizationEnabledFor, setAiCategorization } from "./ai-categorization-setting";
import {
  suggestCategories,
  type CategorizationModelClient,
  type CategorizationRequest,
} from "./ai-categories";
import { deleteCategory, listCategories } from "./categories";
import { ensureMoneyDefaults } from "./defaults";
import { monthlyReport } from "./report";
import { applyRulesToUncategorized, createRule } from "./rules";
import { updateTransaction } from "./transactions";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Db;
let userCount = 0;
let rowCount = 0;

type TestUser = Awaited<ReturnType<typeof createUser>>;

// A user with the money defaults. The name is the one the masking has to keep out of requests.
async function createUser(name = "Jordan Quinn") {
  const [user] = await db
    .insert(schema.users)
    .values({ name, email: `suggest${++userCount}@example.test` })
    .returning({ id: schema.users.id });
  const userId = user!.id;
  await ensureMoneyDefaults(db, userId);
  const [cash] = await listAccounts(db, userId);
  const categories = await listCategories(db, userId);
  const category = (categoryName: string) => categories.find((c) => c.name === categoryName)!.id;
  return { userId, cashId: cash!.id, category };
}

type Row = {
  counterparty?: string | null;
  description?: string | null;
  counterpartyIban?: string | null;
  source?: "manual" | "csv_import";
  categoryId?: string | null;
  bookedOn?: string;
  amountCents?: bigint;
};

// Straight into the table, as an import leaves it. Returns the new rows' ids.
async function insertRows(user: TestUser, rows: Row[]): Promise<string[]> {
  const inserted = await db
    .insert(schema.moneyTransactions)
    .values(
      rows.map((row) => ({
        userId: user.userId,
        accountId: user.cashId,
        bookedOn: "2026-10-05",
        amountCents: -1250n,
        currency: "EUR",
        source: "csv_import" as const,
        dedupKey: `row-${++rowCount}`,
        ...row,
      })),
    )
    .returning({ id: schema.moneyTransactions.id });
  return inserted.map((row) => row.id);
}

async function readRow(userId: string, id: string) {
  const [row] = await db
    .select()
    .from(schema.moneyTransactions)
    .where(and(eq(schema.moneyTransactions.id, id), eq(schema.moneyTransactions.userId, userId)));
  return row!;
}

async function countUnasked(userId: string) {
  const rows = await db
    .select({ id: schema.moneyTransactions.id })
    .from(schema.moneyTransactions)
    .where(
      and(
        eq(schema.moneyTransactions.userId, userId),
        isNull(schema.moneyTransactions.suggestionAskedAt),
      ),
    );
  return rows.length;
}

// Merchants SHOP 000, SHOP 001 ... booked on successive days, so they come oldest first in order.
function shops(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    counterparty: `SHOP ${String(i).padStart(3, "0")}`,
    bookedOn: new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10),
  }));
}

// A model that answers by merchant text: { "GROCERY MART": categoryId | "none" }. It records every
// request it got.
function fakeModel(answers: Record<string, string>) {
  const requests: CategorizationRequest[] = [];
  const client: CategorizationModelClient = {
    async suggestCategories(request) {
      requests.push(request);
      return {
        answers: request.payload.merchants.flatMap((merchant) => {
          const category = answers[merchant.counterparty ?? merchant.description ?? ""];
          return category === undefined ? [] : [{ merchant: merchant.id, category }];
        }),
      };
    },
  };
  return { client, requests };
}

describe("suggested categories", () => {
  beforeAll(async () => {
    database = await createTestDatabase();
    db = createDb(database.url);
  });
  afterAll(async () => {
    await db?.$client.end();
    await database?.drop();
  });

  it("suggests a category for an uncategorized row and leaves it uncategorized and out of the totals", async () => {
    const user = await createUser();
    const [id] = await insertRows(user, [{ counterparty: "GROCERY MART", description: "CARD" }]);
    const model = fakeModel({ "GROCERY MART": user.category("Food") });
    const before = await monthlyReport(db, user.userId, "2026-10");

    const result = await suggestCategories(db, user.userId, { client: model.client });

    expect(result).toEqual({ merchantsAsked: 1, rowsSuggested: 1, failed: false });
    expect(await readRow(user.userId, id!)).toMatchObject({
      categoryId: null,
      categorySource: null,
      suggestedCategoryId: user.category("Food"),
      suggestionAskedAt: expect.any(Date),
    });
    expect(await monthlyReport(db, user.userId, "2026-10")).toEqual(before);
    expect(before[0]!.categories).toEqual([
      expect.objectContaining({ categoryId: null, categoryName: null, spentCents: 1250n }),
    ]);
  });

  it("sends one entry per merchant, masked, with the user's categories and nothing else", async () => {
    const user = await createUser("Jordan Quinn");
    const other = await createUser("Casey Lane");
    await insertRows(user, [
      {
        counterparty: "GROCERY MART",
        description: "CARD 1234567 JORDAN QUINN LT601010012345678901",
        amountCents: -98765n,
        bookedOn: "2026-10-01",
      },
      {
        counterparty: "grocery mart",
        description: "CARD",
        amountCents: -98766n,
        bookedOn: "2026-10-02",
      },
      { counterparty: "Quinn Bakery", description: "BREAD", bookedOn: "2026-10-03" },
      { counterparty: null, description: "TRAM TICKET 2WEEKS", bookedOn: "2026-10-04" },
      // Never sent: a direct transfer, a manual entry, categorized rows.
      {
        counterparty: "Anna Example",
        counterpartyIban: "LT121000011101001000",
        description: "rent for october",
      },
      { counterparty: "MY OWN NOTE SHOP", source: "manual" },
      { counterparty: "ALREADY FOOD SHOP", categoryId: user.category("Food") },
      { counterparty: "DIRECT TRANSFER SHOP", categoryId: user.category("Transfers") },
    ]);
    await insertRows(other, [{ counterparty: "OTHER USERS SHOP", description: "CASEY LANE" }]);
    const model = fakeModel({});

    await suggestCategories(db, user.userId, { client: model.client });

    expect(model.requests).toHaveLength(1);
    const { payload } = model.requests[0]!;
    expect(payload.merchants).toEqual([
      { id: "m1", counterparty: "GROCERY MART", description: "CARD [NUMBER] [NAME] [IBAN]" },
      { id: "m2", counterparty: "[NAME] Bakery", description: "BREAD" },
      { id: "m3", counterparty: null, description: "TRAM TICKET 2WEEKS" },
    ]);
    expect(payload.categories.map((category) => category.name)).toEqual([
      "Bills",
      "Entertainment",
      "Food",
      "Health",
      "Housing",
      "Income",
      "Other",
      "Shopping",
      "Transport",
    ]);
    expect(payload.categories).toContainEqual({ id: user.category("Food"), name: "Food" });
    expect(payload.categories).not.toContainEqual(
      expect.objectContaining({ id: other.category("Food") }),
    );
    // Whatever else the request carries, none of this is in it.
    const sent = JSON.stringify(model.requests[0]);
    for (const secret of [
      "Quinn",
      "JORDAN",
      "Jordan",
      "1234567",
      "LT6010",
      "LT1210",
      "Anna",
      "rent",
      "MY OWN NOTE",
      "ALREADY FOOD",
      "DIRECT TRANSFER",
      "OTHER USERS",
      "Casey",
      "987",
      "2026",
      user.userId,
      user.cashId,
    ]) {
      expect(sent).not.toContain(secret);
    }
  });

  it("applies a merchant's answer to every uncategorized row of that merchant", async () => {
    const user = await createUser();
    const ids = await insertRows(user, [
      { counterparty: "GROCERY MART", bookedOn: "2026-09-01" },
      { counterparty: "Grocery Mart ", bookedOn: "2026-10-01" },
      { counterparty: "OTHER SHOP", bookedOn: "2026-10-02" },
    ]);
    const model = fakeModel({
      "GROCERY MART": user.category("Food"),
      "OTHER SHOP": user.category("Shopping"),
    });

    const result = await suggestCategories(db, user.userId, { client: model.client });

    expect(result).toEqual({ merchantsAsked: 2, rowsSuggested: 3, failed: false });
    const rows = await Promise.all(ids.map((id) => readRow(user.userId, id)));
    expect(rows.map((row) => row.suggestedCategoryId)).toEqual([
      user.category("Food"),
      user.category("Food"),
      user.category("Shopping"),
    ]);
  });

  it("leaves rows a rule matches to the rules", async () => {
    const user = await createUser();
    await createRule(db, user.userId, {
      field: "counterparty",
      pattern: "grocery",
      categoryId: user.category("Food"),
    });
    await createRule(db, user.userId, {
      field: "description",
      pattern: "monthly fee",
      categoryId: user.category("Bills"),
    });
    await insertRows(user, [
      { counterparty: "GROCERY MART" },
      { counterparty: "Example Bank", description: "Monthly fee" },
      { counterparty: "TRAM CO" },
    ]);
    const model = fakeModel({});

    await suggestCategories(db, user.userId, { client: model.client });

    expect(model.requests[0]!.payload.merchants).toEqual([
      { id: "m1", counterparty: "TRAM CO", description: null },
    ]);
  });

  it("discards answers that aren't one of the user's categories", async () => {
    const user = await createUser();
    const other = await createUser();
    const ids = await insertRows(user, [
      { counterparty: "SHOP A" },
      { counterparty: "SHOP B" },
      { counterparty: "SHOP C" },
      { counterparty: "SHOP D" },
      { counterparty: "SHOP E" },
    ]);
    const model = fakeModel({
      "SHOP A": "00000000-0000-4000-8000-000000000000",
      "SHOP B": other.category("Food"),
      "SHOP C": user.category("Transfers"),
      "SHOP D": "Food",
      "SHOP E": user.category("Health"),
    });

    const result = await suggestCategories(db, user.userId, { client: model.client });

    expect(result).toEqual({ merchantsAsked: 5, rowsSuggested: 1, failed: false });
    const rows = await Promise.all(ids.map((id) => readRow(user.userId, id)));
    expect(rows.map((row) => row.suggestedCategoryId)).toEqual([
      null,
      null,
      null,
      null,
      user.category("Health"),
    ]);
    expect(rows.every((row) => row.categoryId === null)).toBe(true);
  });

  it("marks a merchant answered none as asked, with no suggestion, and never sends it again", async () => {
    const user = await createUser();
    const [id] = await insertRows(user, [{ counterparty: "MYSTERY LTD" }]);
    const first = fakeModel({ "MYSTERY LTD": "none" });

    const result = await suggestCategories(db, user.userId, { client: first.client });

    expect(result).toEqual({ merchantsAsked: 1, rowsSuggested: 0, failed: false });
    expect(await readRow(user.userId, id!)).toMatchObject({
      suggestedCategoryId: null,
      suggestionAskedAt: expect.any(Date),
    });
    const second = fakeModel({ "MYSTERY LTD": user.category("Food") });
    expect(await suggestCategories(db, user.userId, { client: second.client })).toEqual({
      merchantsAsked: 0,
      rowsSuggested: 0,
      failed: false,
    });
    expect(second.requests).toHaveLength(0);
  });

  it("asks only about rows it hasn't asked about", async () => {
    const user = await createUser();
    await insertRows(user, [{ counterparty: "GROCERY MART" }]);
    await suggestCategories(db, user.userId, {
      client: fakeModel({ "GROCERY MART": user.category("Food") }).client,
    });
    await insertRows(user, [{ counterparty: "NEW SHOP" }]);
    const model = fakeModel({});

    await suggestCategories(db, user.userId, { client: model.client });

    expect(model.requests[0]!.payload.merchants).toEqual([
      { id: "m1", counterparty: "NEW SHOP", description: null },
    ]);
  });

  it("marks nothing when the client fails, times out or answers garbage, and doesn't throw", async () => {
    const user = await createUser();
    const [id] = await insertRows(user, [{ counterparty: "GROCERY MART" }]);
    let aborted = false;
    const clients: CategorizationModelClient[] = [
      { suggestCategories: () => Promise.reject(new Error("HTTP 500")) },
      {
        suggestCategories: () => {
          throw new Error("sync failure");
        },
      },
      { suggestCategories: () => Promise.resolve("not json") },
      { suggestCategories: () => Promise.resolve({ answers: "GROCERY MART is Food" }) },
      {
        suggestCategories: ({ signal }) => {
          signal.addEventListener("abort", () => (aborted = true));
          return new Promise(() => {});
        },
      },
    ];

    for (const client of clients) {
      const result = await suggestCategories(db, user.userId, { client, timeoutMs: 20 });
      expect(result).toEqual({ merchantsAsked: 0, rowsSuggested: 0, failed: true });
    }

    expect(aborted).toBe(true);
    expect(await readRow(user.userId, id!)).toMatchObject({
      suggestedCategoryId: null,
      suggestionAskedAt: null,
    });
    // A client that works afterwards still finds the row.
    const model = fakeModel({ "GROCERY MART": user.category("Food") });
    const retry = await suggestCategories(db, user.userId, { client: model.client });
    expect(retry.rowsSuggested).toBe(1);
  });

  it("keeps the batches that were answered when a later request fails", async () => {
    const user = await createUser();
    await insertRows(user, shops(120));
    let calls = 0;
    const client: CategorizationModelClient = {
      async suggestCategories(request) {
        if (++calls === 2) throw new Error("HTTP 500");
        return {
          answers: request.payload.merchants.map((merchant) => ({
            merchant: merchant.id,
            category: user.category("Shopping"),
          })),
        };
      },
    };

    const result = await suggestCategories(db, user.userId, { client });

    expect(result).toEqual({ merchantsAsked: 50, rowsSuggested: 50, failed: true });
    expect(await countUnasked(user.userId)).toBe(70);
  });

  it("sends at most 50 merchants a request and handles a bounded number a run", async () => {
    const user = await createUser();
    await insertRows(user, shops(130));
    const model = fakeModel({});

    const all = await suggestCategories(db, user.userId, { client: model.client });

    expect(all.merchantsAsked).toBe(130);
    expect(model.requests.map((request) => request.payload.merchants.length)).toEqual([50, 50, 30]);

    const bounded = await createUser();
    await insertRows(bounded, shops(130));
    const first = fakeModel({});
    const run = await suggestCategories(db, bounded.userId, {
      client: first.client,
      maxMerchants: 60,
    });
    expect(run.merchantsAsked).toBe(60);
    expect(first.requests.map((request) => request.payload.merchants.length)).toEqual([50, 10]);
    // The next run picks up where this one stopped.
    const next = fakeModel({});
    await suggestCategories(db, bounded.userId, { client: next.client, maxMerchants: 60 });
    expect(next.requests[0]!.payload.merchants[0]!.counterparty).toBe("SHOP 060");
  });

  it("pages through a long history without losing a merchant's rows", async () => {
    const user = await createUser();
    // 5,100 rows, more than a page: a merchant's rows lie on both sides of the page boundary.
    const rows: Row[] = Array.from({ length: 5100 }, (_, i) => ({
      counterparty: i % 2 === 0 ? "GROCERY MART" : "TRAM CO",
    }));
    for (let i = 0; i < rows.length; i += 1000) await insertRows(user, rows.slice(i, i + 1000));
    const model = fakeModel({ "GROCERY MART": user.category("Food"), "TRAM CO": "none" });

    const result = await suggestCategories(db, user.userId, { client: model.client });

    expect(result).toEqual({ merchantsAsked: 2, rowsSuggested: 2550, failed: false });
    expect(model.requests).toHaveLength(1);
    expect(await countUnasked(user.userId)).toBe(0);
  });

  it("reads, sends and changes only the user's own rows", async () => {
    const user = await createUser();
    const other = await createUser();
    await insertRows(user, [{ counterparty: "GROCERY MART" }]);
    const [theirs] = await insertRows(other, [{ counterparty: "GROCERY MART" }]);
    const model = fakeModel({ "GROCERY MART": user.category("Food") });

    await suggestCategories(db, user.userId, { client: model.client });

    expect(model.requests[0]!.payload.merchants).toHaveLength(1);
    expect(await readRow(other.userId, theirs!)).toMatchObject({
      suggestedCategoryId: null,
      suggestionAskedAt: null,
    });
  });

  it("looks only at the rows of one import when asked to", async () => {
    const user = await createUser();
    const [imported] = await db
      .insert(schema.moneyImports)
      .values({
        userId: user.userId,
        accountId: user.cashId,
        filename: "example.csv",
        rowsParsed: 1,
        rowsNew: 1,
        rowsDuplicate: 0,
        rowsFailed: 0,
      })
      .returning({ id: schema.moneyImports.id });
    await insertRows(user, [{ counterparty: "OLD SHOP" }]);
    const [inImport] = await insertRows(user, [{ counterparty: "IMPORTED SHOP" }]);
    await db
      .update(schema.moneyTransactions)
      .set({ importId: imported!.id })
      .where(eq(schema.moneyTransactions.id, inImport!));
    const model = fakeModel({});

    await suggestCategories(db, user.userId, { client: model.client, importId: imported!.id });

    expect(model.requests[0]!.payload.merchants).toEqual([
      { id: "m1", counterparty: "IMPORTED SHOP", description: null },
    ]);
  });

  it("doesn't call the model when the user has no category to suggest", async () => {
    const user = await createUser();
    await db
      .delete(schema.moneyCategories)
      .where(
        and(
          eq(schema.moneyCategories.userId, user.userId),
          eq(schema.moneyCategories.excludedFromSpending, false),
        ),
      );
    await insertRows(user, [{ counterparty: "GROCERY MART" }]);
    const model = fakeModel({});

    const result = await suggestCategories(db, user.userId, { client: model.client });

    expect(result).toEqual({ merchantsAsked: 0, rowsSuggested: 0, failed: false });
    expect(model.requests).toHaveLength(0);
  });

  describe("a suggestion lives only on an uncategorized row", () => {
    async function suggested(user: TestUser) {
      const [id] = await insertRows(user, [{ counterparty: "GROCERY MART" }]);
      await suggestCategories(db, user.userId, {
        client: fakeModel({ "GROCERY MART": user.category("Food") }).client,
      });
      expect(await readRow(user.userId, id!)).toMatchObject({
        suggestedCategoryId: user.category("Food"),
      });
      return id!;
    }

    it("is cleared when the user sets a category by hand", async () => {
      const user = await createUser();
      const id = await suggested(user);

      const updated = await updateTransaction(db, user.userId, {
        transactionId: id,
        categoryId: user.category("Shopping"),
        note: null,
      });

      expect(updated.ok).toBe(true);
      expect(await readRow(user.userId, id)).toMatchObject({
        categoryId: user.category("Shopping"),
        categorySource: "manual",
        suggestedCategoryId: null,
      });
    });

    it("is kept when a hand edit leaves the row uncategorized", async () => {
      const user = await createUser();
      const id = await suggested(user);

      await updateTransaction(db, user.userId, { transactionId: id, categoryId: null, note: "x" });

      expect(await readRow(user.userId, id)).toMatchObject({
        categoryId: null,
        suggestedCategoryId: user.category("Food"),
      });
    });

    it("is cleared when a rule categorizes the row", async () => {
      const user = await createUser();
      const id = await suggested(user);
      await createRule(db, user.userId, {
        field: "counterparty",
        pattern: "grocery",
        categoryId: user.category("Bills"),
      });

      await applyRulesToUncategorized(db, user.userId);

      expect(await readRow(user.userId, id)).toMatchObject({
        categoryId: user.category("Bills"),
        categorySource: "rule",
        suggestedCategoryId: null,
      });
    });

    it("is removed when its category is deleted, and the row stays asked about", async () => {
      const user = await createUser();
      const id = await suggested(user);

      const deleted = await deleteCategory(db, user.userId, {
        categoryId: user.category("Food"),
      });

      expect(deleted).toBe(true);
      expect(await readRow(user.userId, id)).toMatchObject({
        categoryId: null,
        suggestedCategoryId: null,
        suggestionAskedAt: expect.any(Date),
      });
    });

    it("is refused by the database next to a category", async () => {
      const user = await createUser();
      const id = await suggested(user);
      const [categorized] = await insertRows(user, [
        { counterparty: "SHOP", categoryId: user.category("Bills") },
      ]);

      await expect(
        db
          .update(schema.moneyTransactions)
          .set({ categoryId: user.category("Bills") })
          .where(eq(schema.moneyTransactions.id, id)),
      ).rejects.toThrow();
      await expect(
        db
          .update(schema.moneyTransactions)
          .set({ suggestedCategoryId: user.category("Food") })
          .where(eq(schema.moneyTransactions.id, categorized!)),
      ).rejects.toThrow();
    });
  });

  describe("the user's opt-out", () => {
    it("is on until the user turns it off, and off again after they turn it back on", async () => {
      const user = await createUser();

      expect(await aiCategorizationEnabledFor(db, user.userId)).toBe(true);
      await setAiCategorization(db, user.userId, false);
      expect(await aiCategorizationEnabledFor(db, user.userId)).toBe(false);
      await setAiCategorization(db, user.userId, true);
      expect(await aiCategorizationEnabledFor(db, user.userId)).toBe(true);
    });

    it("never reaches the model or marks a row when the user is opted out, and leaves another user's run alone", async () => {
      const optedOut = await createUser();
      const other = await createUser();
      const [mine] = await insertRows(optedOut, [{ counterparty: "GROCERY MART" }]);
      const [theirs] = await insertRows(other, [{ counterparty: "GROCERY MART" }]);
      await setAiCategorization(db, optedOut.userId, false);
      const model = fakeModel({ "GROCERY MART": other.category("Food") });

      const refused = await suggestCategories(db, optedOut.userId, { client: model.client });
      expect(refused).toEqual({ merchantsAsked: 0, rowsSuggested: 0, failed: false });
      expect(model.requests).toHaveLength(0);
      expect(await readRow(optedOut.userId, mine!)).toMatchObject({
        suggestedCategoryId: null,
        suggestionAskedAt: null,
      });

      const asked = await suggestCategories(db, other.userId, { client: model.client });
      expect(asked).toEqual({ merchantsAsked: 1, rowsSuggested: 1, failed: false });
      expect(await readRow(other.userId, theirs!)).toMatchObject({
        suggestedCategoryId: other.category("Food"),
      });
    });

    it("stops before the next request when the user opts out during a run", async () => {
      const user = await createUser();
      // 51 merchants make two requests; the user opts out while the first is out.
      await insertRows(user, shops(51));
      const requests: CategorizationRequest[] = [];
      const client: CategorizationModelClient = {
        async suggestCategories(request) {
          requests.push(request);
          await setAiCategorization(db, user.userId, false);
          return { answers: [] };
        },
      };

      await suggestCategories(db, user.userId, { client });

      expect(requests).toHaveLength(1);
    });

    it("keeps the suggestions the user already has", async () => {
      const user = await createUser();
      const [id] = await insertRows(user, [{ counterparty: "GROCERY MART" }]);
      await suggestCategories(db, user.userId, {
        client: fakeModel({ "GROCERY MART": user.category("Food") }).client,
      });

      await setAiCategorization(db, user.userId, false);

      expect(await readRow(user.userId, id!)).toMatchObject({
        suggestedCategoryId: user.category("Food"),
      });
    });
  });
});
