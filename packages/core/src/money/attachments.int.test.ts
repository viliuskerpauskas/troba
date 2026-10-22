import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDb, schema, type Db } from "@troba/db";
import { createTestDatabase } from "@troba/db/test-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listAccounts } from "./accounts";
import {
  addAttachment,
  getAttachmentFile,
  listAttachments,
  maxAttachmentBytes,
  maxAttachmentsPerTransaction,
  removeAttachment,
} from "./attachments";
import { ensureMoneyDefaults } from "./defaults";
import { createTransaction, deleteTransaction, getTransaction } from "./transactions";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Db;
let uploadsDir: string;
let userCount = 0;

// The first bytes of each allowed type, padded: what the content check looks at.
const ascii = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0));
// An ISO base media file (HEIC, AVIF): a box size, "ftyp", then the major brand.
const isoMedia = (brand: string) =>
  Uint8Array.from([0, 0, 0, 0x18, ...ascii(`ftyp${brand}\0\0\0\0mif1${brand}`)]);
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const webp = ascii("RIFF\x24\x00\x00\x00WEBPVP8 ");
const heic = isoMedia("heic");
const pdf = ascii("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n");

async function createUser() {
  const [user] = await db
    .insert(schema.users)
    .values({ name: "Example User", email: `attachments${++userCount}@example.test` })
    .returning({ id: schema.users.id });
  const userId = user!.id;
  await ensureMoneyDefaults(db, userId);
  const [cash] = await listAccounts(db, userId);
  const created = await createTransaction(db, userId, {
    accountId: cash!.id,
    bookedOn: "2026-10-03",
    amountCents: 1250n,
    direction: "expense",
    counterparty: "GROCERY MART",
  });
  if (!created.ok) throw new Error(created.reason);
  return { userId, transactionId: created.transaction.id };
}

describe("attachments", () => {
  beforeAll(async () => {
    database = await createTestDatabase();
    db = createDb(database.url);
    uploadsDir = await mkdtemp(path.join(tmpdir(), "troba-uploads-"));
  });
  afterAll(async () => {
    await db?.$client.end();
    await database?.drop();
    if (uploadsDir) await rm(uploadsDir, { recursive: true, force: true });
  });

  it("attaches a receipt to a transaction and gives it back to its owner", async () => {
    const { userId, transactionId } = await createUser();

    const result = await addAttachment(db, {
      userId,
      uploadsDir,
      transactionId,
      filename: "receipt.jpg",
      bytes: jpeg,
    });

    expect(result).toMatchObject({
      ok: true,
      attachment: { filename: "receipt.jpg", mime: "image/jpeg", sizeBytes: jpeg.byteLength },
    });
    const attachments = await listAttachments(db, userId, transactionId);
    expect(attachments).toEqual([result.ok && result.attachment]);
    const file = await getAttachmentFile(db, {
      userId,
      uploadsDir,
      attachmentId: attachments[0]!.id,
    });
    expect(file).toMatchObject({ filename: "receipt.jpg", mime: "image/jpeg" });
    expect(new Uint8Array(file!.bytes)).toEqual(jpeg);
  });

  it.each([
    ["receipt.png", "image/png", png],
    ["receipt.webp", "image/webp", webp],
    ["IMG_0001.HEIC", "image/heic", heic],
    ["invoice.pdf", "application/pdf", pdf],
    // The type comes from the content, whatever the name says.
    ["photo.pdf", "image/jpeg", jpeg],
  ])("takes %s as %s", async (filename, mime, bytes) => {
    const { userId, transactionId } = await createUser();

    const result = await addAttachment(db, { userId, uploadsDir, transactionId, filename, bytes });

    expect(result).toMatchObject({ ok: true, attachment: { filename, mime } });
  });

  it.each([
    ["a GIF", "receipt.gif", ascii("GIF89a\x01\x00\x01\x00")],
    ["HTML named as a JPEG", "receipt.jpg", ascii("<html><script>alert(1)</script></html>")],
    ["an AVIF, which is not HEIC", "receipt.heic", isoMedia("avif")],
    ["a truncated PNG signature", "receipt.png", png.subarray(0, 4)],
    ["an empty file", "receipt.jpg", new Uint8Array()],
  ])("refuses %s and stores nothing", async (_name, filename, bytes) => {
    const { userId, transactionId } = await createUser();

    const result = await addAttachment(db, { userId, uploadsDir, transactionId, filename, bytes });

    expect(result).toEqual({ ok: false, reason: "unsupported-type" });
    expect(await listAttachments(db, userId, transactionId)).toEqual([]);
    expect(existsSync(path.join(uploadsDir, userId))).toBe(false);
  });

  it(`refuses a file over ${maxAttachmentBytes} bytes and takes one at the limit`, async () => {
    const { userId, transactionId } = await createUser();
    const sized = (size: number) => {
      const bytes = new Uint8Array(size);
      bytes.set(jpeg);
      return bytes;
    };

    const over = { userId, uploadsDir, transactionId, filename: "big.jpg" };
    expect(await addAttachment(db, { ...over, bytes: sized(maxAttachmentBytes + 1) })).toEqual({
      ok: false,
      reason: "too-large",
    });
    expect(existsSync(path.join(uploadsDir, userId))).toBe(false);
    expect(await addAttachment(db, { ...over, bytes: sized(maxAttachmentBytes) })).toMatchObject({
      ok: true,
      attachment: { sizeBytes: maxAttachmentBytes },
    });
  });

  it(`takes at most ${maxAttachmentsPerTransaction} attachments per transaction`, async () => {
    const { userId, transactionId } = await createUser();
    const attach = () =>
      addAttachment(db, { userId, uploadsDir, transactionId, filename: "r.png", bytes: png });
    for (let i = 0; i < maxAttachmentsPerTransaction; i++) {
      expect(await attach()).toMatchObject({ ok: true });
    }

    expect(await attach()).toEqual({ ok: false, reason: "limit-reached" });
    expect(await listAttachments(db, userId, transactionId)).toHaveLength(
      maxAttachmentsPerTransaction,
    );
    expect(await readdir(path.join(uploadsDir, userId))).toHaveLength(maxAttachmentsPerTransaction);
  });

  it("keeps each user's attachments from every other user", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const added = await addAttachment(db, {
      ...alice,
      uploadsDir,
      filename: "receipt.jpg",
      bytes: jpeg,
    });
    if (!added.ok) throw new Error(added.reason);
    const alicesFile = { uploadsDir, attachmentId: added.attachment.id };

    expect(await getAttachmentFile(db, { ...alicesFile, userId: bob.userId })).toBeNull();
    expect(await listAttachments(db, bob.userId, alice.transactionId)).toEqual([]);
    expect(
      await addAttachment(db, {
        userId: bob.userId,
        uploadsDir,
        transactionId: alice.transactionId,
        filename: "receipt.jpg",
        bytes: jpeg,
      }),
    ).toEqual({ ok: false, reason: "transaction-not-found" });
    expect(await getAttachmentFile(db, { ...alicesFile, userId: alice.userId })).not.toBeNull();
    expect(existsSync(path.join(uploadsDir, bob.userId))).toBe(false);
  });

  it("removes an attachment and its file for its owner only", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const added = await addAttachment(db, {
      ...alice,
      uploadsDir,
      filename: "r.jpg",
      bytes: jpeg,
    });
    if (!added.ok) throw new Error(added.reason);
    const attachmentId = added.attachment.id;
    const files = () => readdir(path.join(uploadsDir, alice.userId));
    expect(await files()).toHaveLength(1);

    expect(await removeAttachment(db, { userId: bob.userId, uploadsDir, attachmentId })).toBe(
      false,
    );
    expect(await files()).toHaveLength(1);

    expect(await removeAttachment(db, { userId: alice.userId, uploadsDir, attachmentId })).toBe(
      true,
    );
    expect(await listAttachments(db, alice.userId, alice.transactionId)).toEqual([]);
    expect(await files()).toEqual([]);
    expect(await getTransaction(db, alice.userId, alice.transactionId)).toMatchObject({
      hasReceipt: false,
    });
  });

  it("deletes a transaction's files with it and leaves the user's other files", async () => {
    const { userId, transactionId } = await createUser();
    const other = await createTransaction(db, userId, {
      accountId: (await listAccounts(db, userId))[0]!.id,
      bookedOn: "2026-10-04",
      amountCents: 500n,
      direction: "expense",
    });
    if (!other.ok) throw new Error(other.reason);
    const attach = (id: string) =>
      addAttachment(db, { userId, uploadsDir, transactionId: id, filename: "r.pdf", bytes: pdf });
    await attach(transactionId);
    await attach(transactionId);
    const kept = await attach(other.transaction.id);
    if (!kept.ok) throw new Error(kept.reason);

    expect(await deleteTransaction(db, userId, { transactionId, uploadsDir })).toBe(true);

    expect(await readdir(path.join(uploadsDir, userId))).toHaveLength(1);
    expect(
      await getAttachmentFile(db, { userId, uploadsDir, attachmentId: kept.attachment.id }),
    ).not.toBeNull();
  });
});
