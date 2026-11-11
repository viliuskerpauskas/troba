import { schema, type Db } from "@troba/db";
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { queueJob, type JobQueue } from "../jobs/queue";
import {
  suggestCategories,
  type CategorizationModelClient,
  type SuggestCategoriesResult,
} from "./ai-categories";
import { aiCategorizationEnabledFor } from "./ai-categorization-setting";

// AI-suggested categories, run by the worker (SPEC-money M5, ADR-0020). The web app starts a run,
// which queues a suggest-categories job, and reads back how it went; the job asks the model through
// suggestCategories, which keeps the opt-out, the daily cap and the masking. No request waits on
// the model. A run row holds counts only, never merchant text.

const { moneyAiCategorizeRuns, moneyImports, users } = schema;

// How long a run may stay unfinished before it is given up on as failed: longer than its job can
// take with its one retry (see queueOptions in jobs/queue.ts), so only a run whose worker died
// with it, or that was never picked up, gets there. Its job, if it ever runs, does nothing.
export const categorySuggestionRunStaleMs = 15 * 60 * 1000;
const staleBefore = sql`now() - make_interval(secs => ${categorySuggestionRunStaleMs / 1000})`;

// A finished or given-up run is kept this long for the page to read back, then deleted as the user
// starts another.
const keepRunsFor = sql`now() - interval '24 hours'`;

const unfinished = and(
  isNull(moneyAiCategorizeRuns.finishedAt),
  gt(moneyAiCategorizeRuns.createdAt, staleBefore),
);

const failedResult: SuggestCategoriesResult = {
  merchantsAsked: 0,
  rowsSuggested: 0,
  failed: true,
  capped: false,
};

export type StartCategorySuggestionsOptions = {
  queue: JobQueue;
  // The import just saved: the run asks about its rows only, and an import gets one run. Absent:
  // all of the user's candidate rows (the button).
  importId?: string;
};

// ok: false when the user turned suggestions off: nothing is created or queued.
export type StartCategorySuggestionsResult = { ok: true; runId: string } | { ok: false };

// Creates a run for the user and queues its job, in one transaction, so the job exists only with its
// run. A button run under way is returned instead of a second one, as is an import's run. The
// user's runs older than a day are deleted first.
export async function startCategorySuggestions(
  db: Db,
  userId: string,
  { queue, importId }: StartCategorySuggestionsOptions,
): Promise<StartCategorySuggestionsResult> {
  if (!(await aiCategorizationEnabledFor(db, userId))) return { ok: false };
  return db.transaction(async (tx) => {
    // The user's starts take turns, so two clicks can't both find no run under way.
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
    await tx
      .delete(moneyAiCategorizeRuns)
      .where(
        and(
          eq(moneyAiCategorizeRuns.userId, userId),
          lt(moneyAiCategorizeRuns.createdAt, keepRunsFor),
        ),
      );
    if (importId) {
      // The foreign key doesn't check whose import it is.
      const [own] = await tx
        .select({ id: moneyImports.id })
        .from(moneyImports)
        .where(and(eq(moneyImports.id, importId), eq(moneyImports.userId, userId)));
      if (!own) throw new Error("not the user's import");
    } else {
      const [running] = await tx
        .select({ id: moneyAiCategorizeRuns.id })
        .from(moneyAiCategorizeRuns)
        .where(
          and(
            eq(moneyAiCategorizeRuns.userId, userId),
            isNull(moneyAiCategorizeRuns.importId),
            unfinished,
          ),
        );
      if (running) return { ok: true as const, runId: running.id };
    }
    const [run] = await tx
      .insert(moneyAiCategorizeRuns)
      .values({ userId, importId })
      .onConflictDoNothing({ target: moneyAiCategorizeRuns.importId })
      .returning({ id: moneyAiCategorizeRuns.id });
    if (!run) {
      // The import has its run already, queued when it was first asked for.
      const [existing] = await tx
        .select({ id: moneyAiCategorizeRuns.id })
        .from(moneyAiCategorizeRuns)
        .where(
          and(
            eq(moneyAiCategorizeRuns.userId, userId),
            eq(moneyAiCategorizeRuns.importId, importId!),
          ),
        );
      return { ok: true as const, runId: existing!.id };
    }
    const runId = run.id;
    await queueJob(queue, "suggest-categories", { userId, runId }, { tx });
    return { ok: true as const, runId };
  });
}

export type RunCategorySuggestionsOptions = {
  // Null when the worker has no OpenAI key.
  client: CategorizationModelClient | null;
  dailyLimit: number;
  timeoutMs?: number;
};

// The job: asks the model about the run's rows and records how it went. Only a run of this user's
// that hasn't finished is run, so a repeated job (pg-boss retries one after a crash) or one queued
// for another user does nothing. A run retried part way picks up where it stopped: the rows already
// answered aren't candidates any more, and the merchants already claimed stay counted.
export async function runCategorySuggestions(
  db: Db,
  userId: string,
  runId: string,
  { client, dailyLimit, timeoutMs }: RunCategorySuggestionsOptions,
): Promise<void> {
  const [run] = await db
    .select({ importId: moneyAiCategorizeRuns.importId })
    .from(moneyAiCategorizeRuns)
    .where(
      and(
        eq(moneyAiCategorizeRuns.id, runId),
        eq(moneyAiCategorizeRuns.userId, userId),
        unfinished,
      ),
    );
  if (!run) return;
  // Without a key the worker can't ask: the run fails, as a model that doesn't answer would, and
  // nothing is read or claimed.
  const result: SuggestCategoriesResult = client
    ? await suggestCategories(db, userId, {
        client,
        dailyLimit,
        timeoutMs,
        ...(run.importId && { importId: run.importId }),
      })
    : failedResult;
  await db
    .update(moneyAiCategorizeRuns)
    .set({ finishedAt: new Date(), ...result })
    .where(
      and(
        eq(moneyAiCategorizeRuns.id, runId),
        eq(moneyAiCategorizeRuns.userId, userId),
        isNull(moneyAiCategorizeRuns.finishedAt),
      ),
    );
}

export type CategorySuggestionRun =
  { finished: false } | { finished: true; result: SuggestCategoriesResult };

// Where one of the user's runs stands, or null when it isn't theirs or is gone.
export async function getCategorySuggestionRun(
  db: Db,
  userId: string,
  runId: string,
): Promise<CategorySuggestionRun | null> {
  const [run] = await db
    .select({
      finishedAt: moneyAiCategorizeRuns.finishedAt,
      stale: sql<boolean>`${moneyAiCategorizeRuns.createdAt} <= ${staleBefore}`,
      merchantsAsked: moneyAiCategorizeRuns.merchantsAsked,
      rowsSuggested: moneyAiCategorizeRuns.rowsSuggested,
      failed: moneyAiCategorizeRuns.failed,
      capped: moneyAiCategorizeRuns.capped,
    })
    .from(moneyAiCategorizeRuns)
    .where(and(eq(moneyAiCategorizeRuns.id, runId), eq(moneyAiCategorizeRuns.userId, userId)));
  if (!run) return null;
  if (!run.finishedAt)
    return run.stale ? { finished: true, result: failedResult } : { finished: false };
  const { merchantsAsked, rowsSuggested, failed, capped } = run;
  return { finished: true, result: { merchantsAsked, rowsSuggested, failed, capped } };
}

// The user's latest run still under way, button or import, for the transactions list to follow
// when it loads; null when there is none.
export async function activeCategorySuggestionRun(db: Db, userId: string): Promise<string | null> {
  const [run] = await db
    .select({ id: moneyAiCategorizeRuns.id })
    .from(moneyAiCategorizeRuns)
    .where(and(eq(moneyAiCategorizeRuns.userId, userId), unfinished))
    .orderBy(desc(moneyAiCategorizeRuns.createdAt))
    .limit(1);
  return run?.id ?? null;
}
