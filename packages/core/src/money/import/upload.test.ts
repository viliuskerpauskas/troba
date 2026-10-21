import { describe, expect, it } from "vitest";
import { isCsvUpload } from "./upload";

const bytes = (text: string) => new TextEncoder().encode(text);
const csv = bytes("Date;Amount\n2026-03-01;-4,20\r\n2026-03-02;\t10,00\n");

describe("isCsvUpload", () => {
  it.each(["text/csv", "application/vnd.ms-excel", "text/plain", ""])(
    "accepts a text file declared as %j",
    (type) => {
      expect(isCsvUpload({ type, bytes: csv })).toBe(true);
    },
  );

  it("accepts text in a single-byte code page", () => {
    const windows1257 = new Uint8Array([0x44, 0x61, 0x74, 0x61, 0x3b, 0xe0, 0xe8, 0x0a]);

    expect(isCsvUpload({ type: "text/csv", bytes: windows1257 })).toBe(true);
  });

  it.each(["application/pdf", "image/png", "application/zip"])(
    "refuses a file declared as %j",
    (type) => {
      expect(isCsvUpload({ type, bytes: csv })).toBe(false);
    },
  );

  it.each([
    ["a spreadsheet", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00])],
    ["a PDF", bytes("%PDF-1.7\n%âãÏÓ\n1 0 obj\n")],
    ["a file with a NUL byte", bytes("Date;Amount\n2026-03-01;\u0000\n")],
  ])("refuses %s named .csv", (_name, content) => {
    expect(isCsvUpload({ type: "text/csv", bytes: content })).toBe(false);
  });
});
