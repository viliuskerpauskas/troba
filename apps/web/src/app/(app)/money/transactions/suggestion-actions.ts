"use server";

import {
  getCategorySuggestionRun,
  startCategorySuggestions,
  type SuggestCategoriesResult,
} from "@troba/core";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { aiCategorizationEnabled } from "@/server/env";
import { jobQueue } from "@/server/jobs";
import { requireUser } from "@/server/session";

// AI-suggested categories for the transactions no rule matched (SPEC-money M5, ADR-0016). A
// suggestion is stored on the row and shown as a chip; the row stays uncategorized until the user
// accepts it. The model is asked by the worker (ADR-0020): the button queues a run and answers at
// once, and the page asks how it went until it is done.
//
// The merchant text and the model's answer are a user's data: nothing here logs them, and the
// state sent back to the page holds counts and fixed sentences only.

export type SuggestState = {
  // off: the server has no key or the user turned the feature off, so nothing was done (and the
  // page doesn't offer the button). pending: the run is queued or under way, as `runId`.
  status?: "off" | "pending" | "suggested" | "none" | "nothing" | "failed" | "capped";
  message?: string;
  runId?: string;
};

const pendingMessage = "Suggesting categories. They appear on the list when they're ready.";
const noneMessage = "The model had no suggestions for these transactions.";
const nothingMessage = "There are no uncategorized imported transactions to suggest for.";
const failedMessage =
  "Suggestions aren't available right now. Nothing was changed, so try again later.";

// The user's daily cap (T138) stopped the run. Distinct from a failure: nothing is wrong, the
// allowance is spent, and the rows it left out were not sent.
const cappedMessage =
  "The daily limit on AI suggestions is reached, so these transactions stay uncategorized for now. Try again later.";

function suggestedMessage(rows: number): string {
  return rows === 1 ? "1 transaction has a suggestion." : `${rows} transactions have a suggestion.`;
}

function pending(runId: string): SuggestState {
  return { status: "pending", runId, message: pendingMessage };
}

// The button on the transactions list: queues a run over the signed-in user's eligible rows (core
// caps and batches it, in the worker). A run already under way is the one followed, rather than a
// second one. Nothing is queued with no key or for a user who opted out; the worker's run checks
// the opt-out again.
export async function suggestCategoriesAction(): Promise<SuggestState> {
  const { userId } = await requireUser();
  if (!aiCategorizationEnabled()) return { status: "off", message: "" };
  const started = await startCategorySuggestions(db(), userId, { queue: await jobQueue() });
  if (!started.ok) return { status: "off", message: "" };
  return pending(started.runId);
}

const RunId = z.uuid();

// Where one of the signed-in user's runs stands, asked by the page every few seconds while it is
// under way. A run that isn't theirs, or is gone, says nothing.
export async function suggestionRunStatusAction(runId: string): Promise<SuggestState> {
  const { userId } = await requireUser();
  const id = RunId.safeParse(runId);
  if (!id.success) return {};
  const run = await getCategorySuggestionRun(db(), userId, id.data);
  if (!run) return {};
  if (!run.finished) return pending(id.data);
  if (run.result.rowsSuggested > 0) revalidatePath("/money/transactions");
  return resultState(run.result);
}

function resultState(result: SuggestCategoriesResult): SuggestState {
  if (result.capped) {
    // Earlier batches of a long run may have been stored before the cap stopped it.
    return {
      status: "capped",
      message:
        result.rowsSuggested > 0
          ? `${suggestedMessage(result.rowsSuggested)} The daily limit on AI suggestions is reached, so the rest stays uncategorized for now.`
          : cappedMessage,
    };
  }

  if (result.failed) {
    // Earlier batches of a long run may have been stored before the one that failed.
    return result.rowsSuggested > 0
      ? {
          status: "suggested",
          message: `${suggestedMessage(result.rowsSuggested)} The model then stopped answering; try again later for the rest.`,
        }
      : { status: "failed", message: failedMessage };
  }
  if (result.merchantsAsked === 0) return { status: "nothing", message: nothingMessage };
  if (result.rowsSuggested === 0) return { status: "none", message: noneMessage };
  return { status: "suggested", message: suggestedMessage(result.rowsSuggested) };
}
