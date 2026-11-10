import { createHash } from "node:crypto";
import { schema, type Db } from "@troba/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { queueJob, type JobQueue } from "../../jobs/queue";
import { parseCents } from "../cents";
import { parseIban } from "../iban";
import {
  createAccountForRows,
  previewPrepared,
  prepareRows,
  savePrepared,
  type CommitImportResult,
  type CreateImportAccountResult,
  type ImportRow,
  type ImportRowFailure,
  type PreviewImportResult,
  type RowSource,
} from "./import";
import {
  claimPdfImportUse,
  defaultPdfImportDailyLimit,
  pdfImportAllowance,
} from "./pdf-import-limit";
import { countPdfPages, maxPdfPages } from "./pdf-pages";
import { checkStatementFile } from "./upload";

// PDF statements (SPEC-money M3, ADR-0018): a PDF import holds the file until the worker has had it
// read by a model through an injected statement model client. The model's answer is checked and
// stored, and the PDF import is then previewed and committed like any import, from that stored
// answer and never from anything the client sends back.
//
// Nothing here logs, and nothing may: the PDF is a whole bank statement and the answer is its
// transactions. A failed reading is recorded on the PDF import, never thrown, since what a job
// throws is stored by pg-boss.

const { moneyPdfImports } = schema;
type PdfImportState = schema.PdfImportState;

// ---- The port ----

// What the statement model client is asked. The client sends the PDF as a file with these
// instructions and asks for an answer in this schema.
export type StatementModelRequest = {
  instructions: string;
  pdf: Uint8Array;
  // JSON Schema of the answer.
  schema: Record<string, unknown>;
  // Aborted when the time is up; a client that ignores it is still cut off.
  signal: AbortSignal;
};

// Resolves to the model's structured answer, unchecked: it is untrusted until readPdfImport has
// validated it. Rejects on any failure, with nothing from the exchange in the error.
export type StatementModelClient = {
  readStatement(request: StatementModelRequest): Promise<unknown>;
};

// ---- The answer ----

const text = (max: number) => z.string().max(max);

// What the model returns. Dates, amounts and currencies stay text here: one that doesn't read is a
// failed row with a reason, as in a CSV, not a failed reading.
const statementTransaction = z
  .object({
    // YYYY-MM-DD.
    bookingDate: text(40),
    // A signed decimal string, point for decimals: "-42.15".
    amount: text(40),
    currency: text(10),
    counterparty: text(500).nullable(),
    counterpartyIban: text(64).nullable(),
    description: text(1000).nullable(),
  })
  .strict();

export const statementAnswerSchema = z
  .object({
    // False when the file isn't a bank account statement at all: it is refused.
    isStatement: z.boolean(),
    // The IBANs of the account(s) the statement is for, as printed. More than one is refused.
    accountIbans: z.array(text(64)).max(10),
    // The statement's currency, if printed.
    currency: text(10).nullable(),
    // The balances before the first row and after the last, decimal strings like the amounts, if
    // printed. With both, the rows are checked against them (see checkBalance).
    openingBalance: text(40).nullable(),
    closingBalance: text(40).nullable(),
    transactions: z.array(statementTransaction).max(5000),
  })
  .strict();

export type StatementAnswer = z.infer<typeof statementAnswerSchema>;

// The schema the provider is asked to answer in (strict structured output: every field required,
// no others, optional ones nullable).
const nullableString = { type: ["string", "null"] };
export const statementAnswerJsonSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "isStatement",
    "accountIbans",
    "currency",
    "openingBalance",
    "closingBalance",
    "transactions",
  ],
  properties: {
    isStatement: { type: "boolean" },
    accountIbans: { type: "array", items: { type: "string" } },
    currency: nullableString,
    openingBalance: nullableString,
    closingBalance: nullableString,
    transactions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "bookingDate",
          "amount",
          "currency",
          "counterparty",
          "counterpartyIban",
          "description",
        ],
        properties: {
          bookingDate: { type: "string" },
          amount: { type: "string" },
          currency: { type: "string" },
          counterparty: nullableString,
          counterpartyIban: nullableString,
          description: nullableString,
        },
      },
    },
  },
};

export const statementInstructions = [
  "You read a bank account statement given as a PDF and list every transaction on it, in the order printed.",
  "isStatement: false if the file is not a bank account statement (an invoice, a receipt, a letter); then leave accountIbans and transactions empty and the rest null.",
  "accountIbans: the IBAN of the account the statement is for, as printed; an empty list if none is printed. Never the IBAN of a counterparty.",
  "currency: the account's currency as a three-letter ISO 4217 code, or null if not printed.",
  "openingBalance and closingBalance: the account balance printed for the start and for the end of the statement period, as decimal strings like the amounts, or null if not printed. Never compute one.",
  "For each transaction: bookingDate as YYYY-MM-DD; amount as a decimal string with a point for decimals and no thousands separators, negative for money out and positive for money in (for example -42.15); currency as a three-letter code; counterparty, counterpartyIban and description as printed, or null.",
  "Copy values exactly as printed. Never invent, merge, round or leave out a transaction. Leave out balance lines, totals and page headers.",
].join("\n");

// A model reading a long scanned statement takes a while; the job's expiry is longer than this.
export const defaultStatementTimeoutMs = 120_000;

// ---- PDF imports ----

// Why a reading failed: unavailable, the model failed, timed out or there is no key; invalid-answer,
// the answer isn't in the schema; not-a-statement, the model says the file isn't a bank statement;
// balance-mismatch, the rows don't add up to the statement's balances; daily-limit, the user's daily
// cap was reached before the model was asked (readings started together, past what startPdfImport
// could tell).
export type PdfImportFailureReason =
  "unavailable" | "invalid-answer" | "not-a-statement" | "balance-mismatch" | "daily-limit";

// How the rows compare with the statement's printed balances. matched: they add up to the cent.
// unchecked: the statement prints fewer than both, or a balance or an amount doesn't read, so the
// user should review the preview more carefully. mismatch: opening + the amounts - closing is
// differenceCents, in the statement's currency (null when it can't be told).
export type BalanceCheck =
  | { result: "matched" }
  | { result: "unchecked" }
  | { result: "mismatch"; differenceCents: bigint; currency: string | null };

export type PdfImport = {
  id: string;
  filename: string;
  state: PdfImportState;
  failureReason: PdfImportFailureReason | null;
  // Null while there is no answer: not read yet, or failed for another reason than the balances.
  balance: BalanceCheck | null;
  createdAt: Date;
};

const pdfImportColumns = {
  id: moneyPdfImports.id,
  filename: moneyPdfImports.filename,
  state: moneyPdfImports.state,
  failureReason: moneyPdfImports.failureReason,
  answer: moneyPdfImports.answer,
  createdAt: moneyPdfImports.createdAt,
};

// Why a PDF can't be sent: too big, not a PDF, over the page limit (T154), or the user has had the
// day's PDF imports and may import one again at `nextAt`.
export type PdfImportRefusal =
  | { ok: false; reason: "file-too-large" | "not-a-pdf" }
  | { ok: false; reason: "too-many-pages"; pages: number; maxPages: number }
  | { ok: false; reason: "daily-limit"; limit: number; nextAt: Date };

export type PdfImportLimitOptions = {
  // The user's PDF imports a day: AI_PDF_IMPORT_DAILY_LIMIT, or the default.
  dailyLimit?: number;
};

// Whether this PDF may be sent for the user, checked on upload and again before it is queued;
// `left` is how many PDF imports the user has left today, this one included. The page limit goes
// first, so a long statement is told to split before it is told to wait. A PDF whose page count
// can't be read (encrypted object streams, say) is let through, still bound by the size limit.
export async function checkPdfImport(
  db: Db,
  userId: string,
  bytes: Uint8Array,
  { dailyLimit = defaultPdfImportDailyLimit }: PdfImportLimitOptions = {},
): Promise<{ ok: true; left: number } | PdfImportRefusal> {
  const checked = checkStatementFile({ type: "application/pdf", bytes }, { pdfAvailable: true });
  if (!checked.ok && checked.reason === "file-too-large") {
    return { ok: false, reason: "file-too-large" };
  }
  if (!checked.ok || checked.kind !== "pdf") return { ok: false, reason: "not-a-pdf" };

  const pages = countPdfPages(bytes);
  if (pages !== null && pages > maxPdfPages) {
    return { ok: false, reason: "too-many-pages", pages, maxPages: maxPdfPages };
  }
  const allowance = await pdfImportAllowance(db, userId, dailyLimit);
  if (allowance.ok) return allowance;
  return { ok: false, reason: "daily-limit", limit: allowance.limit, nextAt: allowance.nextAt };
}

export type StartPdfImportResult = { ok: true; pdfImportId: string } | PdfImportRefusal;

// Called once the user has confirmed the PDF may be sent: checks it again (checkPdfImport), then
// holds the bytes in a queued PDF import and queues the job that reads it, together, so neither
// exists without the other. A refusal inserts and queues nothing.
export async function startPdfImport(
  db: Db,
  userId: string,
  file: { filename: string; bytes: Uint8Array },
  { queue, ...limits }: { queue: JobQueue } & PdfImportLimitOptions,
): Promise<StartPdfImportResult> {
  const checked = await checkPdfImport(db, userId, file.bytes, limits);
  if (!checked.ok) return checked;

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(moneyPdfImports)
      .values({ userId, filename: file.filename.slice(0, 200), bytes: file.bytes })
      .returning({ id: moneyPdfImports.id });
    const pdfImportId = created!.id;
    await queueJob(queue, "read-pdf-import", { userId, pdfImportId }, { tx });
    return { ok: true as const, pdfImportId };
  });
}

export type ReadPdfImportOptions = PdfImportLimitOptions & {
  // Null when the server has no key: the reading fails as unavailable.
  client: StatementModelClient | null;
  timeoutMs?: number;
};

// The job: reads one of the user's PDF imports through the model and leaves it read or failed,
// with the bytes deleted either way. Returns the state it ended in, or null when the user has no
// such PDF import waiting to be read (another user's, or one already read). A reading cut short by
// a crash is still `reading` and is read again when the job is retried.
export async function readPdfImport(
  db: Db,
  userId: string,
  pdfImportId: string,
  {
    client,
    timeoutMs = defaultStatementTimeoutMs,
    dailyLimit = defaultPdfImportDailyLimit,
  }: ReadPdfImportOptions,
): Promise<"read" | "failed" | null> {
  const [claimed] = await db
    .update(moneyPdfImports)
    .set({ state: "reading" })
    .where(
      and(
        eq(moneyPdfImports.id, pdfImportId),
        eq(moneyPdfImports.userId, userId),
        inArray(moneyPdfImports.state, ["queued", "reading"]),
      ),
    )
    .returning({ bytes: moneyPdfImports.bytes });
  if (!claimed?.bytes) return null;

  // A unit of the daily cap is claimed just before the model is asked, and a retried job reuses it.
  const claimUse = () => claimPdfImportUse(db, userId, pdfImportId, dailyLimit);
  const outcome = await askModel(client, claimed.bytes, timeoutMs, claimUse);
  const ended = outcome.ok
    ? { state: "read" as const, answer: outcome.answer, failureReason: null }
    : // A mismatched answer is kept, as briefly as a read one, for the difference the page shows.
      // It is never previewed or saved: only a read one is.
      { state: "failed" as const, answer: outcome.answer ?? null, failureReason: outcome.reason };
  await db
    .update(moneyPdfImports)
    .set({ ...ended, bytes: null })
    .where(and(eq(moneyPdfImports.id, pdfImportId), eq(moneyPdfImports.userId, userId)));
  return ended.state;
}

async function askModel(
  client: StatementModelClient | null,
  pdf: Uint8Array,
  timeoutMs: number,
  claimUse: () => Promise<boolean>,
): Promise<
  | { ok: true; answer: StatementAnswer }
  | { ok: false; reason: PdfImportFailureReason; answer?: StatementAnswer }
> {
  if (!client) return { ok: false, reason: "unavailable" };
  if (!(await claimUse())) return { ok: false, reason: "daily-limit" };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("timed out"));
    }, timeoutMs);
  });
  let value: unknown;
  try {
    value = await Promise.race([
      client.readStatement({
        instructions: statementInstructions,
        pdf,
        schema: statementAnswerJsonSchema,
        signal: controller.signal,
      }),
      timedOut,
    ]);
  } catch {
    // The error is dropped: it may echo the request.
    return { ok: false, reason: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
  const parsed = statementAnswerSchema.safeParse(value);
  if (!parsed.success) return { ok: false, reason: "invalid-answer" };
  const answer = parsed.data;
  if (!answer.isStatement) return { ok: false, reason: "not-a-statement" };
  if (checkBalance(answer).result === "mismatch") {
    return { ok: false, reason: "balance-mismatch", answer };
  }
  return { ok: true, answer };
}

// Opening + the amounts against closing, in cents from the decimal strings, never through a float.
// Every row counts, whatever else is wrong with it: the balances are the statement's own.
export function checkBalance(answer: StatementAnswer): BalanceCheck {
  if (answer.openingBalance === null || answer.closingBalance === null) {
    return { result: "unchecked" };
  }
  const opening = parseCents(answer.openingBalance);
  const closing = parseCents(answer.closingBalance);
  if (opening === null || closing === null) return { result: "unchecked" };
  let total = opening;
  for (const transaction of answer.transactions) {
    const amount = parseCents(transaction.amount);
    if (amount === null) return { result: "unchecked" };
    total += amount;
  }
  const differenceCents = total - closing;
  if (differenceCents === 0n) return { result: "matched" };
  return { result: "mismatch", differenceCents, currency: balanceCurrency(answer) };
}

// The statement's currency, or else the one every row is in.
function balanceCurrency(answer: StatementAnswer): string | null {
  const printed = answer.currency?.trim().toUpperCase();
  if (printed && currencyCode.test(printed)) return printed;
  const rowCurrencies = new Set(answer.transactions.map((t) => t.currency.trim().toUpperCase()));
  const [only] = rowCurrencies;
  return rowCurrencies.size === 1 && only && currencyCode.test(only) ? only : null;
}

export async function getPdfImport(
  db: Db,
  userId: string,
  pdfImportId: string,
): Promise<PdfImport | null> {
  const [found] = await db
    .select(pdfImportColumns)
    .from(moneyPdfImports)
    .where(and(eq(moneyPdfImports.id, pdfImportId), eq(moneyPdfImports.userId, userId)));
  return found ? toPdfImport(found) : null;
}

// The one the import page shows, so a reading started earlier is still there after the user left.
export async function latestPdfImport(db: Db, userId: string): Promise<PdfImport | null> {
  const [found] = await db
    .select(pdfImportColumns)
    .from(moneyPdfImports)
    .where(eq(moneyPdfImports.userId, userId))
    .orderBy(desc(moneyPdfImports.createdAt), desc(moneyPdfImports.id))
    .limit(1);
  return found ? toPdfImport(found) : null;
}

// The user started over: whatever state it is in, the PDF import is gone. A job that hasn't run
// yet then finds nothing to read.
export async function discardPdfImport(db: Db, userId: string, pdfImportId: string): Promise<void> {
  await db
    .delete(moneyPdfImports)
    .where(and(eq(moneyPdfImports.id, pdfImportId), eq(moneyPdfImports.userId, userId)));
}

function toPdfImport({
  answer,
  ...row
}: {
  id: string;
  filename: string;
  state: PdfImportState;
  failureReason: string | null;
  answer: unknown;
  createdAt: Date;
}): PdfImport {
  // Checked when it was stored; checked again since it came back from the database.
  const stored = answer === null ? null : statementAnswerSchema.parse(answer);
  return {
    ...row,
    failureReason: row.failureReason as PdfImportFailureReason | null,
    balance: stored && checkBalance(stored),
  };
}

// ---- Preview and commit ----

export type PdfImportInput = {
  pdfImportId: string;
  // The account the user picked, for a statement without an own IBAN. A candidate id.
  accountId?: string | null;
};

// No read PDF import of the user's with that id: another user's, not read yet, failed, or already
// saved.
export type PdfImportNotFound = { ok: false; reason: "pdf-import-not-found" };
const notFound: PdfImportNotFound = { ok: false, reason: "pdf-import-not-found" };

export async function previewPdfImport(
  db: Db,
  userId: string,
  input: PdfImportInput,
): Promise<PreviewImportResult | PdfImportNotFound> {
  const read = await readAnswer(db, userId, input.pdfImportId);
  if (!read) return notFound;
  const prepared = await prepareRows(db, userId, input.accountId, rowSource(read.answer));
  if (!prepared.ok) return prepared;
  return previewPrepared(db, userId, prepared);
}

// The preview offered a bank account for the statement's own IBAN: created with the IBAN and
// currency from the stored answer.
export async function createPdfImportAccount(
  db: Db,
  userId: string,
  input: { pdfImportId: string; name: string },
): Promise<CreateImportAccountResult | PdfImportNotFound> {
  const read = await readAnswer(db, userId, input.pdfImportId);
  if (!read) return notFound;
  const source = rowSource(read.answer);
  return createAccountForRows(db, userId, input.name, () => prepareRows(db, userId, null, source));
}

// All or nothing, like commitImport, and the PDF import is deleted with it: its answer isn't kept
// once saved. The row is locked first, so a second commit of it waits and then finds nothing.
export async function commitPdfImport(
  db: Db,
  userId: string,
  input: PdfImportInput,
): Promise<CommitImportResult | PdfImportNotFound> {
  return db.transaction(async (tx) => {
    const [read] = await tx
      .select({ filename: moneyPdfImports.filename, answer: moneyPdfImports.answer })
      .from(moneyPdfImports)
      .where(readBy(userId, input.pdfImportId))
      .for("update");
    if (!read) return notFound;
    const answer = statementAnswerSchema.parse(read.answer);
    const prepared = await prepareRows(tx, userId, input.accountId, rowSource(answer));
    if (!prepared.ok) return prepared;
    const saved = await savePrepared(tx, userId, prepared, {
      profileId: null,
      filename: read.filename,
    });
    await tx.delete(moneyPdfImports).where(readBy(userId, input.pdfImportId));
    return saved;
  });
}

function readBy(userId: string, pdfImportId: string) {
  return and(
    eq(moneyPdfImports.id, pdfImportId),
    eq(moneyPdfImports.userId, userId),
    eq(moneyPdfImports.state, "read"),
  );
}

async function readAnswer(db: Db, userId: string, pdfImportId: string) {
  const [read] = await db
    .select({ answer: moneyPdfImports.answer })
    .from(moneyPdfImports)
    .where(readBy(userId, pdfImportId));
  // Checked when it was stored; checked again since it came back from the database.
  return read ? { answer: statementAnswerSchema.parse(read.answer) } : null;
}

const currencyCode = /^[A-Z]{3}$/;
const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/;

// The answer's rows as import rows. Every row's currency is the model's, so the account's
// currency only decides which rows fail as currency-mismatch (in prepareRows).
function rowSource(answer: StatementAnswer): RowSource {
  // An IBAN that fails its check digits (misread or masked on the statement) names no account.
  const ownIbans = new Set(
    answer.accountIbans.map(parseIban).filter((iban): iban is string => iban !== null),
  );
  const statementCurrency = answer.currency?.trim().toUpperCase() ?? null;

  const rows: ImportRow[] = [];
  const failed: ImportRowFailure[] = [];
  const occurrences = new Map<string, number>();
  for (const [i, transaction] of answer.transactions.entries()) {
    const row = i + 1;
    const bookedOn = parseIsoDate(transaction.bookingDate.trim());
    if (!bookedOn) {
      failed.push({ row, reason: "invalid-date" });
      continue;
    }
    const amountCents = parseCents(transaction.amount);
    if (amountCents === null) {
      failed.push({ row, reason: "invalid-amount" });
      continue;
    }
    const currency = transaction.currency.trim().toUpperCase();
    if (!currencyCode.test(currency)) {
      failed.push({ row, reason: "invalid-currency" });
      continue;
    }

    // A PDF row has no bank transaction id, and the model's text can differ between two readings
    // of one statement: the key is the date, amount and currency, numbered so that two equal rows
    // stay two while a re-import matches them again. The prefix keeps it apart from a CSV row's.
    const hash = createHash("sha256")
      .update(JSON.stringify([bookedOn, amountCents.toString(), currency]))
      .digest("hex");
    const occurrence = occurrences.get(hash) ?? 0;
    occurrences.set(hash, occurrence + 1);

    rows.push({
      row,
      bookedOn,
      amountCents,
      currency,
      originalAmountCents: null,
      originalCurrency: null,
      counterparty: transaction.counterparty?.trim() || null,
      counterpartyIban: transaction.counterpartyIban && parseIban(transaction.counterpartyIban),
      description: transaction.description?.trim() || null,
      bankTxType: null,
      dedupKey: `pdf:${hash}:${occurrence}`,
      raw: transaction,
    });
  }

  return {
    rowsParsed: answer.transactions.length,
    currency: statementCurrency && currencyCode.test(statementCurrency) ? statementCurrency : null,
    read: () =>
      ownIbans.size > 1
        ? { ok: false, reason: "multiple-own-ibans" }
        : { ok: true, ownIban: [...ownIbans][0] ?? null, rows, failed, debitCredit: null },
  };
}

// YYYY-MM-DD, or null unless it is a real calendar date.
function parseIsoDate(value: string): string | null {
  const match = isoDate.exec(value);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1) return null;
  return value;
}
