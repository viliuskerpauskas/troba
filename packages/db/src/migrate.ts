// Applies pending migrations. Run as a CLI (`pnpm db:migrate`) or import migrateDatabase.
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
  const pool = new pg.Pool({ connectionString, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: folder });
  } finally {
    await pool.end();
  }
}

if (import.meta.main) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  await migrateDatabase(url);
  console.log("migrations applied");
}
