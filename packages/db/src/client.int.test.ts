import { sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createDb, pingDb } from "./client";

const url = process.env.DATABASE_URL!;

describe("createDb", () => {
  const db = createDb(url);
  afterAll(() => db.$client.end());

  it("survives the server dropping an idle connection", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { rows } = await db.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
    expect(db.$client.idleCount).toBe(1);

    // Without a pool "error" listener this surfaces as an uncaught exception and fails the run.
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query("select pg_terminate_backend($1)", [rows[0]?.pid]);
    await admin.end();
    await vi.waitFor(() => expect(db.$client.idleCount).toBe(0));

    expect(logged).toHaveBeenCalled();
    await expect(pingDb(db)).resolves.toBeUndefined();
    logged.mockRestore();
  });
});
