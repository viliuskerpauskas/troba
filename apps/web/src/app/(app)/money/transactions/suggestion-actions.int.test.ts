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

// The "Suggest categories" button's action with a fake model behind it (SPEC-money M5, ADR-0016):
// what the user is told and what the list holds for each way the call can go. The server's
// session, database and model client are the only things replaced; the action, core and Postgres
// are real.

const session = vi.hoisted(() => ({ userId: "" }));
const server = vi.hoisted(() => ({
  db: undefined as unknown,
  client: null as CategorizationModelClient | null,
  clientBuilt: 0,
}));

vi.mock("@/server/session", () => ({
  requireUser: async () => ({ userId: session.userId, role: "user" }),
}));
vi.mock("@/server/db", () => ({ db: () => server.db }));
vi.mock("@/server/openai-categorization", () => ({
  categorizationModelClient: () => {
    server.clientBuilt++;
    return server.client;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Db;
let actions: typeof import("./suggestion-actions");
let userCount = 0;
let rowCount = 0;

type Answer = (request: CategorizationRequest) => unknown;

// Records what it was asked and answers as told; an Error is thrown.
function fakeModel(answer: Answer | Error) {
  const requests: CategorizationRequest[] = [];
  const client: CategorizationModelClient = {
    async suggestCategories(request) {
      requests.push(request);
      if (answer instanceof Error) throw answer;
      return answer(request);
    },
  };
  return { client, requests };
}

// Puts every merchant in the named category.
function everythingIn(categoryName: string): Answer {
  return (request) => ({
    answers: request.payload.merchants.map((merchant) => ({
      merchant: merchant.id,
      category: request.payload.categories.find((category) => category.name === categoryName)!.id,
    })),
  });
}

async function createUser(name: string) {
  const [user] = await db
    .insert(schema.users)
    .values({ name, email: `suggest-action${++userCount}@example.test` })
    .returning({ id: schema.users.id });
  await ensureMoneyDefaults(db, user!.id);
  const [cash] = await listAccounts(db, user!.id);
  return { userId: user!.id, cashId: cash!.id };
}

async function importedRow(user: { userId: string; cashId: string }, counterparty: string) {
  await db.insert(schema.moneyTransactions).values({
    userId: user.userId,
    accountId: user.cashId,
    bookedOn: "2026-10-05",
    amountCents: -1250n,
    currency: "EUR",
    source: "csv_import",
    dedupKey: `action-row-${++rowCount}`,
    counterparty,
    description: "CARD PAYMENT",
  });
}

beforeAll(async () => {
  database = await createTestDatabase();
  db = createDb(database.url);
  server.db = db;
  actions = await import("./suggestion-actions");
});

afterAll(async () => {
  await db.$client.end();
  await database.drop();
});

let user: Awaited<ReturnType<typeof createUser>>;

beforeEach(async () => {
  user = await createUser("Example User");
  session.userId = user.userId;
  server.client = null;
  vi.unstubAllEnvs();
  server.clientBuilt = 0;
});

describe("suggestCategoriesAction", () => {
  it("stores suggestions and says how many rows got one, leaving the rows uncategorized", async () => {
    await importedRow(user, "GROCERY MART");
    await importedRow(user, "GROCERY MART");
    await importedRow(user, "CORNER CAFE");
    const model = fakeModel(everythingIn("Food"));
    server.client = model.client;

    const state = await actions.suggestCategoriesAction();

    expect(state).toEqual({ status: "suggested", message: "3 transactions have a suggestion." });
    const food = (await listCategories(db, user.userId)).find((c) => c.name === "Food")!;
    const rows = await listTransactions(db, user.userId);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row).toMatchObject({
        categoryId: null,
        categoryName: null,
        suggestedCategoryId: food.id,
        suggestedCategoryName: "Food",
      });
    }
    expect(model.requests).toHaveLength(1);
  });

  it("says there is nothing to ask about when no row is eligible, without calling the model", async () => {
    const model = fakeModel(everythingIn("Food"));
    server.client = model.client;

    const state = await actions.suggestCategoriesAction();

    expect(state).toEqual({
      status: "nothing",
      message: "There are no uncategorized imported transactions to suggest for.",
    });
    expect(model.requests).toHaveLength(0);
  });

  it("says so when the model had no suggestion for what it was asked", async () => {
    await importedRow(user, "MYSTERY SHOP");
    server.client = fakeModel((request) => ({
      answers: request.payload.merchants.map((m) => ({ merchant: m.id, category: "none" })),
    })).client;

    const state = await actions.suggestCategoriesAction();

    expect(state).toEqual({
      status: "none",
      message: "The model had no suggestions for these transactions.",
    });
  });

  it.each([
    ["throws", new Error("HTTP 503")],
    ["answers with garbage", () => ({ unexpected: true })],
  ])("changes nothing and stays calm when the model %s", async (_name, answer) => {
    await importedRow(user, "GROCERY MART");
    const model = fakeModel(answer);
    server.client = model.client;

    const state = await actions.suggestCategoriesAction();

    expect(state).toEqual({
      status: "failed",
      message: "Suggestions aren't available right now. Nothing was changed, so try again later.",
    });
    expect(await listTransactions(db, user.userId)).toEqual([
      expect.objectContaining({ suggestedCategoryId: null }),
    ]);
    // Not marked as asked, so the next try sends it again.
    const rows = await db.select().from(schema.moneyTransactions);
    const mine = rows.filter((row) => row.userId === user.userId);
    expect(mine.map((row) => row.suggestionAskedAt)).toEqual([null]);
  });

  it("keeps what an earlier batch stored when a later one fails, and says so", async () => {
    // 51 merchants make two requests; the second one fails.
    for (let i = 0; i < 51; i++) await importedRow(user, `SHOP ${String(i).padStart(3, "0")}`);
    let calls = 0;
    const food = everythingIn("Food");
    server.client = fakeModel((request) => {
      if (++calls > 1) throw new Error("HTTP 503");
      return food(request);
    }).client;

    const state = await actions.suggestCategoriesAction();

    expect(state).toEqual({
      status: "suggested",
      message:
        "50 transactions have a suggestion. The model then stopped answering; try again later for the rest.",
    });
  });

  it("says the limit is reached when it stops the run, keeps what was suggested and leaves the rest alone", async () => {
    vi.stubEnv("AI_CATEGORIZE_DAILY_LIMIT", "2");
    await importedRow(user, "SHOP 001");
    await importedRow(user, "SHOP 002");
    await importedRow(user, "SHOP 003");
    server.client = fakeModel(everythingIn("Food")).client;

    const state = await actions.suggestCategoriesAction();

    expect(state).toEqual({
      status: "capped",
      message:
        "2 transactions have a suggestion. The daily limit on AI suggestions is reached, so the rest stays uncategorized for now.",
    });
    const rows = await db.select().from(schema.moneyTransactions);
    expect(rows.filter((row) => row.userId === user.userId && !row.suggestionAskedAt)).toHaveLength(
      1,
    );
  });

  it("says the limit is reached, and doesn't call the model, once the day's allowance is spent", async () => {
    vi.stubEnv("AI_CATEGORIZE_DAILY_LIMIT", "1");
    await importedRow(user, "SHOP 001");
    await db.insert(schema.moneyAiCategorizeUses).values({ userId: user.userId, merchants: 1 });
    const model = fakeModel(everythingIn("Food"));
    server.client = model.client;

    const state = await actions.suggestCategoriesAction();

    expect(state).toEqual({
      status: "capped",
      message:
        "The daily limit on AI suggestions is reached, so these transactions stay uncategorized for now. Try again later.",
    });
    expect(model.requests).toHaveLength(0);
  });

  it("counts the limit in the environment variable's merchants, defaulting to 200", async () => {
    vi.stubEnv("AI_CATEGORIZE_DAILY_LIMIT", "not a number");
    await db.insert(schema.moneyAiCategorizeUses).values({ userId: user.userId, merchants: 199 });
    await importedRow(user, "SHOP 001");
    await importedRow(user, "SHOP 002");
    server.client = fakeModel(everythingIn("Food")).client;

    const state = await actions.suggestCategoriesAction();

    expect(state.status).toBe("capped");
    expect(state.message).toContain("1 transaction has a suggestion.");
  });

  it("does nothing without a model client, as when the server has no key", async () => {
    await importedRow(user, "GROCERY MART");

    const state = await actions.suggestCategoriesAction();

    expect(state).toEqual({ status: "off", message: "" });
    expect(await listTransactions(db, user.userId)).toEqual([
      expect.objectContaining({ suggestedCategoryId: null }),
    ]);
  });

  it("asks only about the signed-in user's rows", async () => {
    const other = await createUser("Other Person");
    await importedRow(other, "OTHER USERS SHOP");
    await importedRow(user, "GROCERY MART");
    const model = fakeModel(everythingIn("Food"));
    server.client = model.client;

    await actions.suggestCategoriesAction();

    expect(model.requests[0]!.payload.merchants.map((m) => m.counterparty)).toEqual([
      "GROCERY MART",
    ]);
    expect(await listTransactions(db, other.userId)).toEqual([
      expect.objectContaining({ suggestedCategoryId: null }),
    ]);
  });

  it("does nothing for a user who turned AI categorization off, not even building the client, while another user is served", async () => {
    const other = await createUser("Other Person");
    await importedRow(user, "GROCERY MART");
    await importedRow(other, "CORNER CAFE");
    await setAiCategorization(db, user.userId, false);
    const model = fakeModel(everythingIn("Food"));
    server.client = model.client;

    const refused = await actions.suggestCategoriesAction();

    expect(refused).toEqual({ status: "off", message: "" });
    expect(server.clientBuilt).toBe(0);
    expect(model.requests).toHaveLength(0);
    expect(await listTransactions(db, user.userId)).toEqual([
      expect.objectContaining({ suggestedCategoryId: null }),
    ]);

    session.userId = other.userId;
    const served = await actions.suggestCategoriesAction();
    expect(served).toEqual({ status: "suggested", message: "1 transaction has a suggestion." });
    expect(model.requests).toHaveLength(1);
  });
});
