import type { SuggestionGroup } from "@troba/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { rowElementId } from "./row-id";
import { SuggestionGroups } from "./suggestion-groups";

// The buttons call server actions; rendering them, as here, never does.
vi.mock("./suggestion-review-actions", () => ({
  acceptSuggestionAction: vi.fn(),
  dismissSuggestionAction: vi.fn(),
}));

const food = "22222222-2222-4222-8222-222222222222";

const groups: SuggestionGroup[] = [
  {
    transactionId: "11111111-1111-4111-8111-111111111111",
    counterparty: "GROCERY MART",
    description: "CARD PAYMENT",
    suggestedCategoryId: food,
    suggestedCategoryName: "Food",
    rows: 3,
    totals: [
      { currency: "EUR", amountCents: -3000n },
      { currency: "USD", amountCents: -500n },
    ],
  },
  {
    transactionId: "33333333-3333-4333-8333-333333333333",
    counterparty: null,
    description: "BOOK NOOK",
    suggestedCategoryId: food,
    suggestedCategoryName: "Food",
    rows: 1,
    totals: [{ currency: "EUR", amountCents: -1250n }],
  },
];

describe("the suggestions grouped by merchant", () => {
  const html = renderToStaticMarkup(<SuggestionGroups groups={groups} merchants={2} canAccept />);

  it("is a labelled list with one entry per merchant, named by its counterparty or description", () => {
    expect(html).toMatch(/<ol aria-label="Suggestions by merchant"/);
    expect(html.match(/<li /g)).toHaveLength(2);
    expect(html).toContain("GROCERY MART");
    expect(html).not.toContain("CARD PAYMENT");
    expect(html).toContain("BOOK NOOK");
  });

  it("shows each merchant's row count, total in each currency and suggested category", () => {
    expect(html).toContain("3 transactions");
    expect(html).toMatch(/· 1 transaction ·/);
    expect(html).toContain("-€30.00");
    expect(html).toContain("-$5.00");
    expect(html).toContain("suggested: Food");
  });

  it("decides the group through its row, so the keyboard lands back on the entry", () => {
    expect(html).toContain(`id="${rowElementId(groups[0]!.transactionId)}"`);
    expect(html).toMatch(
      /<button[^>]*aria-label="Accept Food for all 3 transactions of GROCERY MART"/,
    );
    expect(html).toMatch(
      /<button[^>]*aria-label="Dismiss the suggestion Food for all 3 transactions of GROCERY MART"/,
    );
  });

  it("says when more merchants are waiting than are listed", () => {
    expect(
      renderToStaticMarkup(<SuggestionGroups groups={groups} merchants={150} canAccept />),
    ).toContain("Showing 2 of 150 merchants");
    expect(html).not.toContain("Showing");
  });

  it("offers only dismiss to a user who turned suggestions off", () => {
    const off = renderToStaticMarkup(
      <SuggestionGroups groups={groups} merchants={2} canAccept={false} />,
    );
    expect(off).toContain(">Dismiss<");
    expect(off).not.toContain(">Accept<");
  });

  it("says so when nothing is waiting", () => {
    expect(
      renderToStaticMarkup(<SuggestionGroups groups={[]} merchants={0} canAccept />),
    ).toContain("No suggestions are waiting.");
  });
});
