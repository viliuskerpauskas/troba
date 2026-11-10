import { describe, expect, it } from "vitest";
import { maxImportFileBytes } from "./import";
import { checkStatementFile } from "./upload";

const bytes = (text: string) => new TextEncoder().encode(text);
const csv = bytes("Date;Amount\n2026-03-01;-4,20\r\n2026-03-02;\t10,00\n");
// The first bytes of each container, followed by some filler: the check reads only the start.
const withFiller = (magic: number[]) => new Uint8Array([...magic, 0x14, 0x00, 0x06, 0x00, 0x08]);
const zip = withFiller([0x50, 0x4b, 0x03, 0x04]);
const ole = withFiller([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const pdf = bytes("%PDF-1.7\n%âãÏÓ\n1 0 obj\n");
const png = withFiller([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const xlsxType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const odsType = "application/vnd.oasis.opendocument.spreadsheet";
const xlsType = "application/vnd.ms-excel";

describe("checkStatementFile", () => {
  it.each(["text/csv", "TEXT/CSV", "application/vnd.ms-excel", "text/plain", ""])(
    "accepts text declared as %j as a CSV",
    (type) => {
      expect(checkStatementFile({ type, bytes: csv })).toEqual({ ok: true, kind: "csv" });
    },
  );

  it("accepts text in a single-byte code page as a CSV", () => {
    const windows1257 = new Uint8Array([0x44, 0x61, 0x74, 0x61, 0x3b, 0xe0, 0xe8, 0x0a]);

    expect(checkStatementFile({ type: "text/csv", bytes: windows1257 })).toEqual({
      ok: true,
      kind: "csv",
    });
  });

  it.each([
    ["an XLSX", xlsxType, zip],
    ["an ODS", odsType, zip],
    ["an XLS", xlsType, ole],
    ["an XLS declared the old way", "application/msexcel", ole],
    ["an XLSX with no declared type", "", zip],
    ["an XLS declared as generic bytes", "application/octet-stream", ole],
  ])("accepts %s as a spreadsheet", (_name, type, content) => {
    expect(checkStatementFile({ type, bytes: content })).toEqual({
      ok: true,
      kind: "spreadsheet",
    });
  });

  it.each([
    "application/pdf",
    "APPLICATION/PDF",
    "application/x-pdf",
    "application/octet-stream",
    "",
  ])("accepts a PDF declared as %j when PDF import is available", (type) => {
    expect(checkStatementFile({ type, bytes: pdf }, { pdfAvailable: true })).toEqual({
      ok: true,
      kind: "pdf",
    });
  });

  it.each([{}, { pdfAvailable: false }])(
    "refuses a PDF as unavailable when the server can't read one (%j)",
    (options) => {
      expect(checkStatementFile({ type: "application/pdf", bytes: pdf }, options)).toEqual({
        ok: false,
        reason: "pdf-unavailable",
      });
    },
  );

  it.each([
    ["an image named .xlsx", xlsxType, png],
    ["an image with no declared type", "", png],
    ["text declared as a PDF", "application/pdf", csv],
    ["text declared as an XLSX", xlsxType, csv],
    ["a ZIP declared as a PDF", "application/pdf", zip],
    ["a PDF declared as a CSV", "text/csv", pdf],
    ["a PDF declared as a spreadsheet", xlsxType, pdf],
    ["a ZIP declared as a CSV", "text/csv", zip],
    ["an XLS declared as text", "text/plain", ole],
    ["a ZIP declared as an image", "image/png", zip],
    ["text declared as an image", "image/png", csv],
    ["text declared as generic bytes", "application/octet-stream", csv],
    ["a file with a NUL byte named .csv", "text/csv", bytes("Date;Amount\n2026-03-01;\u0000\n")],
    ["a file with a DEL byte named .csv", "text/csv", bytes("Date;Amount\n2026-03-01;\u007f\n")],
    [
      "a PDF without its version dash",
      "application/pdf",
      Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0, 1]),
    ],
  ])("refuses %s as not a statement file", (_name, type, content) => {
    expect(checkStatementFile({ type, bytes: content })).toEqual({
      ok: false,
      reason: "not-a-statement-file",
    });
  });

  it("refuses an empty file as not a statement file", () => {
    expect(checkStatementFile({ type: "text/csv", bytes: new Uint8Array() })).toEqual({
      ok: false,
      reason: "not-a-statement-file",
    });
  });

  it("refuses a file over the size limit before looking at its content", () => {
    const big = new Uint8Array(maxImportFileBytes + 1);
    big.set(pdf);

    expect(checkStatementFile({ type: "application/pdf", bytes: big })).toEqual({
      ok: false,
      reason: "file-too-large",
    });
  });

  it("accepts a file at the size limit", () => {
    const atLimit = new Uint8Array(maxImportFileBytes).fill(0x61);

    expect(checkStatementFile({ type: "text/csv", bytes: atLimit })).toEqual({
      ok: true,
      kind: "csv",
    });
  });
});
