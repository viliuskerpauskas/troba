import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDb, schema, type Db } from "@troba/db";
import { createTestDatabase } from "@troba/db/test-database";
import { rowsOwnedBy } from "@troba/db/user-tables";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deleteUser } from "./delete-user";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Db;
let uploadsDir: string;
let userCount = 0;

// A user with a password account, a session and a file, so there is something to delete everywhere.
async function createUser(role: "admin" | "user" = "user") {
  const n = ++userCount;
  const [user] = await db
    .insert(schema.users)
    .values({ name: "Example User", email: `user${n}@example.test`, role })
    .returning({ id: schema.users.id });
  const userId = user!.id;
  await db
    .insert(schema.accounts)
    .values({ userId, providerId: "credential", accountId: userId, password: "hashed" });
  await db.insert(schema.sessions).values({
    userId,
    token: `token-${n}`,
    expiresAt: new Date(Date.now() + 60_000),
  });
  await mkdir(path.join(uploadsDir, userId, "receipts"), { recursive: true });
  await writeFile(path.join(uploadsDir, userId, "receipts", "receipt.jpg"), "not really a jpeg");
  return userId;
}

async function userExists(userId: string) {
  const rows = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  return rows.length === 1;
}

function totalRows(counts: Record<string, number>) {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}

describe("deleteUser", () => {
  beforeAll(async () => {
    database = await createTestDatabase();
    db = createDb(database.url);
    uploadsDir = await mkdtemp(path.join(tmpdir(), "troba-uploads-"));
  });
  afterAll(async () => {
    await db?.$client.end();
    await database?.drop();
    await rm(uploadsDir, { recursive: true, force: true });
  });

  it("removes the user, every row they own and their uploads folder", async () => {
    const userId = await createUser();
    expect(totalRows(await rowsOwnedBy(db, userId))).toBeGreaterThan(0);

    expect(await deleteUser(db, { userId, uploadsDir })).toEqual({ ok: true });

    expect(await userExists(userId)).toBe(false);
    expect(totalRows(await rowsOwnedBy(db, userId))).toBe(0);
    expect(existsSync(path.join(uploadsDir, userId))).toBe(false);
  });

  it("leaves other users' rows and files alone", async () => {
    const userId = await createUser();
    const otherId = await createUser();
    const before = await rowsOwnedBy(db, otherId);

    await deleteUser(db, { userId, uploadsDir });

    expect(await userExists(otherId)).toBe(true);
    expect(await rowsOwnedBy(db, otherId)).toEqual(before);
    expect(existsSync(path.join(uploadsDir, otherId, "receipts", "receipt.jpg"))).toBe(true);
  });

  it("deletes a user who never uploaded anything", async () => {
    const userId = await createUser();
    await rm(path.join(uploadsDir, userId), { recursive: true });

    expect(await deleteUser(db, { userId, uploadsDir })).toEqual({ ok: true });
    expect(await userExists(userId)).toBe(false);
  });

  describe("last admin", () => {
    // Each test starts with no admins and creates the ones it needs.
    beforeEach(async () => {
      await db.update(schema.users).set({ role: "user" }).where(eq(schema.users.role, "admin"));
    });

    it("refuses to delete the last admin and changes nothing", async () => {
      const adminId = await createUser("admin");

      expect(await deleteUser(db, { userId: adminId, uploadsDir })).toEqual({
        ok: false,
        reason: "last-admin",
      });
      expect(await userExists(adminId)).toBe(true);
      expect(existsSync(path.join(uploadsDir, adminId, "receipts", "receipt.jpg"))).toBe(true);
    });

    it("deletes an admin when another admin is left", async () => {
      const adminId = await createUser("admin");
      const otherAdminId = await createUser("admin");

      expect(await deleteUser(db, { userId: adminId, uploadsDir })).toEqual({ ok: true });
      expect(await userExists(otherAdminId)).toBe(true);
    });

    it("keeps one of several admins who delete themselves at the same time", async () => {
      const admins = await Promise.all(Array.from({ length: 8 }, () => createUser("admin")));

      const results = await Promise.all(
        admins.map((userId) => deleteUser(db, { userId, uploadsDir })),
      );

      expect(results.filter((result) => result.ok)).toHaveLength(7);
      expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, reason: "last-admin" }]);
      const left = await db.select().from(schema.users).where(eq(schema.users.role, "admin"));
      expect(left).toHaveLength(1);
    });
  });

  it("reports a user that doesn't exist", async () => {
    expect(await deleteUser(db, { userId: crypto.randomUUID(), uploadsDir })).toEqual({
      ok: false,
      reason: "not-found",
    });
  });

  it("refuses a user id that isn't a uuid, so it can't reach outside the uploads folder", async () => {
    const outside = await mkdtemp(path.join(tmpdir(), "troba-outside-"));
    try {
      // Refused by the guard itself; without it, Postgres would reject the id first.
      await expect(
        deleteUser(db, { userId: path.relative(uploadsDir, outside), uploadsDir }),
      ).rejects.toThrow("deleteUser: userId must be a uuid.");
      expect(existsSync(outside)).toBe(true);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
