// `pnpm db:migrate`: applies packages/db/migrations to DATABASE_URL.
// Imports by package name, not a relative path, so Node can run it with type stripping.
import { runMigrateCommand } from "@troba/db/migrate";

await runMigrateCommand();
