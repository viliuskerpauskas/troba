import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { addAttachment, createTransaction, ensureMoneyDefaults, listAccounts } from "@troba/core";
import { schema } from "@troba/db";
import { createTestDatabase } from "@troba/db/test-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let uploadsDir: string;
// Imported after DATABASE_URL points at the test database (db() reads it once) and UPLOADS_DIR at a
// temporary folder.
let modules: { db: typeof import("./db"); files: typeof import("./files") };
let userCount = 0;

const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);

async function createUser() {
  const db = modules.db.db();
  const [user] = await db
    .insert(schema.users)
    .values({ name: "Example User", email: `files${++userCount}@example.test` })
    .returning({ id: schema.users.id });
  const userId = user!.id;
  await ensureMoneyDefaults(db, userId);
  const [cash] = await listAccounts(db, userId);
  const created = await createTransaction(db, userId, {
    accountId: cash!.id,
    bookedOn: "2026-10-03",
    amountCents: 1250n,
    direction: "expense",
  });
  if (!created.ok) throw new Error(created.reason);
  return { userId, transactionId: created.transaction.id };
}

async function attach(filename: string) {
  const owner = await createUser();
  const added = await addAttachment(modules.db.db(), {
    ...owner,
    uploadsDir,
    filename,
    bytes: jpeg,
  });
  if (!added.ok) throw new Error(added.reason);
  return { userId: owner.userId, attachmentId: added.attachment.id };
}

describe("attachmentResponse", () => {
  beforeAll(async () => {
    database = await createTestDatabase();
    process.env.DATABASE_URL = database.url;
    uploadsDir = await mkdtemp(path.join(tmpdir(), "troba-uploads-"));
    process.env.UPLOADS_DIR = uploadsDir;
    modules = { db: await import("./db"), files: await import("./files") };
  });
  afterAll(async () => {
    await modules?.db.db().$client.end();
    await database?.drop();
    if (uploadsDir) await rm(uploadsDir, { recursive: true, force: true });
  });

  it("serves the owner their file inline, typed by its content and never cached", async () => {
    const { userId, attachmentId } = await attach("Receipt – café №1.jpg");

    const response = await modules.files.attachmentResponse(userId, attachmentId);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("content-length")).toBe(String(jpeg.byteLength));
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toBe(
      `inline; filename="Receipt _ caf_ _1.jpg"; filename*=UTF-8''Receipt%20%E2%80%93%20caf%C3%A9%20%E2%84%961.jpg`,
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(jpeg);
  });

  it("serves it as a download when asked", async () => {
    const { userId, attachmentId } = await attach(`say "cheese" (it's free).jpg`);

    const response = await modules.files.attachmentResponse(userId, attachmentId, {
      download: true,
    });

    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="say _cheese_ (it's free).jpg"; filename*=UTF-8''say%20%22cheese%22%20%28it%27s%20free%29.jpg`,
    );
  });

  it("answers 404 to every other user, and for ids that aren't attachments", async () => {
    const { attachmentId } = await attach("receipt.jpg");
    const other = await createUser();

    for (const id of [attachmentId, crypto.randomUUID(), "not-a-uuid", "../../etc/passwd"]) {
      const response = await modules.files.attachmentResponse(other.userId, id);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("Not found.");
    }
  });
});
