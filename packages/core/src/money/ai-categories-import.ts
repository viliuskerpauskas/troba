import type { Db } from "@troba/db";
import type { JobQueue } from "../jobs/queue";
import { startCategorySuggestions } from "./ai-categories-run";

// The suggestions that follow an import (SPEC-money M5, ADR-0021). Called after commitImport has
// committed, never inside its transaction: whatever happens here, the import is as it was saved.
// The import never waits on the model: the run is queued for the worker, and its suggestions show
// up on the transactions list when it is done.

// What the import result says about them (see afterImportNote).
//   off          the server has no key or the user opted out: say nothing, nothing was queued
//   nothing      no row of the import needs the model (the caller's, for an import with no new rows)
//   pending      the run is queued; the rows show their suggestions on the transactions list when
//                the worker is done
//   unavailable  the run couldn't be queued
export type AfterImportSuggestions = { status: "off" | "nothing" | "pending" | "unavailable" };

export type SuggestAfterImportOptions = {
  // The job queue, or null when the server has no key. A getter, so a queue that can't be started
  // is "unavailable" rather than a failed import.
  queue: (() => Promise<JobQueue>) | null;
  // The import that was just saved. Required: this never runs over the user's whole history.
  importId: string;
};

// Queues the run for the import's unmatched rows. Never throws: the import is already saved, and
// its answer mustn't fail over a note about suggestions. An error isn't logged either, since it
// may quote the user's data.
export async function suggestAfterImport(
  db: Db,
  userId: string,
  { queue, importId }: SuggestAfterImportOptions,
): Promise<AfterImportSuggestions> {
  if (!queue) return { status: "off" };
  try {
    const started = await startCategorySuggestions(db, userId, { queue: await queue(), importId });
    return started.ok ? { status: "pending" } : { status: "off" };
  } catch {
    return { status: "unavailable" };
  }
}
