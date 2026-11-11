import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ensureMoneyDefaults,
  getCategorySuggestionRun,
  importPresets,
  listAccounts,
  runCategorySuggestions,
  setAiCategorization,
  startJobQueue,
  type CategorizationModelClient,
  type CategorizationRequest,
  type JobData,
  type JobQueue,
} from "@troba/core";
import { testAiCategorizeDailyLimit } from "@troba/core/test-ai-categories";
import { createDb, schema, type Db } from "@troba/db";
import { createTestDatabase } from "@troba/db/test-database";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportState } from "./actions";

// An import with AI suggestions on (SPEC-money M5, ADR-0020): the import never waits on the model.
// It is saved, a run for its rows is queued for the worker, and the result says suggestions are
// being prepared. The test plays the worker with core's runCategorySuggestions. The server's
// session, database and job queue are the only things replaced; the actions, core and Postgres
// are real.

const session = vi.hoisted(() => ({ userId: "" }));
const server = vi.hoisted(() => ({
  db: undefined as unknown,
  queue: undefined as unknown,
  queueDown: false,
}));

vi.mock("@/server/money", () => ({
  requireMoneyUser: async () => ({ userId: session.userId, role: "user" }),
}));
vi.mock("@/server/db", () => ({ db: () => server.db }));
vi.mock("@/server/jobs", () => ({
  jobQueue: async () => {
    if (server.queueDown) throw new Error("connection refused");
    return server.queue;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Db;
let queue: JobQueue;
let actions: typeof import("./actions");
let userCount = 0;
let cashId = "";

// A preset's fixture, which names no account: the user picks one. The preset is looked up by
// position, so no bank is named outside the presets folder.
const statement = readFileSync(
  path.join(
    import.meta.dirname,
    "../../../../../../../packages/core/src/money/import/presets",
    `${importPresets[1].id}.fixture.csv`,
  ),
);

function form(extra: Record<string, string> = {}) {
  const data = new FormData();
  data.set("file", new File([new Uint8Array(statement)], "statement.csv", { type: "text/csv" }));
  for (const [name, value] of Object.entries(extra)) data.set(name, value);
  return data;
}

async function importStatement(): Promise<Extract<ImportState, { step: "done" }>> {
  const preview = await actions.startImportAction(form());
  if (preview.step !== "preview") throw new Error(`expected the preview step, got ${preview.step}`);
  const done = await actions.commitImportAction(
    form({ profileId: preview.profile.id, accountId: cashId }),
  );
  if (done.step !== "done") throw new Error(`expected the done step, got ${done.step}`);
  return done;
}

async function savedRows() {
  const rows = await db.select().from(schema.moneyTransactions);
  return rows.filter((row) => row.userId === session.userId);
}

// The user's suggest-categories runs queued and not yet fetched, as the worker would take them.
async function queuedRuns(): Promise<string[]> {
  const jobs =
    (await queue.fetch<JobData<"suggest-categories">>("suggest-categories", { batchSize: 1000 })) ??
    [];
  return jobs.filter((job) => job.data.userId === session.userId).map((job) => job.data.runId);
}

// Answers GROCERY MART with Food and everything else "none"; records what it was sent.
function fakeModel() {
  const requests: CategorizationRequest[] = [];
  const client: CategorizationModelClient = {
    async suggestCategories(request) {
      requests.push(request);
      const food = request.payload.categories.find((category) => category.name === "Food")!;
      return {
        answers: request.payload.merchants.map((merchant) => ({
          merchant: merchant.id,
          category: merchant.counterparty === "GROCERY MART" ? food.id : "none",
        })),
      };
    },
  };
  return { client, requests };
}

beforeAll(async () => {
  database = await createTestDatabase();
  db = createDb(database.url);
  queue = await startJobQueue(database.url);
  server.db = db;
  server.queue = queue;
  actions = await import("./actions");
});

afterAll(async () => {
  await queue.stop({ graceful: false });
  await db.$client.end();
  await database.drop();
});

beforeEach(async () => {
  vi.stubEnv("OPENAI_API_KEY", "sk-test-not-a-real-key");
  const [user] = await db
    .insert(schema.users)
    .values({ name: "Example User", email: `after-commit${++userCount}@example.test` })
    .returning({ id: schema.users.id });
  session.userId = user!.id;
  await ensureMoneyDefaults(db, session.userId);
  cashId = (await listAccounts(db, session.userId))[0]!.id;
  server.queueDown = false;
});

afterEach(() => vi.unstubAllEnvs());

describe("commitImportAction, with AI suggestions on", () => {
  it("answers without the model, saying suggestions are being prepared, and the run adds them", async () => {
    const done = await importStatement();

    expect(done.suggestions).toEqual({ status: "pending" });
    expect((await savedRows()).every((row) => row.suggestionAskedAt === null)).toBe(true);
    const [runId, ...more] = await queuedRuns();
    expect(more).toEqual([]);

    const model = fakeModel();
    await runCategorySuggestions(db, session.userId, runId!, {
      client: model.client,
      dailyLimit: testAiCategorizeDailyLimit,
    });
    expect(await getCategorySuggestionRun(db, session.userId, runId!)).toMatchObject({
      finished: true,
      result: { rowsSuggested: 2 },
    });
    const groceries = (await savedRows()).filter((row) => row.counterparty === "GROCERY MART");
    expect(groceries).toHaveLength(2);
    for (const row of groceries) {
      expect(row).toMatchObject({ categoryId: null, suggestedCategoryId: expect.any(String) });
    }
    // The model got merchant text only.
    const sent = JSON.stringify(model.requests);
    expect(sent).toContain("GROCERY MART");
    for (const absent of ["38.45", "2026-09", "COMPLETED"]) expect(sent).not.toContain(absent);
  });

  it("saves the same rows when the queue can't be reached, and says suggestions are unavailable", async () => {
    server.queueDown = true;

    const done = await importStatement();

    expect(done.suggestions).toEqual({ status: "unavailable" });
    expect(done.rowsNew).toBeGreaterThan(0);
    expect(await savedRows()).toHaveLength(done.rowsNew);
  });

  it("says nothing, and queues nothing, for a user who opted out", async () => {
    await setAiCategorization(db, session.userId, false);

    const done = await importStatement();

    expect(done.suggestions).toEqual({ status: "off" });
    expect(await queuedRuns()).toEqual([]);
    expect(done.rowsNew).toBeGreaterThan(0);
  });

  it("says nothing, and queues nothing, with no key on the server", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");

    const done = await importStatement();

    expect(done.suggestions).toEqual({ status: "off" });
    expect(await queuedRuns()).toEqual([]);
  });

  it("queues nothing new when the same file is imported again", async () => {
    await importStatement();
    await queuedRuns();

    const again = await importStatement();

    expect(again.rowsNew).toBe(0);
    expect(again.suggestions).toEqual({ status: "nothing" });
    expect(await queuedRuns()).toEqual([]);
  });
});
