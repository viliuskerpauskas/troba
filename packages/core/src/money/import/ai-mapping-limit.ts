import { schema, type Db } from "@troba/db";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import {
  proposeMapping,
  type MappingModelClient,
  type ProposedMapping,
  type ProposeMappingOptions,
} from "./ai-mapping";

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

// How an AI suggestion went, for the caller to tell the user:
//   proposed    the model answered with a mapping that reads the file;
//   unavailable the model was called (and counted) but nothing usable came back;
//   capped      the user's daily cap was reached, so the model was not called;
//   not-asked   no model call was attempted (none configured, or nothing readable to send).
export type LimitedMapping =
  | { status: "proposed"; proposal: ProposedMapping }
  | { status: "unavailable" }
  | { status: "capped" }
  | { status: "not-asked" };

// proposeMapping under the user's daily cap. The use is claimed just before the model is called, so
// a file that never reaches the model (unreadable, no rows, no model configured) costs nothing, and
// once the cap is reached the client is not invoked at all.
export async function proposeMappingWithinLimit(
  db: Db,
  userId: string,
  bytes: Uint8Array,
  options: ProposeMappingOptions & { dailyLimit: number },
): Promise<LimitedMapping> {
  const { client, dailyLimit, ...rest } = options;
  if (client === null) return { status: "not-asked" };

  let capped = false;
  let asked = false;
  const limited: MappingModelClient = {
    async suggestMapping(request) {
      if (!(await claimAiMappingUse(db, userId, dailyLimit))) {
        capped = true;
        throw new Error("The daily limit on AI mappings is reached.");
      }
      asked = true;
      return client.suggestMapping(request);
    },
  };

  const proposal = await proposeMapping(bytes, { ...rest, client: limited });
  if (capped) return { status: "capped" };
  if (proposal) return { status: "proposed", proposal };
  return asked ? { status: "unavailable" } : { status: "not-asked" };
}
