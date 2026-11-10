import { createDb, type Db } from "@troba/db";
import { createTestDatabase } from "@troba/db/test-database";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { queueJob, startJobQueue, type JobQueue } from "./queue";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Db;
let queue: JobQueue;

async function tablesIn(schemaName: string): Promise<string[]> {
  const result = await db.execute<{ table_name: string }>(
    sql`select table_name from information_schema.tables where table_schema = ${schemaName}`,
  );
  return result.rows.map((row) => row.table_name);
}

describe("job queue", () => {
  beforeAll(async () => {
    database = await createTestDatabase();
    db = createDb(database.url);
    queue = await startJobQueue(database.url);
  });
  afterAll(async () => {
    await queue?.stop({ graceful: false });
    await db?.$client.end();
    await database?.drop();
  });

  it("keeps its tables in a schema of its own, apart from the app's migrations", async () => {
    expect(await tablesIn("pgboss")).toContain("job");
    expect(await tablesIn("public")).not.toContain("job");
    const migrations = await db.execute(
      sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
    );
    expect(migrations.rows[0]).toEqual({ n: expect.any(Number) });
  });

  it("queues a job", async () => {
    const id = await queueJob(queue, "ping", {});
    expect((await queue.getJobById("ping", id))?.state).toBe("created");
  });

  it("queues a job with the transaction it was queued in", async () => {
    let committed = "";
    await db.transaction(async (tx) => {
      committed = await queueJob(queue, "ping", {}, { tx });
    });
    expect(await queue.getJobById("ping", committed)).not.toBeNull();

    let rolledBack = "";
    await expect(
      db.transaction(async (tx) => {
        rolledBack = await queueJob(queue, "ping", {}, { tx });
        throw new Error("roll back");
      }),
    ).rejects.toThrow("roll back");
    expect(rolledBack).not.toBe("");
    expect(await queue.getJobById("ping", rolledBack)).toBeNull();
  });

  it("refuses data that isn't the job's shape", async () => {
    // @ts-expect-error: the type already refuses it; the check holds for untyped callers too.
    await expect(queueJob(queue, "ping", { extra: 1 })).rejects.toThrow();
  });
});
