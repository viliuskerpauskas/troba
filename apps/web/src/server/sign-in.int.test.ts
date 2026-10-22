import { createTestDatabase } from "@troba/db/test-database";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const password = "correct horse battery";
const wrongPassword = "not the right password";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
// Imported after DATABASE_URL points at the test database, since db() reads it once.
let modules: {
  auth: typeof import("./auth");
  db: typeof import("./db");
  signIn: typeof import("./sign-in");
};

let count = 0;
// TEST-NET-3 addresses (RFC 5737).
const newIp = () => `203.0.113.${++count}`;
const fromIp = (ip: string) => new Headers({ "x-forwarded-for": ip });

async function createUser() {
  const email = `user${++count}@example.test`;
  await modules.auth.auth().api.createUser({ body: { email, password, name: "Example User" } });
  return email;
}

function signIn(requestHeaders: Headers, email: string, withPassword: string) {
  return modules.signIn.signInWithPassword(requestHeaders, { email, password: withPassword });
}

describe("signInWithPassword", () => {
  beforeAll(async () => {
    database = await createTestDatabase();
    process.env.DATABASE_URL = database.url;
    modules = {
      auth: await import("./auth"),
      db: await import("./db"),
      signIn: await import("./sign-in"),
    };
  });
  afterAll(async () => {
    await modules?.db.db().$client.end();
    await database?.drop();
  });
  beforeEach(async () => {
    await modules.db.db().$client.query("delete from sign_in_attempts");
  });

  it("signs in with the right password", async () => {
    const email = await createUser();

    expect(await signIn(fromIp(newIp()), email, password)).toEqual({ ok: true });
  });

  it.each([
    ["a wrong password", async () => [await createUser(), wrongPassword]],
    ["an unknown email", async () => ["nobody@example.test", password]],
    ["an invalid email", async () => ["not an email", password]],
  ])("answers %s the same way", async (_, input) => {
    const [email, withPassword] = await input();

    expect(await signIn(fromIp(newIp()), email!, withPassword!)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("refuses the 6th attempt in 15 minutes for one email, even with the right password", async () => {
    const email = await createUser();
    for (let i = 0; i < 5; i++) {
      expect(await signIn(fromIp(newIp()), email, wrongPassword)).toEqual({
        ok: false,
        reason: "invalid",
      });
    }

    expect(await signIn(fromIp(newIp()), email, password)).toEqual({
      ok: false,
      reason: "limited",
    });
  });

  it("refuses the 6th failed attempt from one IP address", async () => {
    const ip = newIp();
    for (let i = 0; i < 5; i++) {
      expect(await signIn(fromIp(ip), await createUser(), wrongPassword)).toEqual({
        ok: false,
        reason: "invalid",
      });
    }

    expect(await signIn(fromIp(ip), await createUser(), password)).toEqual({
      ok: false,
      reason: "limited",
    });
  });

  it("limits unknown emails like known ones, so the refusal reveals nothing", async () => {
    for (let i = 0; i < 5; i++) await signIn(fromIp(newIp()), "nobody@example.test", password);

    expect(await signIn(fromIp(newIp()), "nobody@example.test", password)).toEqual({
      ok: false,
      reason: "limited",
    });
  });

  it("deletes every user's expired sessions on sign-in, keeping live ones", async () => {
    const other = await createUser();
    await signIn(fromIp(newIp()), other, password);
    await modules.db
      .db()
      .$client.query("update sessions set expires_at = now() - interval '1 hour'");
    const live = await createUser();
    await signIn(fromIp(newIp()), live, password);
    const email = await createUser();

    expect(await signIn(fromIp(newIp()), email, password)).toEqual({ ok: true });

    const { rows } = await modules.db
      .db()
      .$client.query<{ email: string }>(
        "select u.email from sessions s join users u on u.id = s.user_id order by u.email",
      );
    expect(rows.map((row) => row.email)).toEqual([live, email].sort());
  });

  it("starts the count again after a successful sign-in", async () => {
    const email = await createUser();
    for (let i = 0; i < 4; i++) await signIn(fromIp(newIp()), email, wrongPassword);
    expect(await signIn(fromIp(newIp()), email, password)).toEqual({ ok: true });

    for (let i = 0; i < 5; i++) {
      expect(await signIn(fromIp(newIp()), email, wrongPassword)).toEqual({
        ok: false,
        reason: "invalid",
      });
    }
  });
});
