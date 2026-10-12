import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "./client";
import * as schema from "./schema";
import { createTestDatabase } from "./test-database";
import { rowsOwnedBy, userTables } from "./user-tables";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Db;

describe("user tables", () => {
  beforeAll(async () => {
    database = await createTestDatabase();
    db = createDb(database.url);
  });
  afterAll(async () => {
    await db?.$client.end();
    await database?.drop();
  });

  it("finds every table with a user_id column", async () => {
    expect(await userTables(db)).toEqual(expect.arrayContaining(["accounts", "sessions"]));
  });

  // SPEC-identity I7: deleting a user must delete everything they own.
  it("gives every user_id a foreign key to users that cascades on delete", async () => {
    const tables = await userTables(db);
    const { rows } = await db.$client.query<{ table_name: string }>(
      `select tc.table_name
         from information_schema.table_constraints tc
         join information_schema.key_column_usage kcu
           on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
         join information_schema.constraint_column_usage ccu
           on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
         join information_schema.referential_constraints rc
           on rc.constraint_name = tc.constraint_name and rc.constraint_schema = tc.table_schema
        where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'
          and kcu.column_name = 'user_id'
          and ccu.table_name = 'users' and ccu.column_name = 'id'
          and rc.delete_rule = 'CASCADE'`,
    );

    expect(rows.map((row) => row.table_name).sort()).toEqual([...tables].sort());
  });

  it("counts a user's rows in each of those tables", async () => {
    const [owner, other] = await db
      .insert(schema.users)
      .values([
        { name: "Owner", email: "owner@example.test" },
        { name: "Other", email: "other@example.test" },
      ])
      .returning();
    const session = (userId: string, token: string) => ({
      userId,
      token,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await db
      .insert(schema.sessions)
      .values([session(owner!.id, "t1"), session(owner!.id, "t2"), session(other!.id, "t3")]);

    const counts = await rowsOwnedBy(db, owner!.id);

    expect(counts).toMatchObject({ sessions: 2, accounts: 0 });
    expect(Object.keys(counts).sort()).toEqual((await userTables(db)).sort());
  });
});
