// The worker process: `node worker.js` in the image, `pnpm --filter @troba/worker dev` locally.
import {
  createOpenAiStatementClient,
  openAiConfigFrom,
  pdfImportDailyLimitFrom,
} from "@troba/core";
import { startWorker } from "./worker";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

// Without a key, the web app offers no PDF import, and one queued before the key was removed fails.
const openAi = openAiConfigFrom(process.env);
const worker = await startWorker(url, {
  statementClient: openAi && createOpenAiStatementClient(openAi),
  pdfImportDailyLimit: pdfImportDailyLimitFrom(process.env),
});
// e2e: playwright.config.ts waits for this line.
console.log("worker started");

let stopping = false;
async function shutDown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`worker: ${signal}, stopping`);
  try {
    await worker.stop();
    process.exit(0);
  } catch (error) {
    console.error("worker: stop failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
process.on("SIGTERM", () => void shutDown("SIGTERM"));
process.on("SIGINT", () => void shutDown("SIGINT"));
