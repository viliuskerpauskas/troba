import {
  createAccount,
  readPdfImport,
  startJobQueue,
  type JobQueue,
  type StatementModelClient,
} from "@troba/core";
import { createDb, schema, type Db } from "@troba/db";
import { createTestDatabase } from "@troba/db/test-database";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportState } from "./actions";

// The import wizard's PDF steps (T152, ADR-0018): the send disclosure and its confirm, the reading
// state, and the preview and commit of what the model read. The session, database and job queue
// are replaced with test ones; the worker's part runs through core with a fake statement model
// client. No real model is ever called.

const session = vi.hoisted(() => ({ userId: "" }));
const server = vi.hoisted(() => ({ db: undefined as unknown, queue: undefined as unknown }));

vi.mock("@/server/money", () => ({
  requireMoneyUser: async () => ({ userId: session.userId, role: "user" }),
}));
vi.mock("@/server/db", () => ({ db: () => server.db }));
vi.mock("@/server/jobs", () => ({ jobQueue: async () => server.queue }));
vi.mock("@/server/openai-mapping", () => ({ mappingModelClient: () => null }));
vi.mock("@/server/openai-categorization", () => ({ categorizationModelClient: () => null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Db;
let queue: JobQueue;
let actions: typeof import("./actions");
let userCount = 0;

const pdf = new TextEncoder().encode("%PDF-1.7\n% a fictional statement\n");
const ownIban = "DE89370400440532013000";

const answer = {
  accountIbans: [ownIban],
  currency: "EUR",
  transactions: [
    {
      bookingDate: "2026-03-02",
      amount: "-42.15",
      currency: "EUR",
      counterparty: "GROCERY MART",
      counterpartyIban: null,
      description: "Card purchase",
    },
  ],
};

function form(fields: Record<string, string> = {}, file = true) {
  const data = new FormData();
  if (file) data.set("file", new File([pdf], "statement.pdf", { type: "application/pdf" }));
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

async function jobCount() {
  const result = await db.$client.query<{ n: number }>(
    "select count(*)::int as n from pgboss.job where name = 'read-pdf-import'",
  );
  return result.rows[0]!.n;
}

async function owned(table: string, userId: string) {
  const result = await db.$client.query(`select * from ${table} where user_id = $1`, [userId]);
  return result.rows;
}

async function pdfImportRows(userId: string) {
  return (await owned("money_pdf_imports", userId)).map((row) => ({ id: row.id }));
}

function step<S extends ImportState["step"]>(state: ImportState, name: S) {
  if (state.step !== name)
    throw new Error(`expected the ${name} step, got ${JSON.stringify(state)}`);
  return state as Extract<ImportState, { step: S }>;
}

// What the worker does with the job, through core and a fake client.
async function workerReads(pdfImportId: string, value: unknown) {
  const client: StatementModelClient = { readStatement: async () => value };
  await readPdfImport(db, session.userId, pdfImportId, { client });
}

async function confirmed() {
  return step(await actions.startPdfImportAction(form()), "pdf-reading");
}

beforeAll(async () => {
  database = await createTestDatabase();
  db = createDb(database.url);
  queue = await startJobQueue(database.url);
  server.db = db;
  server.queue = queue;
  actions = await import("./actions");
});

afterAll(async () => {
  await queue.stop({ graceful: false });
  await db.$client.end();
  await database.drop();
});

beforeEach(async () => {
  const [user] = await db
    .insert(schema.users)
    .values({ name: "Example User", email: `pdf-wizard${++userCount}@example.test` })
    .returning({ id: schema.users.id });
  session.userId = user!.id;
  // Never the real key from .env: a made-up one switches PDF import on, and nothing here sends.
  vi.stubEnv("OPENAI_API_KEY", "sk-test-not-a-real-key");
});

afterEach(() => vi.unstubAllEnvs());

describe("a PDF upload without an OpenAI key", () => {
  it("is refused as unavailable, and nothing is kept or queued", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const jobs = await jobCount();

    for (const action of [actions.startImportAction, actions.startPdfImportAction]) {
      expect(await action(form())).toEqual({
        step: "upload",
        error: expect.stringContaining("PDF import isn't available"),
      });
    }
    expect(await pdfImportRows(session.userId)).toEqual([]);
    expect(await jobCount()).toBe(jobs);
  });
});

describe("a PDF upload with an OpenAI key", () => {
  it("asks to confirm the send first, keeping and queueing nothing until then", async () => {
    const jobs = await jobCount();

    expect(await actions.startImportAction(form())).toEqual({
      step: "pdf-confirm",
      filename: "statement.pdf",
    });
    expect(await pdfImportRows(session.userId)).toEqual([]);
    expect(await jobCount()).toBe(jobs);
  });

  it("asks again on every import", async () => {
    await confirmed();
    expect(await actions.startImportAction(form())).toMatchObject({ step: "pdf-confirm" });
  });

  it("creates the PDF import and queues its job once confirmed", async () => {
    const jobs = await jobCount();

    const reading = await confirmed();

    expect(reading.filename).toBe("statement.pdf");
    expect(await pdfImportRows(session.userId)).toEqual([{ id: reading.pdfImportId }]);
    expect(await jobCount()).toBe(jobs + 1);
  });

  it("refuses a CSV sent to the confirm step", async () => {
    const data = new FormData();
    data.set("file", new File(["Date,Amount\n"], "statement.csv", { type: "text/csv" }));

    expect(await actions.startPdfImportAction(data)).toMatchObject({ step: "upload" });
    expect(await pdfImportRows(session.userId)).toEqual([]);
  });

  it("refuses a PDF swapped into a CSV's later steps", async () => {
    expect(
      await actions.previewImportAction(
        form({ profileId: "00000000-0000-4000-8000-000000000000", accountId: "" }),
      ),
    ).toEqual({ step: "upload", error: expect.stringContaining("Upload the file again") });
  });
});

describe("a confirmed PDF import", () => {
  it("shows the reading state until the worker is done, then the preview, and saves on commit", async () => {
    const result = await createAccount(db, session.userId, {
      name: "Example Bank",
      type: "bank",
      currency: "EUR",
      iban: ownIban,
    });
    if (!result.ok) throw new Error(result.reason);
    const { pdfImportId } = await confirmed();
    const status = () => actions.pdfImportStatusAction(form({ pdfImportId }, false));

    expect(await status()).toEqual({
      step: "pdf-reading",
      pdfImportId,
      filename: "statement.pdf",
    });
    await workerReads(pdfImportId, answer);

    const preview = step(await status(), "pdf-preview");
    expect(preview.preview).toMatchObject({
      ok: true,
      account: { id: result.account.id },
      rowsParsed: 1,
      rowsNew: 1,
    });

    const done = step(
      await actions.commitPdfImportAction(form({ pdfImportId, accountId: "" }, false)),
      "done",
    );
    expect(done).toMatchObject({ accountName: "Example Bank", rowsNew: 1, rowsFailed: 0 });
    const saved = await owned("money_transactions", session.userId);
    expect(saved.map((row) => row.amount_cents)).toEqual(["-4215"]);
    // Saved: coming back shows the upload step.
    expect(await status()).toEqual({ step: "upload" });
  });

  it("offers to create the statement's account, then previews into it", async () => {
    const { pdfImportId } = await confirmed();
    await workerReads(pdfImportId, answer);

    const offered = step(
      await actions.pdfImportStatusAction(form({ pdfImportId }, false)),
      "pdf-preview",
    );
    expect(offered.preview).toEqual({
      ok: false,
      reason: "unknown-account",
      iban: ownIban,
      currency: "EUR",
    });
    const created = step(
      await actions.createPdfImportAccountAction(
        form({ pdfImportId, accountName: "Example Bank" }, false),
      ),
      "pdf-preview",
    );
    expect(created.preview).toMatchObject({ ok: true, rowsNew: 1 });
  });

  it("shows a failed reading with its reason, and starting again drops it", async () => {
    const { pdfImportId } = await confirmed();
    await workerReads(pdfImportId, { nonsense: true });

    expect(await actions.pdfImportStatusAction(form({ pdfImportId }, false))).toEqual({
      step: "pdf-failed",
      pdfImportId,
      filename: "statement.pdf",
      message: expect.stringContaining("Nothing was saved"),
    });
    expect(await actions.discardPdfImportAction(form({ pdfImportId }, false))).toEqual({
      step: "upload",
    });
    expect(await pdfImportRows(session.userId)).toEqual([]);
  });

  it("is out of another user's reach", async () => {
    const { pdfImportId } = await confirmed();
    await workerReads(pdfImportId, answer);
    const owner = session.userId;
    const [other] = await db
      .insert(schema.users)
      .values({ name: "Example User", email: `pdf-wizard${++userCount}@example.test` })
      .returning({ id: schema.users.id });
    session.userId = other!.id;

    const fields = { pdfImportId, accountId: "", accountName: "Mine" };
    expect(await actions.pdfImportStatusAction(form(fields, false))).toEqual({ step: "upload" });
    for (const action of [
      actions.previewPdfImportAction,
      actions.createPdfImportAccountAction,
      actions.commitPdfImportAction,
    ]) {
      expect(await action(form(fields, false))).toMatchObject({ step: "upload" });
    }
    await actions.discardPdfImportAction(form(fields, false));

    expect(await pdfImportRows(owner)).toEqual([{ id: pdfImportId }]);
    expect(await owned("money_accounts", other!.id)).toEqual([]);
  });
});
