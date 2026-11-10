import type { Db } from "@troba/db";
import { suggestCategories, type CategorizationModelClient } from "./ai-categories";
import { aiCategorizationEnabledFor } from "./ai-categorization-setting";

// The suggestions that follow an import (SPEC-money M5, ADR-0016). Called after commitImport has
// committed, never inside its transaction: whatever happens here, the import is as it was saved.
// Nothing here logs, and nothing may: the merchant text and the answer are a user's data.

// How the run went, for the one-line note on the import result.
//   off          the server has no key or the user opted out: say nothing, nothing was sent
//   nothing      no row of the import needed the model (matched by a rule, transfers, all seen)
//   suggested    `rows` rows now carry a suggestion (it may be fewer than the model was asked about)
//   none         the model was asked and had no suggestion for any merchant
//   unavailable  the model failed, timed out or answered unusably; `rows` came in before it did
//   capped       the user's daily cap stopped the run; `rows` came in before it did
//   pending      the run is still going after the wait; it carries on and the rows show up on the
//                transactions list when it is done
export type AfterImportSuggestions =
  | { status: "off" | "nothing" | "none" | "pending" }
  | { status: "suggested"; rows: number }
  | { status: "unavailable" }
  | { status: "capped"; rows: number };

// How long an import's response waits for the model. A model call is seconds when it is healthy
// and up to its timeout when it is not; the import must not take that long to answer.
export const defaultAfterImportWaitMs = 8_000;

export type SuggestAfterImportOptions = {
  // Null when the server has no key.
  client: CategorizationModelClient | null;
  // The import that was just saved. Required: this never runs over the user's whole history.
  importId: string;
  // See SuggestCategoriesOptions.
  dailyLimit: number;
  // Per model request.
  timeoutMs?: number;
  // How long to wait for the whole run before answering "pending".
  maxWaitMs?: number;
};

// Asks the model about the import's unmatched rows and reports how it went, waiting at most
// `maxWaitMs`. A run that outlasts the wait is not cancelled: it is left to finish in this
// process and its suggestions appear on the list. Never throws: the import is already saved, and
// its answer mustn't fail over a note about suggestions.
export async function suggestAfterImport(
  db: Db,
  userId: string,
  options: SuggestAfterImportOptions,
): Promise<AfterImportSuggestions> {
  const { client, importId, dailyLimit, timeoutMs, maxWaitMs = defaultAfterImportWaitMs } = options;
  try {
    // The opt-out and the key are checked here so that "nothing to ask" and "off" differ: an
    // opted-out user gets no note at all, core's own check only makes the run a no-op.
    if (!client || !(await aiCategorizationEnabledFor(db, userId))) return { status: "off" };

    let timer: ReturnType<typeof setTimeout> | undefined;
    const waited = new Promise<"pending">((resolve) => {
      timer = setTimeout(() => resolve("pending"), maxWaitMs);
    });
    const run = suggestCategories(db, userId, { client, importId, dailyLimit, timeoutMs });
    // A model failure is a result, not a rejection; a run that rejects anyway (its database went
    // away) after the wait is over has no one left to tell, and its error may quote merchant text,
    // so it isn't logged either.
    run.catch(() => {});
    const outcome = await Promise.race([run, waited]);
    clearTimeout(timer);
    if (outcome === "pending") return { status: "pending" };

    // The cap first: it can come with suggestions from the batches before it.
    if (outcome.capped) return { status: "capped", rows: outcome.rowsSuggested };
    if (outcome.failed) {
      return outcome.rowsSuggested > 0
        ? { status: "suggested", rows: outcome.rowsSuggested }
        : { status: "unavailable" };
    }
    if (outcome.merchantsAsked === 0) return { status: "nothing" };
    if (outcome.rowsSuggested === 0) return { status: "none" };
    return { status: "suggested", rows: outcome.rowsSuggested };
  } catch {
    return { status: "unavailable" };
  }
}
