import { createHash } from "node:crypto";
import { createDb, schema, type Db } from "@troba/db";
import { createTestDatabase } from "@troba/db/test-database";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createInvite,
  findPendingInvite,
  inviteLifetimeMs,
  listInvites,
  redeemInvite,
  revokeInvite,
} from "./invites";

const day = 86_400_000;

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Db;
let adminId: string;

async function usersWithEmail(email: string) {
  return db.select().from(schema.users).where(eq(schema.users.email, email));
}

function signUp(token: string, email: string) {
  return redeemInvite(db, { token, name: "Friend", email, passwordHash: "hashed-password" });
}

describe("invites", () => {
  beforeAll(async () => {
    database = await createTestDatabase();
    db = createDb(database.url);
    const [admin] = await db
      .insert(schema.users)
      .values({ name: "Admin", email: "admin@example.test", role: "admin" })
      .returning();
    adminId = admin!.id;
  });
  afterAll(async () => {
    await db?.$client.end();
    await database?.drop();
  });

  describe("createInvite", () => {
    it("returns a token and stores only its SHA-256 hash, expiring in 7 days", async () => {
      const now = new Date("2026-01-01T00:00:00Z");

      const { id, token } = await createInvite(db, { createdBy: adminId, now });

      const [row] = await db.select().from(schema.invites).where(eq(schema.invites.id, id));
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(row!.tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
      expect(JSON.stringify(row)).not.toContain(token);
      expect(row!.expiresAt.getTime() - now.getTime()).toBe(7 * day);
      expect(inviteLifetimeMs).toBe(7 * day);
    });

    it("binds a normalized email when one is given", async () => {
      const { id } = await createInvite(db, { createdBy: adminId, email: " Bound@Example.test " });

      const [row] = await db.select().from(schema.invites).where(eq(schema.invites.id, id));
      expect(row!.email).toBe("bound@example.test");
    });
  });

  describe("findPendingInvite", () => {
    it("finds a pending invite by its token", async () => {
      const { token } = await createInvite(db, { createdBy: adminId, email: "a@example.test" });

      expect(await findPendingInvite(db, token)).toEqual({ email: "a@example.test" });
    });

    it("returns null for an unknown, expired, revoked or used token", async () => {
      const expired = await createInvite(db, {
        createdBy: adminId,
        now: new Date(Date.now() - 8 * day),
      });
      const revoked = await createInvite(db, { createdBy: adminId });
      await revokeInvite(db, { id: revoked.id });
      const used = await createInvite(db, { createdBy: adminId });
      await signUp(used.token, "used-find@example.test");

      expect(await findPendingInvite(db, "no-such-token")).toBeNull();
      expect(await findPendingInvite(db, expired.token)).toBeNull();
      expect(await findPendingInvite(db, revoked.token)).toBeNull();
      expect(await findPendingInvite(db, used.token)).toBeNull();
    });
  });

  describe("redeemInvite", () => {
    it("creates a user with a credential account and marks the invite used", async () => {
      const { id, token } = await createInvite(db, { createdBy: adminId });

      const result = await redeemInvite(db, {
        token,
        name: " New Friend ",
        email: "New.Friend@Example.test",
        passwordHash: "hashed-password",
      });

      expect(result).toEqual({
        ok: true,
        userId: expect.any(String),
        email: "new.friend@example.test",
      });
      const userId = result.ok ? result.userId : "";
      const [user] = await usersWithEmail("new.friend@example.test");
      expect(user).toMatchObject({ id: userId, name: "New Friend", role: "user" });
      const [account] = await db
        .select()
        .from(schema.accounts)
        .where(eq(schema.accounts.userId, userId));
      expect(account).toMatchObject({
        providerId: "credential",
        accountId: userId,
        password: "hashed-password",
      });
      const [invite] = await db.select().from(schema.invites).where(eq(schema.invites.id, id));
      expect(invite).toMatchObject({ usedBy: userId, usedAt: expect.any(Date) });
    });

    it("signs up a bound invite with the bound email, whatever email was submitted", async () => {
      const { token } = await createInvite(db, {
        createdBy: adminId,
        email: "bound-only@example.test",
      });

      const result = await signUp(token, "someone-else@example.test");

      expect(result).toMatchObject({ ok: true, email: "bound-only@example.test" });
      expect(await usersWithEmail("someone-else@example.test")).toEqual([]);
    });

    it("creates exactly one user when one invite is redeemed concurrently", async () => {
      const { token } = await createInvite(db, { createdBy: adminId });
      const emails = Array.from({ length: 5 }, (_, i) => `race-${i}@example.test`);

      const results = await Promise.all(emails.map((email) => signUp(token, email)));

      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.filter((result) => !result.ok)).toEqual(
        Array(4).fill({ ok: false, reason: "invalid" }),
      );
      const created = await Promise.all(emails.map(usersWithEmail));
      expect(created.flat()).toHaveLength(1);
    });

    it("rejects an expired invite", async () => {
      const { token } = await createInvite(db, {
        createdBy: adminId,
        now: new Date(Date.now() - inviteLifetimeMs - 1000),
      });

      expect(await signUp(token, "late@example.test")).toEqual({ ok: false, reason: "invalid" });
      expect(await usersWithEmail("late@example.test")).toEqual([]);
    });

    it("rejects a revoked invite", async () => {
      const { id, token } = await createInvite(db, { createdBy: adminId });
      await revokeInvite(db, { id });

      expect(await signUp(token, "revoked@example.test")).toEqual({ ok: false, reason: "invalid" });
      expect(await usersWithEmail("revoked@example.test")).toEqual([]);
    });

    it("rejects an unknown token", async () => {
      expect(await signUp("not-a-real-token", "unknown@example.test")).toEqual({
        ok: false,
        reason: "invalid",
      });
    });

    it("lets only one of two invites racing for the same email sign up", async () => {
      const first = await createInvite(db, { createdBy: adminId });
      const second = await createInvite(db, { createdBy: adminId });

      const results = await Promise.all([
        signUp(first.token, "same@example.test"),
        signUp(second.token, "same@example.test"),
      ]);

      expect(results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ ok: true }),
          { ok: false, reason: "email-taken" },
        ]),
      );
      expect(await usersWithEmail("same@example.test")).toHaveLength(1);
    });

    it("refuses an email that's taken and leaves the invite pending", async () => {
      const { token } = await createInvite(db, { createdBy: adminId });

      expect(await signUp(token, "Admin@example.test")).toEqual({
        ok: false,
        reason: "email-taken",
      });
      expect(await findPendingInvite(db, token)).toEqual({ email: null });
    });
  });

  describe("listInvites and revokeInvite", () => {
    it("lists invites newest first with their status, never the token hash", async () => {
      const pending = await createInvite(db, { createdBy: adminId, email: "list-p@example.test" });
      const used = await createInvite(db, { createdBy: adminId });
      await signUp(used.token, "list-used@example.test");

      const invites = await listInvites(db);

      const byId = new Map(invites.map((invite) => [invite.id, invite]));
      expect(byId.get(pending.id)).toMatchObject({
        status: "pending",
        email: "list-p@example.test",
      });
      expect(byId.get(used.id)).toMatchObject({ status: "used", usedAt: expect.any(Date) });
      expect(invites.map((invite) => invite.status)).toEqual(
        expect.arrayContaining(["expired", "revoked"]),
      );
      expect(invites[0]!.createdAt >= invites.at(-1)!.createdAt).toBe(true);
      expect(Object.keys(invites[0]!)).not.toContain("tokenHash");
    });

    it("revokes a pending invite but not a used one", async () => {
      const pending = await createInvite(db, { createdBy: adminId });
      const used = await createInvite(db, { createdBy: adminId });
      await signUp(used.token, "revoke-used@example.test");

      expect(await revokeInvite(db, { id: pending.id })).toBe(true);
      expect(await revokeInvite(db, { id: pending.id })).toBe(false);
      expect(await revokeInvite(db, { id: used.id })).toBe(false);
      const statuses = new Map((await listInvites(db)).map((invite) => [invite.id, invite.status]));
      expect(statuses.get(pending.id)).toBe("revoked");
      expect(statuses.get(used.id)).toBe("used");
    });
  });
});
