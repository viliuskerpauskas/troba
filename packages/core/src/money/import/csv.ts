// Bank CSV files → a header row and data rows (SPEC-money M3). Knows nothing about what the
// columns mean; that is the import profile's job (./profile.ts).

export type Delimiter = "," | ";" | "\t";

export const delimiters: readonly Delimiter[] = [",", ";", "\t"];

export type CsvTable = {
  delimiter: Delimiter;
  skipLines: number;
  headers: string[];
  rows: string[][];
};

type DecodeFailure = "unknown-encoding" | "invalid-encoding";

export type ReadCsvResult =
  | ({ ok: true } & CsvTable)
  // A quote that never closes would swallow every row after it into one cell.
  | { ok: false; reason: DecodeFailure | "unterminated-quote" };

export type ReadCsvOptions = {
  // A WHATWG encoding label; UTF-8 by default.
  encoding?: string;
  // Null or absent: detected.
  delimiter?: Delimiter | null;
  // Lines above the header, counted as CSV records. Absent: guessed.
  skipLines?: number;
};

export function readCsv(bytes: Uint8Array, options: ReadCsvOptions = {}): ReadCsvResult {
  const decoded = decode(bytes, options.encoding ?? "utf-8");
  if (!decoded.ok) return decoded;
  const { delimiter, records, unterminated } = options.delimiter
    ? { delimiter: options.delimiter, ...splitRecords(decoded.text, options.delimiter) }
    : sniff(decoded.text);
  if (unterminated) return { ok: false, reason: "unterminated-quote" };

  const skipLines = options.skipLines ?? guessSkipLines(records);
  const [headers = [], ...rows] = records.slice(skipLines).filter(isNonEmpty);

  // Some banks end every line with the delimiter, which reads as an empty, unnamed last column.
  if (headers.at(-1) === "") {
    headers.pop();
    for (const row of rows) if (row.length > headers.length && row.at(-1) === "") row.pop();
  }
  return { ok: true, delimiter, skipLines, headers, rows };
}

export function isKnownEncoding(label: string): boolean {
  try {
    new TextDecoder(label);
    return true;
  } catch {
    return false;
  }
}

const utf8Bom = [0xef, 0xbb, 0xbf];

// Fatal, so a file in the wrong encoding is refused rather than imported with replacement
// characters in every name. A UTF-8 byte order mark settles the encoding whatever the profile
// says: a bank that switched to UTF-8 still matches its profile.
function decode(
  bytes: Uint8Array,
  encoding: string,
): { ok: true; text: string } | { ok: false; reason: DecodeFailure } {
  const hasBom = utf8Bom.every((byte, i) => bytes[i] === byte);
  const label = hasBom ? "utf-8" : encoding;
  if (!isKnownEncoding(label)) return { ok: false, reason: "unknown-encoding" };
  try {
    return { ok: true, text: new TextDecoder(label, { fatal: true }).decode(bytes) };
  } catch {
    return { ok: false, reason: "invalid-encoding" };
  }
}

// The delimiter that gives the most records one shared number of columns, more than one. A comma
// inside amounts ("-4,20") or a preamble line can't outvote the real delimiter on every row.
function sniff(text: string): { delimiter: Delimiter } & SplitRecords {
  let best: { delimiter: Delimiter; score: number } & SplitRecords = {
    delimiter: delimiters[0]!,
    records: [],
    unterminated: false,
    score: -1,
  };
  for (const delimiter of delimiters) {
    const split = splitRecords(text, delimiter);
    const score = sharedWidthCount(split.records.filter(isNonEmpty));
    if (score > best.score) best = { delimiter, ...split, score };
  }
  return best;
}

// How many records have the most common number of columns above one.
function sharedWidthCount(records: string[][]): number {
  const counts = widthCounts(records);
  return Math.max(0, ...[...counts].filter(([width]) => width > 1).map(([, count]) => count));
}

// A preamble (a statement title) sits above the header. The header is the first line of the
// widest width that at least two lines share (the header and a row); a preamble line is
// narrower, and in a short file it can outnumber the rows.
function guessSkipLines(records: string[][]): number {
  const counts = widthCounts(records.filter(isNonEmpty));
  const widths = [...counts.keys()].sort((a, b) => b - a);
  const width = widths.find((w) => counts.get(w)! >= 2) ?? widths[0];
  return Math.max(
    0,
    records.findIndex((record) => record.length === width),
  );
}

function widthCounts(records: string[][]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const record of records) counts.set(record.length, (counts.get(record.length) ?? 0) + 1);
  return counts;
}

function isNonEmpty(record: string[]): boolean {
  return record.some((cell) => cell !== "");
}

// RFC 4180 records: a field that starts with a quote may hold the delimiter, line breaks and ""
// for a quote. A quote later in a field is just a character (an inch mark, a nickname), as the
// bank wrote it.
type SplitRecords = {
  records: string[][];
  // The text ended inside a quoted field.
  unterminated: boolean;
};

function splitRecords(text: string, delimiter: Delimiter): SplitRecords {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let fieldStart = true;

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char !== '"') field += char;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (char === '"' && fieldStart) {
      quoted = true;
      fieldStart = false;
    } else if (char === delimiter) {
      record.push(field);
      field = "";
      fieldStart = true;
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
      fieldStart = true;
    } else {
      field += char;
      fieldStart = false;
    }
  }
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return { records, unterminated: quoted };
}
