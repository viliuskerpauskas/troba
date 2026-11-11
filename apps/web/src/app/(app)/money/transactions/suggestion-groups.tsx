import type { SuggestionGroup } from "@troba/core";
import { formatAmount } from "../format";
import { rowElementId } from "./row-id";
import { SuggestionChip } from "./suggest-categories";
import { SuggestionControls } from "./suggestion-controls";

// The pending suggestions grouped by merchant (SPEC-money M5 story 8, ADR-0016): one entry per
// merchant, with its suggested category, how many rows a decision covers and their total, and one
// accept and one dismiss for the whole group. A group's decision goes through one of its rows, the
// same action as a row's own buttons, so it covers exactly what accepting that row does. The entry
// carries the row's element id, so the notice moves the keyboard back to it if it stays listed.
export function SuggestionGroups({
  groups,
  merchants,
  canAccept,
}: {
  groups: SuggestionGroup[];
  // How many merchants are waiting in all; the list may show fewer.
  merchants: number;
  // False for a user who turned AI suggestions off: they can still dismiss what is left.
  canAccept: boolean;
}) {
  if (groups.length === 0) {
    return <p className="text-muted-foreground">No suggestions are waiting.</p>;
  }

  return (
    <>
      {merchants > groups.length && (
        <p className="text-sm text-muted-foreground">
          Showing {groups.length} of {merchants} merchants, those with the most transactions first.
        </p>
      )}
      <ol
        aria-label="Suggestions by merchant"
        className="flex flex-col divide-y rounded-xl ring-1 ring-foreground/10"
      >
        {groups.map((group) => {
          const merchant = group.counterparty?.trim() || group.description?.trim() || "";
          const rows = group.rows === 1 ? "1 transaction" : `${group.rows} transactions`;
          return (
            <li
              key={group.transactionId}
              id={rowElementId(group.transactionId)}
              tabIndex={-1}
              className="flex flex-col gap-1 px-4 py-3"
            >
              <span className="font-medium [overflow-wrap:anywhere]">{merchant}</span>
              <div className="text-sm text-muted-foreground">
                <SuggestionChip categoryName={group.suggestedCategoryName} /> · {rows} ·{" "}
                {group.totals.map((total, index) => (
                  <span key={total.currency}>
                    {index > 0 && ", "}
                    <strong className="text-foreground">
                      {formatAmount(total.amountCents, total.currency)}
                    </strong>
                  </span>
                ))}
              </div>
              <SuggestionControls
                transactionId={group.transactionId}
                suggestedCategoryId={group.suggestedCategoryId}
                categoryName={group.suggestedCategoryName}
                merchant={merchant}
                canAccept={canAccept}
                groupRows={group.rows}
              />
            </li>
          );
        })}
      </ol>
    </>
  );
}
