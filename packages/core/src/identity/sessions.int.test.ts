import { createDb, schema, type Db } from "@troba/db";
import { createTestDatabase } from "@troba/db/test-database";
import { asc } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteExpiredSessions } from "./sessions";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Db;

const hour = 60 * 60 * 1000;

describe("deleteExpiredSessions", () => {
  beforeAll(async () => {
    database = await createTestDatabase();
    db = createDb(database.url);
  });
  afterAll(async () => {
    await db?.$client.end();
    await database?.drop();
  });

  it("deletes every user's expired sessions and leaves live ones alone", async () => {
    for (const n of [1, 2]) {
      const [user] = await db
        .insert(schema.users)
        .values({ name: `User ${n}`, email: `user${n}@example.test` })
        .returning({ id: schema.users.id });
      await db.insert(schema.sessions).values([
        {
          userId: user!.id,
          token: `expired-${n}`,
          expiresAt: new Date(Date.now() - hour),
          ipAddress: "203.0.113.1",
          userAgent: "Example Browser",
        },
        { userId: user!.id, token: `live-${n}`, expiresAt: new Date(Date.now() + hour) },
      ]);
    }

    await deleteExpiredSessions(db);

    const left = await db
      .select({ token: schema.sessions.token })
      .from(schema.sessions)
      .orderBy(asc(schema.sessions.token));
    expect(left).toEqual([{ token: "live-1" }, { token: "live-2" }]);
  });
});
