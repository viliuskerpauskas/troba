import { schema } from "@troba/db";
import { createTestDatabase } from "@troba/db/test-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const password = "correct horse battery";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
// Imported after DATABASE_URL points at the test database, since db() reads it once.
let modules: {
  auth: typeof import("./auth");
  core: typeof import("@troba/core");
  db: typeof import("./db");
  signUp: typeof import("./invite-sign-up");
};
let adminId: string;

async function newInvite(email?: string) {
  return modules.core.createInvite(modules.db.db(), { createdBy: adminId, email });
}

describe("signUpWithInvite", () => {
  beforeAll(async () => {
    database = await createTestDatabase();
    process.env.DATABASE_URL = database.url;
    modules = {
      auth: await import("./auth"),
      core: await import("@troba/core"),
      db: await import("./db"),
      signUp: await import("./invite-sign-up"),
    };
    const [admin] = await modules.db
      .db()
      .insert(schema.users)
      .values({ name: "Admin", email: "admin@example.test", role: "admin" })
      .returning();
    adminId = admin!.id;
  });
  afterAll(async () => {
    await modules?.db.db().$client.end();
    await database?.drop();
  });

  it("creates a user who can then sign in with the password", async () => {
    const { token } = await newInvite();

    const result = await modules.signUp.signUpWithInvite({
      token,
      name: "Friend",
      email: "friend@example.test",
      password,
    });

    expect(result).toMatchObject({ ok: true, email: "friend@example.test" });
    const signIn = await modules.auth
      .auth()
      .api.signInEmail({ body: { email: "friend@example.test", password } });
    expect(signIn.user).toMatchObject({ name: "Friend", role: "user" });
  });

  it.each([
    ["shorter than 12 characters", "a".repeat(11)],
    ["longer than 128 characters", "a".repeat(129)],
  ])("rejects a password %s and leaves the invite pending", async (_, badPassword) => {
    const { token } = await newInvite();

    const result = await modules.signUp.signUpWithInvite({
      token,
      name: "Friend",
      email: "weak@example.test",
      password: badPassword,
    });

    expect(result).toEqual({
      ok: false,
      reason: "input",
      message: expect.stringMatching(/password/i),
    });
    expect(await modules.core.findPendingInvite(modules.db.db(), token)).not.toBeNull();
  });

  it("rejects a missing name", async () => {
    const { token } = await newInvite();

    const result = await modules.signUp.signUpWithInvite({
      token,
      name: "  ",
      email: "nameless@example.test",
      password,
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "input",
      message: expect.stringMatching(/name/i),
    });
  });

  it("reports an invalid token without creating anyone", async () => {
    const result = await modules.signUp.signUpWithInvite({
      token: "not-a-real-token",
      name: "Friend",
      email: "nobody@example.test",
      password,
    });

    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("ignores the submitted email for a bound invite", async () => {
    const { token } = await newInvite("bound@example.test");

    const result = await modules.signUp.signUpWithInvite({
      token,
      name: "Bound",
      email: "",
      password,
    });

    expect(result).toMatchObject({ ok: true, email: "bound@example.test" });
  });
});
