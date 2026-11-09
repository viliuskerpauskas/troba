import { schema, type Db } from "@troba/db";
import { and, eq, gt, lt, sql } from "drizzle-orm";

// The daily cap on AI-suggested categories (ADR-0016, T138), the same shape as the cap on AI
// mappings: one account mustn't run up the owner's bill. It counts merchants, not requests, per
// user over the last 24 hours, so the allowance comes back a day after each use rather than at
// midnight.

const { moneyAiCategorizeUses } = schema;

export const defaultAiCategorizeDailyLimit = 200;

const windowStart = sql`now() - interval '24 hours'`;

// Call just before asking the model about `wanted` merchants. Returns how many of them may be sent:
// all of them while the allowance lasts, the part that fits when it doesn't, 0 once it is spent. The
// merchants granted are recorded and count from now, whether or not the model's answer turns out to
// be usable, since the provider charges for the call either way. A refusal records nothing.
//
// The user's claims are serialized with an advisory lock, so concurrent runs can't all slip under
// the limit. The lock is released when the transaction ends.
export async function claimAiCategorizeMerchants(
  db: Db,
  userId: string,
  wanted: number,
  limit: number,
): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 1))`);
    await tx
      .delete(moneyAiCategorizeUses)
      .where(
        and(
          eq(moneyAiCategorizeUses.userId, userId),
          lt(moneyAiCategorizeUses.createdAt, windowStart),
        ),
      );
    const [counted] = await tx
      .select({ merchants: sql<number>`coalesce(sum(${moneyAiCategorizeUses.merchants}), 0)::int` })
      .from(moneyAiCategorizeUses)
      .where(
        and(
          eq(moneyAiCategorizeUses.userId, userId),
          gt(moneyAiCategorizeUses.createdAt, windowStart),
        ),
      );
    const granted = Math.max(0, Math.min(wanted, limit - counted!.merchants));
    if (granted > 0) await tx.insert(moneyAiCategorizeUses).values({ userId, merchants: granted });
    return granted;
  });
}
