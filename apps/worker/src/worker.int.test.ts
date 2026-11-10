import {
  getPdfImport,
  queueJob,
  startJobQueue,
  startPdfImport,
  type JobQueue,
  type StatementModelClient,
} from "@troba/core";
import { createDb, schema, type Db } from "@troba/db";
import { createTestDatabase } from "@troba/db/test-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startWorker, type Worker } from "./worker";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Db;
let queue: JobQueue;
let worker: Worker | undefined;

async function until<T>(check: () => Promise<T | undefined>): Promise<T | undefined> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const value = await check();
    if (value !== undefined || Date.now() > deadline) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function finalState(id: string): Promise<string | undefined> {
  return until(async () => {
    const state = (await queue.getJobById("ping", id))?.state;
    return state === "completed" || state === "failed" ? state : undefined;
  });
}

describe("worker", () => {
  beforeAll(async () => {
    database = await createTestDatabase();
    db = createDb(database.url);
    queue = await startJobQueue(database.url);
  });
  afterAll(async () => {
    await worker?.stop();
    await queue?.stop({ graceful: false });
    await db?.$client.end();
    await database?.drop();
  });

  it("runs a job queued through core and stops when asked", async () => {
    worker = await startWorker(database.url);
    const id = await queueJob(queue, "ping", {});
    expect(await finalState(id)).toBe("completed");
    await worker.stop();
    worker = undefined;
  });

  it("reads a queued PDF import through the statement model client", async () => {
    const answer = { accountIbans: [], currency: "EUR", transactions: [] };
    const statementClient: StatementModelClient = { readStatement: async () => answer };
    worker = await startWorker(database.url, { statementClient });
    const [user] = await db
      .insert(schema.users)
      .values({ name: "Example User", email: "worker@example.test" })
      .returning({ id: schema.users.id });
    const started = await startPdfImport(
      db,
      user!.id,
      { filename: "statement.pdf", bytes: new TextEncoder().encode("%PDF-1.7\n") },
      { queue },
    );
    if (!started.ok) throw new Error(started.reason);

    const state = await until(async () => {
      const found = await getPdfImport(db, user!.id, started.pdfImportId);
      return found?.state === "read" || found?.state === "failed" ? found.state : undefined;
    });
    expect(state).toBe("read");
    await worker.stop();
    worker = undefined;
  });
});
