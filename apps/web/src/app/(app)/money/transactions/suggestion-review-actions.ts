"use server";

import {
  acceptSuggestion,
  aiCategorizationEnabledFor,
  dismissSuggestion,
  resetSuggestionAsks,
} from "@troba/core";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { categorizationModelClient } from "@/server/openai-categorization";
import { requireUser } from "@/server/session";
import { suggestCategoriesAction, type SuggestState } from "./suggestion-actions";

// What the user does with a suggested category (SPEC-money M5, ADR-0016): accept it, dismiss it,
// or ask again about the merchants dismissed or not placed. The results are counts and fixed
// sentences; nothing here logs or returns a merchant's text.

// "Ask again": reopens the dismissed and unplaced merchants, then asks about them like the
// "Suggest categories" button does. Nothing is reopened when the server has no key or the user
// turned suggestions off.
export async function askAgainAction(): Promise<SuggestState> {
  const { userId } = await requireUser();
  if (!categorizationModelClient() || !(await aiCategorizationEnabledFor(db(), userId))) {
    return { status: "off", message: "" };
  }

  await resetSuggestionAsks(db(), userId);
  return suggestCategoriesAction();
}

// `ok: false` carries a sentence for the page and means nothing was changed.
export type ReviewState = { ok: boolean; message: string };

const TransactionId = z.uuid();
const notFoundMessage = "That transaction doesn't exist.";
const staleMessage = "That suggestion is no longer there, so nothing was changed.";

function transactions(rows: number): string {
  return rows === 1 ? "1 transaction" : `${rows} transactions`;
}

// Gives every uncategorized row of the row's merchant the suggested category, as the user's own
// choice. The id comes from the client, so it is checked, and read through the user filter.
export async function acceptSuggestionAction(transactionId: string): Promise<ReviewState> {
  const { userId } = await requireUser();
  const id = TransactionId.safeParse(transactionId);
  if (!id.success) return { ok: false, message: notFoundMessage };

  const result = await acceptSuggestion(db(), userId, id.data);
  if (!result.ok) {
    return { ok: false, message: result.reason === "not-found" ? notFoundMessage : staleMessage };
  }
  revalidatePath("/money/transactions");
  revalidatePath("/money/report");
  return {
    ok: true,
    message: `Categorized ${transactions(result.rows)} as ${result.categoryName}.`,
  };
}

// Drops the suggestion on the row's merchant; a later run doesn't ask about it again.
export async function dismissSuggestionAction(transactionId: string): Promise<ReviewState> {
  const { userId } = await requireUser();
  const id = TransactionId.safeParse(transactionId);
  if (!id.success) return { ok: false, message: notFoundMessage };

  const result = await dismissSuggestion(db(), userId, id.data);
  if (!result.ok) {
    return { ok: false, message: result.reason === "not-found" ? notFoundMessage : staleMessage };
  }
  revalidatePath("/money/transactions");
  return { ok: true, message: `Dismissed the suggestion on ${transactions(result.rows)}.` };
}
