import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase } from "@troba/db/test-database";

const password = "correct horse battery";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
// Imported after DATABASE_URL points at the test database, since db() reads it once.
let modules: {
  auth: typeof import("./auth");
  createAdmin: typeof import("./create-admin");
  db: typeof import("./db");
};

async function usersWithEmail(email: string) {
  const { db } = modules.db;
  return db().query.users.findMany({ where: (users, { eq }) => eq(users.email, email) });
}

describe("createAdmin", () => {
  beforeAll(async () => {
    database = await createTestDatabase();
    process.env.DATABASE_URL = database.url;
    modules = {
      auth: await import("./auth"),
      createAdmin: await import("./create-admin"),
      db: await import("./db"),
    };
  });
  afterAll(async () => {
    await modules?.db.db().$client.end();
    await database?.drop();
  });

  it("creates the first admin, who can then sign in with the password", async () => {
    const { createAdmin } = modules.createAdmin;

    const { userId } = await createAdmin({ email: "Owner@example.test", password });

    const [user] = await usersWithEmail("owner@example.test");
    expect(user).toMatchObject({ id: userId, role: "admin", name: "Owner" });
    const signIn = await modules.auth
      .auth()
      .api.signInEmail({ body: { email: "owner@example.test", password } });
    expect(signIn.user.id).toBe(userId);
  });

  it("refuses when an admin already exists", async () => {
    const { AdminExistsError, createAdmin } = modules.createAdmin;

    await expect(createAdmin({ email: "second@example.test", password })).rejects.toThrow(
      AdminExistsError,
    );
    expect(await usersWithEmail("second@example.test")).toEqual([]);
  });

  it("creates another admin with force", async () => {
    const { createAdmin } = modules.createAdmin;

    const { userId } = await createAdmin({ email: "recovery@example.test", password, force: true });

    const [user] = await usersWithEmail("recovery@example.test");
    expect(user).toMatchObject({ id: userId, role: "admin" });
  });

  it.each([
    ["shorter than 12 characters", "a".repeat(11)],
    ["longer than 128 characters", "a".repeat(129)],
  ])("rejects a password %s", async (_, badPassword) => {
    const { createAdmin } = modules.createAdmin;

    await expect(
      createAdmin({ email: "weak@example.test", password: badPassword, force: true }),
    ).rejects.toThrow(/password/i);
    expect(await usersWithEmail("weak@example.test")).toEqual([]);
  });

  it("accepts a 128-character password", async () => {
    const { createAdmin } = modules.createAdmin;

    await expect(
      createAdmin({ email: "long@example.test", password: "a".repeat(128), force: true }),
    ).resolves.toHaveProperty("userId");
  });

  it("rejects an invalid email", async () => {
    const { createAdmin } = modules.createAdmin;

    await expect(createAdmin({ email: "not-an-email", password, force: true })).rejects.toThrow(
      /email/i,
    );
  });

  it("refuses an email that's already taken", async () => {
    const { createAdmin } = modules.createAdmin;

    await expect(
      createAdmin({ email: "owner@example.test", password, force: true }),
    ).rejects.toThrow(/already exists/i);
  });
});
