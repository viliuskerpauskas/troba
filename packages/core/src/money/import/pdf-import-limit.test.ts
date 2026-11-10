import { describe, expect, it } from "vitest";
import { defaultPdfImportDailyLimit, pdfImportDailyLimitFrom } from "./pdf-import-limit";

describe("pdfImportDailyLimitFrom", () => {
  it("is 10 a day unless AI_PDF_IMPORT_DAILY_LIMIT says otherwise", () => {
    expect(defaultPdfImportDailyLimit).toBe(10);
    expect(pdfImportDailyLimitFrom({})).toBe(10);
    expect(pdfImportDailyLimitFrom({ AI_PDF_IMPORT_DAILY_LIMIT: " 4 " })).toBe(4);
  });

  it.each(["", "0", "-3", "2.5", "many", "1e999"])("ignores %j", (value) => {
    expect(pdfImportDailyLimitFrom({ AI_PDF_IMPORT_DAILY_LIMIT: value })).toBe(10);
  });
});
