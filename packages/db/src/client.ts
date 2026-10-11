import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export function createDb(connectionString: string) {
  const pool = new pg.Pool({
    connectionString,
    // Don't queue forever for a connection; requests fail instead of piling up.
    connectionTimeoutMillis: 10_000,
  });
  // An idle client dropped by the server (restart, failover) emits "error"; unhandled, that
  // crashes the process. The pool discards the client and the next query reconnects.
  pool.on("error", (error) => console.error("postgres pool: idle client error:", error.message));
  return drizzle(pool, { schema });
}

export type Db = ReturnType<typeof createDb>;

export async function pingDb(db: Db): Promise<void> {
  await db.execute(sql`select 1`);
}
