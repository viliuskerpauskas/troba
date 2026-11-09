import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SuggestCategories, SuggestionChip } from "./suggest-categories";

// The button calls a server action; rendering it, as here, never does.
vi.mock("./suggestion-actions", () => ({ suggestCategoriesAction: vi.fn() }));

describe("the suggest categories button", () => {
  it("offers the button with what is sent beside it when the server has a key", () => {
    const html = renderToStaticMarkup(<SuggestCategories enabled />);

    expect(html).toContain("Suggest categories");
    expect(html).toContain("OpenAI");
    expect(html).toContain("own name and account numbers masked");
    expect(html).toContain("(transfers) are not sent");
    expect(html).toContain("a name inside a merchant string might get through");
    // The button is described by that text, so a screen reader reads it with the button.
    const id = /<p id="([^"]+)"/.exec(html)![1];
    expect(html).toContain(`aria-describedby="${id}"`);
  });

  it("has an empty announcement region before any answer arrives", () => {
    expect(renderToStaticMarkup(<SuggestCategories enabled />)).toMatch(
      /<p role="status" class="[^"]*"><\/p>/,
    );
  });

  it("shows nothing at all, not even a mention, without a key", () => {
    expect(renderToStaticMarkup(<SuggestCategories enabled={false} />)).toBe("");
  });
});

describe("the suggestion chip", () => {
  it("shows the suggested category as read-only text marked as a suggestion", () => {
    const html = renderToStaticMarkup(<SuggestionChip categoryName="Food" />);

    expect(html).toContain("suggested: Food");
    expect(html).not.toMatch(/<(button|a|input)\b/);
  });
});
