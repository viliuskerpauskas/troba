"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { announce } from "./suggestion-notice";
import { acceptAllSuggestionsAction } from "./suggestion-review-actions";

// The id the notice moves the keyboard focus to after an accept, while this strip is still there.
const buttonId = "accept-all-suggestions";

function plural(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${count} ${many}`;
}

// The transactions list's strip for suggestions that are waiting (SPEC-money M5, ADR-0016): how
// many there are, and "Accept all", which asks for a confirmation that names the count before it
// changes anything. The page passes the counts it has just read; what is applied is whatever is
// still pending when the user confirms, and the answer reaches the list's single status region.
// The page renders it only while the server has a key and the user hasn't turned suggestions off.
export function AcceptAll({ rows, merchants }: { rows: number; merchants: number }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const promptId = useId();
  const promptRef = useRef<HTMLParagraphElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  // Focus follows the step: the question when it opens, the opener when it is cancelled. Not on
  // the first render, so the page load doesn't steal focus.
  const moved = useRef(false);

  useEffect(() => {
    if (confirming) {
      promptRef.current?.focus();
      moved.current = true;
    } else if (moved.current) {
      openerRef.current?.focus();
    }
  }, [confirming]);

  if (rows === 0) return null;

  const transactions = plural(rows, "transaction", "transactions");
  const merchantsText = plural(merchants, "merchant", "merchants");
  const touch = "h-11 px-4 sm:h-8 sm:px-2.5";

  function confirm() {
    startTransition(async () => {
      const result = await acceptAllSuggestionsAction();
      setConfirming(false);
      announce(result, buttonId);
    });
  }

  return (
    <section
      aria-label="Suggestions waiting"
      className="flex flex-col gap-2 rounded-xl p-4 ring-1 ring-foreground/10"
    >
      <p className="text-sm">
        {transactions} from {merchantsText} {rows === 1 ? "has" : "have"} a suggested category
        waiting. A suggestion changes nothing until you accept it.
      </p>
      {confirming ? (
        <div
          role="group"
          aria-labelledby={promptId}
          className="flex flex-col gap-2"
          onKeyDown={(event) => {
            if (event.key === "Escape" && !pending) setConfirming(false);
          }}
        >
          <p id={promptId} ref={promptRef} tabIndex={-1} className="text-sm font-medium">
            Give {transactions} from {merchantsText} their suggested category? This changes your
            spending totals.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={pending} className={touch} onClick={confirm}>
              {pending ? "Accepting…" : `Yes, accept all ${rows}`}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              className={touch}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button
            ref={openerRef}
            id={buttonId}
            type="button"
            className={touch}
            aria-label={`Accept all ${plural(rows, "pending suggestion", "pending suggestions")}`}
            onClick={() => setConfirming(true)}
          >
            Accept all
          </Button>
        </div>
      )}
    </section>
  );
}
