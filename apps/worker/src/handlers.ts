import { readPdfImport, type JobData, type JobName, type StatementModelClient } from "@troba/core";
import { pingDb, type Db } from "@troba/db";

export type JobContext = {
  db: Db;
  // Null when the worker has no OpenAI key: a PDF import then fails as unavailable.
  statementClient: StatementModelClient | null;
  // Each user's PDF imports a day (AI_PDF_IMPORT_DAILY_LIMIT), claimed as each is read.
  pdfImportDailyLimit: number;
};

// One handler per job in core's `jobs`. A handler is a thin caller of core, like a server action.
// What it throws is stored with the failed job in pg-boss's tables, so it must not carry user data.
export type JobHandlers = {
  [N in JobName]: (data: JobData<N>, context: JobContext) => Promise<void>;
};

export const handlers: JobHandlers = {
  ping: async (_data, { db }) => {
    await pingDb(db);
  },
  // The PDF import must be the user's the job was queued for; core filters by both. A failed
  // reading is recorded on the PDF import, so the job still completes.
  "read-pdf-import": async (
    { userId, pdfImportId },
    { db, statementClient, pdfImportDailyLimit },
  ) => {
    await readPdfImport(db, userId, pdfImportId, {
      client: statementClient,
      dailyLimit: pdfImportDailyLimit,
    });
  },
};
