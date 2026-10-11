import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrateDatabase, migrationsFolder } from "./migrate";

const adminUrl = process.env.DATABASE_URL!;
const dbName = `troba_test_${randomBytes(4).toString("hex")}`;
const testUrl = Object.assign(new URL(adminUrl), { pathname: `/${dbName}` }).toString();

async function withClient<T>(url: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

describe("migrations", () => {
  beforeAll(() => withClient(adminUrl, (c) => c.query(`create database ${dbName}`)));
  afterAll(() => withClient(adminUrl, (c) => c.query(`drop database if exists ${dbName}`)));

  it("apply cleanly to an empty database and are idempotent", async () => {
    const journal = JSON.parse(
      await readFile(path.join(migrationsFolder, "meta/_journal.json"), "utf8"),
    ) as { entries: unknown[] };

    await migrateDatabase(testUrl);
    await migrateDatabase(testUrl);

    const { rows } = await withClient(testUrl, (c) =>
      c.query<{ count: string }>("select count(*) from drizzle.__drizzle_migrations"),
    );
    expect(Number(rows[0]?.count)).toBe(journal.entries.length);
  });
});
