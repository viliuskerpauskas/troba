"use client";

import { startTransition, useActionState, useEffect } from "react";
import { suggestionRunStatusAction, type SuggestState } from "./suggestion-actions";

// How often the page asks how a run is going (ADR-0021). A run is a few model requests, seconds
// each when the provider is healthy.
const pollMs = 2_000;

// A button that starts a run of AI-suggested categories on the worker, and then follows it: while
// the run is under way the page asks how it is going every few seconds, and shows the answer once
// it is done (the status action refreshes the list when rows got a suggestion). `runId` is a run
// the page found under way when it loaded, followed at once.
export function useSuggestionRun(
  start: () => Promise<SuggestState>,
  runId: string | null = null,
): { state: SuggestState; startRun: () => void; busy: boolean } {
  const [state, dispatch, pending] = useActionState<SuggestState, "start" | "poll">(
    async (previous, intent) =>
      intent === "poll" && previous.runId ? suggestionRunStatusAction(previous.runId) : start(),
    runId ? { status: "pending", runId } : {},
  );
  const following = state.status === "pending" ? state.runId : undefined;

  useEffect(() => {
    if (!following || pending) return;
    // A run found on page load has no message yet: ask at once.
    const timer = setTimeout(
      () => startTransition(() => dispatch("poll")),
      state.message ? pollMs : 0,
    );
    return () => clearTimeout(timer);
  }, [following, pending, state, dispatch]);

  return { state, startRun: () => dispatch("start"), busy: pending || Boolean(following) };
}
