import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AskAgain } from "./ask-again";
import { SuggestionControls } from "./suggestion-controls";
import { SuggestionNotice } from "./suggestion-notice";

// The buttons call server actions; rendering them, as here, never does.
vi.mock("./suggestion-review-actions", () => ({
  acceptSuggestionAction: vi.fn(),
  dismissSuggestionAction: vi.fn(),
  askAgainAction: vi.fn(),
}));
vi.mock("./suggestion-actions", () => ({ suggestCategoriesAction: vi.fn() }));

const id = "11111111-1111-4111-8111-111111111111";
const categoryId = "22222222-2222-4222-8222-222222222222";

describe("the suggestion controls", () => {
  const html = renderToStaticMarkup(
    <SuggestionControls
      transactionId={id}
      suggestedCategoryId={categoryId}
      categoryName="Food"
      merchant="GROCERY MART: CARD PAYMENT"
      canAccept
    />,
  );

  it("offers accept, dismiss and create-rule, each labelled with the merchant and category", () => {
    expect(html).toContain('role="group"');
    expect(html).toMatch(/<button[^>]*aria-label="Accept Food for GROCERY MART: CARD PAYMENT/);
    expect(html).toMatch(/<button[^>]*aria-label="Dismiss the suggestion Food for GROCERY MART/);
    expect(html).toContain(">Accept<");
    expect(html).toContain(">Dismiss<");
    expect(html).toContain(">Create rule<");
  });

  it("links create-rule to the rules page with the transaction and the suggested category", () => {
    expect(html).toContain(`href="/money/rules?from=${id}&amp;category=${categoryId}"`);
  });

  it("makes every control phone-sized", () => {
    expect(html.match(/h-11/g)).toHaveLength(3);
  });
});

describe("the suggestion controls for a user who turned suggestions off", () => {
  it("offers only dismiss", () => {
    const html = renderToStaticMarkup(
      <SuggestionControls
        transactionId={id}
        suggestedCategoryId={categoryId}
        categoryName="Food"
        merchant="GROCERY MART"
        canAccept={false}
      />,
    );

    expect(html).toContain(">Dismiss<");
    expect(html).not.toContain(">Accept<");
    expect(html).not.toContain("Create rule");
  });
});

describe("the notice", () => {
  it("is always rendered, empty, as a live region the keyboard can be sent to", () => {
    expect(renderToStaticMarkup(<SuggestionNotice />)).toMatch(
      /<p role="status" class="[^"]*" tabindex="-1"><\/p>/,
    );
  });
});

describe("ask again", () => {
  it("is a button with a description when the server has a key", () => {
    const html = renderToStaticMarkup(<AskAgain enabled />);

    expect(html).toContain("Ask again");
    expect(html).toContain("dismissed");
    const description = /<p id="([^"]+)"/.exec(html)![1];
    expect(html).toContain(`aria-describedby="${description}"`);
  });

  it("shows nothing without a key", () => {
    expect(renderToStaticMarkup(<AskAgain enabled={false} />)).toBe("");
  });
});
