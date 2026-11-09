import {
  ensureMoneyDefaults,
  listAccounts,
  listCategories,
  listTransactions,
  setAiCategorization,
  type CategorizationModelClient,
  type CategorizationRequest,
} from "@troba/core";
import { createDb, schema, type Db } from "@troba/db";
import { createTestDatabase } from "@troba/db/test-database";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Accept, dismiss and "Ask again" on suggested categories (SPEC-money M5, ADR-0016): what the user
// is told and what the list holds. The session, database and model client are the only things
// replaced; the actions, core and Postgres are real.

const session = vi.hoisted(() => ({ userId: "" }));
const server = vi.hoisted(() => ({
  db: undefined as unknown,
  client: null as CategorizationModelClient | null,
}));

vi.mock("@/server/session", () => ({
  requireUser: async () => ({ userId: session.userId, role: "user" }),
}));
vi.mock("@/server/db", () => ({ db: () => server.db }));
vi.mock("@/server/openai-categorization", () => ({
  categorizationModelClient: () => server.client,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Db;
let actions: typeof import("./suggestion-review-actions");
let userCount = 0;
let rowCount = 0;

async function createUser(name: string) {
  const [user] = await db
    .insert(schema.users)
    .values({ name, email: `suggest-review${++userCount}@example.test` })
    .returning({ id: schema.users.id });
  await ensureMoneyDefaults(db, user!.id);
  const [cash] = await listAccounts(db, user!.id);
  const categories = await listCategories(db, user!.id);
  return {
    userId: user!.id,
    cashId: cash!.id,
    category: (categoryName: string) => categories.find((c) => c.name === categoryName)!.id,
  };
}

type TestUser = Awaited<ReturnType<typeof createUser>>;

// An imported row the model asked about; with `suggested`, it carries that suggestion.
async function askedRow(user: TestUser, counterparty: string, suggested?: string) {
  const [row] = await db
    .insert(schema.moneyTransactions)
    .values({
      userId: user.userId,
      accountId: user.cashId,
      bookedOn: "2026-10-05",
      amountCents: -1250n,
      currency: "EUR",
      source: "csv_import",
      dedupKey: `review-action-row-${++rowCount}`,
      counterparty,
      description: "CARD PAYMENT",
      suggestedCategoryId: suggested ?? null,
      suggestionAskedAt: new Date(),
    })
    .returning({ id: schema.moneyTransactions.id });
  return row!.id;
}

beforeAll(async () => {
  database = await createTestDatabase();
  db = createDb(database.url);
  server.db = db;
  actions = await import("./suggestion-review-actions");
});

afterAll(async () => {
  await db.$client.end();
  await database.drop();
});

let user: TestUser;

beforeEach(async () => {
  user = await createUser("Example User");
  session.userId = user.userId;
  server.client = null;
});

describe("acceptSuggestionAction", () => {
  it("categorizes the merchant's rows as the user's own choice and says how many", async () => {
    const id = await askedRow(user, "GROCERY MART", user.category("Food"));
    await askedRow(user, "GROCERY MART");

    const state = await actions.acceptSuggestionAction(id);

    expect(state).toEqual({ ok: true, message: "Categorized 2 transactions as Food." });
    expect(await listTransactions(db, user.userId)).toEqual([
      expect.objectContaining({ categoryName: "Food", categorySource: "manual" }),
      expect.objectContaining({ categoryName: "Food", categorySource: "manual" }),
    ]);
  });

  it("says so, and changes nothing, when the suggestion is gone", async () => {
    const id = await askedRow(user, "GROCERY MART");

    const state = await actions.acceptSuggestionAction(id);

    expect(state).toEqual({
      ok: false,
      message: "That suggestion is no longer there, so nothing was changed.",
    });
    expect(await listTransactions(db, user.userId)).toEqual([
      expect.objectContaining({ categoryId: null }),
    ]);
  });

  it("refuses another user's transaction, and anything that isn't an id", async () => {
    const other = await createUser("Other Person");
    const theirs = await askedRow(other, "GROCERY MART", other.category("Food"));

    expect(await actions.acceptSuggestionAction(theirs)).toEqual({
      ok: false,
      message: "That transaction doesn't exist.",
    });
    expect(await actions.acceptSuggestionAction("not an id")).toEqual({
      ok: false,
      message: "That transaction doesn't exist.",
    });
    expect(await listTransactions(db, other.userId)).toEqual([
      expect.objectContaining({ categoryId: null, suggestedCategoryName: "Food" }),
    ]);
  });
});

describe("dismissSuggestionAction", () => {
  it("removes the merchant's suggestions and says how many", async () => {
    const id = await askedRow(user, "GROCERY MART", user.category("Food"));
    await askedRow(user, "GROCERY MART", user.category("Food"));

    const state = await actions.dismissSuggestionAction(id);

    expect(state).toEqual({ ok: true, message: "Dismissed the suggestion on 2 transactions." });
    expect(await listTransactions(db, user.userId)).toEqual([
      expect.objectContaining({ categoryId: null, suggestedCategoryId: null }),
      expect.objectContaining({ categoryId: null, suggestedCategoryId: null }),
    ]);
  });

  it("refuses another user's transaction", async () => {
    const other = await createUser("Other Person");
    const theirs = await askedRow(other, "GROCERY MART", other.category("Food"));

    expect(await actions.dismissSuggestionAction(theirs)).toEqual({
      ok: false,
      message: "That transaction doesn't exist.",
    });
  });
});

describe("askAgainAction", () => {
  function fakeModel() {
    const requests: CategorizationRequest[] = [];
    const client: CategorizationModelClient = {
      async suggestCategories(request) {
        requests.push(request);
        return {
          answers: request.payload.merchants.map((merchant) => ({
            merchant: merchant.id,
            category: request.payload.categories.find((c) => c.name === "Food")!.id,
          })),
        };
      },
    };
    return { client, requests };
  }

  it("offers a dismissed merchant to the model again", async () => {
    const id = await askedRow(user, "GROCERY MART", user.category("Food"));
    await actions.dismissSuggestionAction(id);
    const model = fakeModel();
    server.client = model.client;

    const state = await actions.askAgainAction();

    expect(state).toEqual({ status: "suggested", message: "1 transaction has a suggestion." });
    expect(model.requests).toHaveLength(1);
    expect(await listTransactions(db, user.userId)).toEqual([
      expect.objectContaining({ suggestedCategoryName: "Food" }),
    ]);
  });

  it("reopens nothing without a model client", async () => {
    await askedRow(user, "GROCERY MART");

    expect(await actions.askAgainAction()).toEqual({ status: "off", message: "" });
    const rows = await db.select().from(schema.moneyTransactions);
    expect(
      rows.filter((row) => row.userId === user.userId).map((row) => row.suggestionAskedAt),
    ).toEqual([expect.any(Date)]);
  });

  it("reopens nothing and sends nothing for a user who turned suggestions off", async () => {
    await askedRow(user, "GROCERY MART");
    const model = fakeModel();
    server.client = model.client;
    await setAiCategorization(db, user.userId, false);

    expect(await actions.askAgainAction()).toEqual({ status: "off", message: "" });

    expect(model.requests).toHaveLength(0);
    const rows = await db.select().from(schema.moneyTransactions);
    expect(
      rows.filter((row) => row.userId === user.userId).map((row) => row.suggestionAskedAt),
    ).toEqual([expect.any(Date)]);
  });
});
