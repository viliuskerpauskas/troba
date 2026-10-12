// Integration-test helper for the isolation contract (SPEC-identity I7). Tables are read from the
// database itself, so a module's new user-owned tables are covered as soon as their migration runs.
import { sql } from "drizzle-orm";
import type { Db } from "./client";

// Every table in the public schema with a user_id column.
export async function userTables(db: Db): Promise<string[]> {
  const { rows } = await db.$client.query<{ table_name: string }>(
    `select table_name from information_schema.columns
      where table_schema = 'public' and column_name = 'user_id'
      order by table_name`,
  );
  return rows.map((row) => row.table_name);
}

// The number of rows the user owns in each of those tables.
export async function rowsOwnedBy(db: Db, userId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of await userTables(db)) {
    const { rows } = await db.execute<{ count: number }>(
      sql`select count(*)::int as count from ${sql.identifier(table)} where user_id = ${userId}`,
    );
    counts[table] = rows[0]!.count;
  }
  return counts;
}
