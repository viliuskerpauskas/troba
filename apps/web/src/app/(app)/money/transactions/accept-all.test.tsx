import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AcceptAll } from "./accept-all";

// The button calls a server action; rendering it, as here, never does.
vi.mock("./suggestion-review-actions", () => ({ acceptAllSuggestionsAction: vi.fn() }));

describe("the accept-all strip", () => {
  const html = renderToStaticMarkup(<AcceptAll rows={12} merchants={3} />);

  it("names how many transactions and merchants have a suggestion waiting", () => {
    expect(html).toContain("12 transactions");
    expect(html).toContain("3 merchants");
  });

  it("offers a single Accept all button that says what it will do and applies nothing yet", () => {
    expect(html).toMatch(/<button[^>]*aria-label="Accept all 12 pending suggestions"/);
    expect(html).toContain(">Accept all<");
    // The confirmation is a second step: its button is not there until this one is pressed.
    expect(html).not.toContain("Yes, accept all");
    expect(html).not.toContain("Cancel");
  });

  it("makes the button phone-sized and is a labelled region", () => {
    expect(html).toContain("h-11");
    expect(html).toMatch(/<section[^>]*aria-label="Suggestions waiting"/);
  });

  it("uses the singular for one transaction of one merchant", () => {
    const one = renderToStaticMarkup(<AcceptAll rows={1} merchants={1} />);
    expect(one).toContain("1 transaction ");
    expect(one).toContain("1 merchant");
    expect(one).toContain('aria-label="Accept all 1 pending suggestion"');
  });

  it("shows nothing when no suggestion is waiting", () => {
    expect(renderToStaticMarkup(<AcceptAll rows={0} merchants={0} />)).toBe("");
  });
});
