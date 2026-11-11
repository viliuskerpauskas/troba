import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { dateFormats } from "@troba/core";
import type { ImportState } from "./actions";
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
  commitPdfImportAction: vi.fn(),
  createPdfImportAccountAction: vi.fn(),
  discardPdfImportAction: vi.fn(),
  pdfImportStatusAction: vi.fn(),
  previewPdfImportAction: vi.fn(),
  startPdfImportAction: vi.fn(),
}));

const upload = (aiEnabled: boolean, categorizeEnabled = false, pdfEnabled = false) =>
  renderToStaticMarkup(
    <ImportWizard
      dateFormats={dateFormats}
      maxBytes={1024}
      aiEnabled={aiEnabled}
      categorizeEnabled={categorizeEnabled}
      pdfEnabled={pdfEnabled}
    />,
  );

// The wizard opened on a later step, as the page does for a PDF import picked up again.
const at = (resumed: ImportState) =>
  renderToStaticMarkup(
    <ImportWizard
      dateFormats={dateFormats}
      maxBytes={1024}
      aiEnabled
      categorizeEnabled={false}
      pdfEnabled
      resumed={resumed}
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

describe("the import wizard's PDF steps", () => {
  it("takes a PDF only when the server can read one", () => {
    const withPdf = upload(true, false, true);
    expect(withPdf).toMatch(/accept="[^"]*\.pdf,application\/pdf"/);
    expect(withPdf).toContain("CSV, XLSX, XLS, ODS or PDF");

    const without = upload(true, false, false);
    expect(without).not.toMatch(/accept="[^"]*pdf/);
    expect(without).not.toContain("PDF");
  });

  it("says plainly what is sent before a PDF goes anywhere, and lets the user decline", () => {
    const html = at({ step: "pdf-confirm", filename: "statement.pdf" });

    expect(html).toMatch(/the whole\s+statement is sent to it, including every amount/);
    expect(html).toContain("account numbers");
    expect(html).toContain('value="pdf-confirm"');
    expect(html).toContain("Don&#x27;t send");
    expect(html).not.toMatch(/don&#x27;t ask again/i);
  });

  it("shows the reading state, which survives leaving the page", () => {
    const html = at({ step: "pdf-reading", pdfImportId: "id-1", filename: "statement.pdf" });

    expect(html).toContain("Reading your statement");
    expect(html).toContain("You can leave this page and");
  });

  it("shows a failed reading with a retry", () => {
    const html = at({
      step: "pdf-failed",
      pdfImportId: "id-1",
      filename: "statement.pdf",
      message: "Nothing was saved.",
    });

    expect(html).toContain("Nothing was saved.");
    expect(html).toContain("Try again");
  });

  it("says under the preview's heading that the statement was read by AI", () => {
    const html = at({
      step: "pdf-preview",
      pdfImportId: "id-1",
      filename: "statement.pdf",
      accountId: null,
      preview: {
        ok: true,
        account: { id: "a", name: "Example Bank" },
        rowsParsed: 1,
        rowsNew: 1,
        rowsDuplicate: 0,
        rowsFailed: 1,
        failed: [{ row: 2, reason: "invalid-date" }],
        debitCredit: null,
        fees: 0,
        skipped: null,
        mixedFormats: false,
      },
    });

    expect(html).toContain("Read by AI from statement.pdf");
    expect(html).toContain("Row 2: AI read a date that isn");
    expect(html).not.toContain("profile");
    expect(html).toContain('value="pdf-commit"');
    expect(html).not.toContain("couldn");
    expect(html).not.toContain("won&#x27;t be detected as duplicates");
  });

  it("says when the statement's total couldn't be checked", () => {
    const html = at({
      step: "pdf-preview",
      pdfImportId: "id-1",
      filename: "statement.pdf",
      accountId: null,
      balanceUnchecked: true,
      preview: {
        ok: true,
        account: { id: "a", name: "Example Bank" },
        rowsParsed: 1,
        rowsNew: 1,
        rowsDuplicate: 0,
        rowsFailed: 0,
        failed: [],
        debitCredit: null,
        fees: 0,
        skipped: null,
        mixedFormats: false,
      },
    });

    expect(html).toContain("couldn&#x27;t be checked");
  });
});

describe("the mixed-formats warning", () => {
  const preview = (mixedFormats: boolean) => ({
    ok: true as const,
    account: { id: "a", name: "Example Bank" },
    rowsParsed: 1,
    rowsNew: 1,
    rowsDuplicate: 0,
    rowsFailed: 0,
    failed: [],
    debitCredit: null,
    fees: 0,
    skipped: null,
    mixedFormats,
  });
  const pdf = (mixedFormats: boolean) =>
    at({
      step: "pdf-preview",
      pdfImportId: "id-1",
      filename: "statement.pdf",
      accountId: null,
      preview: preview(mixedFormats),
    });
  const file = (mixedFormats: boolean) =>
    at({
      step: "preview",
      profile: { id: "p", name: "Example Bank", brand: null },
      accountId: null,
      preview: preview(mixedFormats),
    });

  it("says a PDF's rows won't be matched with the account's CSV or spreadsheet rows", () => {
    const html = pdf(true);
    expect(html).toContain("imported from a CSV or spreadsheet file");
    expect(html).toContain("won&#x27;t be detected as duplicates");
  });

  it("says a file's rows won't be matched with the account's PDF rows", () => {
    const html = file(true);
    expect(html).toContain("imported from a PDF statement");
    expect(html).toContain("won&#x27;t be detected as duplicates");
  });

  it("isn't shown without rows of the other kind", () => {
    expect(pdf(false)).not.toContain("won&#x27;t be detected as duplicates");
    expect(file(false)).not.toContain("won&#x27;t be detected as duplicates");
  });
});

describe("the preview of a file with fees and rows that aren't completed", () => {
  const file = (fees: number, skipped: { value: string; rows: number }[] | null) =>
    at({
      step: "preview",
      profile: { id: "p", name: "Example Bank", brand: null },
      accountId: "a",
      preview: {
        ok: true,
        account: { id: "a", name: "Example Bank" },
        rowsParsed: 5,
        rowsNew: 4,
        rowsDuplicate: 0,
        rowsFailed: 0,
        failed: [],
        debitCredit: null,
        fees,
        skipped,
        mixedFormats: false,
      },
    });

  it("says how many fees become transactions of their own", () => {
    expect(file(1, null)).toContain("1 fee charged on top of its payment");
    expect(file(2, null)).toContain("2 fees charged on top of their payments");
  });

  it("says how many rows are skipped for not being completed, by state", () => {
    const html = file(0, [
      { value: "PENDING", rows: 2 },
      { value: "", rows: 1 },
    ]);
    expect(html).toContain("Not completed, skipped");
    expect(html).toContain("PENDING");
    expect(html).toContain("2 rows");
    expect(html).toContain("(blank)");
  });

  it("says nothing of either when there are none", () => {
    const html = file(0, []);
    expect(html).not.toContain("fee");
    expect(html).not.toContain("Not completed");
  });
});

describe("the note under the import result", () => {
  const note = (suggestions: Parameters<typeof AfterImportNote>[0]["suggestions"]) =>
    renderToStaticMarkup(<AfterImportNote suggestions={suggestions} />);

  it("says suggestions are being prepared and where they will appear", () => {
    expect(note({ status: "pending" })).toContain(
      "AI is preparing category suggestions. They appear on the transactions list when ready",
    );
  });

  it("says when suggestions are unavailable", () => {
    expect(note({ status: "unavailable" })).toContain("aren&#x27;t available right now");
  });

  it("renders nothing when the feature is off or there was nothing to ask", () => {
    expect(note({ status: "off" })).toBe("");
    expect(note({ status: "nothing" })).toBe("");
  });
});
