import { schema } from "@troba/db";
import { readCsv, readCsvHeaders, type Delimiter, type ReadCsvOptions } from "./csv";
import { isWorkbookContainer, readSpreadsheet, type TypedCell } from "./spreadsheet";

// A tabular statement file (SPEC-money M3), a CSV or a spreadsheet, as the header row and data
// rows everything after reading works on. The file's bytes say which reader reads it, and an
// import profile matches only files of its own kind (ADR-0019).

export const tableKinds = schema.importProfileKinds;
export type TableKind = (typeof tableKinds)[number];

export function tableKindOf(bytes: Uint8Array): TableKind {
  return isWorkbookContainer(bytes) ? "spreadsheet" : "text";
}

export type StatementTable = {
  kind: TableKind;
  skipLines: number;
  headers: string[];
  rows: string[][];
  // The delimiter a text file was read with; null for a spreadsheet.
  delimiter: Delimiter | null;
  // A spreadsheet's typed cells, per data row (see ./spreadsheet.ts).
  cellTypes?: (TypedCell | undefined)[][];
};

export type TableReadFailure =
  "unknown-encoding" | "invalid-encoding" | "unterminated-quote" | "unreadable-workbook";

export type ReadTableResult =
  ({ ok: true } & StatementTable) | { ok: false; reason: TableReadFailure };

// How a profile reads its files. Delimiter and encoding apply to text only.
export type ReadTableOptions = ReadCsvOptions;

export function readTable(bytes: Uint8Array, options: ReadTableOptions = {}): ReadTableResult {
  if (tableKindOf(bytes) === "spreadsheet") {
    const sheet = readSpreadsheet(bytes, { skipLines: options.skipLines });
    return sheet.ok ? { ...sheet, kind: "spreadsheet", delimiter: null } : sheet;
  }
  const csv = readCsv(bytes, options);
  return csv.ok ? { ...csv, kind: "text" } : csv;
}

// The headers readTable would give, for finding a file's profile by them. A text file is read
// from its start only (see readCsvHeaders); a workbook is read whole, as it can't be cut.
export function readTableHeaders(
  bytes: Uint8Array,
  options: { skipLines: number; delimiter: Delimiter | null; encoding: string },
): { ok: true; headers: string[] } | { ok: false; reason: TableReadFailure } {
  if (tableKindOf(bytes) === "text") return readCsvHeaders(bytes, options);
  const sheet = readSpreadsheet(bytes, { skipLines: options.skipLines });
  return sheet.ok ? { ok: true, headers: sheet.headers } : sheet;
}
