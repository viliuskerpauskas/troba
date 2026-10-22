import { describe, expect, it } from "vitest";
import { readCsv, readCsvHeaders } from "./csv";

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

  it("guesses the header in a short file whose preamble outnumbers its rows", () => {
    const text = "Statement\nEXAMPLE ACCOUNT\nMarch 2026\nDate,Amount\n2026-03-01,1.00\n";

    expect(readCsv(utf8(text))).toMatchObject({
      skipLines: 3,
      headers: ["Date", "Amount"],
      rows: [["2026-03-01", "1.00"]],
    });
  });

  it.each([
    [
      "rows with stray delimiters, wider than the header",
      "Date,Payee,Amount\n2026-03-01,SHOP,1.00\n2026-03-02,ACME, INC,2.00\n" +
        "2026-03-03,FOO, LTD,3.00\n2026-03-04,BAR,4.00\n2026-03-05,BAZ,5.00\n",
      0,
    ],
    [
      "preamble lines wider than the header",
      "Account,EXAMPLE ACCOUNT,EUR,Example Bank\nPeriod,2026-03-01,2026-03-31,x\n" +
        "Date,Amount\n2026-03-01,1.00\n2026-03-02,2.00\n2026-03-03,3.00\n",
      2,
    ],
    // As many preamble lines as header lines: the wider one is the header.
    ["a header with no rows yet", "Statement;March\nDate;Amount;Payee\n", 1],
  ])("guesses the header past %s", (_, text, skipLines) => {
    expect(readCsv(utf8(text))).toMatchObject({ skipLines });
  });

  it("decodes a file with a UTF-8 byte order mark as UTF-8 whatever the encoding given", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("Payee;Amount\nCAFÉ;1,00\n")]);

    expect(readCsv(bytes, { encoding: "windows-1252" })).toMatchObject({
      headers: ["Payee", "Amount"],
      rows: [["CAFÉ", "1,00"]],
    });
  });

  it("keeps a quote inside a field as a character", () => {
    const text = 'Date;Payee\n2026-03-01;TV 55" SHOP\n2026-03-02;CAFE "SUNNY" LTD\n';

    expect(readCsv(utf8(text))).toMatchObject({
      rows: [
        ["2026-03-01", 'TV 55" SHOP'],
        ["2026-03-02", 'CAFE "SUNNY" LTD'],
      ],
    });
  });

  it("refuses a file that ends inside a quoted field", () => {
    const text = 'Date;Payee\n2026-03-01;"GROCERY MART\n2026-03-02;ACME\n';

    expect(readCsv(utf8(text))).toEqual({ ok: false, reason: "unterminated-quote" });
    expect(readCsv(utf8(text), { delimiter: ";" })).toEqual({
      ok: false,
      reason: "unterminated-quote",
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

describe("readCsvHeaders", () => {
  // Far past the part of the file it reads.
  const long = utf8(
    'Statement "Café"\nDate;Amount;Payée\n' +
      Array.from({ length: 20000 }, (_, i) => `2026-03-01;-${i},20;CAFÉ ÜBER ${i}\n`).join(""),
  );

  it("reads the same headers as the whole file gives", () => {
    expect(readCsv(long)).toMatchObject({ ok: true, skipLines: 1 });
    expect(readCsvHeaders(long, { skipLines: 1, delimiter: null, encoding: "utf-8" })).toEqual({
      ok: true,
      headers: ["Date", "Amount", "Payée"],
    });
  });

  it("reads only the start of a long file", () => {
    // A byte that isn't UTF-8 at the very end: reading the whole file would refuse it.
    const brokenEnd = new Uint8Array([...long, 0xff]);

    expect(readCsv(brokenEnd)).toEqual({ ok: false, reason: "invalid-encoding" });
    expect(readCsvHeaders(brokenEnd, { skipLines: 1, delimiter: null, encoding: "utf-8" })).toEqual(
      { ok: true, headers: ["Date", "Amount", "Payée"] },
    );
  });

  // A file whose last byte read (the read stops at 64 KiB) starts the given text, as a field of
  // its own.
  const crossingAt = (text: string) => {
    const header = "Date;Amount;Payée\n";
    const filler = 64 * 1024 - utf8(header).byteLength;
    const row = "2026-03-01;-1,00;";
    return utf8(
      header + row + "x".repeat(filler - row.length - 2) + ";" + text + "\n2026-03-02;-1,00;B\n",
    );
  };

  it("reads a character split where the read stops", () => {
    // "É" is two bytes in UTF-8: the first is read, the second isn't.
    const split = crossingAt("ÉCOLE");

    expect(split[64 * 1024 - 1]).toBe(0xc3);
    expect(readCsvHeaders(split, { skipLines: 0, delimiter: ";", encoding: "utf-8" })).toEqual({
      ok: true,
      headers: ["Date", "Amount", "Payée"],
    });
  });

  it("reads the whole file when the header lies past where the read stops", () => {
    const longTitle = utf8(`${"x".repeat(70 * 1024)}\nDate;Amount\n2026-03-01;-1,00\n`);

    expect(readCsvHeaders(longTitle, { skipLines: 1, delimiter: ";", encoding: "utf-8" })).toEqual({
      ok: true,
      headers: ["Date", "Amount"],
    });
  });

  it("reads the whole file when the read stops inside a quoted field", () => {
    const quoted = crossingAt('"a note\nover\nlines"');

    expect(readCsv(quoted)).toMatchObject({ ok: true });
    expect(readCsvHeaders(quoted, { skipLines: 0, delimiter: ";", encoding: "utf-8" })).toEqual({
      ok: true,
      headers: ["Date", "Amount", "Payée"],
    });
  });

  it("reads with the given settings", () => {
    const text = utf8("Title\na;b,c\n1;2,3\n");

    expect(readCsvHeaders(text, { skipLines: 1, delimiter: ",", encoding: "utf-8" })).toEqual({
      ok: true,
      headers: ["a;b", "c"],
    });
    expect(readCsvHeaders(text, { skipLines: 0, delimiter: ";", encoding: "utf-8" })).toEqual({
      ok: true,
      headers: ["Title"],
    });
  });

  it("refuses a file that isn't in the encoding", () => {
    const latin1 = new Uint8Array([0x61, 0x3b, 0xe9, 0x0a, 0x31, 0x3b, 0x32, 0x0a]);

    expect(readCsvHeaders(latin1, { skipLines: 0, delimiter: null, encoding: "utf-8" })).toEqual({
      ok: false,
      reason: "invalid-encoding",
    });
  });
});
