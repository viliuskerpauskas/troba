import { startJobQueue, type JobQueue } from "@troba/core";
import { env } from "./env";

// One job queue per server process, like the database pool; survives dev hot reloads. It only
// queues: apps/worker runs the jobs and pg-boss's maintenance.
const globalForJobs = globalThis as { trobaJobQueue?: Promise<JobQueue> };

// Pass the result to queueJob from @troba/core.
export function jobQueue(): Promise<JobQueue> {
  globalForJobs.trobaJobQueue ??= startJobQueue(env().DATABASE_URL).catch((error: unknown) => {
    // Don't keep a failed start: the next call tries again.
    globalForJobs.trobaJobQueue = undefined;
    throw error;
  });
  return globalForJobs.trobaJobQueue;
}
