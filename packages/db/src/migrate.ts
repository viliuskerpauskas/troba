// Applies pending migrations. CLI entries: migrate-cli.ts (`pnpm db:migrate`) and the image's
// migrate.js (apps/web/src/migrate.ts).
// Kept free of relative imports so Node can run it directly with type stripping.
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

export const migrationsFolder = path.join(import.meta.dirname, "../migrations");

export async function migrateDatabase(
  connectionString: string,
  folder: string = migrationsFolder,
): Promise<void> {
  const pool = new pg.Pool({
    connectionString,
    max: 1,
    // Fail instead of waiting minutes on the OS when the database doesn't answer.
    connectionTimeoutMillis: 10_000,
  });
  try {
    await migrate(drizzle(pool), { migrationsFolder: folder });
  } finally {
    await pool.end();
  }
}

// Reads DATABASE_URL, applies migrations from `folder` and exits non-zero on failure.
export async function runMigrateCommand(folder: string = migrationsFolder): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  try {
    await migrateDatabase(url, folder);
    console.log("migrations applied");
  } catch (error) {
    // Drizzle wraps driver errors; the cause says why (auth, network, bad SQL).
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    console.error("migration failed:", cause instanceof Error ? cause.message : cause);
    process.exit(1);
  }
}
