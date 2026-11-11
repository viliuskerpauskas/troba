import {
  listTransactions,
  runCategorySuggestions,
  setAiCategorization,
  startJobQueue,
  type CategorizationRequest,
  type JobData,
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
import type { SuggestState } from "./suggestion-actions";

// The "Suggest categories" button's actions (SPEC-money M5, ADR-0020): the button queues a run for
// the worker and answers at once, and the page asks how the run went until it is done. The test
// plays the worker with core's runCategorySuggestions and a fake model. The server's session,
// database and job queue are the only things replaced; the actions, core and Postgres are real.

const session = vi.hoisted(() => ({ userId: "" }));
const server = vi.hoisted(() => ({ db: undefined as unknown, queue: undefined as unknown }));

vi.mock("@/server/session", () => ({
  requireUser: async () => ({ userId: session.userId, role: "user" }),
}));
vi.mock("@/server/db", () => ({ db: () => server.db }));
vi.mock("@/server/jobs", () => ({ jobQueue: async () => server.queue }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Db;
let queue: JobQueue;
let actions: typeof import("./suggestion-actions");

type Answer = (request: CategorizationRequest) => unknown;

// Puts every merchant in the named category.
function everythingIn(categoryName: string): Answer {
  return (request) => ({
    answers: request.payload.merchants.map((merchant) => ({
      merchant: merchant.id,
      category: request.payload.categories.find((category) => category.name === categoryName)!.id,
    })),
  });
}

async function importedRow(owner: MoneyUser, counterparty: string) {
  await insertImportedRows(db, owner, [{ counterparty, description: "CARD PAYMENT" }]);
}

// When each of the user's rows was asked about, null for not yet.
async function askedAt(owner: MoneyUser) {
  const rows = await db.select().from(schema.moneyTransactions);
  return rows.filter((row) => row.userId === owner.userId).map((row) => row.suggestionAskedAt);
}

// The suggest-categories jobs queued for the user and not yet fetched.
async function queuedFor(owner: MoneyUser) {
  const jobs =
    (await queue.fetch<JobData<"suggest-categories">>("suggest-categories", { batchSize: 1000 })) ??
    [];
  return jobs.filter((job) => job.data.userId === owner.userId);
}

// Presses the button, which must answer at once with a run under way.
async function press(): Promise<string> {
  const state = await actions.suggestCategoriesAction();
  expect(state).toMatchObject({ status: "pending", runId: expect.any(String) });
  return state.runId!;
}

// Presses the button, runs the job as the worker would, and returns what the page is then told.
async function suggest(
  answer: Answer | Error,
  dailyLimit = testAiCategorizeDailyLimit,
): Promise<{ state: SuggestState; requests: CategorizationRequest[] }> {
  const runId = await press();
  const model = recordingModel(answer);
  await runCategorySuggestions(db, session.userId, runId, { client: model.client, dailyLimit });
  return { state: await actions.suggestionRunStatusAction(runId), requests: model.requests };
}

beforeAll(async () => {
  database = await createTestDatabase();
  db = createDb(database.url);
  queue = await startJobQueue(database.url);
  server.db = db;
  server.queue = queue;
  actions = await import("./suggestion-actions");
});

afterAll(async () => {
  await queue.stop({ graceful: false });
  await db.$client.end();
  await database.drop();
});

let user: MoneyUser;

beforeEach(async () => {
  vi.unstubAllEnvs();
  vi.stubEnv("OPENAI_API_KEY", "sk-test-not-a-real-key");
  user = await createMoneyUser(db, "Example User");
  session.userId = user.userId;
});

describe("suggestCategoriesAction", () => {
  it("answers at once, before the model is asked, and says a run is under way", async () => {
    await importedRow(user, "GROCERY MART");

    const state = await actions.suggestCategoriesAction();

    expect(state).toEqual({
      status: "pending",
      runId: expect.any(String),
      message: "Suggesting categories. They appear on the list when they're ready.",
    });
    expect(await actions.suggestionRunStatusAction(state.runId!)).toEqual(state);
    expect(await askedAt(user)).toEqual([null]);
  });

  it("reports the stored suggestions once the run is done, leaving the rows uncategorized", async () => {
    await importedRow(user, "GROCERY MART");
    await importedRow(user, "GROCERY MART");
    await importedRow(user, "CORNER CAFE");

    const { state, requests } = await suggest(everythingIn("Food"));

    expect(state).toEqual({ status: "suggested", message: "3 transactions have a suggestion." });
    for (const row of await listTransactions(db, user.userId)) {
      expect(row).toMatchObject({ categoryId: null, suggestedCategoryName: "Food" });
    }
    expect(requests).toHaveLength(1);
  });

  it("says there is nothing to ask about when no row is eligible", async () => {
    const { state, requests } = await suggest(everythingIn("Food"));

    expect(state).toEqual({
      status: "nothing",
      message: "There are no uncategorized imported transactions to suggest for.",
    });
    expect(requests).toHaveLength(0);
  });

  it("says so when the model had no suggestion for what it was asked", async () => {
    await importedRow(user, "MYSTERY SHOP");

    const { state } = await suggest((request) => ({
      answers: request.payload.merchants.map((m) => ({ merchant: m.id, category: "none" })),
    }));

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

    const { state } = await suggest(answer);

    expect(state).toEqual({
      status: "failed",
      message: "Suggestions aren't available right now. Nothing was changed, so try again later.",
    });
    // Not marked as asked, so the next try sends it again.
    expect(await listTransactions(db, user.userId)).toEqual([
      expect.objectContaining({ suggestedCategoryId: null }),
    ]);
    expect(await askedAt(user)).toEqual([null]);
  });

  it("keeps what an earlier batch stored when a later one fails, and says so", async () => {
    // 51 merchants make two requests; the second one fails.
    for (let i = 0; i < 51; i++) await importedRow(user, `SHOP ${String(i).padStart(3, "0")}`);
    let calls = 0;
    const food = everythingIn("Food");

    const { state } = await suggest((request) => {
      if (++calls > 1) throw new Error("HTTP 503");
      return food(request);
    });

    expect(state).toEqual({
      status: "suggested",
      message:
        "50 transactions have a suggestion. The model then stopped answering; try again later for the rest.",
    });
  });

  it("says the limit is reached when it stops the run, keeping what was suggested", async () => {
    await importedRow(user, "SHOP 001");
    await importedRow(user, "SHOP 002");
    await importedRow(user, "SHOP 003");

    const { state } = await suggest(everythingIn("Food"), 2);

    expect(state).toEqual({
      status: "capped",
      message:
        "2 transactions have a suggestion. The daily limit on AI suggestions is reached, so the rest stays uncategorized for now.",
    });
  });

  it("says the limit is reached, and the model isn't asked, once the day's allowance is spent", async () => {
    await importedRow(user, "SHOP 001");
    await db.insert(schema.moneyAiCategorizeUses).values({ userId: user.userId, merchants: 1 });

    const { state, requests } = await suggest(everythingIn("Food"), 1);

    expect(state).toEqual({
      status: "capped",
      message:
        "The daily limit on AI suggestions is reached, so these transactions stay uncategorized for now. Try again later.",
    });
    expect(requests).toHaveLength(0);
  });

  it("queues nothing without a key on the server", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    await importedRow(user, "GROCERY MART");

    expect(await actions.suggestCategoriesAction()).toEqual({ status: "off", message: "" });
    expect(await queuedFor(user)).toEqual([]);
  });

  it("queues nothing for a user who turned AI categorization off", async () => {
    await importedRow(user, "GROCERY MART");
    await setAiCategorization(db, user.userId, false);

    expect(await actions.suggestCategoriesAction()).toEqual({ status: "off", message: "" });
    expect(await queuedFor(user)).toEqual([]);
  });

  it("starts no second run while one is under way", async () => {
    await importedRow(user, "GROCERY MART");

    expect(await press()).toBe(await press());
  });
});

describe("suggestionRunStatusAction", () => {
  it("tells another user nothing about a run, and refuses anything that isn't an id", async () => {
    await importedRow(user, "GROCERY MART");
    const runId = await press();

    session.userId = (await createMoneyUser(db, "Other Person")).userId;
    expect(await actions.suggestionRunStatusAction(runId)).toEqual({});
    expect(await actions.suggestionRunStatusAction("not an id")).toEqual({});
  });
});
