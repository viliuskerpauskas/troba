import { createDb, schema, type Db } from "@troba/db";
import { createTestDatabase } from "@troba/db/test-database";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startJobQueue, type JobQueue } from "../../jobs/queue";
import { createAccount } from "../accounts";
import { ensureMoneyDefaults } from "../defaults";
import {
  commitPdfImport,
  deleteExpiredPdfImports,
  getPdfImport,
  pdfImportExpiryMs,
  readPdfImport,
  startPdfImport,
  type StatementModelClient,
} from "./pdf-import";

// Unconfirmed PDF imports (T155): a read answer is kept only until it is confirmed or abandoned.
// The cleanup job deletes PDF imports never confirmed, whatever their state, once they are older
// than the expiry, and nothing else.

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Db;
let queue: JobQueue;
let userCount = 0;

const ownIban = "DE89370400440532013000";
const hour = 60 * 60 * 1000;

const statement = {
  accountIbans: [ownIban],
  currency: "EUR",
  transactions: [
    {
      bookingDate: "2026-03-02",
      amount: "-4.20",
      currency: "EUR",
      counterparty: "GROCERY MART",
      counterpartyIban: null,
      description: null,
    },
  ],
};

async function createUser() {
  const [user] = await db
    .insert(schema.users)
    .values({ name: "Example User", email: `expiry${++userCount}@example.test` })
    .returning({ id: schema.users.id });
  await ensureMoneyDefaults(db, user!.id);
  return user!.id;
}

async function start(userId: string) {
  const started = await startPdfImport(
    db,
    userId,
    { filename: "statement.pdf", bytes: new TextEncoder().encode("%PDF-1.7\n") },
    { queue },
  );
  if (!started.ok) throw new Error(`startPdfImport failed: ${started.reason}`);
  return started.pdfImportId;
}

async function read(userId: string, value: unknown) {
  const pdfImportId = await start(userId);
  const client: StatementModelClient = { readStatement: async () => value };
  await readPdfImport(db, userId, pdfImportId, { client });
  return pdfImportId;
}

// Moves a PDF import's creation back by `ms`, as if it were started that long ago.
async function age(pdfImportId: string, ms: number) {
  await db
    .update(schema.moneyPdfImports)
    .set({ createdAt: new Date(Date.now() - ms) })
    .where(eq(schema.moneyPdfImports.id, pdfImportId));
}

async function exists(userId: string, pdfImportId: string) {
  return (await getPdfImport(db, userId, pdfImportId)) !== null;
}

describe("PDF import expiry", () => {
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

  it("expires after 24 hours", () => {
    expect(pdfImportExpiryMs).toBe(24 * hour);
  });

  it("deletes read and failed PDF imports older than the expiry", async () => {
    const userId = await createUser();
    const readOne = await read(userId, statement);
    const failedOne = await read(userId, { nonsense: true });
    expect((await getPdfImport(db, userId, readOne))?.state).toBe("read");
    expect((await getPdfImport(db, userId, failedOne))?.state).toBe("failed");
    await age(readOne, pdfImportExpiryMs + hour);
    await age(failedOne, pdfImportExpiryMs + hour);

    await deleteExpiredPdfImports(db);

    expect(await exists(userId, readOne)).toBe(false);
    expect(await exists(userId, failedOne)).toBe(false);
  });

  it("deletes a PDF import stuck queued or reading past the expiry", async () => {
    const userId = await createUser();
    const queued = await start(userId);
    const reading = await start(userId);
    await db
      .update(schema.moneyPdfImports)
      .set({ state: "reading" })
      .where(eq(schema.moneyPdfImports.id, reading));
    await age(queued, pdfImportExpiryMs + hour);
    await age(reading, pdfImportExpiryMs + hour);

    await deleteExpiredPdfImports(db);

    expect(await exists(userId, queued)).toBe(false);
    expect(await exists(userId, reading)).toBe(false);
  });

  it("keeps PDF imports younger than the expiry, in every state", async () => {
    const userId = await createUser();
    const queued = await start(userId);
    const readOne = await read(userId, statement);
    const failedOne = await read(userId, { nonsense: true });
    for (const id of [queued, readOne, failedOne]) await age(id, pdfImportExpiryMs - hour);

    await deleteExpiredPdfImports(db);

    for (const id of [queued, readOne, failedOne]) expect(await exists(userId, id)).toBe(true);
  });

  it("deletes each user's expired PDF imports and no one's fresh ones", async () => {
    const owner = await createUser();
    const friend = await createUser();
    const ownerExpired = await read(owner, statement);
    const ownerFresh = await read(owner, statement);
    const friendExpired = await read(friend, statement);
    const friendFresh = await read(friend, statement);
    await age(ownerExpired, pdfImportExpiryMs + hour);
    await age(friendExpired, pdfImportExpiryMs + hour);

    await deleteExpiredPdfImports(db);

    expect(await exists(owner, ownerExpired)).toBe(false);
    expect(await exists(friend, friendExpired)).toBe(false);
    expect(await exists(owner, ownerFresh)).toBe(true);
    expect(await exists(friend, friendFresh)).toBe(true);
  });

  it("leaves confirmed imports and their transactions alone", async () => {
    const userId = await createUser();
    const result = await createAccount(db, userId, {
      name: "Example Bank",
      type: "bank",
      currency: "EUR",
      iban: ownIban,
    });
    if (!result.ok) throw new Error(result.reason);
    const pdfImportId = await read(userId, statement);
    const committed = await commitPdfImport(db, userId, { pdfImportId });
    if (!committed.ok) throw new Error(committed.reason);
    // Even an import saved long ago, with its rows dated long ago.
    await db
      .update(schema.moneyImports)
      .set({ importedAt: sql`now() - interval '30 days'` })
      .where(eq(schema.moneyImports.id, committed.importId));

    await deleteExpiredPdfImports(db);

    const imports = await db
      .select({ id: schema.moneyImports.id })
      .from(schema.moneyImports)
      .where(eq(schema.moneyImports.userId, userId));
    const transactions = await db
      .select({ importId: schema.moneyTransactions.importId })
      .from(schema.moneyTransactions)
      .where(eq(schema.moneyTransactions.userId, userId));
    expect(imports).toEqual([{ id: committed.importId }]);
    expect(transactions).toEqual([{ importId: committed.importId }]);
  });
});
