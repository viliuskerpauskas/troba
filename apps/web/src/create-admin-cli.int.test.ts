import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCli } from "./build-cli";
import { createTestDatabase } from "@troba/db/test-database";

const password = "correct horse battery";

let outdir: string;
let database: Awaited<ReturnType<typeof createTestDatabase>>;

// Runs the bundle the way the image does: `node scripts/create-admin.js`, with only the
// image's env and the password piped to stdin.
function createAdmin(args: string[], stdin = `${password}\n`) {
  const child = spawn(process.execPath, ["scripts/create-admin.js", ...args], {
    cwd: outdir,
    env: {
      NODE_ENV: "production",
      PATH: process.env.PATH ?? "",
      DATABASE_URL: database.url,
      BETTER_AUTH_SECRET: randomBytes(32).toString("base64"),
      BETTER_AUTH_URL: "https://troba.example.test",
    },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  child.stdin.end(stdin);
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) =>
    child.on("close", (code) => resolve({ code, stdout, stderr })),
  );
}

async function adminEmails(): Promise<string[]> {
  const client = new pg.Client({ connectionString: database.url });
  await client.connect();
  try {
    const { rows } = await client.query<{ email: string }>(
      "select email from users where role = 'admin' order by created_at",
    );
    return rows.map((row) => row.email);
  } finally {
    await client.end();
  }
}

describe("scripts/create-admin.js bundle", () => {
  beforeAll(async () => {
    outdir = await mkdtemp(path.join(tmpdir(), "troba-cli-"));
    await buildCli(outdir);
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database?.drop();
    await rm(outdir, { recursive: true, force: true });
  });

  it("creates the first admin from a piped password and never prints it", async () => {
    const result = await createAdmin(["owner@example.test"]);

    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(result.stdout).toContain("Admin created: owner@example.test");
    expect(result.stdout + result.stderr).not.toContain(password);
    expect(await adminEmails()).toEqual(["owner@example.test"]);
  });

  it("refuses a second admin without --force", async () => {
    const result = await createAdmin(["second@example.test"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("An admin already exists");
    expect(await adminEmails()).toEqual(["owner@example.test"]);
  });

  it("creates a second admin with --force", async () => {
    const result = await createAdmin(["recovery@example.test", "--force"]);

    expect(result.code).toBe(0);
    expect(await adminEmails()).toEqual(["owner@example.test", "recovery@example.test"]);
  });

  it("rejects a short password without printing it", async () => {
    const result = await createAdmin(["short@example.test", "--force"], "elevenchars\n");

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("at least 12 characters");
    expect(result.stdout + result.stderr).not.toContain("elevenchars");
  });

  it("prints usage without an email", async () => {
    const result = await createAdmin([]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("usage: create-admin <email> [--force]");
  });
});
