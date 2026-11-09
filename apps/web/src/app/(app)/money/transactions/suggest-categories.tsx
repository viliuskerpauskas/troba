"use client";

import { useActionState, useId } from "react";
import { FormStatus } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { suggestCategoriesAction, type SuggestState } from "./suggestion-actions";

// The transactions list's AI strip (SPEC-money M5, ADR-0016): a button that asks the model for a
// category for the uncategorized imported rows, and the sentence that says what is sent. With no
// key on the server the page passes enabled={false} and nothing about the feature is rendered.
export function SuggestCategories({ enabled }: { enabled: boolean }) {
  const [state, action, pending] = useActionState<SuggestState>(suggestCategoriesAction, {});
  const disclosureId = useId();
  if (!enabled) return null;

  return (
    <form action={action} className="flex flex-col gap-2">
      <div>
        <Button type="submit" variant="outline" disabled={pending} aria-describedby={disclosureId}>
          {pending ? "Suggesting…" : "Suggest categories"}
        </Button>
      </div>
      <p id={disclosureId} className="text-sm text-muted-foreground">
        Sends the counterparty and description of your uncategorized imported transactions to
        OpenAI, with your own name and account numbers masked. Transfers are not sent, but a name
        inside a merchant string might get through. A suggestion only appears beside a transaction;
        it never changes its category.
      </p>
      {/* Always rendered, so a screen reader announces the text when it arrives. */}
      <FormStatus>{state.message}</FormStatus>
    </form>
  );
}

// A model's suggestion on an uncategorized row. Text, not a control: accepting one is another
// ticket's. The label tells it apart from a category the user or a rule set.
export function SuggestionChip({ categoryName }: { categoryName: string }) {
  return (
    <span className="inline-block rounded-md border border-dashed px-1.5 py-0.5 text-xs text-foreground">
      suggested: {categoryName}
    </span>
  );
}
