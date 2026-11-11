import { schema, type Db } from "@troba/db";
import { and, asc, eq, gt, inArray, notExists, sql } from "drizzle-orm";
import { aiCapLock, aiUseWindowStart, claimWithinDailyCap } from "../ai-daily-cap";

// The daily cap on PDF imports (T154, ADR-0018): reading a whole statement is the dearest model
// call troba makes, so one account mustn't run up the owner's bill. A use is counted per user over
// the last 24 hours, apart from the mapping and categorization caps, so the count resets a day
// after each use rather than at midnight.

const { moneyAiPdfImportUses, moneyPdfImports } = schema;

export const defaultPdfImportDailyLimit = 10;

// AI_PDF_IMPORT_DAILY_LIMIT, read by the worker; anything but a whole number from 1 up is ignored.
// apps/web/src/server/env.ts reads it the same way and stays free of core.
export function pdfImportDailyLimitFrom(env: Record<string, string | undefined>): number {
  const limit = Number(env.AI_PDF_IMPORT_DAILY_LIMIT?.trim());
  return Number.isSafeInteger(limit) && limit >= 1 ? limit : defaultPdfImportDailyLimit;
}

const day = 24 * 60 * 60 * 1000;

// Call just before the model reads the PDF import. Returns false when the user has already had
// `limit` readings in the last day: don't send it. Otherwise the use is recorded and counts from
// now, whether or not the answer turns out to be usable, since the provider charges for the call
// either way. A PDF import that already has its use (the job was retried) is let through again
// without another.
//
// Serialized per user with the advisory lock the mapping cap takes (see ai-daily-cap.ts), so
// concurrent readings can't all slip under the limit.
export async function claimPdfImportUse(
  db: Db,
  userId: string,
  pdfImportId: string,
  limit: number,
): Promise<boolean> {
  return claimWithinDailyCap(
    db,
    {
      log: moneyAiPdfImportUses,
      userId,
      lock: aiCapLock.mapping,
      spent: sql<number>`count(*)::int`,
    },
    async (tx, used) => {
      const [claimed] = await tx
        .select({ id: moneyAiPdfImportUses.id })
        .from(moneyAiPdfImportUses)
        .where(
          and(
            eq(moneyAiPdfImportUses.userId, userId),
            eq(moneyAiPdfImportUses.pdfImportId, pdfImportId),
          ),
        );
      if (claimed) return true;
      if (used >= limit) return false;
      await tx.insert(moneyAiPdfImportUses).values({ userId, pdfImportId });
      return true;
    },
  );
}

// Whether the user may start another PDF import: `left` is how many more fit today. At the limit,
// `nextAt` is when a place frees up. PDF imports still waiting to be read count too, since each
// will take a use; one stuck for over a day doesn't. The claim above stays the real guard.
export type PdfImportAllowance =
  { ok: true; left: number } | { ok: false; limit: number; nextAt: Date };

export async function pdfImportAllowance(
  db: Db,
  userId: string,
  limit: number,
): Promise<PdfImportAllowance> {
  const uses = await db
    .select({ createdAt: moneyAiPdfImportUses.createdAt })
    .from(moneyAiPdfImportUses)
    .where(
      and(
        eq(moneyAiPdfImportUses.userId, userId),
        gt(moneyAiPdfImportUses.createdAt, aiUseWindowStart),
      ),
    )
    .orderBy(asc(moneyAiPdfImportUses.createdAt));
  const [pending] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(moneyPdfImports)
    .where(
      and(
        eq(moneyPdfImports.userId, userId),
        inArray(moneyPdfImports.state, ["queued", "reading"]),
        gt(moneyPdfImports.createdAt, aiUseWindowStart),
        notExists(
          db
            .select({ id: moneyAiPdfImportUses.id })
            .from(moneyAiPdfImportUses)
            .where(
              and(
                eq(moneyAiPdfImportUses.userId, userId),
                eq(moneyAiPdfImportUses.pdfImportId, moneyPdfImports.id),
              ),
            ),
        ),
      ),
    );

  const taken = uses.length + pending!.count;
  if (taken < limit) return { ok: true, left: limit - taken };
  // The use whose expiry brings the count under the limit. When waiting PDF imports hold the
  // places, they take their uses about now.
  const freeing = uses[taken - limit];
  const nextAt = new Date((freeing?.createdAt.getTime() ?? Date.now()) + day);
  return { ok: false, limit, nextAt };
}
