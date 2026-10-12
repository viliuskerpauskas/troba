// Integration-test helper for the isolation contract (SPEC-identity I7). Tables are read from the
// database itself, so a module's new user-owned tables are covered as soon as their migration runs.
// Only user_id columns count as ownership; other references to users (invites.created_by,
// invites.used_by) are left to their own foreign keys.
import pg from "pg";
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
    const { rows } = await db.$client.query<{ count: number }>(
      `select count(*)::int as count from ${pg.escapeIdentifier(table)} where user_id = $1`,
      [userId],
    );
    counts[table] = rows[0]!.count;
  }
  return counts;
}
