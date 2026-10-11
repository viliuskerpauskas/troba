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

export default defineConfig({
  testDir: "e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Tests the built app, not the dev server: run `pnpm build` first.
    command: "node scripts/start-standalone.ts",
    // The home page, not /api/health: with the database down, the smoke test should fail on
    // the health assertion, not time out waiting for the server.
    url: `http://127.0.0.1:${port}`,
    env: { PORT: String(port), HOSTNAME: "127.0.0.1" },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
