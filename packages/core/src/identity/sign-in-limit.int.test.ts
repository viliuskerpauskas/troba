import { createDb, schema, type Db } from "@troba/db";
import { createTestDatabase } from "@troba/db/test-database";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { beginSignInAttempt, signInLimit, signInSucceeded } from "./sign-in-limit";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Db;

let emailCount = 0;
let ipCount = 0;
const newEmail = () => `user${++emailCount}@example.test`;
// TEST-NET-3 addresses (RFC 5737).
const newIp = () => `203.0.113.${++ipCount}`;

async function fail(times: number, key: { email: string; ipAddress: string | null }) {
  for (let i = 0; i < times; i++) {
    expect(await beginSignInAttempt(db, key)).not.toBeNull();
  }
}

async function ageAttempts(minutes: number) {
  await db.execute(
    sql`update sign_in_attempts set created_at = created_at - make_interval(mins => ${minutes})`,
  );
}

describe("sign-in limit", () => {
  beforeAll(async () => {
    database = await createTestDatabase();
    db = createDb(database.url);
  });
  afterAll(async () => {
    await db?.$client.end();
    await database?.drop();
  });
  beforeEach(async () => {
    await db.delete(schema.signInAttempts);
  });

  it("allows 5 failed attempts per email in 15 minutes and refuses the 6th", async () => {
    expect(signInLimit).toEqual({ attempts: 5, windowMinutes: 15 });
    const email = newEmail();

    await fail(5, { email, ipAddress: newIp() });

    expect(await beginSignInAttempt(db, { email, ipAddress: newIp() })).toBeNull();
  });

  it("counts an email the same whatever its case or surrounding spaces", async () => {
    const email = newEmail();

    await fail(5, { email: ` ${email.toUpperCase()} `, ipAddress: newIp() });

    expect(await beginSignInAttempt(db, { email, ipAddress: newIp() })).toBeNull();
  });

  it("refuses the 6th attempt from one IP address, whatever the email", async () => {
    const ipAddress = newIp();
    for (let i = 0; i < 5; i++) await fail(1, { email: newEmail(), ipAddress });

    expect(await beginSignInAttempt(db, { email: newEmail(), ipAddress })).toBeNull();
  });

  it("counts IPv6 addresses by their /64, whatever the email", async () => {
    // Documentation addresses (RFC 3849), all in 2001:db8:0:1::/64, however they're written.
    for (const ipAddress of [
      "2001:db8:0:1::1",
      "2001:db8:0:1::2",
      "2001:db8:0:1::3",
      "2001:db8:0:1::4",
      "2001:0DB8:0000:0001::5",
    ])
      await fail(1, { email: newEmail(), ipAddress });

    expect(
      await beginSignInAttempt(db, { email: newEmail(), ipAddress: "2001:db8::1:ffff:0:0:6" }),
    ).toBeNull();
    expect(
      await beginSignInAttempt(db, { email: newEmail(), ipAddress: "2001:db8:0:2::1" }),
    ).not.toBeNull();
  });

  it("counts an IPv4-mapped IPv6 address as the IPv4 address", async () => {
    const ipAddress = newIp();
    for (let i = 0; i < 4; i++) await fail(1, { email: newEmail(), ipAddress });
    await fail(1, { email: newEmail(), ipAddress: `::ffff:${ipAddress}` });

    expect(await beginSignInAttempt(db, { email: newEmail(), ipAddress })).toBeNull();
    // Mapped addresses aren't lumped together as one /64: other IPv4 addresses count on their own.
    expect(await beginSignInAttempt(db, { email: newEmail(), ipAddress: newIp() })).not.toBeNull();
  });

  it("doesn't limit by IP when there's no address", async () => {
    for (let i = 0; i < 6; i++) await fail(1, { email: newEmail(), ipAddress: null });

    expect(await beginSignInAttempt(db, { email: newEmail(), ipAddress: null })).not.toBeNull();
  });

  it("doesn't count a refused attempt, so retrying doesn't extend the lockout", async () => {
    const email = newEmail();
    await fail(5, { email, ipAddress: null });
    expect(await beginSignInAttempt(db, { email, ipAddress: null })).toBeNull();

    const [{ count } = { count: 0 }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.signInAttempts);
    expect(count).toBe(5);
  });

  it("allows attempts again once the failures are older than 15 minutes", async () => {
    const email = newEmail();
    await fail(5, { email, ipAddress: null });

    await ageAttempts(15);

    expect(await beginSignInAttempt(db, { email, ipAddress: null })).not.toBeNull();
  });

  it("deletes attempts older than the window", async () => {
    await fail(1, { email: newEmail(), ipAddress: null });
    await ageAttempts(16);

    await fail(1, { email: newEmail(), ipAddress: null });

    expect(await db.select().from(schema.signInAttempts)).toHaveLength(1);
  });

  it("lets at most 5 of many concurrent attempts through", async () => {
    const email = newEmail();

    const attempts = await Promise.all(
      Array.from({ length: 20 }, () => beginSignInAttempt(db, { email, ipAddress: null })),
    );

    const allowed = attempts.filter((attempt) => attempt !== null).length;
    expect(allowed).toBeLessThanOrEqual(5);
    // Refusing everything would also pass the line above: the rest of the 5 are still allowed.
    await fail(5 - allowed, { email, ipAddress: null });
    expect(await beginSignInAttempt(db, { email, ipAddress: null })).toBeNull();
  });

  describe("signInSucceeded", () => {
    it("clears the email's failures", async () => {
      const email = newEmail();
      await fail(4, { email, ipAddress: newIp() });
      const attempt = await beginSignInAttempt(db, { email, ipAddress: newIp() });

      await signInSucceeded(db, attempt!);

      await fail(5, { email, ipAddress: newIp() });
    });

    it("keeps other emails' failures from the same IP address", async () => {
      const ipAddress = newIp();
      await fail(4, { email: newEmail(), ipAddress });
      const attempt = await beginSignInAttempt(db, { email: newEmail(), ipAddress });

      await signInSucceeded(db, attempt!);

      // The successful attempt itself no longer counts against the IP address.
      await fail(1, { email: newEmail(), ipAddress });
      expect(await beginSignInAttempt(db, { email: newEmail(), ipAddress })).toBeNull();
    });
  });
});
