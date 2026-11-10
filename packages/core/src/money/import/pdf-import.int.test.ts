import { createDb, schema, type Db } from "@troba/db";
import { createTestDatabase } from "@troba/db/test-database";
import { and, asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startJobQueue, type JobQueue } from "../../jobs/queue";
import { createAccount } from "../accounts";
import { listCategories } from "../categories";
import { ensureMoneyDefaults } from "../defaults";
import { createRule } from "../rules";
import { commitImport, previewImport } from "./import";
import {
  checkPdfImport,
  commitPdfImport,
  createPdfImportAccount,
  discardPdfImport,
  getPdfImport,
  latestPdfImport,
  previewPdfImport,
  readPdfImport,
  startPdfImport,
  type StatementModelClient,
  type StatementModelRequest,
} from "./pdf-import";
import type { ImportProfile } from "./profile";

// The PDF reader seam (T152, ADR-0018): a PDF statement queued, read through a fake statement
// model client with a recorded answer, then previewed and committed like any import.

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Db;
let queue: JobQueue;
let userCount = 0;

const pdf = new TextEncoder().encode("%PDF-1.7\n% a fictional statement\n");
// Fictional IBANs from the published test ranges.
const ownIban = "DE89370400440532013000";
const otherOwnIban = "GB82WEST12345698765432";
const savingsIban = "FR1420041010050500013M02606";

type AnswerRow = {
  bookingDate: string;
  amount: string;
  currency: string;
  counterparty: string | null;
  counterpartyIban: string | null;
  description: string | null;
};

// What a model answers for a fictional Example Bank statement.
function answer(
  overrides: {
    isStatement?: boolean;
    accountIbans?: string[];
    currency?: string | null;
    openingBalance?: string | null;
    closingBalance?: string | null;
    transactions?: AnswerRow[];
  } = {},
) {
  return {
    isStatement: true,
    accountIbans: [ownIban],
    currency: "EUR",
    // Not printed: most tests change the rows, and a balance check would then fail them.
    openingBalance: null,
    closingBalance: null,
    transactions: [
      row({ amount: "-42.15", counterparty: "GROCERY MART", description: "Card purchase" }),
      row({ bookingDate: "2026-03-03", amount: "1500.00", counterparty: "ACME LTD" }),
      row({ bookingDate: "2026-03-04", amount: "-1.50", description: "Monthly fee" }),
    ],
    ...overrides,
  };
}

function row(overrides: Partial<AnswerRow> = {}): AnswerRow {
  return {
    bookingDate: "2026-03-02",
    amount: "-4.20",
    currency: "EUR",
    counterparty: null,
    counterpartyIban: null,
    description: null,
    ...overrides,
  };
}

// A client that answers with `value`, recording what it was sent.
function fakeClient(value: unknown) {
  const requests: StatementModelRequest[] = [];
  const client: StatementModelClient = {
    readStatement: async (request) => {
      requests.push(request);
      return value;
    },
  };
  return { client, requests };
}

async function createUser() {
  const [user] = await db
    .insert(schema.users)
    .values({ name: "Example User", email: `pdf${++userCount}@example.test` })
    .returning({ id: schema.users.id });
  await ensureMoneyDefaults(db, user!.id);
  return user!.id;
}

async function createBankAccount(userId: string, iban: string, currency = "EUR") {
  const result = await createAccount(db, userId, {
    name: "Example Bank",
    type: "bank",
    currency,
    iban,
  });
  if (!result.ok) throw new Error(`createAccount failed: ${result.reason}`);
  return result.account;
}

async function start(userId: string, bytes = pdf) {
  const started = await startPdfImport(db, userId, { filename: "statement.pdf", bytes }, { queue });
  if (!started.ok) throw new Error(`startPdfImport failed: ${started.reason}`);
  return started.pdfImportId;
}

// A PDF import read with the fake client's answer.
async function readWith(userId: string, value: unknown) {
  const pdfImportId = await start(userId);
  const { client } = fakeClient(value);
  await readPdfImport(db, userId, pdfImportId, { client });
  return pdfImportId;
}

async function queuedJobs(pdfImportId: string) {
  const result = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from pgboss.job
         where name = 'read-pdf-import' and data->>'pdfImportId' = ${pdfImportId}`,
  );
  return result.rows[0]!.n;
}

async function storedRow(pdfImportId: string) {
  const [stored] = await db
    .select({
      state: schema.moneyPdfImports.state,
      bytes: schema.moneyPdfImports.bytes,
      answer: schema.moneyPdfImports.answer,
    })
    .from(schema.moneyPdfImports)
    .where(eq(schema.moneyPdfImports.id, pdfImportId));
  return stored;
}

async function savedTransactions(userId: string) {
  return db
    .select({
      bookedOn: schema.moneyTransactions.bookedOn,
      amountCents: schema.moneyTransactions.amountCents,
      counterparty: schema.moneyTransactions.counterparty,
      categoryId: schema.moneyTransactions.categoryId,
      categorySource: schema.moneyTransactions.categorySource,
      raw: schema.moneyTransactions.raw,
    })
    .from(schema.moneyTransactions)
    .where(eq(schema.moneyTransactions.userId, userId))
    .orderBy(asc(schema.moneyTransactions.bookedOn), asc(schema.moneyTransactions.amountCents));
}

describe("PDF import", () => {
  beforeAll(async () => {
    database = await createTestDatabase();
    db = createDb(database.url);
    queue = await startJobQueue(database.url);
  });
  afterAll(async () => {
    await queue?.stop({ graceful: false });
    await db?.$client.end();
    await database?.drop();
  });

  describe("starting", () => {
    it("holds the bytes in a queued PDF import and queues one job for it", async () => {
      const userId = await createUser();
      const pdfImportId = await start(userId);

      expect(await getPdfImport(db, userId, pdfImportId)).toMatchObject({
        id: pdfImportId,
        filename: "statement.pdf",
        state: "queued",
        failureReason: null,
      });
      expect((await storedRow(pdfImportId))?.bytes).toEqual(pdf);
      expect(await queuedJobs(pdfImportId)).toBe(1);
    });

    it("refuses a file that isn't a PDF, and queues nothing", async () => {
      const userId = await createUser();
      const csv = new TextEncoder().encode("Date,Amount\n2026-03-01,-4.20\n");

      expect(
        await startPdfImport(db, userId, { filename: "statement.pdf", bytes: csv }, { queue }),
      ).toEqual({ ok: false, reason: "not-a-pdf" });
      expect(await latestPdfImport(db, userId)).toBeNull();
    });

    it("leaves nothing behind when the job can't be queued", async () => {
      const userId = await createUser();
      const failing: JobQueue = Object.create(queue);
      failing.send = async () => {
        throw new Error("the queue is down");
      };

      await expect(
        startPdfImport(db, userId, { filename: "statement.pdf", bytes: pdf }, { queue: failing }),
      ).rejects.toThrow("the queue is down");
      expect(await latestPdfImport(db, userId)).toBeNull();
    });
  });

  describe("reading", () => {
    it("sends the PDF to the model client, stores the answer as read and deletes the bytes", async () => {
      const userId = await createUser();
      const pdfImportId = await start(userId);
      const { client, requests } = fakeClient(answer());

      expect(await readPdfImport(db, userId, pdfImportId, { client })).toBe("read");

      expect(requests).toHaveLength(1);
      expect(requests[0]!.pdf).toEqual(pdf);
      expect(requests[0]!.schema).toMatchObject({ type: "object" });
      expect(await getPdfImport(db, userId, pdfImportId)).toMatchObject({ state: "read" });
      const stored = await storedRow(pdfImportId);
      expect(stored?.bytes).toBeNull();
      expect(stored?.answer).toEqual(answer());
    });

    it.each([
      ["a schema-invalid answer", { transactions: "none" }, "invalid-answer"],
      ["an answer with an extra field", { ...answer(), note: "hi" }, "invalid-answer"],
      ["no answer", undefined, "invalid-answer"],
    ])("leaves %s failed with a reason, and deletes the bytes", async (_name, value, reason) => {
      const userId = await createUser();
      const pdfImportId = await readWith(userId, value);

      expect(await getPdfImport(db, userId, pdfImportId)).toMatchObject({
        state: "failed",
        failureReason: reason,
      });
      const stored = await storedRow(pdfImportId);
      expect(stored?.bytes).toBeNull();
      expect(stored?.answer).toBeNull();
    });

    it("fails as unavailable when the client throws, or when there is no client", async () => {
      const userId = await createUser();
      const thrown = await start(userId);
      const throwing: StatementModelClient = {
        readStatement: async () => {
          throw new Error("OpenAI answered HTTP 503.");
        },
      };
      expect(await readPdfImport(db, userId, thrown, { client: throwing })).toBe("failed");
      expect(await getPdfImport(db, userId, thrown)).toMatchObject({
        failureReason: "unavailable",
      });

      const keyless = await start(userId);
      expect(await readPdfImport(db, userId, keyless, { client: null })).toBe("failed");
      expect(await getPdfImport(db, userId, keyless)).toMatchObject({
        failureReason: "unavailable",
      });
      expect((await storedRow(keyless))?.bytes).toBeNull();
    });

    it("fails as unavailable when the client takes longer than the timeout", async () => {
      const userId = await createUser();
      const pdfImportId = await start(userId);
      let aborted = false;
      const slow: StatementModelClient = {
        readStatement: ({ signal }) =>
          new Promise((resolve) => {
            signal.addEventListener("abort", () => (aborted = true));
            setTimeout(() => resolve(answer()), 1_000);
          }),
      };

      expect(await readPdfImport(db, userId, pdfImportId, { client: slow, timeoutMs: 20 })).toBe(
        "failed",
      );
      expect(aborted).toBe(true);
      expect(await getPdfImport(db, userId, pdfImportId)).toMatchObject({
        failureReason: "unavailable",
      });
    });

    it("reads a PDF import only once", async () => {
      const userId = await createUser();
      const pdfImportId = await start(userId);
      const { client, requests } = fakeClient(answer());
      await readPdfImport(db, userId, pdfImportId, { client });

      expect(await readPdfImport(db, userId, pdfImportId, { client })).toBeNull();
      expect(requests).toHaveLength(1);
    });

    it("logs nothing from the exchange, whether it succeeds or fails", async () => {
      const userId = await createUser();
      const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
        vi.spyOn(console, level).mockImplementation(() => {}),
      );
      try {
        await readWith(userId, answer());
        await readWith(userId, { transactions: [{ amount: "secret" }] });
        const failing = await start(userId);
        await readPdfImport(db, userId, failing, {
          client: {
            readStatement: async () => {
              throw new Error("GROCERY MART -42.15");
            },
          },
        });
        for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      } finally {
        for (const spy of spies) spy.mockRestore();
      }
    });
  });

  describe("daily cap and page limit", () => {
    async function uses(userId: string) {
      return db
        .select()
        .from(schema.moneyAiPdfImportUses)
        .where(eq(schema.moneyAiPdfImportUses.userId, userId));
    }

    async function pendingJobs(userId: string) {
      const result = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from pgboss.job
             where name = 'read-pdf-import' and data->>'userId' = ${userId}`,
      );
      return result.rows[0]!.n;
    }

    // A fictional PDF whose page tree says it has `pages` pages.
    function pdfOf(pages: number) {
      return new TextEncoder().encode(
        `%PDF-1.4\n2 0 obj\n<< /Type /Pages /Kids [] /Count ${pages} >>\nendobj\n%%EOF\n`,
      );
    }

    it("refuses the 11th PDF import in a day at the default, saying when, and queues nothing", async () => {
      const userId = await createUser();
      for (let i = 0; i < 10; i++) await readWith(userId, answer());
      const [oldest] = (await uses(userId)).sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      );

      const refused = await startPdfImport(
        db,
        userId,
        { filename: "statement.pdf", bytes: pdf },
        { queue },
      );

      expect(refused).toEqual({
        ok: false,
        reason: "daily-limit",
        limit: 10,
        nextAt: new Date(oldest!.createdAt.getTime() + 24 * 60 * 60 * 1000),
      });
      expect(await pendingJobs(userId)).toBe(10);
      expect(
        await db.$count(schema.moneyPdfImports, eq(schema.moneyPdfImports.userId, userId)),
      ).toBe(10);
    });

    it("takes the limit it is given", async () => {
      const userId = await createUser();
      await readWith(userId, answer());

      expect(
        await startPdfImport(
          db,
          userId,
          { filename: "statement.pdf", bytes: pdf },
          { queue, dailyLimit: 1 },
        ),
      ).toMatchObject({ ok: false, reason: "daily-limit", limit: 1 });
      expect(
        await startPdfImport(
          db,
          userId,
          { filename: "statement.pdf", bytes: pdf },
          { queue, dailyLimit: 2 },
        ),
      ).toMatchObject({ ok: true });
    });

    it("claims one use for a reading that reaches the model, and not when the job is retried", async () => {
      const userId = await createUser();
      const pdfImportId = await start(userId);
      const throwing: StatementModelClient = {
        readStatement: async () => {
          throw new Error("the worker crashed mid-call");
        },
      };
      // A crash during the call leaves it reading, with the bytes still there.
      const crashed = readPdfImport(db, userId, pdfImportId, { client: throwing });
      await crashed;
      await db
        .update(schema.moneyPdfImports)
        .set({ state: "reading", bytes: pdf, failureReason: null })
        .where(eq(schema.moneyPdfImports.id, pdfImportId));
      expect(await uses(userId)).toHaveLength(1);

      const { client, requests } = fakeClient(answer());
      expect(await readPdfImport(db, userId, pdfImportId, { client, dailyLimit: 1 })).toBe("read");
      expect(requests).toHaveLength(1);
      expect(await uses(userId)).toHaveLength(1);
    });

    it("uses no unit for a reading that fails before the model is called", async () => {
      const userId = await createUser();
      const pdfImportId = await start(userId);

      expect(await readPdfImport(db, userId, pdfImportId, { client: null })).toBe("failed");
      expect(await uses(userId)).toHaveLength(0);
    });

    it("fails a reading once the cap is reached, without calling the model, and deletes the bytes", async () => {
      const userId = await createUser();
      const first = await start(userId);
      const second = await start(userId);
      const { client, requests } = fakeClient(answer());
      expect(await readPdfImport(db, userId, first, { client, dailyLimit: 1 })).toBe("read");

      expect(await readPdfImport(db, userId, second, { client, dailyLimit: 1 })).toBe("failed");
      expect(requests).toHaveLength(1);
      expect(await getPdfImport(db, userId, second)).toMatchObject({
        state: "failed",
        failureReason: "daily-limit",
      });
      expect((await storedRow(second))?.bytes).toBeNull();
      expect(await uses(userId)).toHaveLength(1);
    });

    it("lets concurrent readings for one user call the model at most the limit's times", async () => {
      const userId = await createUser();
      const pdfImportIds = [];
      for (let i = 0; i < 6; i++) pdfImportIds.push(await start(userId));
      const { client, requests } = fakeClient(answer());

      const states = await Promise.all(
        pdfImportIds.map((id) => readPdfImport(db, userId, id, { client, dailyLimit: 2 })),
      );

      expect(requests).toHaveLength(2);
      expect(states.filter((state) => state === "read")).toHaveLength(2);
      expect(await uses(userId)).toHaveLength(2);
    });

    it("counts PDF imports waiting to be read, so nothing more is queued than will be read", async () => {
      const userId = await createUser();
      await start(userId);

      expect(
        await startPdfImport(
          db,
          userId,
          { filename: "statement.pdf", bytes: pdf },
          { queue, dailyLimit: 1 },
        ),
      ).toMatchObject({ ok: false, reason: "daily-limit" });
    });

    it("refuses a PDF over 20 pages before anything is queued or sent", async () => {
      const userId = await createUser();

      expect(
        await startPdfImport(
          db,
          userId,
          { filename: "statement.pdf", bytes: pdfOf(21) },
          { queue },
        ),
      ).toEqual({ ok: false, reason: "too-many-pages", pages: 21, maxPages: 20 });
      expect(await latestPdfImport(db, userId)).toBeNull();
      expect(await pendingJobs(userId)).toBe(0);
      expect(await uses(userId)).toHaveLength(0);

      expect(
        await startPdfImport(
          db,
          userId,
          { filename: "statement.pdf", bytes: pdfOf(20) },
          { queue },
        ),
      ).toMatchObject({ ok: true });
    });

    it("checks the page limit before the cap, so a long PDF says to split it", async () => {
      const userId = await createUser();
      await readWith(userId, answer());

      expect(await checkPdfImport(db, userId, pdfOf(25), { dailyLimit: 1 })).toMatchObject({
        ok: false,
        reason: "too-many-pages",
      });
      expect(await checkPdfImport(db, userId, pdf, { dailyLimit: 1 })).toMatchObject({
        ok: false,
        reason: "daily-limit",
      });
      expect(await checkPdfImport(db, userId, pdf, { dailyLimit: 2 })).toEqual({
        ok: true,
        left: 1,
      });
    });

    it("is independent of the AI mapping and categorization caps", async () => {
      const userId = await createUser();
      await db
        .insert(schema.moneyAiMappingUses)
        .values(Array.from({ length: 30 }, () => ({ userId })));
      await db.insert(schema.moneyAiCategorizeUses).values({ userId, merchants: 500 });

      const pdfImportId = await start(userId);
      const { client } = fakeClient(answer());
      expect(await readPdfImport(db, userId, pdfImportId, { client })).toBe("read");
      expect(
        await db.$count(schema.moneyAiMappingUses, eq(schema.moneyAiMappingUses.userId, userId)),
      ).toBe(30);
    });
  });

  describe("checking the balances", () => {
    // The default rows sum to 1456.35.
    const balanced = { openingBalance: "1000.00", closingBalance: "2456.35" };

    it("reads a statement whose opening balance plus its rows is its closing balance", async () => {
      const userId = await createUser();
      await createBankAccount(userId, ownIban);
      const pdfImportId = await readWith(userId, answer(balanced));

      expect(await getPdfImport(db, userId, pdfImportId)).toMatchObject({
        state: "read",
        balance: { result: "matched" },
      });
      expect(await previewPdfImport(db, userId, { pdfImportId })).toMatchObject({
        ok: true,
        rowsNew: 3,
      });
    });

    it("adds the amounts as exact cents, never as floats", async () => {
      const userId = await createUser();
      const transactions = [row({ amount: "0.10" }), row({ amount: "0.20" })];
      const pdfImportId = await readWith(
        userId,
        answer({ openingBalance: "0", closingBalance: "0.30", transactions }),
      );

      expect(await getPdfImport(db, userId, pdfImportId)).toMatchObject({
        state: "read",
        balance: { result: "matched" },
      });
    });

    it("fails a statement that is a cent out, with the difference, and saves nothing", async () => {
      const userId = await createUser();
      await createBankAccount(userId, ownIban);
      const pdfImportId = await readWith(
        userId,
        answer({ openingBalance: "1000.00", closingBalance: "2456.36" }),
      );

      expect(await getPdfImport(db, userId, pdfImportId)).toMatchObject({
        state: "failed",
        failureReason: "balance-mismatch",
        balance: { result: "mismatch", differenceCents: -1n, currency: "EUR" },
      });
      expect((await storedRow(pdfImportId))?.bytes).toBeNull();
      expect(await previewPdfImport(db, userId, { pdfImportId })).toEqual({
        ok: false,
        reason: "pdf-import-not-found",
      });
      expect(await commitPdfImport(db, userId, { pdfImportId })).toEqual({
        ok: false,
        reason: "pdf-import-not-found",
      });
      expect(await savedTransactions(userId)).toEqual([]);
    });

    it("gives the difference in the rows' currency when the statement prints none", async () => {
      const userId = await createUser();
      const transactions = [row({ amount: "-10.00", currency: "USD" })];
      const pdfImportId = await readWith(
        userId,
        answer({ currency: null, openingBalance: "50", closingBalance: "45.00", transactions }),
      );

      expect(await getPdfImport(db, userId, pdfImportId)).toMatchObject({
        failureReason: "balance-mismatch",
        balance: { result: "mismatch", differenceCents: -500n, currency: "USD" },
      });
    });

    it.each([
      ["no balances", { openingBalance: null, closingBalance: null }],
      ["only the opening balance", { openingBalance: "1000.00", closingBalance: null }],
      ["only the closing balance", { openingBalance: null, closingBalance: "2456.36" }],
      ["a balance that isn't a number", { openingBalance: "n/a", closingBalance: "2456.36" }],
    ])("reads a statement with %s, noting it couldn't be checked", async (_name, balances) => {
      const userId = await createUser();
      await createBankAccount(userId, ownIban);
      const pdfImportId = await readWith(userId, answer(balances));

      expect(await getPdfImport(db, userId, pdfImportId)).toMatchObject({
        state: "read",
        balance: { result: "unchecked" },
      });
      expect(await previewPdfImport(db, userId, { pdfImportId })).toMatchObject({ ok: true });
    });

    it("can't check the total when a row's amount doesn't read", async () => {
      const userId = await createUser();
      const transactions = [row({ amount: "-4.20" }), row({ amount: "four" })];
      const pdfImportId = await readWith(
        userId,
        answer({ openingBalance: "10.00", closingBalance: "5.80", transactions }),
      );

      expect(await getPdfImport(db, userId, pdfImportId)).toMatchObject({
        state: "read",
        balance: { result: "unchecked" },
      });
    });

    it("refuses a file the model says isn't a bank statement, and keeps nothing of it", async () => {
      const userId = await createUser();
      await createBankAccount(userId, ownIban);
      const pdfImportId = await readWith(userId, answer({ isStatement: false, ...balanced }));

      expect(await getPdfImport(db, userId, pdfImportId)).toMatchObject({
        state: "failed",
        failureReason: "not-a-statement",
        balance: null,
      });
      const stored = await storedRow(pdfImportId);
      expect(stored?.bytes).toBeNull();
      expect(stored?.answer).toBeNull();
      expect(await commitPdfImport(db, userId, { pdfImportId })).toEqual({
        ok: false,
        reason: "pdf-import-not-found",
      });
      expect(await savedTransactions(userId)).toEqual([]);
    });

    it("asks the model for the balances and whether the file is a statement", async () => {
      const userId = await createUser();
      const pdfImportId = await start(userId);
      const { client, requests } = fakeClient(answer());
      await readPdfImport(db, userId, pdfImportId, { client });

      expect(requests[0]!.schema).toMatchObject({
        required: expect.arrayContaining(["isStatement", "openingBalance", "closingBalance"]),
      });
    });
  });

  describe("preview and commit", () => {
    it("previews and commits the rows into the account with the statement's own IBAN", async () => {
      const userId = await createUser();
      const account = await createBankAccount(userId, ownIban);
      const pdfImportId = await readWith(userId, answer());

      const preview = await previewPdfImport(db, userId, { pdfImportId });
      expect(preview).toMatchObject({
        ok: true,
        account: { id: account.id },
        rowsParsed: 3,
        rowsNew: 3,
        rowsDuplicate: 0,
        failed: [],
      });

      const committed = await commitPdfImport(db, userId, { pdfImportId });
      expect(committed).toMatchObject({ ok: true, rowsNew: 3, rowsDuplicate: 0 });
      expect(await savedTransactions(userId)).toEqual([
        expect.objectContaining({ bookedOn: "2026-03-02", amountCents: -4215n }),
        expect.objectContaining({ bookedOn: "2026-03-03", amountCents: 150000n }),
        expect.objectContaining({ bookedOn: "2026-03-04", amountCents: -150n }),
      ]);
      // Confirmed: the answer isn't kept.
      expect(await getPdfImport(db, userId, pdfImportId)).toBeNull();
    });

    it("records the import with no profile, and keeps the model's row as each transaction's raw", async () => {
      const userId = await createUser();
      await createBankAccount(userId, ownIban);
      const pdfImportId = await readWith(userId, answer());
      const committed = await commitPdfImport(db, userId, { pdfImportId });
      if (!committed.ok) throw new Error(committed.reason);

      const [record] = await db
        .select()
        .from(schema.moneyImports)
        .where(
          and(
            eq(schema.moneyImports.userId, userId),
            eq(schema.moneyImports.id, committed.importId),
          ),
        );
      expect(record).toMatchObject({
        profileId: null,
        filename: "statement.pdf",
        rowsParsed: 3,
        rowsNew: 3,
        rowsFailed: 0,
      });
      const [first] = await savedTransactions(userId);
      expect(first?.raw).toEqual(answer().transactions[0]);
      expect(first?.counterparty).toBe("GROCERY MART");
    });

    it("reads amounts as exact cents and fails rows with an unusable date, amount or currency", async () => {
      const userId = await createUser();
      await createBankAccount(userId, ownIban);
      const pdfImportId = await readWith(
        userId,
        answer({
          transactions: [
            row({ amount: "0.10" }),
            row({ amount: "-1,234.56" }),
            row({ amount: "12.345" }),
            row({ amount: "1e3" }),
            row({ bookingDate: "2026-02-30" }),
            row({ bookingDate: "02.03.2026" }),
            row({ currency: "euro" }),
            row({ currency: "usd", amount: "-3.00" }),
          ],
        }),
      );

      const preview = await previewPdfImport(db, userId, { pdfImportId });
      expect(preview).toMatchObject({
        ok: true,
        rowsParsed: 8,
        rowsNew: 2,
        failed: [
          { row: 3, reason: "invalid-amount" },
          { row: 4, reason: "invalid-amount" },
          { row: 5, reason: "invalid-date" },
          { row: 6, reason: "invalid-date" },
          { row: 7, reason: "invalid-currency" },
          { row: 8, reason: "currency-mismatch" },
        ],
      });
      await commitPdfImport(db, userId, { pdfImportId });
      expect((await savedTransactions(userId)).map((saved) => saved.amountCents)).toEqual([
        -123456n,
        10n,
      ]);
    });

    it("offers a new account for an own IBAN the user doesn't have, and creates it", async () => {
      const userId = await createUser();
      const pdfImportId = await readWith(userId, answer());

      expect(await previewPdfImport(db, userId, { pdfImportId })).toEqual({
        ok: false,
        reason: "unknown-account",
        iban: ownIban,
        currency: "EUR",
      });
      const created = await createPdfImportAccount(db, userId, { pdfImportId, name: "Example" });
      expect(created).toMatchObject({ ok: true, account: { iban: ownIban, currency: "EUR" } });
      expect(await previewPdfImport(db, userId, { pdfImportId })).toMatchObject({
        ok: true,
        rowsNew: 3,
      });
    });

    it("refuses a statement naming more than one own IBAN", async () => {
      const userId = await createUser();
      await createBankAccount(userId, ownIban);
      const pdfImportId = await readWith(userId, answer({ accountIbans: [ownIban, otherOwnIban] }));

      expect(await previewPdfImport(db, userId, { pdfImportId })).toEqual({
        ok: false,
        reason: "multiple-own-ibans",
      });
      expect(await commitPdfImport(db, userId, { pdfImportId })).toEqual({
        ok: false,
        reason: "multiple-own-ibans",
      });
      expect(await savedTransactions(userId)).toEqual([]);
    });

    it("asks for an account when the statement names none, and imports into the one picked", async () => {
      const userId = await createUser();
      const account = await createBankAccount(userId, otherOwnIban);
      // An own IBAN that fails its check digits names no account.
      const pdfImportId = await readWith(userId, answer({ accountIbans: ["DE00 1234"] }));

      expect(await previewPdfImport(db, userId, { pdfImportId })).toEqual({
        ok: false,
        reason: "account-required",
      });
      expect(
        await previewPdfImport(db, userId, { pdfImportId, accountId: account.id }),
      ).toMatchObject({ ok: true, account: { id: account.id }, rowsNew: 3 });
      expect(
        await commitPdfImport(db, userId, { pdfImportId, accountId: account.id }),
      ).toMatchObject({ ok: true, rowsNew: 3 });
    });

    it("reads a spaced, lower-case own IBAN as the account's", async () => {
      const userId = await createUser();
      const account = await createBankAccount(userId, ownIban);
      const pdfImportId = await readWith(
        userId,
        answer({ accountIbans: ["de89 3704 0044 0532 0130 00"] }),
      );

      expect(await previewPdfImport(db, userId, { pdfImportId })).toMatchObject({
        ok: true,
        account: { id: account.id },
      });
    });

    it("refuses a row in another currency than the account's", async () => {
      const userId = await createUser();
      await createBankAccount(userId, ownIban, "USD");
      const pdfImportId = await readWith(userId, answer());

      expect(await previewPdfImport(db, userId, { pdfImportId })).toMatchObject({
        ok: true,
        rowsNew: 0,
        failed: [
          { row: 1, reason: "currency-mismatch" },
          { row: 2, reason: "currency-mismatch" },
          { row: 3, reason: "currency-mismatch" },
        ],
      });
    });

    it("puts moves between own accounts in Transfers and applies the user's rules", async () => {
      const userId = await createUser();
      await createBankAccount(userId, ownIban);
      await createBankAccount(userId, savingsIban);
      const categories = await listCategories(db, userId);
      const food = categories.find((category) => category.name === "Food")!;
      const transfers = categories.find((category) => category.excludedFromSpending)!;
      await createRule(db, userId, {
        field: "counterparty",
        pattern: "GROCERY",
        categoryId: food.id,
      });
      const pdfImportId = await readWith(
        userId,
        answer({
          transactions: [
            row({ amount: "-42.15", counterparty: "GROCERY MART" }),
            row({ amount: "-100.00", counterpartyIban: "fr14 2004 1010 0505 0001 3m02 606" }),
          ],
        }),
      );
      await commitPdfImport(db, userId, { pdfImportId });

      expect(await savedTransactions(userId)).toEqual([
        expect.objectContaining({
          amountCents: -10000n,
          categoryId: transfers.id,
          categorySource: "transfer",
        }),
        expect.objectContaining({
          amountCents: -4215n,
          categoryId: food.id,
          categorySource: "rule",
        }),
      ]);
    });

    it("finds every row of a re-imported PDF as a duplicate, and keeps two equal rows as two", async () => {
      const userId = await createUser();
      await createBankAccount(userId, ownIban);
      const twoCoffees = answer({
        transactions: [
          row({ amount: "-3.00", counterparty: "EXAMPLE CAFE" }),
          row({ amount: "-3.00", counterparty: "EXAMPLE CAFE" }),
        ],
      });
      const first = await readWith(userId, twoCoffees);
      expect(await commitPdfImport(db, userId, { pdfImportId: first })).toMatchObject({
        rowsNew: 2,
      });

      // The model's text can differ between readings; the date, amount and currency don't.
      const again = await readWith(
        userId,
        answer({
          transactions: [
            row({ amount: "-3.00", counterparty: "Example Cafe", description: "Coffee" }),
            row({ amount: "-3.00", counterparty: null }),
          ],
        }),
      );
      expect(await previewPdfImport(db, userId, { pdfImportId: again })).toMatchObject({
        rowsNew: 0,
        rowsDuplicate: 2,
      });
      expect(await commitPdfImport(db, userId, { pdfImportId: again })).toMatchObject({
        rowsNew: 0,
        rowsDuplicate: 2,
      });
      expect(await savedTransactions(userId)).toHaveLength(2);
    });

    it("doesn't take a PDF row for a CSV row with the same date and amount", async () => {
      const userId = await createUser();
      await createBankAccount(userId, ownIban);
      const profile: ImportProfile = {
        name: "Example Bank",
        skipLines: 0,
        delimiter: ",",
        encoding: "utf-8",
        decimalSeparator: ".",
        dateFormat: "YYYY-MM-DD",
        columns: { bookingDate: "Date", amount: "Amount", ownIban: "Account" },
        debitValues: null,
      };
      const bytes = new TextEncoder().encode(`Date,Amount,Account\n2026-03-02,-4.20,${ownIban}\n`);
      await commitImport(db, userId, { profile, filename: "statement.csv", bytes });
      const pdfImportId = await readWith(userId, answer({ transactions: [row()] }));

      expect(await previewPdfImport(db, userId, { pdfImportId })).toMatchObject({ rowsNew: 1 });
      expect(
        await previewImport(db, userId, { profile, filename: "statement.csv", bytes }),
      ).toMatchObject({
        rowsDuplicate: 1,
      });
    });

    it("refuses a PDF import that isn't read yet, or failed", async () => {
      const userId = await createUser();
      await createBankAccount(userId, ownIban);
      const queued = await start(userId);
      const failed = await readWith(userId, { nonsense: true });

      for (const pdfImportId of [queued, failed]) {
        expect(await previewPdfImport(db, userId, { pdfImportId })).toEqual({
          ok: false,
          reason: "pdf-import-not-found",
        });
        expect(await commitPdfImport(db, userId, { pdfImportId })).toEqual({
          ok: false,
          reason: "pdf-import-not-found",
        });
      }
    });

    it("saves a PDF import once when it is committed twice", async () => {
      const userId = await createUser();
      await createBankAccount(userId, ownIban);
      const pdfImportId = await readWith(userId, answer());

      const results = await Promise.all([
        commitPdfImport(db, userId, { pdfImportId }),
        commitPdfImport(db, userId, { pdfImportId }),
      ]);
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results).toContainEqual({ ok: false, reason: "pdf-import-not-found" });
      expect(await savedTransactions(userId)).toHaveLength(3);
    });
  });

  describe("the user's PDF imports", () => {
    it("shows the latest one, and forgets one the user discards", async () => {
      const userId = await createUser();
      const first = await readWith(userId, { nonsense: true });
      const second = await start(userId);

      expect(await latestPdfImport(db, userId)).toMatchObject({ id: second, state: "queued" });
      await discardPdfImport(db, userId, second);
      expect(await latestPdfImport(db, userId)).toMatchObject({ id: first, state: "failed" });
      await discardPdfImport(db, userId, first);
      expect(await latestPdfImport(db, userId)).toBeNull();
    });

    it("keeps one user's PDF import away from another", async () => {
      const userA = await createUser();
      const userB = await createUser();
      await createBankAccount(userA, ownIban);
      const bAccount = await createBankAccount(userB, otherOwnIban);
      const queued = await start(userA);
      const read = await readWith(userA, answer());
      const { client, requests } = fakeClient(answer());

      // B can't read, see, preview, create an account from, commit or discard A's.
      expect(await readPdfImport(db, userB, queued, { client })).toBeNull();
      expect(requests).toEqual([]);
      expect(await getPdfImport(db, userB, read)).toBeNull();
      expect(await latestPdfImport(db, userB)).toBeNull();
      expect(await previewPdfImport(db, userB, { pdfImportId: read })).toEqual({
        ok: false,
        reason: "pdf-import-not-found",
      });
      expect(
        await previewPdfImport(db, userB, { pdfImportId: read, accountId: bAccount.id }),
      ).toEqual({ ok: false, reason: "pdf-import-not-found" });
      expect(await createPdfImportAccount(db, userB, { pdfImportId: read, name: "Mine" })).toEqual({
        ok: false,
        reason: "pdf-import-not-found",
      });
      expect(await commitPdfImport(db, userB, { pdfImportId: read })).toEqual({
        ok: false,
        reason: "pdf-import-not-found",
      });
      await discardPdfImport(db, userB, read);

      expect(await getPdfImport(db, userA, queued)).toMatchObject({ state: "queued" });
      expect(await getPdfImport(db, userA, read)).toMatchObject({ state: "read" });
      expect(await savedTransactions(userB)).toEqual([]);
    });

    it("doesn't import into another user's account picked by id", async () => {
      const userA = await createUser();
      const userB = await createUser();
      const bAccount = await createBankAccount(userB, otherOwnIban);
      const pdfImportId = await readWith(userA, answer({ accountIbans: [] }));

      expect(await commitPdfImport(db, userA, { pdfImportId, accountId: bAccount.id })).toEqual({
        ok: false,
        reason: "account-not-found",
      });
      expect(await savedTransactions(userB)).toEqual([]);
    });

    it("are deleted with the user", async () => {
      const userId = await createUser();
      await start(userId);
      await readWith(userId, answer());

      await db.delete(schema.users).where(eq(schema.users.id, userId));
      const left = await db
        .select({ id: schema.moneyPdfImports.id })
        .from(schema.moneyPdfImports)
        .where(eq(schema.moneyPdfImports.userId, userId));
      expect(left).toEqual([]);
    });
  });
});
