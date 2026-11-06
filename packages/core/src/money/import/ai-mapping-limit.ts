import { schema, type Db } from "@troba/db";
import { and, eq, gt, lt, sql } from "drizzle-orm";

// The daily cap on AI-suggested mappings (ADR-0015, T128): one account mustn't run up the owner's
// bill. A use is counted per user over the last 24 hours, so the count resets a day after each use
// rather than at midnight.

const { moneyAiMappingUses } = schema;

const windowStart = sql`now() - interval '24 hours'`;

// Call just before asking the model. Returns false when the user has already had `limit` mappings
// in the last day: don't ask. Otherwise the use is recorded and counts from now, whether or not the
// model's answer turns out to be usable, since the provider charges for the call either way.
//
// The user's claims are serialized with an advisory lock, so concurrent uploads can't all slip
// under the limit. The lock is released when the transaction ends.
export async function claimAiMappingUse(db: Db, userId: string, limit: number): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);
    await tx
      .delete(moneyAiMappingUses)
      .where(
        and(eq(moneyAiMappingUses.userId, userId), lt(moneyAiMappingUses.createdAt, windowStart)),
      );
    const [counted] = await tx
      .select({ uses: sql<number>`count(*)::int` })
      .from(moneyAiMappingUses)
      .where(
        and(eq(moneyAiMappingUses.userId, userId), gt(moneyAiMappingUses.createdAt, windowStart)),
      );
    if (counted!.uses >= limit) return false;
    await tx.insert(moneyAiMappingUses).values({ userId });
    return true;
  });
}
