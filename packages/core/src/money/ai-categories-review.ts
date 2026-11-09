import { schema, type Db, type DbTransaction } from "@troba/db";
import { and, eq, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";

// What the user does with a suggested category (SPEC-money M5, ADR-0016): accept it, dismiss it,
// or have the dismissed and unplaced merchants offered to the model again. A suggestion is
// per merchant: one decision covers every uncategorized row of it, with the merchant the engine
// groups by (the counterparty ignoring case, the description when there is none).

const { moneyTransactions, moneyCategories } = schema;

// The engine's merchant key, in SQL.
const merchantKey = sql`lower(coalesce(nullif(btrim(${moneyTransactions.counterparty}), ''), nullif(btrim(${moneyTransactions.description}), '')))`;

export type ReviewFailure =
  // No such row for this user. A row of someone else's reads the same.
  | { ok: false; reason: "not-found" }
  // The row has no suggestion any more: it was categorized, dismissed, or its category deleted.
  | { ok: false; reason: "no-suggestion" };

export type AcceptSuggestionResult =
  { ok: true; rows: number; categoryName: string } | ReviewFailure;

export type DismissSuggestionResult = { ok: true; rows: number } | ReviewFailure;

// The row's merchant and suggestion, read through the user filter; null for a row that isn't
// the user's.
async function readSuggestion(db: Db | DbTransaction, userId: string, transactionId: string) {
  const [row] = await db
    .select({
      key: sql<string | null>`${merchantKey}`,
      categoryId: moneyTransactions.categoryId,
      suggestedCategoryId: moneyTransactions.suggestedCategoryId,
    })
    .from(moneyTransactions)
    .where(and(eq(moneyTransactions.id, transactionId), eq(moneyTransactions.userId, userId)));
  return row ?? null;
}

// The user's uncategorized rows of one merchant.
function uncategorizedOf(userId: string, key: string): SQL | undefined {
  return and(
    eq(moneyTransactions.userId, userId),
    isNull(moneyTransactions.categoryId),
    sql`${merchantKey} = ${key}`,
  );
}

// Gives every uncategorized row of the row's merchant the suggested category, as the user's own
// choice (so a rule never overwrites it), and clears their suggestions. A category already set,
// by hand or otherwise, is never replaced. A row that no longer holds a suggestion, because it
// was categorized or its category deleted, changes nothing.
export async function acceptSuggestion(
  db: Db,
  userId: string,
  transactionId: string,
): Promise<AcceptSuggestionResult> {
  return db.transaction(async (tx) => {
    const row = await readSuggestion(tx, userId, transactionId);
    if (!row) return { ok: false, reason: "not-found" };
    if (row.categoryId !== null || row.suggestedCategoryId === null || row.key === null) {
      return { ok: false, reason: "no-suggestion" };
    }

    // Read again in the same statement as the update: a category deleted meanwhile is no change.
    const [category] = await tx
      .select({ id: moneyCategories.id, name: moneyCategories.name })
      .from(moneyCategories)
      .where(
        and(eq(moneyCategories.id, row.suggestedCategoryId), eq(moneyCategories.userId, userId)),
      )
      .for("share");
    if (!category) return { ok: false, reason: "no-suggestion" };

    const updated = await tx
      .update(moneyTransactions)
      .set({ categoryId: category.id, categorySource: "manual", suggestedCategoryId: null })
      .where(uncategorizedOf(userId, row.key))
      .returning({ id: moneyTransactions.id });
    return { ok: true, rows: updated.length, categoryName: category.name };
  });
}

// Drops the suggestion on every row of the row's merchant. The rows stay marked as asked, so no
// later run sends the merchant again, until "ask again".
export async function dismissSuggestion(
  db: Db,
  userId: string,
  transactionId: string,
): Promise<DismissSuggestionResult> {
  return db.transaction(async (tx) => {
    const row = await readSuggestion(tx, userId, transactionId);
    if (!row) return { ok: false, reason: "not-found" };
    if (row.categoryId !== null || row.suggestedCategoryId === null || row.key === null) {
      return { ok: false, reason: "no-suggestion" };
    }

    const updated = await tx
      .update(moneyTransactions)
      .set({ suggestedCategoryId: null })
      .where(
        and(uncategorizedOf(userId, row.key), isNotNull(moneyTransactions.suggestedCategoryId)),
      )
      .returning({ id: moneyTransactions.id });
    return { ok: true, rows: updated.length };
  });
}

// Marks the user's uncategorized rows that were asked about and carry no suggestion (a dismissed
// merchant, or one the model couldn't place) as not asked, so the next run offers them to the
// model again, for example after the user adds categories. Rows with a pending suggestion keep
// it. Returns the number of rows reopened.
export async function resetSuggestionAsks(db: Db, userId: string): Promise<number> {
  const reopened = await db
    .update(moneyTransactions)
    .set({ suggestionAskedAt: null })
    .where(
      and(
        eq(moneyTransactions.userId, userId),
        isNull(moneyTransactions.categoryId),
        isNull(moneyTransactions.suggestedCategoryId),
        isNotNull(moneyTransactions.suggestionAskedAt),
      ),
    )
    .returning({ id: moneyTransactions.id });
  return reopened.length;
}

export type PendingSuggestions = { rows: number; merchants: number };

// How many rows carry a suggestion the user hasn't decided on, and how many merchants they
// belong to: the number the "Accept all" strip names before it asks for confirmation. One
// aggregate over the user's rows, never the rows themselves, so a large history stays cheap.
export async function countPendingSuggestions(db: Db, userId: string): Promise<PendingSuggestions> {
  const [counts] = await db
    .select({
      rows: sql<number>`count(*)::int`,
      merchants: sql<number>`count(distinct ${merchantKey})::int`,
    })
    .from(moneyTransactions)
    .where(pendingSuggestionOf(userId));
  return { rows: counts?.rows ?? 0, merchants: counts?.merchants ?? 0 };
}

// The user's uncategorized rows that still carry a suggestion.
function pendingSuggestionOf(userId: string): SQL | undefined {
  return and(
    eq(moneyTransactions.userId, userId),
    isNull(moneyTransactions.categoryId),
    isNotNull(moneyTransactions.suggestedCategoryId),
  );
}

// Rows per statement: big enough that 10,000 rows take a handful of round trips, small enough
// that none holds locks on a whole history.
const acceptPageSize = 1000;

// A category deleted between choosing a page and applying it fails the foreign key check once;
// the delete has cleared those suggestions by then, so the next attempt skips them.
const foreignKeyViolation = "23503";
const attemptsPerPage = 3;

function isForeignKeyViolation(error: unknown): boolean {
  for (let e = error; typeof e === "object" && e !== null; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: unknown }).code === foreignKeyViolation) return true;
  }
  return false;
}

// Gives every row that still carries a suggestion that suggestion's category, as the user's own
// choice, a page at a time. Each statement re-checks that the row is still uncategorized and
// still suggested, so a row the user categorized meanwhile (or whose category was deleted) is
// skipped rather than failed or overwritten. Only the user's own rows are ever selected.
export async function acceptAllSuggestions(db: Db, userId: string): Promise<PendingSuggestions> {
  const merchants = new Set<string>();
  let rows = 0;

  for (;;) {
    // The page's ids are read first and the update goes by id: a subquery in the update's where
    // clause can plan as a nested loop over the whole history when the table's statistics are
    // stale, as they are right after a big import.
    const page = await db
      .select({ id: moneyTransactions.id })
      .from(moneyTransactions)
      .where(pendingSuggestionOf(userId))
      .limit(acceptPageSize);
    if (page.length === 0) break;

    let accepted: { key: string | null }[] | undefined;
    for (let attempt = 1; accepted === undefined; attempt++) {
      try {
        accepted = await db
          .update(moneyTransactions)
          .set({
            categoryId: sql`${moneyTransactions.suggestedCategoryId}`,
            categorySource: "manual",
            suggestedCategoryId: null,
          })
          .where(
            and(
              pendingSuggestionOf(userId),
              inArray(
                moneyTransactions.id,
                page.map((row) => row.id),
              ),
            ),
          )
          .returning({ key: sql<string | null>`${merchantKey}` });
      } catch (error) {
        if (!isForeignKeyViolation(error) || attempt >= attemptsPerPage) throw error;
      }
    }

    rows += accepted.length;
    for (const { key } of accepted) if (key !== null) merchants.add(key);
  }

  return { rows, merchants: merchants.size };
}
