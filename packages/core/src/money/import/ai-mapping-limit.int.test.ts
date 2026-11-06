import { createDb, schema, type Db } from "@troba/db";
import { createTestDatabase } from "@troba/db/test-database";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { claimAiMappingUse } from "./ai-mapping-limit";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Db;
let userCount = 0;

async function newUser(): Promise<string> {
  const [user] = await db
    .insert(schema.users)
    .values({ name: "Example User", email: `limit${++userCount}@example.test` })
    .returning({ id: schema.users.id });
  return user!.id;
}

async function ageUses(userId: string, hours: number) {
  await db.execute(
    sql`update money_ai_mapping_uses set created_at = created_at - make_interval(hours => ${hours}) where user_id = ${userId}`,
  );
}

async function useUpTo(userId: string, limit: number) {
  for (let i = 0; i < limit; i++) expect(await claimAiMappingUse(db, userId, limit)).toBe(true);
}

describe("daily cap on AI mappings", () => {
  beforeAll(async () => {
    database = await createTestDatabase();
    db = createDb(database.url);
  });
  afterAll(async () => {
    await db?.$client.end();
    await database?.drop();
  });
  beforeEach(async () => {
    await db.delete(schema.moneyAiMappingUses);
  });

  it("lets the daily number of mappings through and refuses the next", async () => {
    const userId = await newUser();

    await useUpTo(userId, 3);

    expect(await claimAiMappingUse(db, userId, 3)).toBe(false);
    expect(await claimAiMappingUse(db, userId, 3)).toBe(false);
  });

  it("doesn't count a refused attempt, so the day's count stops at the limit", async () => {
    const userId = await newUser();
    await useUpTo(userId, 2);

    await claimAiMappingUse(db, userId, 2);
    await claimAiMappingUse(db, userId, 2);

    const rows = await db.select().from(schema.moneyAiMappingUses);
    expect(rows).toHaveLength(2);
  });

  it("lets one user hit the limit without affecting another", async () => {
    const first = await newUser();
    const second = await newUser();
    await useUpTo(first, 2);
    expect(await claimAiMappingUse(db, first, 2)).toBe(false);

    expect(await claimAiMappingUse(db, second, 2)).toBe(true);
    expect(await claimAiMappingUse(db, second, 2)).toBe(true);
    expect(await claimAiMappingUse(db, second, 2)).toBe(false);
  });

  it("resets after a day", async () => {
    const userId = await newUser();
    await useUpTo(userId, 2);
    expect(await claimAiMappingUse(db, userId, 2)).toBe(false);

    await ageUses(userId, 23);
    expect(await claimAiMappingUse(db, userId, 2)).toBe(false);

    await ageUses(userId, 2);
    expect(await claimAiMappingUse(db, userId, 2)).toBe(true);
  });

  it("forgets the user's uses that are over a day old, and keeps everyone else's", async () => {
    const first = await newUser();
    const second = await newUser();
    await useUpTo(first, 2);
    await useUpTo(second, 2);
    await ageUses(first, 25);
    await ageUses(second, 25);

    await claimAiMappingUse(db, first, 2);

    const rows = await db.select().from(schema.moneyAiMappingUses);
    expect(rows.filter((row) => row.userId === first)).toHaveLength(1);
    expect(rows.filter((row) => row.userId === second)).toHaveLength(2);
  });

  it("lets only the limit through when claims arrive at once", async () => {
    const userId = await newUser();

    const results = await Promise.all(
      Array.from({ length: 8 }, () => claimAiMappingUse(db, userId, 3)),
    );

    expect(results.filter(Boolean)).toHaveLength(3);
  });
});
