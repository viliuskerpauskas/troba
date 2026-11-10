import { describe, expect, it } from "vitest";
import { parseRows, type ImportProfile } from "./profile";
import { readSpreadsheet } from "./spreadsheet";
import {
  encryptedWorkbook,
  writeWorkbook,
  zipOfText,
  type FixtureBookType,
} from "./spreadsheet-fixture";

const bookTypes: FixtureBookType[] = ["xlsx", "xls", "ods"];

// A profile for text written the other way round from what typed cells become: decimal commas
// and day-first dates.
const commaProfile: ImportProfile = {
  name: "Example Bank (sheet)",
  skipLines: 0,
  delimiter: null,
  encoding: "utf-8",
  decimalSeparator: ",",
  dateFormat: "DD.MM.YYYY",
  columns: { bookingDate: "Date", amount: "Amount", counterparty: "Payee" },
  debitValues: null,
};

function read(bytes: Uint8Array, options?: { skipLines?: number }) {
  const table = readSpreadsheet(bytes, options);
  if (!table.ok) throw new Error(table.reason);
  return table;
}

describe("readSpreadsheet", () => {
  it.each(bookTypes)("reads the first sheet of an %s workbook only", (bookType) => {
    const bytes = writeWorkbook(
      [
        ["Date", "Amount", "Payee"],
        ["01.03.2026", "-4,20", "GROCERY MART"],
      ],
      { bookType, more: [[["Notes"], ["This sheet is not a statement"]]] },
    );

    expect(read(bytes)).toMatchObject({
      skipLines: 0,
      headers: ["Date", "Amount", "Payee"],
      rows: [["01.03.2026", "-4,20", "GROCERY MART"]],
    });
  });

  it.each(bookTypes)("reads typed numbers in %s as their exact decimal", (bookType) => {
    const bytes = writeWorkbook(
      [["Amount"], [0.1], [1234.56], [-4.2], [-0.01], [10], [0.1 + 0.2]],
      { bookType },
    );

    expect(read(bytes).rows).toEqual([
      ["0.1"],
      ["1234.56"],
      ["-4.2"],
      ["-0.01"],
      ["10"],
      // Not an amount a bank writes: its shortest decimal has too many places to be cents.
      ["0.30000000000000004"],
    ]);
  });

  it.each(bookTypes)("reads typed dates in %s as their day", (bookType) => {
    const bytes = writeWorkbook(
      [
        ["Date"],
        [{ date: "2026-01-05" }],
        [{ date: "2026-12-31 23:30:00" }],
        [{ date: "2024-02-29" }],
      ],
      { bookType },
    );

    expect(read(bytes).rows).toEqual([["2026-01-05"], ["2026-12-31"], ["2024-02-29"]]);
  });

  it("reads typed cells to the cent and the day whatever the profile says about text", () => {
    const bytes = writeWorkbook([
      ["Date", "Amount", "Payee"],
      [{ date: "2026-03-01" }, 1234.56, "GROCERY MART"],
      [{ date: "2026-03-02" }, -0.1, "CORNER CAFE"],
      // Text cells are the bank's own writing, read as the profile says.
      ["03.03.2026", "-1.234,50", "BOOK NOOK"],
    ]);

    const parsed = parseRows(commaProfile, read(bytes), { accountCurrency: "EUR" });

    if (!parsed.ok) throw new Error(parsed.reason);
    expect(parsed.failed).toEqual([]);
    expect(parsed.rows.map(({ bookedOn, amountCents }) => [bookedOn, amountCents])).toEqual([
      ["2026-03-01", 123456n],
      ["2026-03-02", -10n],
      ["2026-03-03", -123450n],
    ]);
  });

  it("refuses a typed number with more decimals than cents", () => {
    const bytes = writeWorkbook([
      ["Date", "Amount"],
      [{ date: "2026-03-01" }, 0.1 + 0.2],
    ]);

    const parsed = parseRows(
      { ...commaProfile, columns: { bookingDate: "Date", amount: "Amount" } },
      read(bytes),
      { accountCurrency: "EUR" },
    );

    expect(parsed).toMatchObject({
      ok: true,
      rows: [],
      failed: [{ row: 1, reason: "invalid-amount" }],
    });
  });

  it("reads booleans and empty cells as text", () => {
    const bytes = writeWorkbook([
      ["Booked", "Note", "Amount"],
      [true, null, 1],
    ]);

    expect(read(bytes).rows).toEqual([["TRUE", "", "1"]]);
  });

  it("guesses the preamble rows above the header, as for CSV", () => {
    const bytes = writeWorkbook([
      ["Statement of account"],
      [],
      ["Date", "Amount", "Payee"],
      [{ date: "2026-03-01" }, -4.2, "GROCERY MART"],
      [{ date: "2026-03-02" }, 10, "EXAMPLE EMPLOYER"],
    ]);

    expect(read(bytes)).toMatchObject({
      skipLines: 2,
      headers: ["Date", "Amount", "Payee"],
      rows: [
        ["2026-03-01", "-4.2", "GROCERY MART"],
        ["2026-03-02", "10", "EXAMPLE EMPLOYER"],
      ],
    });
  });

  it("finds the header above rows whose last cells are empty", () => {
    const bytes = writeWorkbook([
      ["Statement of account"],
      ["Date", "Amount", "Payee", "Note"],
      [{ date: "2026-03-01" }, -4.2, "GROCERY MART"],
      [{ date: "2026-03-02" }, -2.5, "CORNER CAFE"],
      [{ date: "2026-03-03" }, 10, "EXAMPLE EMPLOYER", "Salary"],
    ]);

    expect(read(bytes)).toMatchObject({
      skipLines: 1,
      headers: ["Date", "Amount", "Payee", "Note"],
    });
  });

  it("skips the given preamble rows instead of guessing", () => {
    const bytes = writeWorkbook([
      ["Statement of account", "March"],
      ["Date", "Amount"],
      [{ date: "2026-03-01" }, -4.2],
    ]);

    expect(read(bytes, { skipLines: 1 })).toMatchObject({
      skipLines: 1,
      headers: ["Date", "Amount"],
      rows: [["2026-03-01", "-4.2"]],
    });
  });

  it("reads an empty first sheet as an empty table", () => {
    expect(read(writeWorkbook([]))).toMatchObject({ headers: [], rows: [] });
  });

  it.each([
    ["an encrypted workbook", encryptedWorkbook()],
    ["a ZIP that is no workbook", zipOfText()],
    ["a cut-off workbook", writeWorkbook([["Date"], ["2026-03-01"]]).subarray(0, 300)],
    ["a CSV", new TextEncoder().encode("Date,Amount\n2026-03-01,-4.20\n")],
  ])("refuses %s as unreadable", (_name, bytes) => {
    expect(readSpreadsheet(bytes)).toEqual({ ok: false, reason: "unreadable-workbook" });
  });
});
