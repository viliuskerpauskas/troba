import { statementFileKinds, type StatementFileKind } from "./file-kinds";
import { maxImportFileBytes } from "./import";
import { isWorkbookContainer } from "./spreadsheet";

// Which kind of statement file an upload is (SPEC-money M3): a CSV, a spreadsheet (XLSX, XLS or
// ODS) or a PDF. The content decides the kind and the declared type has to allow it, so a file
// is accepted only when the two agree. Nothing here parses the file: a ZIP that isn't a workbook
// gets as far as the spreadsheet reader, which refuses it.

export type StatementFileCheck =
  | { ok: true; kind: StatementFileKind }
  | { ok: false; reason: "file-too-large" | "not-a-statement-file" }
  // A PDF, on a server that can't read one: PDFs are read by a model (ADR-0018), and there is no key.
  | { ok: false; reason: "pdf-unavailable" };

export type StatementFileCheckOptions = {
  // The server has a statement model client. Off unless the caller says so.
  pdfAvailable?: boolean;
};

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
  // A ZIP (XLSX, ODS) or OLE container (XLS).
  if (isWorkbookContainer(bytes)) return "spreadsheet";
  // Checked before text: a PDF starts with a text line before its binary streams.
  if (startsWith(bytes, pdfMagic)) return "pdf";
  if (isText(bytes)) return "csv";
  return null;
}

// The size limit comes first, so that an oversized file is refused before its content is read.
export function checkStatementFile(
  file: { type: string; bytes: Uint8Array },
  { pdfAvailable = false }: StatementFileCheckOptions = {},
): StatementFileCheck {
  if (file.bytes.byteLength > maxImportFileBytes) return { ok: false, reason: "file-too-large" };
  const kind = contentKind(file.bytes);
  if (!kind || !statementFileKinds[kind].declaredTypes.includes(file.type.toLowerCase())) {
    return { ok: false, reason: "not-a-statement-file" };
  }
  if (kind === "pdf" && !pdfAvailable) return { ok: false, reason: "pdf-unavailable" };
  return { ok: true, kind };
}
