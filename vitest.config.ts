import path from "node:path";
import { defineConfig } from "vitest/config";

// Integration tests read DATABASE_URL like the app does: real env, then .env, then .env.example.
for (const file of [".env", ".env.example"]) {
  try {
    process.loadEnvFile(path.join(import.meta.dirname, file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

const sources = ["apps/*/src/**", "packages/*/src/**"];

export default defineConfig({
  // Mirrors the "@/*" path in apps/web/tsconfig.json.
  resolve: {
    alias: [{ find: /^@\//, replacement: path.join(import.meta.dirname, "apps/web/src/") }],
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: [...sources.map((dir) => `${dir}/*.test.{ts,tsx}`), ".claude/hooks/*.test.mjs"],
          exclude: sources.map((dir) => `${dir}/*.int.test.{ts,tsx}`),
        },
      },
      {
        // Needs Postgres: `pnpm db:up` locally, a service container in CI.
        extends: true,
        test: {
          name: "integration",
          include: sources.map((dir) => `${dir}/*.int.test.{ts,tsx}`),
          fileParallelism: false,
        },
      },
    ],
  },
});
