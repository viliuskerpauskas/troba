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

export type ReadCsvResult =
  ({ ok: true } & CsvTable) | { ok: false; reason: "unknown-encoding" | "invalid-encoding" };

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
  const { delimiter, records } = options.delimiter
    ? { delimiter: options.delimiter, records: splitRecords(decoded.text, options.delimiter) }
    : sniff(decoded.text);

  // A preamble (a statement title) sits above the header. Unless the profile says how many lines
  // it has, the header is the first line as wide as most of the file.
  const usual = usualWidth(records.filter(isNonEmpty)).width;
  const skipLines =
    options.skipLines ??
    Math.max(
      0,
      records.findIndex((r) => r.length === usual),
    );
  const [headers = [], ...rows] = records.slice(skipLines).filter(isNonEmpty);

  // Some banks end every line with the delimiter, which reads as an empty, unnamed last column.
  if (headers.at(-1) === "") {
    headers.pop();
    for (const row of rows) if (row.length > headers.length && row.at(-1) === "") row.pop();
  }
  return { ok: true, delimiter, skipLines, headers, rows };
}

// TextDecoder drops a UTF-8 byte order mark. Fatal, so a file in the wrong encoding is refused
// rather than imported with replacement characters in every name.
function decode(
  bytes: Uint8Array,
  encoding: string,
): { ok: true; text: string } | { ok: false; reason: "unknown-encoding" | "invalid-encoding" } {
  let decoder: InstanceType<typeof TextDecoder>;
  try {
    decoder = new TextDecoder(encoding, { fatal: true });
  } catch {
    return { ok: false, reason: "unknown-encoding" };
  }
  try {
    return { ok: true, text: decoder.decode(bytes) };
  } catch {
    return { ok: false, reason: "invalid-encoding" };
  }
}

// The delimiter that gives the most records the same number of columns, more than one. A comma
// inside amounts ("-4,20") or a preamble line can't outvote the real delimiter on every row.
function sniff(text: string): { delimiter: Delimiter; records: string[][] } {
  let best = { delimiter: delimiters[0]!, records: [] as string[][], score: -1 };
  for (const delimiter of delimiters) {
    const records = splitRecords(text, delimiter);
    const { width, count } = usualWidth(records.filter(isNonEmpty));
    const score = width > 1 ? count : 0;
    if (score > best.score) best = { delimiter, records, score };
  }
  return { delimiter: best.delimiter, records: best.records };
}

// The most common number of columns, and how many records have it; the wider one on a tie.
function usualWidth(records: string[][]): { width: number; count: number } {
  const counts = new Map<number, number>();
  for (const record of records) counts.set(record.length, (counts.get(record.length) ?? 0) + 1);
  let usual = { width: 0, count: 0 };
  for (const [width, count] of counts) {
    if (count > usual.count || (count === usual.count && width > usual.width)) {
      usual = { width, count };
    }
  }
  return usual;
}

function isNonEmpty(record: string[]): boolean {
  return record.some((cell) => cell !== "");
}

// RFC 4180 records: a quoted field may hold the delimiter, line breaks and "" for a quote.
function splitRecords(text: string, delimiter: Delimiter): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char !== '"') field += char;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) {
      record.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else field += char;
  }
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}
