import {
  listTransactions,
  runCategorySuggestions,
  setAiCategorization,
  startJobQueue,
  type CategorizationModelClient,
  type JobQueue,
} from "@troba/core";
import { createDb, schema, type Db } from "@troba/db";
import {
  createMoneyUser,
  insertImportedRows,
  recordingModel,
  testAiCategorizeDailyLimit,
  type MoneyUser,
} from "@troba/core/test-ai-categories";
import { createTestDatabase } from "@troba/db/test-database";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Accept, dismiss and "Ask again" on suggested categories (SPEC-money M5, ADR-0016): what the user
// is told and what the list holds. The session, database, job queue and whether the server has a
// key are the only things replaced; the actions, core and Postgres are real. "Ask again" queues a
// run, which the test runs as the worker would, with `server.client` as the model.

const session = vi.hoisted(() => ({ userId: "" }));
const server = vi.hoisted(() => ({
  db: undefined as unknown,
  // Null: the server has no key.
  client: null as CategorizationModelClient | null,
  queue: undefined as unknown,
}));

vi.mock("@/server/session", () => ({
  requireUser: async () => ({ userId: session.userId, role: "user" }),
}));
vi.mock("@/server/db", () => ({ db: () => server.db }));
vi.mock("@/server/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/env")>()),
  aiCategorizationEnabled: () => server.client !== null,
}));
vi.mock("@/server/jobs", () => ({ jobQueue: async () => server.queue }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Db;
let queue: JobQueue;
let actions: typeof import("./suggestion-review-actions");

function createUser(name: string) {
  return createMoneyUser(db, name);
}

// An imported row the model asked about; with `suggested`, it carries that suggestion.
async function askedRow(user: MoneyUser, counterparty: string, suggested?: string) {
  const [id] = await insertImportedRows(db, user, [
    {
      counterparty,
      description: "CARD PAYMENT",
      suggestedCategoryId: suggested ?? null,
      suggestionAskedAt: new Date(),
    },
  ]);
  return id!;
}

beforeAll(async () => {
  database = await createTestDatabase();
  db = createDb(database.url);
  queue = await startJobQueue(database.url);
  server.db = db;
  server.queue = queue;
  actions = await import("./suggestion-review-actions");
});

afterAll(async () => {
  await queue.stop({ graceful: false });
  await db.$client.end();
  await database.drop();
});

let user: MoneyUser;

beforeEach(async () => {
  user = await createUser("Example User");
  session.userId = user.userId;
  server.client = null;
});

// The accept and dismiss controls are shown only while the server has a key.
function withKey() {
  server.client = { suggestCategories: async () => ({ answers: [] }) };
}

describe("acceptSuggestionAction", () => {
  beforeEach(withKey);

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

  it("changes nothing without a key on the server", async () => {
    const id = await askedRow(user, "GROCERY MART", user.category("Food"));
    server.client = null;

    expect(await actions.acceptSuggestionAction(id)).toEqual({
      ok: false,
      message: "AI suggestions are turned off, so nothing was changed.",
    });
    expect(await listTransactions(db, user.userId)).toEqual([
      expect.objectContaining({ categoryId: null, suggestedCategoryName: "Food" }),
    ]);
  });

  it("changes nothing for a user who turned suggestions off", async () => {
    const id = await askedRow(user, "GROCERY MART", user.category("Food"));
    await setAiCategorization(db, user.userId, false);

    expect(await actions.acceptSuggestionAction(id)).toEqual({
      ok: false,
      message: "AI suggestions are turned off, so nothing was changed.",
    });
    expect(await listTransactions(db, user.userId)).toEqual([
      expect.objectContaining({ categoryId: null, suggestedCategoryName: "Food" }),
    ]);
  });
});

describe("dismissSuggestionAction", () => {
  beforeEach(withKey);

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

  it("changes nothing without a key on the server", async () => {
    const id = await askedRow(user, "GROCERY MART", user.category("Food"));
    server.client = null;

    expect(await actions.dismissSuggestionAction(id)).toEqual({
      ok: false,
      message: "AI suggestions are turned off, so nothing was changed.",
    });
    expect(await listTransactions(db, user.userId)).toEqual([
      expect.objectContaining({ suggestedCategoryName: "Food" }),
    ]);
  });

  // The page keeps the suggestions an opted-out user already has dismissable: dismissing sends
  // nothing anywhere.
  it("still dismisses for a user who turned suggestions off", async () => {
    const id = await askedRow(user, "GROCERY MART", user.category("Food"));
    await setAiCategorization(db, user.userId, false);

    expect(await actions.dismissSuggestionAction(id)).toEqual({
      ok: true,
      message: "Dismissed the suggestion on 1 transaction.",
    });
  });
});

describe("askAgainAction", () => {
  function fakeModel() {
    return recordingModel((request) => ({
      answers: request.payload.merchants.map((merchant) => ({
        merchant: merchant.id,
        category: request.payload.categories.find((c) => c.name === "Food")!.id,
      })),
    }));
  }

  it("offers a dismissed merchant to the model again", async () => {
    const id = await askedRow(user, "GROCERY MART", user.category("Food"));
    const model = fakeModel();
    server.client = model.client;
    await actions.dismissSuggestionAction(id);

    const state = await actions.askAgainAction();
    expect(state).toMatchObject({ status: "pending", runId: expect.any(String) });
    await runCategorySuggestions(db, user.userId, state.runId!, {
      client: model.client,
      dailyLimit: testAiCategorizeDailyLimit,
    });

    const { suggestionRunStatusAction } = await import("./suggestion-actions");
    expect(await suggestionRunStatusAction(state.runId!)).toEqual({
      status: "suggested",
      message: "1 transaction has a suggestion.",
    });
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

describe("acceptAllSuggestionsAction", () => {
  beforeEach(() => {
    // Accepting is offered only while the server has a key.
    server.client = { suggestCategories: async () => ({ answers: [] }) };
  });

  it("categorizes every pending suggestion as the user's own choice and says how many", async () => {
    await askedRow(user, "GROCERY MART", user.category("Food"));
    await askedRow(user, "GROCERY MART", user.category("Food"));
    await askedRow(user, "BOOK NOOK", user.category("Shopping"));
    await askedRow(user, "MYSTERY SHOP");

    const state = await actions.acceptAllSuggestionsAction();

    expect(state).toEqual({ ok: true, message: "Categorized 3 transactions from 2 merchants." });
    const rows = await listTransactions(db, user.userId);
    expect(rows.filter((row) => row.categorySource === "manual")).toHaveLength(3);
    expect(rows.filter((row) => row.categoryId === null)).toHaveLength(1);
  });

  it("uses the singular for one transaction", async () => {
    await askedRow(user, "GROCERY MART", user.category("Food"));

    expect(await actions.acceptAllSuggestionsAction()).toEqual({
      ok: true,
      message: "Categorized 1 transaction from 1 merchant.",
    });
  });

  it("says so, and changes nothing, when no suggestion is waiting any more", async () => {
    await askedRow(user, "GROCERY MART");

    expect(await actions.acceptAllSuggestionsAction()).toEqual({
      ok: false,
      message: "No suggestions are waiting, so nothing was changed.",
    });
  });

  it("leaves another user's suggestions alone", async () => {
    const other = await createUser("Other Person");
    await askedRow(other, "GROCERY MART", other.category("Food"));
    await askedRow(user, "BOOK NOOK", user.category("Shopping"));

    await actions.acceptAllSuggestionsAction();

    expect(await listTransactions(db, other.userId)).toEqual([
      expect.objectContaining({ categoryId: null, suggestedCategoryName: "Food" }),
    ]);
  });

  it("changes nothing without a key on the server", async () => {
    await askedRow(user, "GROCERY MART", user.category("Food"));
    server.client = null;

    expect(await actions.acceptAllSuggestionsAction()).toEqual({
      ok: false,
      message: "AI suggestions are turned off, so nothing was changed.",
    });
    expect(await listTransactions(db, user.userId)).toEqual([
      expect.objectContaining({ categoryId: null, suggestedCategoryName: "Food" }),
    ]);
  });

  it("changes nothing for a user who turned suggestions off", async () => {
    await askedRow(user, "GROCERY MART", user.category("Food"));
    await setAiCategorization(db, user.userId, false);

    expect(await actions.acceptAllSuggestionsAction()).toEqual({
      ok: false,
      message: "AI suggestions are turned off, so nothing was changed.",
    });
    expect(await listTransactions(db, user.userId)).toEqual([
      expect.objectContaining({ categoryId: null, suggestedCategoryName: "Food" }),
    ]);
  });
});
