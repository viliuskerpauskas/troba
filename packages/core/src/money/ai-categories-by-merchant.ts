import { schema, type Db } from "@troba/db";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { merchantKey } from "./merchant-key";

// The pending suggestions grouped by merchant (SPEC-money M5 story 8, ADR-0016): one entry per
// merchant, for a review that decides a merchant at a time. A group is exactly what one decision
// on a row covers: the user's uncategorized rows of the merchant (merchantKey), so its count and
// total are what accepting it changes.

const { moneyTransactions, moneyCategories } = schema;

export type SuggestionGroup = {
  // A row of the merchant that holds the suggestion shown: accepting or dismissing the group is
  // accepting or dismissing this row, which covers every uncategorized row of the merchant.
  transactionId: string;
  // How that row reads, to name the merchant.
  counterparty: string | null;
  description: string | null;
  suggestedCategoryId: string;
  suggestedCategoryName: string;
  // The merchant's uncategorized rows, with and without a suggestion of their own.
  rows: number;
  // Their sum in each currency, in minor units, by currency code.
  totals: { currency: string; amountCents: bigint }[];
};

export const suggestionGroupLimit = 100;

// The user's merchants with a pending suggestion, those with the most rows first. Two statements:
// the groups, then the totals of the groups listed, by currency. Only the user's rows are read.
export async function listSuggestionsByMerchant(
  db: Db,
  userId: string,
  options: { limit?: number } = {},
): Promise<SuggestionGroup[]> {
  const t = moneyTransactions;
  const uncategorized = and(eq(t.userId, userId), isNull(t.categoryId), isNotNull(merchantKey()));
  // The merchant's newest row with a suggestion: the one the group's decision goes through.
  const ofNewestSuggested = (column: AnyPgColumn) =>
    sql`(array_agg(${column} order by ${t.bookedOn} desc, ${t.createdAt} desc, ${t.id} desc) filter (where ${t.suggestedCategoryId} is not null))[1]`;

  const groups = db
    .select({
      key: sql<string>`${merchantKey()}`.as("key"),
      rows: sql<number>`count(*)::int`.as("rows"),
      transactionId: sql<string>`${ofNewestSuggested(t.id)}`.as("transaction_id"),
      suggestedCategoryId: sql<string>`${ofNewestSuggested(t.suggestedCategoryId)}`.as(
        "suggested_category_id",
      ),
      counterparty: sql<string | null>`${ofNewestSuggested(t.counterparty)}`.as("counterparty"),
      description: sql<string | null>`${ofNewestSuggested(t.description)}`.as("description"),
    })
    .from(t)
    .where(uncategorized)
    .groupBy(merchantKey())
    .having(sql`count(${t.suggestedCategoryId}) > 0`)
    .as("groups");

  const listed = await db
    .select({
      key: groups.key,
      transactionId: groups.transactionId,
      counterparty: groups.counterparty,
      description: groups.description,
      suggestedCategoryId: groups.suggestedCategoryId,
      suggestedCategoryName: moneyCategories.name,
      rows: groups.rows,
    })
    .from(groups)
    .innerJoin(
      moneyCategories,
      and(eq(moneyCategories.id, groups.suggestedCategoryId), eq(moneyCategories.userId, userId)),
    )
    .orderBy(desc(groups.rows), asc(groups.key))
    .limit(options.limit ?? suggestionGroupLimit);
  if (listed.length === 0) return [];

  const totals = await db
    .select({
      key: sql<string>`${merchantKey()}`,
      currency: t.currency,
      amountCents: sql<string>`sum(${t.amountCents})`.mapWith(BigInt),
    })
    .from(t)
    .where(
      and(
        uncategorized,
        inArray(
          merchantKey(),
          listed.map((group) => group.key),
        ),
      ),
    )
    .groupBy(merchantKey(), t.currency)
    .orderBy(t.currency);

  return listed.map(({ key, ...group }) => ({
    ...group,
    totals: totals
      .filter((total) => total.key === key)
      .map(({ currency, amountCents }) => ({ currency, amountCents })),
  }));
}
