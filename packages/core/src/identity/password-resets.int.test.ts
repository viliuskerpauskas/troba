import { createHash } from "node:crypto";
import { createDb, schema, type Db } from "@troba/db";
import { createTestDatabase } from "@troba/db/test-database";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPasswordReset,
  findPendingPasswordReset,
  resetLifetimeMs,
  resetPassword,
} from "./password-resets";

const hour = 3_600_000;

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Db;
let userCount = 0;

// A user with a password account and two sessions.
async function createUser() {
  const n = ++userCount;
  const email = `user${n}@example.test`;
  const [user] = await db
    .insert(schema.users)
    .values({ name: "Example User", email })
    .returning({ id: schema.users.id });
  const userId = user!.id;
  await db
    .insert(schema.accounts)
    .values({ userId, providerId: "credential", accountId: userId, password: "old-hash" });
  for (const device of ["laptop", "phone"]) {
    await db.insert(schema.sessions).values({
      userId,
      token: `token-${n}-${device}`,
      expiresAt: new Date(Date.now() + 60_000),
    });
  }
  return { userId, email };
}

async function passwordOf(userId: string) {
  const [account] = await db
    .select({ password: schema.accounts.password })
    .from(schema.accounts)
    .where(eq(schema.accounts.userId, userId));
  return account!.password;
}

async function sessionsOf(userId: string) {
  return db.select().from(schema.sessions).where(eq(schema.sessions.userId, userId));
}

describe("password resets", () => {
  beforeAll(async () => {
    database = await createTestDatabase();
    db = createDb(database.url);
  });
  afterAll(async () => {
    await db?.$client.end();
    await database?.drop();
  });

  describe("createPasswordReset", () => {
    it("returns a token and stores only its SHA-256 hash, expiring in 1 hour", async () => {
      const { userId } = await createUser();
      const now = new Date("2026-01-01T00:00:00Z");

      const reset = await createPasswordReset(db, { userId, now });

      const [row] = await db
        .select()
        .from(schema.passwordResets)
        .where(eq(schema.passwordResets.userId, userId));
      expect(reset!.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(row!.tokenHash).toBe(createHash("sha256").update(reset!.token).digest("hex"));
      expect(JSON.stringify(row)).not.toContain(reset!.token);
      expect(row!.expiresAt.getTime() - now.getTime()).toBe(hour);
      expect(resetLifetimeMs).toBe(hour);
    });

    it("replaces the user's earlier links, so only the newest one works", async () => {
      const { userId } = await createUser();
      const other = await createUser();
      const othersReset = await createPasswordReset(db, { userId: other.userId });
      const first = await createPasswordReset(db, { userId });

      const second = await createPasswordReset(db, { userId });

      expect(await findPendingPasswordReset(db, first!.token)).toBeNull();
      expect(await findPendingPasswordReset(db, second!.token)).not.toBeNull();
      expect(await findPendingPasswordReset(db, othersReset!.token)).not.toBeNull();
    });

    it("leaves one working link when several are created at the same time", async () => {
      const { userId } = await createUser();

      const resets = await Promise.all(
        Array.from({ length: 4 }, () => createPasswordReset(db, { userId })),
      );

      const pending = await Promise.all(
        resets.map((reset) => findPendingPasswordReset(db, reset!.token)),
      );
      expect(pending.filter((reset) => reset !== null)).toHaveLength(1);
    });

    it("returns null for a user that doesn't exist", async () => {
      expect(await createPasswordReset(db, { userId: crypto.randomUUID() })).toBeNull();
    });
  });

  describe("findPendingPasswordReset", () => {
    it("finds a pending reset by its token, with the user's email", async () => {
      const { userId, email } = await createUser();
      const reset = await createPasswordReset(db, { userId });

      expect(await findPendingPasswordReset(db, reset!.token)).toEqual({ email });
    });

    it("returns null for an unknown, expired or used token", async () => {
      // Separate users: a new link would replace the same user's expired one.
      const expired = await createPasswordReset(db, {
        userId: (await createUser()).userId,
        now: new Date(Date.now() - hour - 1000),
      });
      const used = await createPasswordReset(db, { userId: (await createUser()).userId });
      await resetPassword(db, { token: used!.token, passwordHash: "new-hash" });

      expect(await findPendingPasswordReset(db, "no-such-token")).toBeNull();
      expect(await findPendingPasswordReset(db, expired!.token)).toBeNull();
      expect(await findPendingPasswordReset(db, used!.token)).toBeNull();
    });
  });

  describe("resetPassword", () => {
    it("sets the new password, ends every session of the user and uses up the link", async () => {
      const { userId } = await createUser();
      const other = await createUser();
      const reset = await createPasswordReset(db, { userId });

      expect(await resetPassword(db, { token: reset!.token, passwordHash: "new-hash" })).toEqual({
        ok: true,
      });

      expect(await passwordOf(userId)).toBe("new-hash");
      expect(await sessionsOf(userId)).toEqual([]);
      expect(await passwordOf(other.userId)).toBe("old-hash");
      expect(await sessionsOf(other.userId)).toHaveLength(2);
    });

    it("is single-use", async () => {
      const { userId } = await createUser();
      const reset = await createPasswordReset(db, { userId });
      await resetPassword(db, { token: reset!.token, passwordHash: "first-hash" });

      expect(await resetPassword(db, { token: reset!.token, passwordHash: "second-hash" })).toEqual(
        { ok: false },
      );
      expect(await passwordOf(userId)).toBe("first-hash");
    });

    it("sets the password exactly once when the link is used twice at the same time", async () => {
      const { userId } = await createUser();
      const reset = await createPasswordReset(db, { userId });

      const results = await Promise.all(
        ["a", "b", "c", "d"].map((n) =>
          resetPassword(db, { token: reset!.token, passwordHash: `hash-${n}` }),
        ),
      );

      expect(results.filter((result) => result.ok)).toHaveLength(1);
    });

    it("refuses an expired link and changes nothing", async () => {
      const { userId } = await createUser();
      const now = new Date();
      const reset = await createPasswordReset(db, { userId, now });

      expect(
        await resetPassword(db, {
          token: reset!.token,
          passwordHash: "new-hash",
          now: new Date(now.getTime() + hour),
        }),
      ).toEqual({ ok: false });
      expect(await passwordOf(userId)).toBe("old-hash");
      expect(await sessionsOf(userId)).toHaveLength(2);
    });

    it("refuses an unknown token", async () => {
      expect(await resetPassword(db, { token: "no-such-token", passwordHash: "new-hash" })).toEqual(
        {
          ok: false,
        },
      );
    });
  });
});
