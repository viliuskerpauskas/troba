"use client";

import { useId } from "react";
import { FormStatus } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { suggestCategoriesAction } from "./suggestion-actions";
import { useSuggestionRun } from "./use-suggestion-run";

// The transactions list's AI strip (SPEC-money M5, ADR-0016): a button that asks the model for a
// category for the uncategorized imported rows, and the sentence that says what is sent. With no
// key on the server the page passes enabled={false} and nothing about the feature is rendered. The
// worker asks the model (ADR-0020): the button stays busy, and the page follows the run, until it is
// done; `runId` is a run of the user's the page found under way.
export function SuggestCategories({
  enabled,
  runId = null,
}: {
  enabled: boolean;
  runId?: string | null;
}) {
  const { state, startRun, busy } = useSuggestionRun(suggestCategoriesAction, runId);
  const disclosureId = useId();
  if (!enabled) return null;

  return (
    <form action={startRun} className="flex flex-col gap-2">
      <div>
        <Button type="submit" variant="outline" disabled={busy} aria-describedby={disclosureId}>
          {busy ? "Suggesting…" : "Suggest categories"}
        </Button>
      </div>
      <p id={disclosureId} className="text-sm text-muted-foreground">
        Sends the counterparty and description of your uncategorized imported transactions to an AI
        service, with your own name and account numbers masked. Rows that show the other
        party&apos;s IBAN (transfers) are not sent. A payment to a person that shows no IBAN is
        sent, and a name inside a merchant string might get through. A suggestion only appears
        beside a transaction; it never changes its category.
      </p>
      {/* Always rendered, so a screen reader announces the text when it arrives. */}
      <FormStatus>{state.message}</FormStatus>
    </form>
  );
}

// A model's suggestion on an uncategorized row. Text, not a control: the row's SuggestionControls
// accept or dismiss it. The label tells it apart from a category the user or a rule set.
export function SuggestionChip({ categoryName }: { categoryName: string }) {
  return (
    <span className="inline-block rounded-md border border-dashed px-1.5 py-0.5 text-xs text-foreground">
      suggested: {categoryName}
    </span>
  );
}
