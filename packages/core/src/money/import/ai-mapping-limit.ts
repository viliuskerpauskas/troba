import { schema, type Db } from "@troba/db";
import { sql } from "drizzle-orm";
import { aiCapLock, claimWithinDailyCap } from "../ai-daily-cap";
import {
  proposeMapping,
  type MappingModelClient,
  type ProposedMapping,
  type ProposeMappingOptions,
} from "./ai-mapping";

// The daily cap on AI-suggested mappings (ADR-0015, T128), counted in requests over a rolling 24
// hours like the other AI caps (see ai-daily-cap.ts).

const { moneyAiMappingUses } = schema;

// Call just before asking the model. Returns false when the user has already had `limit` mappings
// in the last day: don't ask. Otherwise the use is recorded and counts from now, whether or not the
// model's answer turns out to be usable, since the provider charges for the call either way.
//
// The user's claims are serialized, so concurrent uploads can't all slip under the limit.
export async function claimAiMappingUse(db: Db, userId: string, limit: number): Promise<boolean> {
  return claimWithinDailyCap(
    db,
    {
      log: moneyAiMappingUses,
      userId,
      lock: aiCapLock.mapping,
      spent: sql<number>`count(*)::int`,
    },
    async (tx, used) => {
      if (used >= limit) return false;
      await tx.insert(moneyAiMappingUses).values({ userId });
      return true;
    },
  );
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
