// The kinds of statement file troba imports (SPEC-money M3), and the formats of each: a CSV, a
// spreadsheet (XLSX, XLS or ODS) or a PDF. Adding a format starts here; the upload check, the
// import page's copy and file picker, and a new profile's starting name all follow from it.
//
// Plain data with no imports, so the client wizard can import it too, as
// @troba/core/file-kinds: the rest of the package is server-only.

export type StatementFileKind = "csv" | "spreadsheet" | "pdf";

export type StatementFileFormat = {
  // As the import page names it.
  name: string;
  extension: string;
  // The type a file picker filters by.
  type: string;
};

export const statementFileKinds: Record<
  StatementFileKind,
  {
    formats: readonly StatementFileFormat[];
    // The types a browser may declare for a file of this kind. Browsers declare files
    // inconsistently: Windows with a spreadsheet app installed says application/vnd.ms-excel for
    // a CSV, some say text/plain, and some send no type at all or a generic
    // application/octet-stream for a type they don't know.
    declaredTypes: readonly string[];
  }
> = {
  csv: {
    formats: [{ name: "CSV", extension: ".csv", type: "text/csv" }],
    declaredTypes: [
      "text/csv",
      "application/csv",
      "text/comma-separated-values",
      "text/x-csv",
      "application/vnd.ms-excel",
      "text/plain",
      "",
    ],
  },
  spreadsheet: {
    formats: [
      {
        name: "XLSX",
        extension: ".xlsx",
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
      { name: "XLS", extension: ".xls", type: "application/vnd.ms-excel" },
      { name: "ODS", extension: ".ods", type: "application/vnd.oasis.opendocument.spreadsheet" },
    ],
    declaredTypes: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.oasis.opendocument.spreadsheet",
      "application/vnd.ms-excel",
      "application/msexcel",
      "application/x-msexcel",
      "application/x-excel",
      "application/x-xls",
      "application/octet-stream",
      "",
    ],
  },
  pdf: {
    formats: [{ name: "PDF", extension: ".pdf", type: "application/pdf" }],
    declaredTypes: ["application/pdf", "application/x-pdf", "application/octet-stream", ""],
  },
};

// The kinds read as a table, with an import profile; a PDF is read by a model (ADR-0018).
export type TabularFileKind = Exclude<StatementFileKind, "pdf">;
export const tabularFileKinds: readonly TabularFileKind[] = ["csv", "spreadsheet"];

export function formatsOf(kinds: readonly StatementFileKind[]): StatementFileFormat[] {
  return kinds.flatMap((kind) => statementFileKinds[kind].formats);
}

// Matches a file name ending in one of the kinds' extensions, in any case; group 1 is the
// extension without its dot.
export function extensionPattern(kinds: readonly StatementFileKind[]): RegExp {
  const extensions = formatsOf(kinds).map((format) => format.extension.slice(1));
  return new RegExp(String.raw`\.(${extensions.join("|")})$`, "i");
}
