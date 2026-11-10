import { schema, type Db } from "@troba/db";
import { sql } from "drizzle-orm";
import { aiCapLock, claimWithinDailyCap } from "./ai-daily-cap";

// The daily cap on AI-suggested categories (ADR-0016, T138), the same shape as the cap on AI
// mappings (see ai-daily-cap.ts): it counts merchants, not requests. The limit is the caller's
// (AI_CATEGORIZE_DAILY_LIMIT in the web app).

const { moneyAiCategorizeUses } = schema;

// Call just before asking the model about `wanted` merchants. Returns how many of them may be sent:
// all of them while the allowance lasts, the part that fits when it doesn't, 0 once it is spent. The
// merchants granted are recorded and count from now, whether or not the model's answer turns out to
// be usable, since the provider charges for the call either way. A refusal records nothing.
//
// The user's claims are serialized, so concurrent runs can't all slip under the limit.
export async function claimAiCategorizeMerchants(
  db: Db,
  userId: string,
  wanted: number,
  limit: number,
): Promise<number> {
  return claimWithinDailyCap(
    db,
    {
      log: moneyAiCategorizeUses,
      userId,
      lock: aiCapLock.categorize,
      spent: sql<number>`coalesce(sum(${moneyAiCategorizeUses.merchants}), 0)::int`,
    },
    async (tx, used) => {
      const granted = Math.max(0, Math.min(wanted, limit - used));
      if (granted > 0)
        await tx.insert(moneyAiCategorizeUses).values({ userId, merchants: granted });
      return granted;
    },
  );
}
