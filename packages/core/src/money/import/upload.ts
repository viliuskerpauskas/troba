import { maxImportFileBytes } from "./import";

// Which kind of statement file an upload is (SPEC-money M3): a CSV, a spreadsheet (XLSX, XLS or
// ODS) or a PDF. The content decides the kind and the declared type has to allow it, so a file
// is accepted only when the two agree. Nothing here parses the file: a ZIP that isn't a workbook
// gets as far as the spreadsheet reader, which refuses it.

export type StatementFileKind = "csv" | "spreadsheet" | "pdf";

export type StatementFileCheck =
  | { ok: true; kind: StatementFileKind }
  | { ok: false; reason: "file-too-large" | "not-a-statement-file" };

// Browsers declare files inconsistently. Windows with a spreadsheet app installed says
// application/vnd.ms-excel for a CSV, some say text/plain, and some send no type at all or a
// generic application/octet-stream for a type they don't know.
const declaredTypes: Record<StatementFileKind, ReadonlySet<string>> = {
  csv: new Set([
    "text/csv",
    "application/csv",
    "text/comma-separated-values",
    "text/x-csv",
    "application/vnd.ms-excel",
    "text/plain",
    "",
  ]),
  spreadsheet: new Set([
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.oasis.opendocument.spreadsheet",
    "application/vnd.ms-excel",
    "application/msexcel",
    "application/x-msexcel",
    "application/x-excel",
    "application/x-xls",
    "application/octet-stream",
    "",
  ]),
  pdf: new Set(["application/pdf", "application/x-pdf", "application/octet-stream", ""]),
};

const zipMagic = [0x50, 0x4b, 0x03, 0x04]; // XLSX and ODS
const oleMagic = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]; // XLS
const pdfMagic = [...new TextEncoder().encode("%PDF-")];

// CSV has no magic bytes, so the content check is that the start reads as text: no control
// characters but tab and line breaks. Any single-byte code page or UTF-8 passes.
const sniffedBytes = 8192;

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  return magic.every((byte, i) => bytes[i] === byte);
}

function isText(bytes: Uint8Array): boolean {
  return bytes
    .subarray(0, sniffedBytes)
    .every((byte) =>
      byte >= 0x20 ? byte !== 0x7f : byte === 0x09 || byte === 0x0a || byte === 0x0d,
    );
}

function contentKind(bytes: Uint8Array): StatementFileKind | null {
  if (bytes.byteLength === 0) return null;
  if (startsWith(bytes, zipMagic) || startsWith(bytes, oleMagic)) return "spreadsheet";
  // Checked before text: a PDF starts with a text line before its binary streams.
  if (startsWith(bytes, pdfMagic)) return "pdf";
  if (isText(bytes)) return "csv";
  return null;
}

// The size limit comes first, so that an oversized file is refused before its content is read.
export function checkStatementFile(file: { type: string; bytes: Uint8Array }): StatementFileCheck {
  if (file.bytes.byteLength > maxImportFileBytes) return { ok: false, reason: "file-too-large" };
  const kind = contentKind(file.bytes);
  if (!kind || !declaredTypes[kind].has(file.type.toLowerCase())) {
    return { ok: false, reason: "not-a-statement-file" };
  }
  return { ok: true, kind };
}
