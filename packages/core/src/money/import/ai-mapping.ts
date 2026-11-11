import { z } from "zod";
import { readTable, type ReadTableOptions, type StatementTable } from "./table";
import {
  dateFormats,
  importProfileFields,
  importProfileSchema,
  parseRows,
  type ImportField,
  type ImportProfile,
} from "./profile";

// An AI-suggested import profile for a file in a format nobody has taught troba (SPEC-money M3,
// ADR-0015). A scrubbed sample goes to an injected model client; the answer is checked against
// the profile schema and the whole file, and only a proposal that reads rows comes back.
//
// Nothing here logs, and nothing may: the sample is derived from a user's bank file and the
// answer is a guess about it. Every failure, including a client that throws, is the same quiet
// "no proposal".

// ---- The port ----

// What the model client is asked. The client sends it as it is; it adds nothing from the file.
export type MappingModelRequest = {
  instructions: string;
  sample: MappingSample;
  // JSON Schema of the answer.
  schema: Record<string, unknown>;
  // Aborted when the time is up; a client that ignores it is still cut off.
  signal: AbortSignal;
};

// Resolves to the model's structured answer, unchecked: it is untrusted until proposeMapping has
// validated it. Rejects on any failure.
export type MappingModelClient = {
  suggestMapping(request: MappingModelRequest): Promise<unknown>;
};

// ---- The sample ----

export type MappingSample = {
  headers: string[];
  // At most sampleRowCount rows spread over the file, every cell scrubbed (see scrubCell).
  rows: string[][];
  // Columns whose values are all codes of one kind (debit/credit markers, or currencies; see
  // codeKindOf): their distinct values in file order. These are not personal, and a sample of
  // cells would probably miss the rarer one.
  codedValues: { header: string; values: string[] }[];
};

const sampleRowCount = 5;
// A column is coded when it has at most this many distinct values ...
const maxCodedValues = 8;
// ... each repeating on average at least this often, so a handful of values in a small file
// isn't taken for codes ...
const minRowsPerCodedValue = 2;
// ... and every value is a code of one kind, not a word. A column's cardinality can't tell a debit
// marker from a person's name (a statement with three payees looks like one with three markers), so
// what is sent raw is decided by what the value can be, never by how often it repeats: markers (one
// or two capital letters such as D, C, DR, CR, or a debit/credit marker word), or currency codes.
// Anything else, including one-word merchants and transaction types, is masked like every other
// cell. The cost is that the model sees a transaction-type column as shapes; it still maps it by
// its header. Currency codes count only in a column of nothing else: ALL, TOP and PEN are words
// too, and outside such a column they are masked.
const markerWords = new Set(["debit", "credit", "dbit", "crdt"]);

const maxShapeLength = 60;
const currencies = new Set(Intl.supportedValuesOf("currency"));

const ibanShaped = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/i;
const numeric = /^[+\d\s.,'’-]+$/;
const longDigitRun = /\d{9,}/;
// 7 or more digits with no separator or decimals are an account, reference or phone number rather
// than an amount; amounts with decimals or thousands separators are kept however large.
const digitsOnly = /^\+?\d{7,}$/;
const dateShaped =
  /^(?:\d{4}[-./]\d{1,2}[-./]\d{1,2}|\d{1,2}[-./]\d{1,2}[-./]\d{4})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?)?$/;
const dateInside = /(?:^|\D)(?:\d{4}[-./]\d{1,2}[-./]\d{1,2}|\d{1,2}[-./]\d{1,2}[-./]\d{4})(?!\d)/;
const ibanInside = /[A-Z]{2}\d{2}[A-Z0-9]{11,30}/;
const amountShaped = /^[+-]?(?:\d{1,3}(?:[ .,'’]\d{3})+|\d+)(?:[.,]\d{1,4})?$|^[+-]?[.,]\d{1,4}$/;

// One data cell as the model may see it, outside a coded column. The mapping isn't known yet, so
// this works on content:
//   - IBAN-shaped values and long digit runs (card, account, reference, phone numbers) are masked;
//   - dates and amounts are kept, since they are how the model tells a date format from a decimal
//     separator, and they are not personal;
//   - any other text, a currency-code-shaped word included, becomes a shape with its length and
//     character classes (A upper, a lower, # digit) and no words. A currency column's codes reach
//     the model as its coded values.
export function scrubCell(cell: string): string {
  const text = cell.trim();
  if (text === "") return "";
  if (ibanShaped.test(text.replace(/\s/g, ""))) return "[IBAN]";
  if (dateShaped.test(text)) return text;
  if (numeric.test(text)) {
    if (isLongNumber(text)) return "[NUMBER]";
    if (amountShaped.test(text)) return text;
  }
  return shapeOf(text);
}

function isLongNumber(text: string): boolean {
  const compact = text.replace(/[\s-]/g, "");
  return longDigitRun.test(compact) || digitsOnly.test(compact);
}

// Headers are words by nature and are sent as written. A wrong guess at which line is the header
// (a file with no header line, or a skip that lands on a transaction) makes a data row the header,
// and its names and descriptions would go out with it. Words alone can't tell a payee from a column
// name, but a data row carries a date, an amount or an account number and a column name doesn't, so
// a header row with any of those, alone or inside text, sends nothing at all. No proposal could
// read such a file anyway: its columns would be named by a transaction.
function looksLikeData(header: string): boolean {
  const text = header.trim();
  if (text === "") return false;
  return (
    numeric.test(text) ||
    dateInside.test(text) ||
    ibanInside.test(text.replace(/\s/g, "")) ||
    isLongNumber(text)
  );
}

function shapeOf(text: string): string {
  let shape = "";
  for (const char of text.slice(0, maxShapeLength)) {
    if (/\p{Lu}/u.test(char)) shape += "A";
    else if (/\p{L}/u.test(char)) shape += "a";
    else if (/\p{N}/u.test(char)) shape += "#";
    else shape += char;
  }
  return shape;
}

function buildSample(table: StatementTable): MappingSample {
  const coded = new Map<number, string[]>();
  for (const [column] of table.headers.entries()) {
    const values = codedValuesOf(table, column);
    if (values) coded.set(column, values);
  }

  // Spread over the file: a refund or a fee is rarely among the first rows.
  const count = Math.min(sampleRowCount, table.rows.length);
  const rows = Array.from({ length: count }, (_, i) => {
    const cells = table.rows[Math.floor((i * table.rows.length) / count)]!;
    return table.headers.map((_header, column) => {
      const cell = (cells[column] ?? "").trim();
      return coded.has(column) ? cell : scrubCell(cell);
    });
  });

  return {
    headers: table.headers,
    rows,
    codedValues: [...coded].map(([column, values]) => ({
      header: table.headers[column]!,
      values,
    })),
  };
}

type CodeKind = "marker" | "currency";

function codeKindOf(value: string): CodeKind | null {
  if (/^\p{Lu}{1,2}$/u.test(value) || markerWords.has(value.toLowerCase())) return "marker";
  if (currencies.has(value)) return "currency";
  return null;
}

// The column's distinct values when it is a coded one, else null.
function codedValuesOf(table: StatementTable, column: number): string[] | null {
  const values = new Set<string>();
  let kind: CodeKind | null = null;
  for (const cells of table.rows) {
    const value = (cells[column] ?? "").trim();
    if (value === "") continue;
    const valueKind = codeKindOf(value);
    if (valueKind === null || (kind !== null && valueKind !== kind)) return null;
    kind = valueKind;
    values.add(value);
    if (values.size > maxCodedValues) return null;
  }
  if (values.size === 0 || table.rows.length < values.size * minRowsPerCodedValue) return null;
  return [...values];
}

// ---- The answer ----

// Not a fee or a state column (ADR-0020): whether an amount includes its fee, and which states
// mean completed, can't be told from a masked sample. The user maps them in the form.
const columnFields = (Object.keys(importProfileFields.shape.columns.shape) as ImportField[]).filter(
  (field) => field !== "fee" && field !== "state",
);

// The profile's fields the model decides. The file's own read settings (lines above the header,
// delimiter, encoding) come from reading it, and the name is the user's to give. A field the file
// has no column for is null: strict structured output wants every key present.
const answerSchema = z.strictObject({
  decimalSeparator: z.enum([".", ","]),
  dateFormat: z.enum(dateFormats),
  columns: z.strictObject(
    Object.fromEntries(columnFields.map((field) => [field, z.string().nullable()])) as Record<
      ImportField,
      z.ZodNullable<z.ZodString>
    >,
  ),
  debitValues: z.array(z.string()).nullable(),
});

// Without the $schema key, which OpenAI's strict mode doesn't take. Length and cardinality limits
// are the profile schema's job once the answer is back, not the model's.
export const mappingAnswerJsonSchema: Record<string, unknown> = Object.fromEntries(
  Object.entries(z.toJSONSchema(answerSchema)).filter(([key]) => key !== "$schema"),
);

export const mappingInstructions = [
  "You map the columns of a bank statement file (a CSV, or the first sheet of a spreadsheet) to the fields of an import profile.",
  "You get the header row, up to five sample rows and the coded values of some columns.",
  "Sample cells are masked: dates and amounts are shown as they are; IBANs and long numbers are [IBAN] and [NUMBER]; other text is a shape in which A is an upper case letter, a a lower case letter and # a digit. Columns of debit/credit markers or currency codes are shown as they are, and their values are listed among the coded values. Never ask for the real text.",
  "Answer with the header, copied exactly, of the column that holds each field, or null when the file has none.",
  "bookingDate and amount are required. transactionDate is the date the purchase was made when the file has both. counterparty is the other party's name and counterpartyIban its account. ownIban is the statement account's own IBAN.",
  "dateFormat is how the date cells are written. decimalSeparator is the character before the cents in the amount cells.",
  "When amounts are unsigned and a column tells debit from credit, set debitCredit to that column and debitValues to the values that mean money going out, copied from the coded values. Otherwise both are null.",
  "originalAmount and originalCurrency are set together, or both null.",
].join("\n");

// ---- The proposal ----

export type ProposedMapping = {
  // Named for the user to rename.
  profile: ImportProfile;
  // What reading the whole file with the profile gives.
  rows: number;
  failed: number;
};

export type ProposeMappingOptions = {
  // Null when no model is configured: nothing is read, built or sent.
  client: MappingModelClient | null;
  // How the upload is read, as for readTable. Absent: detected.
  read?: ReadTableOptions;
  timeoutMs?: number;
};

export const defaultMappingTimeoutMs = 20_000;

const proposedProfileName = "Suggested mapping";

// A profile for the file's format, or null: no model, nothing readable in the file, the client
// failed or timed out, or its answer didn't hold up. One attempt, never throws.
export async function proposeMapping(
  bytes: Uint8Array,
  options: ProposeMappingOptions,
): Promise<ProposedMapping | null> {
  const { client, read = {}, timeoutMs = defaultMappingTimeoutMs } = options;
  if (client === null) return null;

  const table = readTable(bytes, read);
  if (!table.ok || table.headers.length === 0 || table.rows.length === 0) return null;
  if (table.headers.some(looksLikeData)) return null;

  let answer: unknown;
  try {
    answer = await ask(client, {
      instructions: mappingInstructions,
      sample: buildSample(table),
      schema: mappingAnswerJsonSchema,
      timeoutMs,
    });
  } catch {
    return null;
  }
  return checkAnswer(answer, table, read.encoding ?? "utf-8");
}

async function ask(
  client: MappingModelClient,
  { timeoutMs, ...request }: Omit<MappingModelRequest, "signal"> & { timeoutMs: number },
): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("The model client timed out."));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      client.suggestMapping({ ...request, signal: controller.signal }),
      timedOut,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// The model's word is checked twice: against the profile schema, and by reading the file with it.
function checkAnswer(
  answer: unknown,
  table: StatementTable,
  encoding: string,
): ProposedMapping | null {
  const parsed = answerSchema.safeParse(answer);
  if (!parsed.success) return null;
  const { decimalSeparator, dateFormat, columns, debitValues } = parsed.data;

  const profile = importProfileSchema.safeParse({
    name: proposedProfileName,
    skipLines: table.skipLines,
    delimiter: table.delimiter,
    encoding,
    decimalSeparator,
    dateFormat,
    columns: Object.fromEntries(Object.entries(columns).filter(([, header]) => header !== null)),
    debitValues,
  });
  if (!profile.success) return null;

  // The account's currency only matters to a foreign-currency purchase's original amount.
  const result = parseRows(profile.data, table, { accountCurrency: "EUR" });
  // A mapped header the file lacks is a missing-columns refusal.
  if (!result.ok || result.rows.length === 0) return null;
  return { profile: profile.data, rows: result.rows.length, failed: result.failed.length };
}
