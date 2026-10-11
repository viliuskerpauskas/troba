import { createDb, type Db } from "@troba/db";
import { env } from "./env";

// One pool per server process; survives dev hot reloads.
const globalForDb = globalThis as { trobaDb?: Db };

export function db(): Db {
  globalForDb.trobaDb ??= createDb(env().DATABASE_URL);
  return globalForDb.trobaDb;
}
