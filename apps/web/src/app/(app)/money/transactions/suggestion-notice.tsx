"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { FormStatus } from "@/components/form-message";
import { cn } from "@/lib/utils";

// The answer to accepting or dismissing a suggestion, shown once for the whole list. A row's
// controls vanish when the suggestion goes (and the row itself, under the "Uncategorized"
// filter), so the sentence can't live in the row. A row calls announce(); the notice, rendered
// once near the top of the list, shows it and takes the keyboard focus when the row that had it is
// gone. The two share a small store because the page is a server component with no client
// ancestor to hold the state.

type Notice = { ok: boolean; message: string; focusId: string; seq: number };

let current: Notice | null = null;
const listeners = new Set<() => void>();

export function announce(result: { ok: boolean; message: string }, focusId: string): void {
  current = { ...result, focusId, seq: (current?.seq ?? 0) + 1 };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Always rendered, so a screen reader announces the text when it arrives.
export function SuggestionNotice() {
  const notice = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
  const ref = useRef<HTMLParagraphElement>(null);
  const seq = notice?.seq;
  const focusId = notice?.focusId;

  // The button that was pressed is gone by now. Focus goes to the row if it is still listed,
  // else to this notice, so a keyboard user isn't dropped at the top of the page.
  useEffect(() => {
    if (seq === undefined || focusId === undefined) return;
    const timer = setTimeout(() => (document.getElementById(focusId) ?? ref.current)?.focus(), 150);
    return () => clearTimeout(timer);
  }, [seq, focusId]);

  return (
    <FormStatus
      ref={ref}
      tabIndex={-1}
      className={cn("empty:-mt-6", notice && !notice.ok && "text-destructive")}
    >
      {notice?.message}
    </FormStatus>
  );
}
