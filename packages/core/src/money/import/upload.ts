// Whether an uploaded file may be a bank CSV (SPEC-money M3). The size limit is
// maxImportFileBytes, checked by the import itself.

// Browsers declare CSV inconsistently: Windows with a spreadsheet app installed says
// application/vnd.ms-excel, some say text/plain, and some send no type at all.
const declaredTypes = new Set([
  "text/csv",
  "application/csv",
  "text/comma-separated-values",
  "text/x-csv",
  "application/vnd.ms-excel",
  "text/plain",
  "",
]);

// CSV has no magic bytes, so the content check is that the start reads as text: no control
// characters but tab and line breaks. Spreadsheets (ZIP or OLE) and images fail it at once.
const sniffedBytes = 8192;
const pdfMagic = new TextEncoder().encode("%PDF-");

export function isCsvUpload(file: { type: string; bytes: Uint8Array }): boolean {
  if (!declaredTypes.has(file.type.toLowerCase())) return false;
  // A PDF starts with a text line before its binary streams.
  if (pdfMagic.every((byte, i) => file.bytes[i] === byte)) return false;
  return file.bytes
    .subarray(0, sniffedBytes)
    .every((byte) =>
      byte >= 0x20 ? byte !== 0x7f : byte === 0x09 || byte === 0x0a || byte === 0x0d,
    );
}
