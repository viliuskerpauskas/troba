// Background jobs (ADR-0003): pg-boss keeps the queue in the app database, and apps/worker runs
// the jobs. The web app queues them from server actions through queueJob.
import type { DbTransaction } from "@troba/db";
import { sql } from "drizzle-orm";
import { fromDrizzle, PgBoss } from "pg-boss";
import { z } from "zod";

// A schema of pg-boss's own, created and migrated by pg-boss on start; drizzle's migrations never
// touch it.
export const jobQueueSchema = "pgboss";

// Every job the worker runs: its queue name and the shape of its data, checked on both sides.
export const jobs = {
  // Proves the wiring: the worker picks it up and runs a query.
  ping: z.object({}).strict(),
} as const;

export type JobName = keyof typeof jobs;
export type JobData<N extends JobName> = z.infer<(typeof jobs)[N]>;
export const jobNames = Object.keys(jobs) as JobName[];

export type JobQueue = PgBoss;

export type StartJobQueueOptions = {
  // Maintenance (expiring, retrying and archiving jobs) runs in the worker only, so the web app
  // just queues. Off by default.
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
  for (const name of jobNames) await queue.createQueue(name);
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
