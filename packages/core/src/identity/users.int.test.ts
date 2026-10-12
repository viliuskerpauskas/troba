import { createDb, schema, type Db } from "@troba/db";
import { createTestDatabase } from "@troba/db/test-database";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deleteUser } from "./delete-user";
import { disableUser, enableUser, listUsers } from "./users";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Db;
let userCount = 0;

// A user with two sessions, so there is something for disabling to revoke.
async function createUser(role: "admin" | "user" = "user") {
  const n = ++userCount;
  const [user] = await db
    .insert(schema.users)
    .values({ name: `User ${n}`, email: `user${n}@example.test`, role })
    .returning({ id: schema.users.id });
  const userId = user!.id;
  for (const device of ["laptop", "phone"]) {
    await db.insert(schema.sessions).values({
      userId,
      token: `token-${n}-${device}`,
      expiresAt: new Date(Date.now() + 60_000),
    });
  }
  return userId;
}

async function userRow(userId: string) {
  const [row] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  return row;
}

async function sessionsOf(userId: string) {
  return db.select().from(schema.sessions).where(eq(schema.sessions.userId, userId));
}

describe("users", () => {
  beforeAll(async () => {
    database = await createTestDatabase();
    db = createDb(database.url);
  });
  afterAll(async () => {
    await db?.$client.end();
    await database?.drop();
  });
  // Each test starts with no admins and creates the ones it needs.
  beforeEach(async () => {
    await db.update(schema.users).set({ role: "user" }).where(eq(schema.users.role, "admin"));
  });

  describe("listUsers", () => {
    it("lists every user, oldest first, with what the admin page shows and nothing more", async () => {
      await db.delete(schema.users);
      const adminId = await createUser("admin");
      const userId = await createUser();
      const lastActiveAt = new Date("2026-01-02T03:04:05Z");
      await db.update(schema.users).set({ lastActiveAt }).where(eq(schema.users.id, userId));
      await disableUser(db, { userId, by: adminId });

      const users = await listUsers(db);

      expect(users).toEqual([
        {
          id: adminId,
          name: expect.any(String),
          email: expect.stringMatching(/@example\.test$/),
          role: "admin",
          createdAt: expect.any(Date),
          lastActiveAt: null,
          disabled: false,
        },
        {
          id: userId,
          name: expect.any(String),
          email: expect.stringMatching(/@example\.test$/),
          role: "user",
          createdAt: expect.any(Date),
          lastActiveAt,
          disabled: true,
        },
      ]);
    });
  });

  describe("disableUser", () => {
    it("disables the user and ends all their sessions, and no one else's", async () => {
      const adminId = await createUser("admin");
      const userId = await createUser();
      const otherId = await createUser();

      expect(await disableUser(db, { userId, by: adminId })).toEqual({ ok: true });

      expect((await userRow(userId))!.banned).toBe(true);
      expect(await sessionsOf(userId)).toEqual([]);
      expect(await sessionsOf(otherId)).toHaveLength(2);
    });

    it("refuses to disable the admin doing it", async () => {
      const adminId = await createUser("admin");
      await createUser("admin");

      expect(await disableUser(db, { userId: adminId, by: adminId })).toEqual({
        ok: false,
        reason: "self",
      });
      expect((await userRow(adminId))!.banned).toBe(false);
      expect(await sessionsOf(adminId)).toHaveLength(2);
    });

    it("disables another admin while an active admin is left", async () => {
      const adminId = await createUser("admin");
      const otherAdminId = await createUser("admin");

      expect(await disableUser(db, { userId: otherAdminId, by: adminId })).toEqual({ ok: true });
    });

    it("refuses to disable the last active admin", async () => {
      // A disabled admin doesn't count: they can't sign in to administer anything.
      const disabledAdminId = await createUser("admin");
      const adminId = await createUser("admin");
      await db
        .update(schema.users)
        .set({ banned: true })
        .where(eq(schema.users.id, disabledAdminId));

      expect(await disableUser(db, { userId: adminId, by: disabledAdminId })).toEqual({
        ok: false,
        reason: "last-admin",
      });
      expect((await userRow(adminId))!.banned).toBe(false);
    });

    it("keeps one active admin when admins disable each other at the same time", async () => {
      const admins = await Promise.all(Array.from({ length: 6 }, () => createUser("admin")));

      // Each admin disables the next one, round the circle.
      const results = await Promise.all(
        admins.map((by, i) => disableUser(db, { userId: admins[(i + 1) % admins.length]!, by })),
      );

      expect(results.filter((result) => result.ok)).toHaveLength(5);
      const active = await db.select().from(schema.users).where(eq(schema.users.role, "admin"));
      expect(active.filter((admin) => !admin.banned)).toHaveLength(1);
    });

    it("keeps one active admin when one is disabled while another deletes themselves", async () => {
      const [first, second] = await Promise.all([createUser("admin"), createUser("admin")]);

      const results = await Promise.all([
        disableUser(db, { userId: first!, by: second! }),
        deleteUser(db, { userId: second!, uploadsDir: "unused-uploads-dir" }),
      ]);

      expect(results.filter((result) => result.ok)).toHaveLength(1);
      const admins = await db.select().from(schema.users).where(eq(schema.users.role, "admin"));
      expect(admins.filter((admin) => !admin.banned)).toHaveLength(1);
    });

    it("reports a user that doesn't exist", async () => {
      const adminId = await createUser("admin");

      expect(await disableUser(db, { userId: crypto.randomUUID(), by: adminId })).toEqual({
        ok: false,
        reason: "not-found",
      });
    });
  });

  describe("enableUser", () => {
    it("enables a disabled user", async () => {
      const adminId = await createUser("admin");
      const userId = await createUser();
      await disableUser(db, { userId, by: adminId });

      expect(await enableUser(db, { userId })).toBe(true);

      expect((await userRow(userId))!.banned).toBe(false);
    });

    it("reports a user that doesn't exist", async () => {
      expect(await enableUser(db, { userId: crypto.randomUUID() })).toBe(false);
    });
  });
});

describe("deleteUser and disabled admins", () => {
  beforeAll(async () => {
    database = await createTestDatabase();
    db = createDb(database.url);
  });
  afterAll(async () => {
    await db?.$client.end();
    await database?.drop();
  });

  it("refuses to delete the last active admin even when a disabled admin is left", async () => {
    const disabledAdminId = await createUser("admin");
    const adminId = await createUser("admin");
    await db.update(schema.users).set({ banned: true }).where(eq(schema.users.id, disabledAdminId));

    expect(await deleteUser(db, { userId: adminId, uploadsDir: "unused-uploads-dir" })).toEqual({
      ok: false,
      reason: "last-admin",
    });
  });

  it("deletes a disabled admin, who doesn't count towards the last admin", async () => {
    const disabledAdminId = await createUser("admin");
    await createUser("admin");
    await db.update(schema.users).set({ banned: true }).where(eq(schema.users.id, disabledAdminId));

    expect(
      await deleteUser(db, { userId: disabledAdminId, uploadsDir: "unused-uploads-dir" }),
    ).toEqual({ ok: true });
  });
});
