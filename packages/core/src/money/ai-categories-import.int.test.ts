import { createDb, schema, type Db } from "@troba/db";
import { createTestDatabase } from "@troba/db/test-database";
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
import { suggestAfterImport } from "./ai-categories-import";
import { getCategorySuggestionRun, runCategorySuggestions } from "./ai-categories-run";

// What an import leaves for the model (SPEC-money M5, ADR-0020): once the import is saved, a run
// for its rows is queued for the worker and the import answers at once. Whatever happens to the
// queue, the import is as it was saved.

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Db;
let queue: JobQueue;

// An import with the given merchants as its rows, as commitImport leaves them.
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

// The suggest-categories jobs waiting in the queue, as the worker would fetch them.
async function queuedJobs() {
  const fetched = await queue.fetch<JobData<"suggest-categories">>("suggest-categories", {
    batchSize: 50,
  });
  return (fetched ?? []).map((job) => job.data);
}

describe("suggestions after an import", () => {
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

  it("queues a run for the import and says suggestions are being prepared", async () => {
    const user = await createMoneyUser(db);
    const { importId, rowIds } = await insertImport(user, ["GROCERY MART"]);
    const model = recordingModel((request) => ({
      answers: request.payload.merchants.map(({ id }) => ({
        merchant: id,
        category: user.category("Food"),
      })),
    }));

    const result = await suggestAfterImport(db, user.userId, {
      queue: async () => queue,
      importId,
    });

    expect(result).toEqual({ status: "pending" });
    // The import answered without the model.
    expect(model.requests).toHaveLength(0);
    const [job] = await queuedJobs();
    expect(job).toEqual({ userId: user.userId, runId: expect.any(String) });

    await runCategorySuggestions(db, user.userId, job!.runId, {
      client: model.client,
      dailyLimit: testAiCategorizeDailyLimit,
    });
    expect(await getCategorySuggestionRun(db, user.userId, job!.runId)).toMatchObject({
      finished: true,
      result: { rowsSuggested: 1 },
    });
    expect((await readTransaction(db, user.userId, rowIds[0]!)).suggestedCategoryId).toBe(
      user.category("Food"),
    );
  });

  it("is off, and queues nothing, for a user who opted out", async () => {
    const user = await createMoneyUser(db);
    await setAiCategorization(db, user.userId, false);
    const { importId } = await insertImport(user, ["GROCERY MART"]);

    expect(
      await suggestAfterImport(db, user.userId, { queue: async () => queue, importId }),
    ).toEqual({ status: "off" });
    expect(await queuedJobs()).toEqual([]);
  });

  it("is off with no queue, which is a server with no key", async () => {
    const user = await createMoneyUser(db);
    const { importId } = await insertImport(user, ["GROCERY MART"]);

    expect(await suggestAfterImport(db, user.userId, { queue: null, importId })).toEqual({
      status: "off",
    });
    expect(await queuedJobs()).toEqual([]);
  });

  it("says unavailable, and leaves the import as saved, when the queue can't be reached", async () => {
    const user = await createMoneyUser(db);
    const { importId, rowIds } = await insertImport(user, ["GROCERY MART"]);

    const result = await suggestAfterImport(db, user.userId, {
      queue: () => Promise.reject(new Error("connection refused")),
      importId,
    });

    expect(result).toEqual({ status: "unavailable" });
    expect(await readTransaction(db, user.userId, rowIds[0]!)).toMatchObject({
      suggestionAskedAt: null,
    });
  });

  it("never starts a run on another user's import", async () => {
    const owner = await createMoneyUser(db);
    const stranger = await createMoneyUser(db);
    const { importId } = await insertImport(owner, ["GROCERY MART"]);

    expect(
      await suggestAfterImport(db, stranger.userId, { queue: async () => queue, importId }),
    ).toEqual({ status: "unavailable" });
    expect(await queuedJobs()).toEqual([]);
    // The owner's own run still starts.
    expect(
      await suggestAfterImport(db, owner.userId, { queue: async () => queue, importId }),
    ).toEqual({ status: "pending" });
  });
});
