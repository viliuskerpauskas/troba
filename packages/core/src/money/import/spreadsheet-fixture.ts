import * as XLSX from "xlsx";

// Test fixtures only: spreadsheet statement files written in the test with the library that reads
// them, so no binary fixture is committed. Exported as @troba/core/test-spreadsheet, never from
// the package's index.

// A typed cell: a number, a boolean, or a date (a day as YYYY-MM-DD, with an optional time,
// stored as the serial number a spreadsheet keeps with a date format). A string is a text cell.
export type FixtureCell = string | number | boolean | { date: string } | null;

export type FixtureBookType = "xlsx" | "xls" | "ods";

const bookTypes: Record<FixtureBookType, XLSX.BookType> = {
  xlsx: "xlsx",
  xls: "biff8",
  ods: "ods",
};

const day = 24 * 60 * 60 * 1000;
const epoch = Date.UTC(1899, 11, 30);

// The first sheet is `rows`; `more` are further sheets after it.
export function writeWorkbook(
  rows: FixtureCell[][],
  { bookType = "xlsx", more = [] }: { bookType?: FixtureBookType; more?: FixtureCell[][][] } = {},
): Uint8Array {
  const book = XLSX.utils.book_new();
  for (const [i, sheet] of [rows, ...more].entries()) {
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet(sheet.map(toCells)),
      `Sheet${i + 1}`,
    );
  }
  return new Uint8Array(XLSX.write(book, { type: "buffer", bookType: bookTypes[bookType] }));
}

function toCells(row: FixtureCell[]): (XLSX.CellObject | null)[] {
  return row.map((cell) => {
    if (cell === null) return null;
    if (typeof cell === "string") return { t: "s", v: cell };
    if (typeof cell === "number") return { t: "n", v: cell };
    if (typeof cell === "boolean") return { t: "b", v: cell };
    const time = Date.parse(`${cell.date.replace(" ", "T")}Z`);
    return { t: "n", v: (time - epoch) / day, z: "m/d/yy" };
  });
}

// A workbook the reader can't open: an encrypted (password-protected) one, as Office writes it.
export function encryptedWorkbook(): Uint8Array {
  const container = XLSX.CFB.utils.cfb_new();
  XLSX.CFB.utils.cfb_add(container, "/EncryptionInfo", Buffer.from([4, 0, 4, 0, 0x40, 0, 0, 0]));
  XLSX.CFB.utils.cfb_add(container, "/EncryptedPackage", Buffer.alloc(64));
  return new Uint8Array(XLSX.CFB.write(container, { type: "buffer" }) as Buffer);
}

// A ZIP that is no workbook, as a word processor's document is.
export function zipOfText(): Uint8Array {
  const container = XLSX.CFB.utils.cfb_new();
  XLSX.CFB.utils.cfb_add(container, "notes.txt", Buffer.from("Example notes"));
  return new Uint8Array(XLSX.CFB.write(container, { type: "buffer", fileType: "zip" }) as Buffer);
}

// An XLSX workbook whose ZIP declares that its first sheet unzips to `declaredBytes`, in both the
// local and the central header, as a file built to exhaust memory would. Its entries are stored,
// not compressed, so a reader that trusts the declaration reads it as an ordinary workbook.
export function workbookDeclaring(declaredBytes: number): Uint8Array {
  const bytes = writeWorkbook([["Date"], ["2026-03-01"]]);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const name = new TextEncoder().encode("xl/worksheets/sheet1.xml");
  const named = (at: number) => name.every((byte, i) => bytes[at + i] === byte);
  for (let i = 0; i + 46 <= bytes.byteLength; i++) {
    const signature = view.getUint32(i, true);
    if (signature === 0x04034b50 && named(i + 30)) view.setUint32(i + 22, declaredBytes, true);
    if (signature === 0x02014b50 && named(i + 46)) view.setUint32(i + 24, declaredBytes, true);
  }
  return bytes;
}
