import { createDb, schema, type Db } from "@troba/db";
import { createTestDatabase } from "@troba/db/test-database";
import { ageAiUses, insertUser } from "./ai-categories-fixture";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { claimAiCategorizeMerchants } from "./ai-categories-limit";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Db;

function newUser(): Promise<string> {
  return insertUser(db);
}

function ageUses(userId: string, hours: number) {
  return ageAiUses(db, schema.moneyAiCategorizeUses, userId, hours);
}

describe("daily cap on AI-categorized merchants", () => {
  beforeAll(async () => {
    database = await createTestDatabase();
    db = createDb(database.url);
  });
  afterAll(async () => {
    await db?.$client.end();
    await database?.drop();
  });
  beforeEach(async () => {
    await db.delete(schema.moneyAiCategorizeUses);
  });

  it("grants what was asked while the allowance lasts", async () => {
    const userId = await newUser();

    expect(await claimAiCategorizeMerchants(db, userId, 4, 10)).toBe(4);
    expect(await claimAiCategorizeMerchants(db, userId, 6, 10)).toBe(6);
  });

  it("counts merchants, not requests, and grants only what fits of the next ask", async () => {
    const userId = await newUser();
    await claimAiCategorizeMerchants(db, userId, 8, 10);

    expect(await claimAiCategorizeMerchants(db, userId, 5, 10)).toBe(2);
    expect(await claimAiCategorizeMerchants(db, userId, 1, 10)).toBe(0);
  });

  it("records nothing for a refused ask, so the day's total stops at the limit", async () => {
    const userId = await newUser();
    await claimAiCategorizeMerchants(db, userId, 10, 10);

    await claimAiCategorizeMerchants(db, userId, 3, 10);
    await claimAiCategorizeMerchants(db, userId, 0, 10);

    const rows = await db.select().from(schema.moneyAiCategorizeUses);
    expect(rows.reduce((sum, row) => sum + row.merchants, 0)).toBe(10);
  });

  it("lets one user spend the allowance without affecting another", async () => {
    const first = await newUser();
    const second = await newUser();
    await claimAiCategorizeMerchants(db, first, 5, 5);
    expect(await claimAiCategorizeMerchants(db, first, 1, 5)).toBe(0);

    expect(await claimAiCategorizeMerchants(db, second, 5, 5)).toBe(5);
  });

  it("gives the allowance back a day after each use, not at midnight", async () => {
    const userId = await newUser();
    await claimAiCategorizeMerchants(db, userId, 5, 5);

    await ageUses(userId, 23);
    expect(await claimAiCategorizeMerchants(db, userId, 5, 5)).toBe(0);

    await ageUses(userId, 2);
    expect(await claimAiCategorizeMerchants(db, userId, 5, 5)).toBe(5);
  });

  it("forgets the user's uses over a day old, and keeps everyone else's", async () => {
    const first = await newUser();
    const second = await newUser();
    await claimAiCategorizeMerchants(db, first, 2, 10);
    await claimAiCategorizeMerchants(db, second, 2, 10);
    await ageUses(first, 25);
    await ageUses(second, 25);

    await claimAiCategorizeMerchants(db, first, 1, 10);

    const rows = await db.select().from(schema.moneyAiCategorizeUses);
    expect(rows.filter((row) => row.userId === first)).toHaveLength(1);
    expect(rows.filter((row) => row.userId === second)).toHaveLength(1);
  });

  it("stays under the limit when claims arrive at once", async () => {
    const userId = await newUser();

    const granted = await Promise.all(
      Array.from({ length: 8 }, () => claimAiCategorizeMerchants(db, userId, 3, 10)),
    );

    expect(granted.reduce((sum, n) => sum + n, 0)).toBe(10);
  });
});
