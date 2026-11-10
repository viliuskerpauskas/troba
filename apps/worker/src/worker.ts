import {
  defaultPdfImportDailyLimit,
  jobNames,
  jobs,
  startJobQueue,
  type JobData,
  type JobName,
  type StatementModelClient,
} from "@troba/core";
import { createDb } from "@troba/db";
import { handlers, type JobHandlers } from "./handlers";

export type Worker = { stop: () => Promise<void> };

export type StartWorkerOptions = {
  handlers?: JobHandlers;
  // The model client PDF imports are read with; null (the default) without an OpenAI key.
  statementClient?: StatementModelClient | null;
  // Each user's PDF imports a day; core's default unless given.
  pdfImportDailyLimit?: number;
};

// How long stop() lets running jobs finish. Compose's stop_grace_period for the worker is longer.
const stopTimeoutMs = 25_000;

// Starts the job queue with its maintenance and a worker for every job.
export async function startWorker(
  connectionString: string,
  {
    handlers: jobHandlers = handlers,
    statementClient = null,
    pdfImportDailyLimit = defaultPdfImportDailyLimit,
  }: StartWorkerOptions = {},
): Promise<Worker> {
  const db = createDb(connectionString);
  const queue = await startJobQueue(connectionString, { maintenance: true });

  async function work<N extends JobName>(name: N) {
    const handler = jobHandlers[name];
    await queue.work(name, async ([job]) => {
      if (!job) return;
      // The data came through the database, so check it again before a handler trusts it.
      // TypeScript can't tie jobs[name]'s output to N, so the parsed data is cast back to it.
      const data = jobs[name].parse(job.data) as JobData<N>;
      await handler(data, { db, statementClient, pdfImportDailyLimit });
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
