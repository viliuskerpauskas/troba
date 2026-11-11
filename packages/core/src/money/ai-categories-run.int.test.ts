import { createDb, schema, type Db } from "@troba/db";
import { createTestDatabase } from "@troba/db/test-database";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startJobQueue, type JobData, type JobQueue } from "../jobs/queue";
import {
  createMoneyUser,
  insertImportedRows,
  readTransaction,
  recordingModel,
  testAiCategorizeDailyLimit,
  type MoneyUser,
} from "./ai-categories-fixture";
import { setAiCategorization } from "./ai-categorization-setting";
import {
  activeCategorySuggestionRun,
  categorySuggestionRunStaleMs,
  getCategorySuggestionRun,
  runCategorySuggestions,
  startCategorySuggestions,
} from "./ai-categories-run";

// AI-suggested categories run by the worker (SPEC-money M5, ADR-0021): the web app starts a run,
// which queues a job; the job asks the model and records how it went; the web app reads that back.

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Db;
let queue: JobQueue;

// Answers GROCERY MART with Food, every other merchant "none".
function fakeModel(foodId: string) {
  return recordingModel((request) => ({
    answers: request.payload.merchants.map((merchant) => ({
      merchant: merchant.id,
      category: merchant.counterparty === "GROCERY MART" ? foodId : "none",
    })),
  }));
}

// The suggest-categories jobs waiting in the queue, as the worker would fetch them.
async function queuedJobs() {
  const fetched = await queue.fetch<JobData<"suggest-categories">>("suggest-categories", {
    batchSize: 50,
  });
  return (fetched ?? []).map((job) => job.data);
}

// An import of the given merchants, as commitImport leaves it.
async function insertImport(user: MoneyUser, counterparties: string[]) {
  const [created] = await db
    .insert(schema.moneyImports)
    .values({
      userId: user.userId,
      accountId: user.cashId,
      filename: "statement.csv",
      rowsParsed: counterparties.length,
      rowsNew: counterparties.length,
      rowsDuplicate: 0,
      rowsFailed: 0,
    })
    .returning({ id: schema.moneyImports.id });
  const importId = created!.id;
  const rowIds = await insertImportedRows(
    db,
    user,
    counterparties.map((counterparty) => ({ counterparty, importId })),
  );
  return { importId, rowIds };
}

// Moves a run `ms` into the past.
async function ageRun(runId: string, ms: number) {
  await db
    .update(schema.moneyAiCategorizeRuns)
    .set({ createdAt: sql`created_at - make_interval(secs => ${ms / 1000})` })
    .where(eq(schema.moneyAiCategorizeRuns.id, runId));
}

describe("AI category suggestion runs", () => {
  let user: MoneyUser;

  beforeAll(async () => {
    database = await createTestDatabase();
    db = createDb(database.url);
    queue = await startJobQueue(database.url);
  });
  afterAll(async () => {
    await queue?.stop({ graceful: false });
    await db?.$client.end();
    await database?.drop();
  });

  it("queues a run, which the job finishes with its result", async () => {
    user = await createMoneyUser(db);
    const [grocery] = await insertImportedRows(db, user, [
      { counterparty: "GROCERY MART" },
      { counterparty: "ODD SHOP" },
    ]);

    const started = await startCategorySuggestions(db, user.userId, { queue });
    if (!started.ok) throw new Error("expected a run");
    expect(await queuedJobs()).toEqual([{ userId: user.userId, runId: started.runId }]);
    expect(await getCategorySuggestionRun(db, user.userId, started.runId)).toEqual({
      finished: false,
    });

    const model = fakeModel(user.category("Food"));
    await runCategorySuggestions(db, user.userId, started.runId, {
      client: model.client,
      dailyLimit: testAiCategorizeDailyLimit,
    });

    expect(await getCategorySuggestionRun(db, user.userId, started.runId)).toEqual({
      finished: true,
      result: { merchantsAsked: 2, rowsSuggested: 1, failed: false, capped: false },
    });
    expect((await readTransaction(db, user.userId, grocery!)).suggestedCategoryId).toBe(
      user.category("Food"),
    );
  });

  it("starts nothing for a user who turned suggestions off", async () => {
    const other = await createMoneyUser(db);
    await insertImportedRows(db, other, [{ counterparty: "GROCERY MART" }]);
    await setAiCategorization(db, other.userId, false);

    expect(await startCategorySuggestions(db, other.userId, { queue })).toEqual({ ok: false });
    expect(await queuedJobs()).toEqual([]);
  });

  it("runs an import's suggestions once, for that import's rows only", async () => {
    const owner = await createMoneyUser(db);
    const [older] = await insertImportedRows(db, owner, [{ counterparty: "GROCERY MART" }]);
    const { importId, rowIds } = await insertImport(owner, ["GROCERY MART"]);

    const first = await startCategorySuggestions(db, owner.userId, { queue, importId });
    const again = await startCategorySuggestions(db, owner.userId, { queue, importId });
    if (!first.ok) throw new Error("expected a run");
    expect(again).toEqual(first);
    expect(await queuedJobs()).toEqual([{ userId: owner.userId, runId: first.runId }]);

    await runCategorySuggestions(db, owner.userId, first.runId, {
      client: fakeModel(owner.category("Food")).client,
      dailyLimit: testAiCategorizeDailyLimit,
    });
    expect((await readTransaction(db, owner.userId, rowIds[0]!)).suggestedCategoryId).toBe(
      owner.category("Food"),
    );
    expect((await readTransaction(db, owner.userId, older!)).suggestionAskedAt).toBeNull();
  });

  it("does nothing for a run that is finished or another user's", async () => {
    const owner = await createMoneyUser(db);
    const stranger = await createMoneyUser(db);
    await insertImportedRows(db, owner, [{ counterparty: "GROCERY MART" }]);
    const started = await startCategorySuggestions(db, owner.userId, { queue });
    if (!started.ok) throw new Error("expected a run");
    await queuedJobs();
    const model = fakeModel(owner.category("Food"));
    const options = { client: model.client, dailyLimit: testAiCategorizeDailyLimit };

    await runCategorySuggestions(db, stranger.userId, started.runId, options);
    expect(model.requests).toHaveLength(0);
    expect(await getCategorySuggestionRun(db, stranger.userId, started.runId)).toBeNull();

    await runCategorySuggestions(db, owner.userId, started.runId, options);
    await insertImportedRows(db, owner, [{ counterparty: "ODD SHOP" }]);
    // The job again, say after a crash once it had finished: the run is kept as it ended.
    await runCategorySuggestions(db, owner.userId, started.runId, options);
    expect(model.requests).toHaveLength(1);
    expect(await getCategorySuggestionRun(db, owner.userId, started.runId)).toEqual({
      finished: true,
      result: { merchantsAsked: 1, rowsSuggested: 1, failed: false, capped: false },
    });
  });

  it("finishes as failed when the worker has no model client", async () => {
    const owner = await createMoneyUser(db);
    const [row] = await insertImportedRows(db, owner, [{ counterparty: "GROCERY MART" }]);
    const started = await startCategorySuggestions(db, owner.userId, { queue });
    if (!started.ok) throw new Error("expected a run");
    await queuedJobs();

    await runCategorySuggestions(db, owner.userId, started.runId, {
      client: null,
      dailyLimit: testAiCategorizeDailyLimit,
    });
    expect(await getCategorySuggestionRun(db, owner.userId, started.runId)).toEqual({
      finished: true,
      result: { merchantsAsked: 0, rowsSuggested: 0, failed: true, capped: false },
    });
    expect((await readTransaction(db, owner.userId, row!)).suggestionAskedAt).toBeNull();
  });

  it("keeps one button run under way at a time, and gives up on one that never finished", async () => {
    const owner = await createMoneyUser(db);
    await insertImportedRows(db, owner, [{ counterparty: "GROCERY MART" }]);

    const first = await startCategorySuggestions(db, owner.userId, { queue });
    const again = await startCategorySuggestions(db, owner.userId, { queue });
    if (!first.ok) throw new Error("expected a run");
    expect(again).toEqual(first);
    expect(await queuedJobs()).toHaveLength(1);
    expect(await activeCategorySuggestionRun(db, owner.userId)).toBe(first.runId);

    // The worker died with it: past the time a job can take, the run reads as failed.
    await ageRun(first.runId, categorySuggestionRunStaleMs + 1000);
    expect(await getCategorySuggestionRun(db, owner.userId, first.runId)).toEqual({
      finished: true,
      result: { merchantsAsked: 0, rowsSuggested: 0, failed: true, capped: false },
    });
    expect(await activeCategorySuggestionRun(db, owner.userId)).toBeNull();
    const next = await startCategorySuggestions(db, owner.userId, { queue });
    if (!next.ok) throw new Error("expected a run");
    expect(next.runId).not.toBe(first.runId);
    expect(await queuedJobs()).toEqual([{ userId: owner.userId, runId: next.runId }]);
  });

  it("keeps the daily cap: a run past it records that it was capped", async () => {
    const owner = await createMoneyUser(db);
    await insertImportedRows(db, owner, [
      { counterparty: "GROCERY MART" },
      // Later, so the cap leaves this one out.
      { counterparty: "ODD SHOP", bookedOn: "2026-10-06" },
    ]);
    const started = await startCategorySuggestions(db, owner.userId, { queue });
    if (!started.ok) throw new Error("expected a run");
    await queuedJobs();
    const model = fakeModel(owner.category("Food"));

    await runCategorySuggestions(db, owner.userId, started.runId, {
      client: model.client,
      dailyLimit: 1,
    });
    expect(model.requests[0]!.payload.merchants).toHaveLength(1);
    expect(await getCategorySuggestionRun(db, owner.userId, started.runId)).toEqual({
      finished: true,
      result: { merchantsAsked: 1, rowsSuggested: 1, failed: false, capped: true },
    });
  });

  it("deletes the user's runs from more than a day ago as another starts", async () => {
    const owner = await createMoneyUser(db);
    const old = await startCategorySuggestions(db, owner.userId, { queue });
    if (!old.ok) throw new Error("expected a run");
    await runCategorySuggestions(db, owner.userId, old.runId, {
      client: null,
      dailyLimit: testAiCategorizeDailyLimit,
    });
    await ageRun(old.runId, 25 * 60 * 60 * 1000);

    await startCategorySuggestions(db, owner.userId, { queue });
    await queuedJobs();
    expect(await getCategorySuggestionRun(db, owner.userId, old.runId)).toBeNull();
  });
});
