import { createDb, schema, type Db } from "@troba/db";
import { createTestDatabase } from "@troba/db/test-database";
import { ageAiUses, insertUser } from "../ai-categories-fixture";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { MappingModelClient } from "./ai-mapping";
import { claimAiMappingUse, proposeMappingWithinLimit } from "./ai-mapping-limit";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Db;

function newUser(): Promise<string> {
  return insertUser(db);
}

function ageUses(userId: string, hours: number) {
  return ageAiUses(db, schema.moneyAiMappingUses, userId, hours);
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

  describe("proposeMappingWithinLimit", () => {
    const file = new TextEncoder().encode(
      ["Date;Amount;D/C", "15.01.2024;12,50;D", "16.01.2024;99,00;C"].join("\n"),
    );
    const answer = {
      decimalSeparator: ",",
      dateFormat: "DD.MM.YYYY",
      columns: {
        bookingDate: "Date",
        transactionDate: null,
        amount: "Amount",
        debitCredit: "D/C",
        currency: null,
        originalAmount: null,
        originalCurrency: null,
        counterparty: null,
        counterpartyIban: null,
        description: null,
        transactionId: null,
        transactionType: null,
        ownIban: null,
      },
      debitValues: ["D"],
    };

    function client(reply: () => Promise<unknown>) {
      const calls: unknown[] = [];
      return {
        calls,
        suggestMapping: (request: unknown) => {
          calls.push(request);
          return reply();
        },
      } satisfies MappingModelClient & { calls: unknown[] };
    }

    const ask = (userId: string, model: MappingModelClient | null, limit = 2) =>
      proposeMappingWithinLimit(db, userId, file, { client: model, dailyLimit: limit });

    it("returns the proposal and counts one use", async () => {
      const userId = await newUser();
      const model = client(() => Promise.resolve(answer));

      const result = await ask(userId, model);

      expect(result).toMatchObject({ status: "proposed", proposal: { rows: 2 } });
      expect(model.calls).toHaveLength(1);
      expect(await db.select().from(schema.moneyAiMappingUses)).toHaveLength(1);
    });

    it("refuses once the cap is reached, without invoking the client", async () => {
      const userId = await newUser();
      await useUpTo(userId, 2);
      const model = client(() => Promise.resolve(answer));

      const result = await ask(userId, model);

      expect(result).toEqual({ status: "capped" });
      expect(model.calls).toHaveLength(0);
      expect(await db.select().from(schema.moneyAiMappingUses)).toHaveLength(2);
    });

    it("counts a call whose answer is unusable, and says the model was asked", async () => {
      const userId = await newUser();
      const model = client(() => Promise.reject(new Error("HTTP 500")));

      const result = await ask(userId, model);

      expect(result).toEqual({ status: "unavailable" });
      expect(model.calls).toHaveLength(1);
      expect(await db.select().from(schema.moneyAiMappingUses)).toHaveLength(1);
    });

    it("costs nothing and says no call was attempted for a file with no rows", async () => {
      const userId = await newUser();
      const model = client(() => Promise.resolve(answer));
      const headerOnly = new TextEncoder().encode("Date;Amount;D/C");

      const result = await proposeMappingWithinLimit(db, userId, headerOnly, {
        client: model,
        dailyLimit: 2,
      });

      expect(result).toEqual({ status: "not-asked" });
      expect(model.calls).toHaveLength(0);
      expect(await db.select().from(schema.moneyAiMappingUses)).toHaveLength(0);
    });

    it("costs nothing and says no call was attempted when no model is configured", async () => {
      const userId = await newUser();

      expect(await ask(userId, null)).toEqual({ status: "not-asked" });
      expect(await db.select().from(schema.moneyAiMappingUses)).toHaveLength(0);
    });

    it("counts per user", async () => {
      const first = await newUser();
      const second = await newUser();
      await useUpTo(first, 2);
      const model = client(() => Promise.resolve(answer));

      expect(await ask(first, model)).toEqual({ status: "capped" });
      expect(await ask(second, model)).toMatchObject({ status: "proposed" });
    });
  });
});
