// One-shot migrate command for the container image, bundled to migrate.js by build-migrate.ts.
// The migrations folder is copied next to the bundle.
import path from "node:path";
import { migrateDatabase } from "@troba/db/migrate";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

try {
  await migrateDatabase(url, path.join(import.meta.dirname, "migrations"));
  console.log("migrations applied");
} catch (error) {
  // Drizzle wraps driver errors; the cause says why (auth, network, bad SQL).
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  console.error("migration failed:", cause instanceof Error ? cause.message : cause);
  process.exit(1);
}
