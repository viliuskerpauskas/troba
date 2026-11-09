"use server";

import { suggestCategories } from "@troba/core";
import { revalidatePath } from "next/cache";
import { db } from "@/server/db";
import { aiCategorizeDailyLimit } from "@/server/env";
import { categorizationModelClient } from "@/server/openai-categorization";
import { requireUser } from "@/server/session";

// AI-suggested categories for the transactions no rule matched (SPEC-money M5, ADR-0016). A
// suggestion is stored on the row and shown as a chip; the row stays uncategorized until the user
// accepts it.
//
// The merchant text and the model's answer are a user's data: nothing here logs them, and the
// state sent back to the page holds counts and fixed sentences only.

export type SuggestState = {
  // off: the server has no key, so nothing was done (and the page doesn't offer the button).
  status?: "off" | "suggested" | "none" | "nothing" | "failed" | "capped";
  message?: string;
};

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

// The button on the transactions list: asks about the signed-in user's eligible rows, a merchant
// at a time (core caps and batches the run). Never throws: a failure leaves the rows as they were.
export async function suggestCategoriesAction(): Promise<SuggestState> {
  const { userId } = await requireUser();
  const client = categorizationModelClient();
  if (!client) return { status: "off", message: "" };

  const result = await suggestCategories(db(), userId, {
    client,
    dailyLimit: aiCategorizeDailyLimit(),
  });
  if (result.rowsSuggested > 0) revalidatePath("/money/transactions");

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
