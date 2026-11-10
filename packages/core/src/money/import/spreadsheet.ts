import * as XLSX from "xlsx";
import { isNonEmpty, usualWidth } from "./csv";

// Spreadsheet statement files (XLSX, XLS, ODS) → the same header row and data rows a CSV gives
// (SPEC-money M3, ADR-0019), so profiles, presets, the AI mapping and the manual form work on
// them unchanged. Only the first sheet is read: a bank's notes on another sheet are no statement.
//
// Typed cells never reach a profile as numbers or dates. A number becomes its shortest round-trip
// decimal string, which is exact for any amount with up to two decimals, and a date becomes
// YYYY-MM-DD from its serial number, with no time zone involved. They are marked typed, so that a
// profile reads them as such whatever it says about the bank's text (see parseRows). Text cells
// are the bank's own writing and pass through.
//
// The file is an untrusted upload: the import size limit applies before this reads it, and the
// library is asked for values only (no formulas, styles, HTML or macros).

export type TypedCell = "number" | "date";

export type SpreadsheetTable = {
  skipLines: number;
  headers: string[];
  rows: string[][];
  // Per data row, the typed cells among it; text cells are undefined.
  cellTypes: (TypedCell | undefined)[][];
};

// Corrupt, cut off, password-protected, or a ZIP or Office file that holds no workbook.
export type ReadSpreadsheetResult =
  ({ ok: true } & SpreadsheetTable) | { ok: false; reason: "unreadable-workbook" };

export type ReadSpreadsheetOptions = {
  // Rows above the header, counting from the sheet's first row. Absent: guessed.
  skipLines?: number | undefined;
};

const zipMagic = [0x50, 0x4b, 0x03, 0x04]; // XLSX and ODS
const oleMagic = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]; // XLS

// A workbook is a ZIP (XLSX, ODS) or an OLE container (XLS). The library would read much else
// too (CSV, HTML, SYLK); a statement file of another kind has a reader of its own.
export function isWorkbookContainer(bytes: Uint8Array): boolean {
  return [zipMagic, oleMagic].some((magic) => magic.every((byte, i) => bytes[i] === byte));
}

const readOptions: XLSX.ParsingOptions = {
  type: "array",
  dense: true,
  sheets: 0,
  // The number format, which tells a date from a number.
  cellNF: true,
  cellDates: false,
  cellFormula: false,
  cellHTML: false,
  cellText: false,
  cellStyles: false,
  bookVBA: false,
};

type Cell = { text: string; type: TypedCell | undefined };

export function readSpreadsheet(
  bytes: Uint8Array,
  options: ReadSpreadsheetOptions = {},
): ReadSpreadsheetResult {
  const records = readRecords(bytes);
  if (!records) return { ok: false, reason: "unreadable-workbook" };

  const texts = records.map((record) => record.map((cell) => cell.text));
  const skipLines = options.skipLines ?? guessSkipLines(texts);
  const [header = [], ...rows] = records
    .slice(skipLines)
    .filter((record) => isNonEmpty(record.map((cell) => cell.text)));
  return {
    ok: true,
    skipLines,
    headers: header.map((cell) => cell.text),
    rows: rows.map((record) => record.map((cell) => cell.text)),
    cellTypes: rows.map((record) => record.map((cell) => cell.type)),
  };
}

// A preamble (a statement title) sits above the header, as in a CSV. A sheet row ends at its last
// filled cell, so a data row with an empty last column is narrower than the header: the header is
// the first row at least as wide as most rows.
function guessSkipLines(records: string[][]): number {
  const width = usualWidth(records.filter(isNonEmpty))?.width;
  if (width === undefined) return 0;
  return Math.max(
    0,
    records.findIndex((record) => record.length >= width),
  );
}

// The first sheet's rows from its first row down, each without its empty cells at the end, so a
// title row reads as one cell as it does in a CSV. Null when the workbook can't be read.
function readRecords(bytes: Uint8Array): Cell[][] | null {
  if (!isWorkbookContainer(bytes)) return null;
  let book: XLSX.WorkBook;
  try {
    book = XLSX.read(bytes, readOptions);
  } catch {
    return null;
  }
  const name = book.SheetNames[0];
  const sheet = name === undefined ? undefined : book.Sheets[name];
  if (!sheet) return null;
  if (!sheet["!ref"]) return [];

  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const data = (sheet["!data"] ?? []) as (XLSX.CellObject | undefined)[][];
  const date1904 = Boolean(book.Workbook?.WBProps?.date1904);
  const records: Cell[][] = [];
  for (let r = 0; r <= range.e.r; r++) {
    const row = data[r] ?? [];
    const record: Cell[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) record.push(cellOf(row[c], date1904));
    while (record.length > 0 && record.at(-1)!.text === "") record.pop();
    records.push(record);
  }
  return records;
}

// The library's number-format helpers are untyped.
const ssf = XLSX.SSF as {
  is_date(format: string): boolean;
  parse_date_code(
    serial: number,
    options?: { date1904?: boolean },
  ): { y: number; m: number; d: number } | null;
};

function cellOf(cell: XLSX.CellObject | undefined, date1904: boolean): Cell {
  if (!cell || cell.v === undefined || cell.v === null) return { text: "", type: undefined };
  switch (cell.t) {
    case "s":
      return { text: String(cell.v), type: undefined };
    case "b":
      return { text: cell.v ? "TRUE" : "FALSE", type: undefined };
    case "n": {
      const value = cell.v as number;
      if (cell.z !== undefined && ssf.is_date(String(cell.z))) {
        const day = dayOf(value, date1904);
        if (day) return { text: day, type: "date" };
      }
      return { text: String(value), type: "number" };
    }
    case "d":
      // Not asked for (cellDates is off), but a format may still give one, parsed as UTC.
      return cell.v instanceof Date && !Number.isNaN(cell.v.getTime())
        ? { text: cell.v.toISOString().slice(0, 10), type: "date" }
        : { text: "", type: undefined };
    default:
      // Errors (#N/A) and stubs hold nothing to import.
      return { text: "", type: undefined };
  }
}

// YYYY-MM-DD of a date serial number, or null when it names no real day.
function dayOf(serial: number, date1904: boolean): string | null {
  const parts = ssf.parse_date_code(serial, { date1904 });
  if (!parts) return null;
  const { y, m, d } = parts;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}
