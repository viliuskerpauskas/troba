import { queueJob, startJobQueue, type JobQueue } from "@troba/core";
import { createTestDatabase } from "@troba/db/test-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startWorker, type Worker } from "./worker";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let queue: JobQueue;
let worker: Worker | undefined;

async function finalState(id: string): Promise<string | undefined> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const state = (await queue.getJobById("ping", id))?.state;
    if (state === "completed" || state === "failed" || Date.now() > deadline) return state;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe("worker", () => {
  beforeAll(async () => {
    database = await createTestDatabase();
    queue = await startJobQueue(database.url);
  });
  afterAll(async () => {
    await worker?.stop();
    await queue?.stop({ graceful: false });
    await database?.drop();
  });

  it("runs a job queued through core and stops when asked", async () => {
    worker = await startWorker(database.url);
    const id = await queueJob(queue, "ping", {});
    expect(await finalState(id)).toBe("completed");
    await worker.stop();
    worker = undefined;
  });
});
