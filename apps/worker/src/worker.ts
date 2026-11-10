import { jobNames, jobs, startJobQueue, type JobName } from "@troba/core";
import { createDb } from "@troba/db";
import { handlers, type JobHandlers } from "./handlers";

export type Worker = { stop: () => Promise<void> };

// How long stop() lets running jobs finish. Compose's stop_grace_period for the worker is longer.
const stopTimeoutMs = 25_000;

// Starts the job queue with its maintenance and a worker for every job.
export async function startWorker(
  connectionString: string,
  jobHandlers: JobHandlers = handlers,
): Promise<Worker> {
  const db = createDb(connectionString);
  const queue = await startJobQueue(connectionString, { maintenance: true });

  async function work<N extends JobName>(name: N) {
    const handler = jobHandlers[name];
    await queue.work(name, async ([job]) => {
      if (!job) return;
      // The data came through the database, so check it again before a handler trusts it.
      await handler(jobs[name].parse(job.data), { db });
    });
  }
  for (const name of jobNames) await work(name);

  return {
    async stop() {
      // Graceful: stop fetching, let running jobs finish (or time out and be retried later).
      await queue.stop({ graceful: true, timeout: stopTimeoutMs });
      await db.$client.end();
    },
  };
}
