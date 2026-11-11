"use client";

import Link from "next/link";
import { useTransition } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { rowElementId } from "./row-id";
import { announce } from "./suggestion-notice";
import { acceptSuggestionAction, dismissSuggestionAction } from "./suggestion-review-actions";

// Accept, dismiss and "create rule" for a row's suggestion (SPEC-money M5, ADR-0016). Accepting
// and dismissing cover the merchant's other rows too; the buttons say so for a screen reader.
// Touch-sized on a phone.
export function SuggestionControls({
  transactionId,
  suggestedCategoryId,
  categoryName,
  merchant,
  canAccept,
  groupRows,
}: {
  transactionId: string;
  suggestedCategoryId: string;
  categoryName: string;
  // How the row reads in the list, for the labels.
  merchant: string;
  // False for a user who turned AI suggestions off: they can still dismiss what is left.
  canAccept: boolean;
  // In the list grouped by merchant: how many rows the decision covers, for the labels.
  groupRows?: number;
}) {
  const [pending, startTransition] = useTransition();
  const focusId = rowElementId(transactionId);
  const touch = "h-11 px-4 sm:h-10";
  const covered =
    groupRows === undefined
      ? null
      : `all ${groupRows === 1 ? "1 transaction" : `${groupRows} transactions`} of ${merchant}`;

  function resolve(action: typeof acceptSuggestionAction) {
    startTransition(async () => {
      announce(await action(transactionId), focusId);
    });
  }

  return (
    <div role="group" aria-label={`Suggestion for ${merchant}`} className="flex flex-wrap gap-2">
      {canAccept && (
        <Button
          type="button"
          disabled={pending}
          className={touch}
          aria-label={
            covered
              ? `Accept ${categoryName} for ${covered}`
              : `Accept ${categoryName} for ${merchant}, and for its other uncategorized transactions`
          }
          onClick={() => resolve(acceptSuggestionAction)}
        >
          Accept
        </Button>
      )}
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        className={touch}
        aria-label={`Dismiss the suggestion ${categoryName} for ${covered ?? merchant}`}
        onClick={() => resolve(dismissSuggestionAction)}
      >
        Dismiss
      </Button>
      {canAccept && (
        <Link
          href={`/money/rules?from=${transactionId}&category=${suggestedCategoryId}`}
          className={cn(buttonVariants({ variant: "outline" }), touch)}
          aria-label={`Create rule from ${merchant} that sets ${categoryName}`}
        >
          Create rule
        </Link>
      )}
    </div>
  );
}
