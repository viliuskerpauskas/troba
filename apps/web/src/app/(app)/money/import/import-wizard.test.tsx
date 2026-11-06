import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { dateFormats } from "@troba/core";
import { ImportWizard } from "./import-wizard";

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

const upload = (aiEnabled: boolean) =>
  renderToStaticMarkup(
    <ImportWizard profiles={[]} dateFormats={dateFormats} maxBytes={1024} aiEnabled={aiEnabled} />,
  );

describe("the import wizard's upload step", () => {
  it("says what is sent to OpenAI when the server has a key", () => {
    const html = upload(true);

    expect(html).toContain("are sent to OpenAI to suggest how to map the columns");
    expect(html).toContain('aria-describedby="import-ai-disclosure"');
  });

  it("shows no disclosure text, and the file field points at none, without a key", () => {
    const html = upload(false);

    expect(html).not.toMatch(/OpenAI|AI|masked|suggest/);
    expect(html).not.toContain("import-ai-disclosure");
    expect(html).not.toContain("aria-describedby");
  });

  it("has an empty announcement region before any suggestion arrives", () => {
    expect(upload(false)).toMatch(/<p aria-live="polite" aria-atomic="true" class="sr-only"><\/p>/);
  });
});
