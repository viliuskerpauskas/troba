import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { dateFormats } from "@troba/core";
import { AfterImportNote, ImportWizard } from "./import-wizard";

// The wizard's steps call server actions; the upload step, rendered here, never does.
vi.mock("./actions", () => ({
  commitImportAction: vi.fn(),
  createImportAccountAction: vi.fn(),
  editProfileAction: vi.fn(),
  previewImportAction: vi.fn(),
  rereadMappingAction: vi.fn(),
  saveProfileAction: vi.fn(),
  startImportAction: vi.fn(),
}));

const upload = (aiEnabled: boolean, categorizeEnabled = false) =>
  renderToStaticMarkup(
    <ImportWizard
      dateFormats={dateFormats}
      maxBytes={1024}
      aiEnabled={aiEnabled}
      categorizeEnabled={categorizeEnabled}
    />,
  );

describe("the import wizard's upload step", () => {
  it("says what is sent to an AI service, never naming the provider, when the server has a key", () => {
    const html = upload(true);

    expect(html).toMatch(/are sent to an AI\s+service to suggest how to map the columns/);
    expect(html).not.toContain("OpenAI");
    expect(html).toContain('aria-describedby="import-ai-disclosure"');
  });

  it("shows no disclosure text, and the file field points at none, without a key", () => {
    const html = upload(false);

    expect(html).not.toMatch(/OpenAI|AI|masked|suggest/);
    expect(html).not.toContain("import-ai-disclosure");
    expect(html).not.toContain("aria-describedby");
  });

  it("asks only for the file: no import profile to pick", () => {
    const html = upload(true, true);

    expect(html).toContain('type="file"');
    expect(html).not.toContain("Import profile");
    expect(html).not.toContain('name="profileId"');
  });

  it("has an empty announcement region before any suggestion arrives", () => {
    expect(upload(false)).toMatch(/<p aria-live="polite" aria-atomic="true" class="sr-only"><\/p>/);
  });

  it("says what is sent for category suggestions, and that a name might get through, when on", () => {
    const html = upload(false, true);

    expect(html).toContain('id="import-categorize-disclosure"');
    expect(html).toContain('aria-describedby="import-categorize-disclosure"');
    expect(html).toContain("sent to an AI service");
    expect(html).not.toContain("OpenAI");
    expect(html).toContain("a name inside a merchant string might get through");
    expect(html).toContain("accept");
  });

  it("points the file field at both disclosures when both are on", () => {
    expect(upload(true, true)).toContain(
      'aria-describedby="import-ai-disclosure import-categorize-disclosure"',
    );
  });

  it("shows nothing about category suggestions when they are off", () => {
    const html = upload(false, false);

    expect(html).not.toContain("import-categorize-disclosure");
    expect(html).not.toContain("merchant string");
  });
});

describe("the note under the import result", () => {
  const note = (suggestions: Parameters<typeof AfterImportNote>[0]["suggestions"]) =>
    renderToStaticMarkup(<AfterImportNote suggestions={suggestions} />);

  it("says how many transactions got a suggestion", () => {
    expect(note({ status: "suggested", rows: 3 })).toContain("3 transactions");
  });

  it("says when suggestions are unavailable, and when the limit is reached", () => {
    expect(note({ status: "unavailable" })).toContain("aren&#x27;t available right now");
    expect(note({ status: "capped", rows: 0 })).toContain("daily limit");
  });

  it("renders nothing when the feature is off or there was nothing to ask", () => {
    expect(note({ status: "off" })).toBe("");
    expect(note({ status: "nothing" })).toBe("");
  });
});
