import type { JobData, JobName } from "@troba/core";
import { pingDb, type Db } from "@troba/db";

export type JobContext = { db: Db };

// One handler per job in core's `jobs`. A handler is a thin caller of core, like a server action.
// What it throws is stored with the failed job in pg-boss's tables, so it must not carry user data.
export type JobHandlers = {
  [N in JobName]: (data: JobData<N>, context: JobContext) => Promise<void>;
};

export const handlers: JobHandlers = {
  ping: async (_data, { db }) => {
    await pingDb(db);
  },
};
