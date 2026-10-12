// Integration-test helper: a fresh, migrated database, so tests don't depend on (or touch)
// whatever is in the dev database.
import { randomBytes } from "node:crypto";
import pg from "pg";
import { migrateDatabase } from "./migrate";

async function run(url: string, sql: string) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

export async function createTestDatabase(): Promise<{ url: string; drop: () => Promise<void> }> {
  const adminUrl = process.env.DATABASE_URL!;
  const name = `troba_test_${randomBytes(4).toString("hex")}`;
  const url = Object.assign(new URL(adminUrl), { pathname: `/${name}` }).toString();
  await run(adminUrl, `create database ${name}`);
  await migrateDatabase(url);
  return {
    url,
    // with (force) ends connections a test left open.
    drop: () => run(adminUrl, `drop database if exists ${name} with (force)`),
  };
}
