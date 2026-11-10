import type { Db, DbTransaction } from "@troba/db";
import { and, eq, gt, lt, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";

// What the daily caps on AI calls share (AI mappings, ADR-0015; AI-suggested categories,
// ADR-0016): one account mustn't run up the owner's bill. Uses are logged per user and counted over
// the last 24 hours, so the allowance comes back a day after each use rather than at midnight. Each
// cap's numbers (its limit, and what one use counts for) stay its own.

export const aiUseWindowStart = sql`now() - interval '24 hours'`;

// The per-user advisory lock each cap's claims take, as the second key of hashtextextended. The
// mapping's is also the PDF import's, which counts against a log of its own.
export const aiCapLock = { mapping: 0, categorize: 1 } as const;

// A log of uses: one row per claim, with its user and when it was made.
type UseLog = PgTable & { userId: AnyPgColumn; createdAt: AnyPgColumn };

// Runs `claim` with how much the user has used within the window, in a transaction that holds the
// user's lock for this cap, so concurrent claims can't all slip under the limit; the lock is
// released when the transaction ends. Uses that aged out of the window are deleted first. `spent`
// is the SQL aggregate over the user's log rows (a count, or a sum of a column), as an int. `claim`
// records what it grants in `tx`.
export async function claimWithinDailyCap<T>(
  db: Db,
  options: { log: UseLog; userId: string; lock: number; spent: SQL<number> },
  claim: (tx: DbTransaction, used: number) => Promise<T>,
): Promise<T> {
  const { log, userId, lock, spent } = options;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, ${lock}))`);
    await tx.delete(log).where(and(eq(log.userId, userId), lt(log.createdAt, aiUseWindowStart)));
    const [counted] = await tx
      .select({ used: spent })
      .from(log)
      .where(and(eq(log.userId, userId), gt(log.createdAt, aiUseWindowStart)));
    return claim(tx, counted?.used ?? 0);
  });
}
