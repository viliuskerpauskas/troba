import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase } from "@troba/db/test-database";
import { rowsOwnedBy } from "@troba/db/user-tables";

const password = "correct horse battery";
const newPassword = "another long passphrase";
const firefoxOnWindows =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0";
const safariOnIphone =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let uploadsDir: string;
// Imported after DATABASE_URL points at the test database (db() reads it once) and UPLOADS_DIR at a
// temporary folder.
let modules: {
  account: typeof import("./account");
  auth: typeof import("./auth");
  db: typeof import("./db");
  signIn: typeof import("./sign-in");
};

let userCount = 0;

async function createUser() {
  const email = `user${++userCount}@example.test`;
  const { user } = await modules.auth
    .auth()
    .api.createUser({ body: { email, password, name: "Example User" } });
  return { id: user.id, email };
}

// TEST-NET-3 (RFC 5737), the address every test browser signs in from.
const ipAddress = "203.0.113.7";

// Signs in like a browser would and returns the request headers that browser sends afterwards.
async function signIn(email: string, userAgent: string, withPassword = password) {
  const { headers } = await modules.auth.auth().api.signInEmail({
    body: { email, password: withPassword },
    headers: new Headers({ "user-agent": userAgent, "x-forwarded-for": ipAddress }),
    returnHeaders: true,
  });
  const cookie = headers
    .getSetCookie()
    .map((setCookie) => setCookie.split(";")[0])
    .join("; ");
  return new Headers({ cookie, "user-agent": userAgent });
}

async function sessionsOf(userId: string) {
  return modules.db
    .db()
    .query.sessions.findMany({ where: (sessions, { eq }) => eq(sessions.userId, userId) });
}

describe("account", () => {
  beforeAll(async () => {
    database = await createTestDatabase();
    process.env.DATABASE_URL = database.url;
    uploadsDir = await mkdtemp(path.join(tmpdir(), "troba-uploads-"));
    process.env.UPLOADS_DIR = uploadsDir;
    modules = {
      account: await import("./account"),
      auth: await import("./auth"),
      db: await import("./db"),
      signIn: await import("./sign-in"),
    };
  });
  afterAll(async () => {
    await modules?.db.db().$client.end();
    await database?.drop();
    if (uploadsDir) await rm(uploadsDir, { recursive: true, force: true });
  });

  let user: { id: string; email: string };
  beforeEach(async () => {
    user = await createUser();
  });

  describe("changeName", () => {
    it("trims and saves the new name", async () => {
      const laptop = await signIn(user.email, firefoxOnWindows);

      await modules.account.changeName(laptop, "  New Name ");

      const saved = await modules.db
        .db()
        .query.users.findFirst({ where: (users, { eq }) => eq(users.id, user.id) });
      expect(saved?.name).toBe("New Name");
    });

    it.each([
      ["empty", "   "],
      ["longer than 100 characters", "a".repeat(101)],
    ])("rejects a name that's %s", async (_, name) => {
      const laptop = await signIn(user.email, firefoxOnWindows);

      await expect(modules.account.changeName(laptop, name)).rejects.toThrow(
        modules.account.AccountInputError,
      );
    });
  });

  describe("changePassword", () => {
    it("leaves only the current session", async () => {
      const laptop = await signIn(user.email, firefoxOnWindows);
      await signIn(user.email, safariOnIphone);
      expect(await sessionsOf(user.id)).toHaveLength(2);

      const { headers } = await modules.account.changePassword(laptop, {
        currentPassword: password,
        newPassword,
      });

      const remaining = await sessionsOf(user.id);
      expect(remaining).toHaveLength(1);
      // The device that changed the password gets a new session cookie and stays signed in.
      const newCookie = headers.getSetCookie().find((cookie) => cookie.includes("session_token"));
      expect(newCookie).toContain(remaining[0]!.token);
      await expect(signIn(user.email, firefoxOnWindows, newPassword)).resolves.toBeDefined();
    });

    it("refuses a wrong current password and keeps every session", async () => {
      const laptop = await signIn(user.email, firefoxOnWindows);
      await signIn(user.email, safariOnIphone);

      await expect(
        modules.account.changePassword(laptop, {
          currentPassword: "not the right password",
          newPassword,
        }),
      ).rejects.toThrow("The current password is incorrect.");
      expect(await sessionsOf(user.id)).toHaveLength(2);
    });

    it("refuses the 6th wrong current password in 15 minutes, even with the right one", async () => {
      const laptop = await signIn(user.email, firefoxOnWindows);
      for (let i = 0; i < 5; i++) {
        await expect(
          modules.account.changePassword(laptop, {
            currentPassword: "not the right password",
            newPassword,
          }),
        ).rejects.toThrow("The current password is incorrect.");
      }

      await expect(
        modules.account.changePassword(laptop, { currentPassword: password, newPassword }),
      ).rejects.toThrow("Too many wrong passwords. Wait 15 minutes and try again.");
      // The same limit covers signing in, since both guess the same password.
      await expect(
        modules.signIn.signInWithPassword(new Headers(), { email: user.email, password }),
      ).resolves.toEqual({ ok: false, reason: "limited" });
    });

    it("starts the count again after the password is changed", async () => {
      const laptop = await signIn(user.email, firefoxOnWindows);
      const wrong = { currentPassword: "not the right password", newPassword: password };
      for (let i = 0; i < 4; i++) {
        await expect(modules.account.changePassword(laptop, wrong)).rejects.toThrow();
      }
      const { headers } = await modules.account.changePassword(laptop, {
        currentPassword: password,
        newPassword,
      });
      const cookie = headers
        .getSetCookie()
        .map((setCookie) => setCookie.split(";")[0])
        .join("; ");
      const stillSignedIn = new Headers({ cookie, "user-agent": firefoxOnWindows });

      for (let i = 0; i < 5; i++) {
        await expect(modules.account.changePassword(stillSignedIn, wrong)).rejects.toThrow(
          "The current password is incorrect.",
        );
      }
    });

    it.each([
      ["shorter than 12 characters", "a".repeat(11)],
      ["longer than 128 characters", "a".repeat(129)],
    ])("rejects a new password %s", async (_, badPassword) => {
      const laptop = await signIn(user.email, firefoxOnWindows);

      await expect(
        modules.account.changePassword(laptop, {
          currentPassword: password,
          newPassword: badPassword,
        }),
      ).rejects.toThrow(modules.account.AccountInputError);
    });
  });

  describe("listSessions", () => {
    it("lists the user's active sessions, newest activity first, marking this device", async () => {
      await signIn(user.email, safariOnIphone);
      const laptop = await signIn(user.email, firefoxOnWindows);
      const other = await createUser();
      await signIn(other.email, firefoxOnWindows);

      const sessions = await modules.account.listSessions(laptop);

      expect(sessions).toEqual([
        {
          id: expect.any(String),
          device: "Firefox on Windows",
          ipAddress,
          lastActive: expect.any(Date),
          current: true,
        },
        {
          id: expect.any(String),
          device: "Safari on iPhone",
          ipAddress,
          lastActive: expect.any(Date),
          current: false,
        },
      ]);
      // Tokens never leave the server.
      expect(JSON.stringify(sessions)).not.toMatch(/token/i);
    });

    it("leaves out expired sessions", async () => {
      const phone = await signIn(user.email, safariOnIphone);
      const laptop = await signIn(user.email, firefoxOnWindows);
      const phoneSession = (await modules.account.listSessions(phone)).find((s) => s.current)!;
      await modules.db
        .db()
        .$client.query(
          "update sessions set expires_at = now() - interval '1 second' where id = $1",
          [phoneSession.id],
        );

      const sessions = await modules.account.listSessions(laptop);

      expect(sessions.map((session) => session.device)).toEqual(["Firefox on Windows"]);
    });
  });

  describe("revokeSession", () => {
    it("signs out another of the user's sessions", async () => {
      const phone = await signIn(user.email, safariOnIphone);
      const laptop = await signIn(user.email, firefoxOnWindows);
      const phoneSession = (await modules.account.listSessions(laptop)).find((s) => !s.current)!;

      await modules.account.revokeSession(laptop, phoneSession.id);

      expect(await modules.auth.auth().api.getSession({ headers: phone })).toBeNull();
      expect(await modules.auth.auth().api.getSession({ headers: laptop })).not.toBeNull();
    });

    it("can't revoke someone else's session", async () => {
      const other = await createUser();
      const othersPhone = await signIn(other.email, safariOnIphone);
      const [othersSession] = await modules.account.listSessions(othersPhone);
      const laptop = await signIn(user.email, firefoxOnWindows);

      await modules.account.revokeSession(laptop, othersSession!.id);

      expect(await modules.auth.auth().api.getSession({ headers: othersPhone })).not.toBeNull();
    });

    it("ignores an id that isn't a session id", async () => {
      const laptop = await signIn(user.email, firefoxOnWindows);

      await expect(modules.account.revokeSession(laptop, "not-a-uuid")).resolves.toBeUndefined();
    });
  });

  describe("signOutEverywhere", () => {
    it("ends every session of the user, including this one, and no one else's", async () => {
      const phone = await signIn(user.email, safariOnIphone);
      const laptop = await signIn(user.email, firefoxOnWindows);
      const other = await createUser();
      const othersLaptop = await signIn(other.email, firefoxOnWindows);

      await modules.account.signOutEverywhere(laptop);

      expect(await sessionsOf(user.id)).toEqual([]);
      expect(await modules.auth.auth().api.getSession({ headers: phone })).toBeNull();
      expect(await modules.auth.auth().api.getSession({ headers: othersLaptop })).not.toBeNull();
    });
  });

  describe("deleteAccount", () => {
    it("deletes the user, their rows, files and sessions once they type their email", async () => {
      const phone = await signIn(user.email, safariOnIphone);
      const laptop = await signIn(user.email, firefoxOnWindows);
      await mkdir(path.join(uploadsDir, user.id), { recursive: true });
      await writeFile(path.join(uploadsDir, user.id, "receipt.jpg"), "not really a jpeg");

      await modules.account.deleteAccount(laptop, ` ${user.email.toUpperCase()} `);

      const counts = await rowsOwnedBy(modules.db.db(), user.id);
      expect(Object.values(counts).every((count) => count === 0)).toBe(true);
      expect(
        await modules.db
          .db()
          .query.users.findFirst({ where: (users, { eq }) => eq(users.id, user.id) }),
      ).toBeUndefined();
      expect(existsSync(path.join(uploadsDir, user.id))).toBe(false);
      expect(await modules.auth.auth().api.getSession({ headers: phone })).toBeNull();
    });

    it("refuses when the typed email isn't the user's and deletes nothing", async () => {
      const laptop = await signIn(user.email, firefoxOnWindows);
      const other = await createUser();

      await expect(modules.account.deleteAccount(laptop, other.email)).rejects.toThrow(
        modules.account.AccountInputError,
      );
      await expect(modules.account.deleteAccount(laptop, "")).rejects.toThrow(
        modules.account.AccountInputError,
      );
      expect(await sessionsOf(user.id)).toHaveLength(1);
    });

    it("refuses to delete the last admin", async () => {
      const admin = await createUser();
      await modules.db
        .db()
        .$client.query("update users set role = 'admin' where id = $1", [admin.id]);
      const laptop = await signIn(admin.email, firefoxOnWindows);

      await expect(modules.account.deleteAccount(laptop, admin.email)).rejects.toThrow(
        "You're the only admin",
      );
      expect(await sessionsOf(admin.id)).toHaveLength(1);
      await modules.db
        .db()
        .$client.query("update users set role = 'user' where id = $1", [admin.id]);
    });
  });

  it("refuses every call without a session", async () => {
    const signedOut = new Headers();
    const { account } = modules;

    await expect(account.changeName(signedOut, "Name")).rejects.toThrow();
    await expect(
      account.changePassword(signedOut, { currentPassword: password, newPassword }),
    ).rejects.toThrow();
    await expect(account.listSessions(signedOut)).rejects.toThrow();
    await expect(account.revokeSession(signedOut, crypto.randomUUID())).rejects.toThrow();
    await expect(account.signOutEverywhere(signedOut)).rejects.toThrow();
    await expect(account.deleteAccount(signedOut, "")).rejects.toThrow();
  });

  it("refuses every call for a banned user and changes nothing", async () => {
    const laptop = await signIn(user.email, firefoxOnWindows);
    // Set directly: banning through the admin plugin also revokes the sessions, and this checks
    // the account functions themselves, for callers that don't go through requireUser().
    await modules.db.db().$client.query("update users set banned = true where id = $1", [user.id]);
    const { account } = modules;

    await expect(account.changeName(laptop, "Banned Rename")).rejects.toThrow(
      account.NotSignedInError,
    );
    await expect(
      account.changePassword(laptop, { currentPassword: password, newPassword }),
    ).rejects.toThrow(account.NotSignedInError);
    await expect(account.listSessions(laptop)).rejects.toThrow(account.NotSignedInError);
    await expect(account.revokeSession(laptop, crypto.randomUUID())).rejects.toThrow(
      account.NotSignedInError,
    );
    await expect(account.signOutEverywhere(laptop)).rejects.toThrow(account.NotSignedInError);
    await expect(account.deleteAccount(laptop, user.email)).rejects.toThrow(
      account.NotSignedInError,
    );

    const saved = await modules.db
      .db()
      .query.users.findFirst({ where: (users, { eq }) => eq(users.id, user.id) });
    expect(saved?.name).toBe("Example User");
    expect(await sessionsOf(user.id)).toHaveLength(1);
    await modules.db.db().$client.query("update users set banned = false where id = $1", [user.id]);
    await expect(signIn(user.email, firefoxOnWindows)).resolves.toBeDefined();
  });
});
