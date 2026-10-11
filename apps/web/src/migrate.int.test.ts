import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { migrationsFolder } from "@troba/db/migrate";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildMigrate } from "./build-migrate";

let outdir: string;
const adminUrl = process.env.DATABASE_URL!;
const dbName = `troba_test_${randomBytes(4).toString("hex")}`;
const testUrl = Object.assign(new URL(adminUrl), { pathname: `/${dbName}` }).toString();

async function query<T extends pg.QueryResultRow>(url: string, sql: string): Promise<T[]> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query<T>(sql)).rows;
  } finally {
    await client.end();
  }
}

// Runs the bundle the way the image does: `node migrate.js`, with only the given env.
async function runMigrate(env: Record<string, string>) {
  try {
    const { stdout } = await promisify(execFile)(process.execPath, ["migrate.js"], {
      cwd: outdir,
      env: { NODE_ENV: "production", PATH: process.env.PATH ?? "", ...env },
    });
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    const { code, stdout, stderr } = error as { code: number; stdout: string; stderr: string };
    return { code, stdout, stderr };
  }
}

describe("migrate.js bundle", () => {
  beforeAll(async () => {
    outdir = await mkdtemp(path.join(tmpdir(), "troba-migrate-"));
    await buildMigrate(outdir);
    await query(adminUrl, `create database ${dbName}`);
  });
  afterAll(async () => {
    await query(adminUrl, `drop database if exists ${dbName}`);
    await rm(outdir, { recursive: true, force: true });
  });

  it("applies every migration and exits 0", async () => {
    const journal = JSON.parse(
      await readFile(path.join(migrationsFolder, "meta/_journal.json"), "utf8"),
    ) as { entries: unknown[] };

    const result = await runMigrate({ DATABASE_URL: testUrl });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("migrations applied");
    const rows = await query<{ count: string }>(
      testUrl,
      "select count(*) from drizzle.__drizzle_migrations",
    );
    expect(Number(rows[0]?.count)).toBe(journal.entries.length);
  });

  it("exits non-zero when the database is unreachable", async () => {
    const result = await runMigrate({ DATABASE_URL: "postgres://troba:troba@127.0.0.1:1/troba" });

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("migration failed");
  });

  it("gives up when the server accepts the connection but never answers", async () => {
    // Stands in for a black-holed database: without a connect timeout, migrate waits on the OS.
    const sockets: Socket[] = [];
    const server = createServer((socket) => sockets.push(socket));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as { port: number };
    try {
      const result = await runMigrate({
        DATABASE_URL: `postgres://troba:troba@127.0.0.1:${port}/troba`,
      });

      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("timeout");
    } finally {
      sockets.forEach((socket) => socket.destroy());
      server.close();
    }
  }, 20_000);

  it("reports the driver's reason when the database rejects the connection", async () => {
    const badPassword = Object.assign(new URL(testUrl), { password: "wrong" }).toString();

    const result = await runMigrate({ DATABASE_URL: badPassword });

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("password authentication failed");
  });

  it("exits non-zero when DATABASE_URL is missing", async () => {
    const result = await runMigrate({});

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("DATABASE_URL is not set");
  });
});
