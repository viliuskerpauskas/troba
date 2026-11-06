import { z } from "zod";
import { readCsv, type CsvTable, type ReadCsvOptions } from "./csv";
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
  // Columns whose values are all codes (debit/credit markers, currencies; see isCode): their
  // distinct values in file order. These are not personal, and a sample of cells would probably
  // miss the rarer one.
  codedValues: { header: string; values: string[] }[];
};

const sampleRowCount = 5;
// A column is coded when it has at most this many distinct values ...
const maxCodedValues = 8;
// ... each repeating on average at least this often, so a handful of values in a small file
// isn't taken for codes ...
const minRowsPerCodedValue = 2;
// ... and every value is a code, not a word. A column's cardinality can't tell a debit marker from
// a person's name (a statement with three payees looks like one with three markers), so what is
// sent raw is decided by what the value can be, never by how often it repeats: one or two capital
// letters (D, C, DR, CR), a currency code, or a debit/credit marker word. Anything else, including
// one-word merchants and transaction types, is masked like every other cell. The cost is that the
// model sees a transaction-type column as shapes; it still maps it by its header.
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
const amountShaped = /^[+-]?(?:\d{1,3}(?:[ .,'’]\d{3})+|\d+)(?:[.,]\d{1,4})?$|^[+-]?[.,]\d{1,4}$/;

// One data cell as the model may see it. The mapping isn't known yet, so this works on content:
//   - IBAN-shaped values and long digit runs (card, account, reference, phone numbers) are masked;
//   - dates, amounts and currency codes are kept, since they are how the model tells a date
//     format from a decimal separator, and they are not personal;
//   - any other text becomes a shape with its length and character classes (A upper, a lower,
//     # digit) and no words.
export function scrubCell(cell: string): string {
  const text = cell.trim();
  if (text === "") return "";
  if (ibanShaped.test(text.replace(/\s/g, ""))) return "[IBAN]";
  if (dateShaped.test(text)) return text;
  if (numeric.test(text)) {
    if (isLongNumber(text)) return "[NUMBER]";
    if (amountShaped.test(text)) return text;
  }
  if (currencies.has(text)) return text;
  return shapeOf(text);
}

function isLongNumber(text: string): boolean {
  const compact = text.replace(/[\s-]/g, "");
  return longDigitRun.test(compact) || digitsOnly.test(compact);
}

// A header as the model may see it. Headers are words by nature and are sent as written, but a
// wrong guess at which line is the header can make a data row the header: its IBANs and numbers
// are masked, so a proposal that names such a header fails the check against the file.
function scrubHeader(header: string): string {
  const text = header.trim();
  if (ibanShaped.test(text.replace(/\s/g, ""))) return "[IBAN]";
  if (numeric.test(text) && isLongNumber(text)) return "[NUMBER]";
  return header;
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

function buildSample(table: CsvTable): MappingSample {
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
    headers: table.headers.map(scrubHeader),
    rows,
    codedValues: [...coded].map(([column, values]) => ({
      header: scrubHeader(table.headers[column]!),
      values,
    })),
  };
}

function isCode(value: string): boolean {
  return (
    /^\p{Lu}{1,2}$/u.test(value) || currencies.has(value) || markerWords.has(value.toLowerCase())
  );
}

// The column's distinct values when it is a coded one, else null.
function codedValuesOf(table: CsvTable, column: number): string[] | null {
  const values = new Set<string>();
  for (const cells of table.rows) {
    const value = (cells[column] ?? "").trim();
    if (value === "") continue;
    if (!isCode(value)) return null;
    values.add(value);
    if (values.size > maxCodedValues) return null;
  }
  if (values.size === 0 || table.rows.length < values.size * minRowsPerCodedValue) return null;
  return [...values];
}

// ---- The answer ----

const columnFields = Object.keys(importProfileFields.shape.columns.shape) as ImportField[];

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
  "You map the columns of a bank statement CSV to the fields of an import profile.",
  "You get the header row, up to five sample rows and the coded values of some columns.",
  "Sample cells are masked: dates, amounts and currency codes are shown as they are; IBANs and long numbers are [IBAN] and [NUMBER]; other text is a shape in which A is an upper case letter, a a lower case letter and # a digit. Never ask for the real text.",
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
  // How the upload is read, as for readCsv. Absent: detected.
  read?: ReadCsvOptions;
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

  const table = readCsv(bytes, read);
  if (!table.ok || table.headers.length === 0 || table.rows.length === 0) return null;

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
function checkAnswer(answer: unknown, table: CsvTable, encoding: string): ProposedMapping | null {
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
