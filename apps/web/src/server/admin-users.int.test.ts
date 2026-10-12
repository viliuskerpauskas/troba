import { createTestDatabase } from "@troba/db/test-database";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const password = "correct horse battery";
const newPassword = "another long passphrase";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
// Imported after DATABASE_URL points at the test database, since db() reads it once.
let modules: {
  auth: typeof import("./auth");
  core: typeof import("@troba/core");
  db: typeof import("./db");
  passwordReset: typeof import("./password-reset");
  signIn: typeof import("./sign-in");
};

let count = 0;
// TEST-NET-3 addresses (RFC 5737), one per sign-in so the rate limit stays out of the way.
const newIp = () => new Headers({ "x-forwarded-for": `203.0.113.${++count}` });

async function createUser() {
  const email = `user${++count}@example.test`;
  const { user } = await modules.auth
    .auth()
    .api.createUser({ body: { email, password, name: "Example User" } });
  return { id: user.id, email };
}

function signIn(email: string, withPassword = password) {
  return modules.signIn.signInWithPassword(newIp(), { email, password: withPassword });
}

async function sessionsOf(userId: string) {
  return modules.db
    .db()
    .query.sessions.findMany({ where: (sessions, { eq }) => eq(sessions.userId, userId) });
}

async function lastActiveAt(userId: string) {
  const user = await modules.db
    .db()
    .query.users.findFirst({ where: (users, { eq }) => eq(users.id, userId) });
  return user!.lastActiveAt;
}

describe("admin user management", () => {
  beforeAll(async () => {
    database = await createTestDatabase();
    process.env.DATABASE_URL = database.url;
    modules = {
      auth: await import("./auth"),
      core: await import("@troba/core"),
      db: await import("./db"),
      passwordReset: await import("./password-reset"),
      signIn: await import("./sign-in"),
    };
  });
  afterAll(async () => {
    await modules?.db.db().$client.end();
    await database?.drop();
  });

  let admin: { id: string; email: string };
  let user: { id: string; email: string };
  beforeEach(async () => {
    admin = await createUser();
    user = await createUser();
  });

  describe("disabling", () => {
    it("ends the user's sessions and refuses their sign-in with the usual answer", async () => {
      await signIn(user.email);
      await signIn(user.email);
      expect(await sessionsOf(user.id)).toHaveLength(2);

      await modules.core.disableUser(modules.db.db(), { userId: user.id, by: admin.id });

      expect(await sessionsOf(user.id)).toEqual([]);
      expect(await signIn(user.email)).toEqual({ ok: false, reason: "invalid" });
      expect(await sessionsOf(user.id)).toEqual([]);
    });

    it("lets the user sign in again once enabled", async () => {
      await modules.core.disableUser(modules.db.db(), { userId: user.id, by: admin.id });

      await modules.core.enableUser(modules.db.db(), { userId: user.id });

      expect(await signIn(user.email)).toEqual({ ok: true });
    });
  });

  describe("last active", () => {
    it("is recorded when the user signs in", async () => {
      expect(await lastActiveAt(user.id)).toBeNull();
      const before = Date.now();

      await signIn(user.email);

      expect((await lastActiveAt(user.id))!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    });

    it("is recorded when a day-old session is used again", async () => {
      const { headers } = await modules.auth.auth().api.signInEmail({
        body: { email: user.email, password },
        returnHeaders: true,
      });
      const cookie = headers
        .getSetCookie()
        .map((setCookie) => setCookie.split(";")[0])
        .join("; ");
      await modules.db
        .db()
        .$client.query(
          "update sessions set updated_at = now() - interval '2 days', expires_at = now() + interval '28 days' where user_id = $1",
          [user.id],
        );
      await modules.db
        .db()
        .$client.query("update users set last_active_at = null where id = $1", [user.id]);

      await modules.auth.auth().api.getSession({ headers: new Headers({ cookie }) });

      expect(await lastActiveAt(user.id)).not.toBeNull();
    });
  });

  describe("resetPasswordWithLink", () => {
    async function newLink() {
      const reset = await modules.core.createPasswordReset(modules.db.db(), { userId: user.id });
      return reset!.token;
    }

    it("sets the new password and ends every session of the user", async () => {
      await signIn(user.email);
      const token = await newLink();

      expect(
        await modules.passwordReset.resetPasswordWithLink({ token, password: newPassword }),
      ).toEqual({ ok: true });

      expect(await sessionsOf(user.id)).toEqual([]);
      expect(await signIn(user.email, password)).toEqual({ ok: false, reason: "invalid" });
      expect(await signIn(user.email, newPassword)).toEqual({ ok: true });
    });

    it("works once", async () => {
      const token = await newLink();
      await modules.passwordReset.resetPasswordWithLink({ token, password: newPassword });

      expect(
        await modules.passwordReset.resetPasswordWithLink({ token, password: "yet another one!" }),
      ).toEqual({ ok: false, reason: "invalid" });
      expect(await signIn(user.email, newPassword)).toEqual({ ok: true });
    });

    it.each([
      ["shorter than 12 characters", "a".repeat(11)],
      ["longer than 128 characters", "a".repeat(129)],
    ])("rejects a password %s and keeps the link usable", async (_, badPassword) => {
      const token = await newLink();

      expect(
        await modules.passwordReset.resetPasswordWithLink({ token, password: badPassword }),
      ).toEqual({ ok: false, reason: "input", message: expect.any(String) });
      expect(
        await modules.passwordReset.resetPasswordWithLink({ token, password: newPassword }),
      ).toEqual({ ok: true });
    });

    it("refuses an unknown token", async () => {
      expect(
        await modules.passwordReset.resetPasswordWithLink({
          token: "not-a-real-token",
          password: newPassword,
        }),
      ).toEqual({ ok: false, reason: "invalid" });
    });
  });
});
