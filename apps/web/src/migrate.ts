// One-shot migrate command for the container image, bundled to migrate.js by build-migrate.ts.
// The migrations folder is copied next to the bundle.
import path from "node:path";
import { runMigrateCommand } from "@troba/db/migrate";

await runMigrateCommand(path.join(import.meta.dirname, "migrations"));
