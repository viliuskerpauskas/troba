import { defineConfig } from "drizzle-kit";

// Only `drizzle-kit generate` is used, which needs no connection. Migrations run through
// `pnpm db:migrate` (src/migrate.ts), so there are no dbCredentials here.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  strict: true,
});
