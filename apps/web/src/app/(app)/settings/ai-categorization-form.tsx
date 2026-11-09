"use client";

import { useActionState } from "react";
import { FormStatus } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { updateAiCategorization, type AiCategorizationState } from "./ai-categorization-actions";

// Shown only when the server has an OpenAI key (the page checks); without one nothing about the
// feature appears.
export function AiCategorizationForm({ enabled }: { enabled: boolean }) {
  const [state, action, pending] = useActionState<AiCategorizationState, FormData>(
    updateAiCategorization,
    {},
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <input
          id="ai-categorization"
          type="checkbox"
          name="enabled"
          defaultChecked={enabled}
          aria-describedby="ai-categorization-help"
          className="mt-1 size-4 shrink-0 accent-primary"
        />
        <div className="flex flex-col gap-1">
          <label htmlFor="ai-categorization" className="font-medium">
            Suggest categories with AI
          </label>
          <p id="ai-categorization-help" className="text-sm text-muted-foreground">
            When on, the counterparty and description of your uncategorized imported transactions
            are sent to OpenAI, with your own name and account numbers masked, so it can suggest a
            category. Turn it off and nothing of yours is sent. Suggestions you already have stay.
          </p>
        </div>
      </div>
      <FormStatus>{state.message}</FormStatus>
      <Button type="submit" disabled={pending} className="self-start">
        Save
      </Button>
    </form>
  );
}
