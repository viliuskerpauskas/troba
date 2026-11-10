import { createDb, schema, type Db } from "@troba/db";
import { createTestDatabase } from "@troba/db/test-database";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { claimAiCategorizeMerchants } from "../ai-categories-limit";
import { claimAiMappingUse } from "./ai-mapping-limit";
import { claimPdfImportUse, pdfImportAllowance } from "./pdf-import-limit";

// The daily cap on PDF imports (T154): its claim, under the per-user lock the mapping cap takes,
// and the allowance startPdfImport checks before anything is queued.

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Db;
let userCount = 0;

async function newUser(): Promise<string> {
  const [user] = await db
    .insert(schema.users)
    .values({ name: "Example User", email: `pdflimit${++userCount}@example.test` })
    .returning({ id: schema.users.id });
  return user!.id;
}

async function ageUses(userId: string, hours: number) {
  await db.execute(
    sql`update money_ai_pdf_import_uses set created_at = created_at - make_interval(hours => ${hours}) where user_id = ${userId}`,
  );
}

async function useUpTo(userId: string, limit: number) {
  for (let i = 0; i < limit; i++) {
    expect(await claimPdfImportUse(db, userId, crypto.randomUUID(), limit)).toBe(true);
  }
}

async function usesOf(userId: string) {
  const rows = await db.select().from(schema.moneyAiPdfImportUses);
  return rows.filter((row) => row.userId === userId);
}

// A PDF import waiting for the worker, which will claim a use when it is read.
async function pendingPdfImport(userId: string, state: "queued" | "reading" = "queued") {
  const [created] = await db
    .insert(schema.moneyPdfImports)
    .values({
      userId,
      filename: "statement.pdf",
      bytes: new TextEncoder().encode("%PDF-1.7"),
      state,
    })
    .returning({ id: schema.moneyPdfImports.id });
  return created!.id;
}

describe("daily cap on PDF imports", () => {
  beforeAll(async () => {
    database = await createTestDatabase();
    db = createDb(database.url);
  });
  afterAll(async () => {
    await db?.$client.end();
    await database?.drop();
  });
  beforeEach(async () => {
    await db.delete(schema.moneyAiPdfImportUses);
  });

  describe("claimPdfImportUse", () => {
    it("lets the daily number of readings through and refuses the next, recording nothing", async () => {
      const userId = await newUser();
      await useUpTo(userId, 3);

      expect(await claimPdfImportUse(db, userId, crypto.randomUUID(), 3)).toBe(false);
      expect(await usesOf(userId)).toHaveLength(3);
    });

    it("lets a retried reading of the same PDF import through without another use", async () => {
      const userId = await newUser();
      const pdfImportId = crypto.randomUUID();
      expect(await claimPdfImportUse(db, userId, pdfImportId, 1)).toBe(true);

      expect(await claimPdfImportUse(db, userId, pdfImportId, 1)).toBe(true);
      expect(await usesOf(userId)).toHaveLength(1);
    });

    it("lets one user hit the limit without affecting another", async () => {
      const first = await newUser();
      const second = await newUser();
      await useUpTo(first, 2);

      expect(await claimPdfImportUse(db, first, crypto.randomUUID(), 2)).toBe(false);
      expect(await claimPdfImportUse(db, second, crypto.randomUUID(), 2)).toBe(true);
    });

    it("resets after a day and forgets the user's uses that are over a day old", async () => {
      const userId = await newUser();
      await useUpTo(userId, 2);
      await ageUses(userId, 23);
      expect(await claimPdfImportUse(db, userId, crypto.randomUUID(), 2)).toBe(false);

      await ageUses(userId, 2);
      expect(await claimPdfImportUse(db, userId, crypto.randomUUID(), 2)).toBe(true);
      expect(await usesOf(userId)).toHaveLength(1);
    });

    it("lets only the limit through when claims arrive at once", async () => {
      const userId = await newUser();

      const results = await Promise.all(
        Array.from({ length: 8 }, () => claimPdfImportUse(db, userId, crypto.randomUUID(), 3)),
      );

      expect(results.filter(Boolean)).toHaveLength(3);
      expect(await usesOf(userId)).toHaveLength(3);
    });

    it("is counted apart from the mapping and categorization caps", async () => {
      const userId = await newUser();
      await useUpTo(userId, 1);
      expect(await claimAiMappingUse(db, userId, 1)).toBe(true);
      expect(await claimAiCategorizeMerchants(db, userId, 5, 5)).toBe(5);

      expect(await claimPdfImportUse(db, userId, crypto.randomUUID(), 1)).toBe(false);
      const other = await newUser();
      expect(await claimAiMappingUse(db, other, 1)).toBe(true);
      expect(await claimAiCategorizeMerchants(db, other, 5, 5)).toBe(5);
      expect(await claimPdfImportUse(db, other, crypto.randomUUID(), 1)).toBe(true);
    });
  });

  describe("pdfImportAllowance", () => {
    it("allows a PDF import while the day's uses are under the limit", async () => {
      const userId = await newUser();
      await useUpTo(userId, 2);

      expect(await pdfImportAllowance(db, userId, 3)).toEqual({ ok: true, left: 1 });
    });

    it("refuses at the limit, saying when the oldest use frees a place", async () => {
      const userId = await newUser();
      await useUpTo(userId, 2);
      await ageUses(userId, 1);
      await db.execute(
        sql`update money_ai_pdf_import_uses set created_at = created_at - interval '3 hours'
             where id = (select id from money_ai_pdf_import_uses where user_id = ${userId} limit 1)`,
      );
      const [oldest] = await db
        .execute<{ at: Date }>(
          sql`select min(created_at) as at from money_ai_pdf_import_uses where user_id = ${userId}`,
        )
        .then((result) => result.rows);

      const allowance = await pdfImportAllowance(db, userId, 2);

      expect(allowance).toEqual({
        ok: false,
        limit: 2,
        nextAt: new Date(new Date(oldest!.at).getTime() + 24 * 60 * 60 * 1000),
      });
    });

    it("counts PDF imports still waiting to be read, which will each take a use", async () => {
      const userId = await newUser();
      await useUpTo(userId, 1);
      await pendingPdfImport(userId, "queued");

      expect(await pdfImportAllowance(db, userId, 3)).toEqual({ ok: true, left: 1 });
      await pendingPdfImport(userId, "reading");
      expect(await pdfImportAllowance(db, userId, 3)).toMatchObject({ ok: false, limit: 3 });
    });

    it("doesn't count a PDF import being read twice once it has its use", async () => {
      const userId = await newUser();
      const pdfImportId = await pendingPdfImport(userId, "reading");
      expect(await claimPdfImportUse(db, userId, pdfImportId, 3)).toBe(true);

      expect(await pdfImportAllowance(db, userId, 3)).toEqual({ ok: true, left: 2 });
    });

    it("doesn't count another user's uses or PDF imports", async () => {
      const userId = await newUser();
      const other = await newUser();
      await useUpTo(other, 2);
      await pendingPdfImport(other);

      expect(await pdfImportAllowance(db, userId, 2)).toEqual({ ok: true, left: 2 });
    });
  });
});
