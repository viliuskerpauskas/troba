// Background jobs (ADR-0003): pg-boss keeps the queue in the app database, and apps/worker runs
// the jobs. The web app queues them from server actions through queueJob.
import type { DbTransaction } from "@troba/db";
import { sql } from "drizzle-orm";
import { fromDrizzle, PgBoss, type QueueOptions } from "pg-boss";
import { z } from "zod";

// A schema of pg-boss's own, created and migrated by pg-boss on start; drizzle's migrations never
// touch it.
export const jobQueueSchema = "pgboss";

// Every job the worker runs: its queue name and the shape of its data, checked on both sides.
export const jobs = {
  // Proves the wiring: the worker picks it up and runs a query.
  ping: z.object({}).strict(),
  // Reads a PDF statement through the model (T152, ADR-0018). The handler checks the PDF import is
  // this user's.
  "read-pdf-import": z.object({ userId: z.uuid(), pdfImportId: z.uuid() }).strict(),
  // Deletes PDF imports never confirmed, once expired (T155). Scheduled, for no user.
  "clean-up-pdf-imports": z.object({}).strict(),
} as const;

export type JobName = keyof typeof jobs;
export type JobData<N extends JobName> = z.infer<(typeof jobs)[N]>;
export const jobNames = Object.keys(jobs) as JobName[];

export type JobQueue = PgBoss;

// Queue settings that differ from pg-boss's defaults, applied when the queue is created.
const queueOptions: { [N in JobName]?: QueueOptions } = {
  // One model call of up to 2 minutes (defaultStatementTimeoutMs). The handler records a failed
  // reading itself and finishes, so a retry only follows a crash or an expiry: once, after which
  // the job fails and the PDF import is left for the user to start over.
  "read-pdf-import": { expireInSeconds: 5 * 60, retryLimit: 1, retryDelay: 30 },
};

// Jobs the worker queues itself on a cron schedule (UTC), with empty data.
export const jobSchedules: { [N in JobName]?: string } = {
  // Hourly, so an unconfirmed PDF import is gone within an hour of expiring.
  "clean-up-pdf-imports": "17 * * * *",
};

export type StartJobQueueOptions = {
  // Maintenance (expiring, retrying and archiving jobs) and the scheduled jobs run in the worker
  // only, so the web app just queues. Off by default.
  maintenance?: boolean;
};

// Starts pg-boss, creating or migrating its schema, and creates every queue in `jobs`, so either
// process can start first. One per process, like the database pool.
export async function startJobQueue(
  connectionString: string,
  { maintenance = false }: StartJobQueueOptions = {},
): Promise<JobQueue> {
  const queue = new PgBoss({
    connectionString,
    schema: jobQueueSchema,
    max: 4,
    connectionTimeoutMillis: 10_000,
    supervise: maintenance,
    schedule: maintenance,
  });
  // Unhandled, an "error" event crashes the process; pg-boss reconnects on its own.
  queue.on("error", (error) => console.error("job queue:", error.message));
  await queue.start();
  for (const name of jobNames) await queue.createQueue(name, queueOptions[name]);
  if (maintenance) {
    // An upsert, so every start of the worker leaves one schedule per job.
    for (const name of jobNames) {
      const cron = jobSchedules[name];
      if (cron) await queue.schedule(name, cron, {});
    }
  }
  return queue;
}

export type QueueJobOptions = {
  // Queues the job in this transaction, so it exists only if the rows it acts on are committed.
  tx?: DbTransaction;
};

// Queues one job and returns its id.
export async function queueJob<N extends JobName>(
  queue: JobQueue,
  name: N,
  data: JobData<N>,
  { tx }: QueueJobOptions = {},
): Promise<string> {
  const valid = jobs[name].parse(data);
  const id = await queue.send(name, valid, tx ? { db: fromDrizzle(tx, sql) } : {});
  // send answers null only for throttled or singleton jobs, which no job here uses.
  if (!id) throw new Error(`job ${name} was not queued`);
  return id;
}
