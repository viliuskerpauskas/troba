import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const root = path.join(import.meta.dirname, "../..");

// The standalone server doesn't run next.config.ts, so load the env files here: real env, then
// .env, then .env.example. The server inherits them.
for (const file of [".env", ".env.example"]) {
  try {
    process.loadEnvFile(path.join(root, file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

// Not 3000, so a running `pnpm dev` is never mistaken for the build under test.
const port = 3100;
const baseURL = `http://127.0.0.1:${port}`;
// Better Auth checks request origins against its URL, so it must be the one tests use.
process.env.BETTER_AUTH_URL = baseURL;

export default defineConfig({
  testDir: "e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  globalSetup: "./e2e/global-setup.ts",
  // Signing in or up hashes the password with scrypt, which is slow when every worker does it
  // at once on a busy machine; the default 5 s let a sign-in redirect wait expire.
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // Tests the built app, not the dev server: run `pnpm build` first.
      // e2e/fake-openai.ts stands in for OpenAI, which the import test's AI mapping would call.
      command: "node --import ./e2e/fake-openai.ts scripts/start-standalone.ts",
      // The home page, not /api/health: with the database down, the smoke test should fail on
      // the health assertion, not time out waiting for the server.
      url: baseURL,
      // A made-up key: it switches AI-suggested mappings on, and only the fake ever sees it.
      env: { PORT: String(port), HOSTNAME: "127.0.0.1", OPENAI_API_KEY: "sk-e2e-not-a-real-key" },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      // The background worker, as built by `pnpm build` (apps/worker/dist/worker.js). Jobs the
      // app queues during a test run here. It reads PDF statements through the same fake OpenAI.
      command: "node --import ./e2e/fake-openai.ts ../worker/dist/worker.js",
      env: { OPENAI_API_KEY: "sk-e2e-not-a-real-key" },
      wait: { stdout: /worker started/ },
      // Lets running jobs finish instead of killing the worker mid-job.
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
      timeout: 60_000,
    },
  ],
});
