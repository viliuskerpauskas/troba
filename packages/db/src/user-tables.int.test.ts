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

  // SPEC-identity I7: every user-owned table has user_id uuid not null references users(id) on
  // delete cascade, so deleting a user deletes everything they own.
  it("gives every user_id a non-null uuid foreign key to users that cascades on delete", async () => {
    const tables = await userTables(db);
    const { rows: columns } = await db.$client.query<{ table_name: string }>(
      `select table_name from information_schema.columns
        where table_schema = 'public' and column_name = 'user_id'
          and data_type = 'uuid' and is_nullable = 'NO'`,
    );
    const { rows: cascades } = await db.$client.query<{ table_name: string }>(
      `select c.conrelid::regclass::text as table_name
         from pg_constraint c
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
        where c.contype = 'f' and c.confrelid = 'users'::regclass and c.confdeltype = 'c'
          and a.attname = 'user_id' and array_length(c.conkey, 1) = 1`,
    );

    expect(columns.map((row) => row.table_name).sort()).toEqual([...tables].sort());
    expect(cascades.map((row) => row.table_name).sort()).toEqual([...tables].sort());
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
