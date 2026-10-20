import { describe, expect, it } from "vitest";
import { readCsv } from "./csv";

const utf8 = (text: string) => new TextEncoder().encode(text);

describe("readCsv", () => {
  it("splits a comma-separated file into headers and rows", () => {
    const result = readCsv(utf8("Date,Amount\n2026-03-01,-4.20\n2026-03-02,10.00\n"));

    expect(result).toEqual({
      ok: true,
      delimiter: ",",
      skipLines: 0,
      headers: ["Date", "Amount"],
      rows: [
        ["2026-03-01", "-4.20"],
        ["2026-03-02", "10.00"],
      ],
    });
  });

  it.each([
    [";", "Date;Amount;Payee\n2026-03-01;-4,20;GROCERY MART, LTD\n"],
    ["\t", "Date\tAmount\tPayee\n2026-03-01\t-4,20\tGROCERY MART, LTD\n"],
  ])("detects %j as the delimiter", (delimiter, text) => {
    const result = readCsv(utf8(text));

    expect(result).toMatchObject({
      ok: true,
      delimiter,
      headers: ["Date", "Amount", "Payee"],
      rows: [["2026-03-01", "-4,20", "GROCERY MART, LTD"]],
    });
  });

  it("uses the given delimiter instead of detecting one", () => {
    const result = readCsv(utf8("a;b,c\n1;2,3\n"), { delimiter: "," });

    expect(result).toMatchObject({ delimiter: ",", headers: ["a;b", "c"], rows: [["1;2", "3"]] });
  });

  it("drops a UTF-8 byte order mark", () => {
    const result = readCsv(
      new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("Date;Payee\n2026-03-01;Café\n")]),
    );

    expect(result).toMatchObject({ headers: ["Date", "Payee"], rows: [["2026-03-01", "Café"]] });
  });

  it("decodes a windows-125x code page when given one", () => {
    // "CAFÉ" in windows-1252, where É is 0xC9.
    const bytes = new Uint8Array([...utf8("Payee;Amount\nCAF"), 0xc9, ...utf8(";1,00\n")]);

    expect(readCsv(bytes, { encoding: "windows-1252" })).toMatchObject({
      rows: [["CAFÉ", "1,00"]],
    });
  });

  it("refuses an encoding the platform doesn't know", () => {
    expect(readCsv(utf8("a,b\n1,2\n"), { encoding: "no-such-code-page" })).toEqual({
      ok: false,
      reason: "unknown-encoding",
    });
  });

  it("refuses bytes that aren't valid in the encoding", () => {
    // A windows-125x file read as UTF-8.
    const bytes = new Uint8Array([...utf8("Payee;Amount\nCAF"), 0xc9, ...utf8(";1,00\n")]);

    expect(readCsv(bytes)).toEqual({ ok: false, reason: "invalid-encoding" });
  });

  const withPreamble = utf8(
    '"Statement for EXAMPLE ACCOUNT, March 2026";\n' +
      "Date;Amount;Payee;\n" +
      "2026-03-01;-4,20;GROCERY MART;\n" +
      "2026-03-02;10,00;ACME LTD;\n",
  );

  it("skips the given number of preamble lines", () => {
    expect(readCsv(withPreamble, { skipLines: 1 })).toMatchObject({
      skipLines: 1,
      headers: ["Date", "Amount", "Payee"],
    });
  });

  it("guesses the header as the first line with the file's usual column count", () => {
    expect(readCsv(withPreamble)).toEqual({
      ok: true,
      delimiter: ";",
      skipLines: 1,
      headers: ["Date", "Amount", "Payee"],
      rows: [
        ["2026-03-01", "-4,20", "GROCERY MART"],
        ["2026-03-02", "10,00", "ACME LTD"],
      ],
    });
  });

  it("keeps an empty last column that has a header", () => {
    expect(readCsv(utf8("Date;Note\n2026-03-01;\n"))).toMatchObject({
      headers: ["Date", "Note"],
      rows: [["2026-03-01", ""]],
    });
  });

  it("reads quoted fields with delimiters, line breaks and doubled quotes", () => {
    const result = readCsv(
      utf8('Payee;Description\r\n"SHOP ""BEST"" LTD";"line one\r\nline; two"\r\n'),
    );

    expect(result).toMatchObject({
      delimiter: ";",
      headers: ["Payee", "Description"],
      rows: [['SHOP "BEST" LTD', "line one\r\nline; two"]],
    });
  });
});
