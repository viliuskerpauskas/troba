"use client";

import { useId } from "react";
import { FormStatus } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { askAgainAction } from "./suggestion-review-actions";
import { useSuggestionRun } from "./use-suggestion-run";

// "Ask again" on the transactions list (SPEC-money M5, ADR-0016): offers the merchants that were
// dismissed, or that the model couldn't place, to the model again, for example after adding
// categories. Like the "Suggest categories" button, it is absent without a key on the server.
// The run is the worker's, followed like the button's (ADR-0020).
export function AskAgain({ enabled }: { enabled: boolean }) {
  const { state, startRun, busy } = useSuggestionRun(askAgainAction);
  const descriptionId = useId();
  if (!enabled) return null;

  return (
    <form action={startRun} className="flex flex-col gap-2">
      <div>
        <Button
          type="submit"
          variant="outline"
          disabled={busy}
          aria-describedby={descriptionId}
          className="h-11 px-4 sm:h-10"
        >
          {busy ? "Asking again…" : "Ask again"}
        </Button>
      </div>
      <p id={descriptionId} className="text-sm text-muted-foreground">
        Sends the merchants you dismissed, or the model couldn&apos;t place, to the AI service once
        more, for example after you add a category. The same masking applies.
      </p>
      <FormStatus>{state.message}</FormStatus>
    </form>
  );
}
