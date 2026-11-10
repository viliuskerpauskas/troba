import { randomUUID } from "node:crypto";
import { schema, type Db } from "@troba/db";
import { and, eq, sql } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { listAccounts } from "./accounts";
import type { CategorizationModelClient, CategorizationRequest } from "./ai-categories";
import { listCategories } from "./categories";
import { ensureMoneyDefaults } from "./defaults";

// Test helpers shared by the AI categorization and AI cap integration tests, in core and in the
// web app (as @troba/core/test-ai-categories). Fictional data only. Not exported from the package
// index: nothing outside tests uses them.

// The web app's default daily cap (AI_CATEGORIZE_DAILY_LIMIT unset), for tests about something
// else; a test of the cap passes its own.
export const testAiCategorizeDailyLimit = 200;

// A user with nothing else.
export async function insertUser(db: Db, name = "Example User"): Promise<string> {
  const [user] = await db
    .insert(schema.users)
    .values({ name, email: `${randomUUID()}@example.test` })
    .returning({ id: schema.users.id });
  return user!.id;
}

export type MoneyUser = Awaited<ReturnType<typeof createMoneyUser>>;

// A user with the money defaults: their cash account, and their categories by name. The name is
// the one the masking has to keep out of requests.
export async function createMoneyUser(db: Db, name = "Jordan Quinn") {
  const userId = await insertUser(db, name);
  await ensureMoneyDefaults(db, userId);
  const [cash] = await listAccounts(db, userId);
  const categories = await listCategories(db, userId);
  const category = (categoryName: string) => categories.find((c) => c.name === categoryName)!.id;
  return { userId, cashId: cash!.id, category };
}

type NewTransaction = typeof schema.moneyTransactions.$inferInsert;

// Rows straight into the table, as an import leaves them: a card payment of 12.50 EUR into the
// user's cash account unless a row says otherwise. Returns the new rows' ids, in order.
export async function insertImportedRows(
  db: Db,
  user: { userId: string; cashId: string },
  rows: Partial<NewTransaction>[],
): Promise<string[]> {
  const inserted = await db
    .insert(schema.moneyTransactions)
    .values(
      rows.map((row) => ({
        userId: user.userId,
        accountId: user.cashId,
        bookedOn: "2026-10-05",
        amountCents: -1250n,
        currency: "EUR",
        source: "csv_import" as const,
        dedupKey: randomUUID(),
        ...row,
      })),
    )
    .returning({ id: schema.moneyTransactions.id });
  return inserted.map((row) => row.id);
}

// One of the user's rows, read through the user filter.
export async function readTransaction(db: Db, userId: string, id: string) {
  const [row] = await db
    .select()
    .from(schema.moneyTransactions)
    .where(and(eq(schema.moneyTransactions.id, id), eq(schema.moneyTransactions.userId, userId)));
  return row!;
}

// A model client that records every request and answers it with `answer`; an Error is thrown.
export function recordingModel(answer: ((request: CategorizationRequest) => unknown) | Error) {
  const requests: CategorizationRequest[] = [];
  const client: CategorizationModelClient = {
    async suggestCategories(request) {
      requests.push(request);
      if (answer instanceof Error) throw answer;
      return answer(request);
    },
  };
  return { client, requests };
}

// Moves the user's logged AI uses `hours` into the past.
export async function ageAiUses(
  db: Db,
  log: PgTable & { userId: AnyPgColumn; createdAt: AnyPgColumn },
  userId: string,
  hours: number,
): Promise<void> {
  await db.execute(
    sql`update ${log} set created_at = created_at - make_interval(hours => ${hours}) where ${log.userId} = ${userId}`,
  );
}
