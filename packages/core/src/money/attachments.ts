import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { schema, type Db } from "@troba/db";
import { and, asc, count, eq } from "drizzle-orm";

// Receipt attachments (SPEC-money M6). Files live at <uploadsDir>/<userId>/<uuid>, named by the
// server; the client's filename is metadata only. Every read and delete filters by the user, so
// another user's attachment id finds nothing.

const { moneyAttachments, moneyTransactions } = schema;

export type Attachment = {
  id: string;
  transactionId: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  createdAt: Date;
};

export type AddAttachmentResult =
  | { ok: true; attachment: Attachment }
  | {
      ok: false;
      reason: "transaction-not-found" | "too-large" | "unsupported-type" | "limit-reached";
    };

export const maxAttachmentBytes = 10 * 1024 * 1024;
// Bounds the list on a transaction's page; a receipt rarely needs more than a few pages.
export const maxAttachmentsPerTransaction = 20;

export const attachmentTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
] as const;
export type AttachmentType = (typeof attachmentTypes)[number];

const startsWith = (bytes: Uint8Array, prefix: readonly number[], at = 0) =>
  bytes.byteLength >= at + prefix.length && prefix.every((byte, i) => bytes[at + i] === byte);
const ascii = (text: string) => Array.from(text, (char) => char.charCodeAt(0));
const brandAt = (bytes: Uint8Array, at: number) =>
  String.fromCharCode(...bytes.subarray(at, at + 4));

// HEIC is an ISO base media file: a box size, "ftyp", the major brand, a version, then the
// compatible brands. AVIF has the same shape with other brands, so the brand decides. A generic
// HEIF major brand (mif1, msf1) counts when a HEVC brand is among the compatible ones.
const heicBrands = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx"]);
const heifBrands = new Set(["mif1", "msf1"]);

function isHeic(bytes: Uint8Array): boolean {
  if (!startsWith(bytes, ascii("ftyp"), 4)) return false;
  const major = brandAt(bytes, 8);
  if (heicBrands.has(major)) return true;
  if (!heifBrands.has(major)) return false;
  const boxSize = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0);
  const end = Math.min(boxSize, bytes.byteLength);
  for (let at = 16; at + 4 <= end; at += 4) {
    if (heicBrands.has(brandAt(bytes, at))) return true;
  }
  return false;
}

// The type is what the content is, by its magic bytes; the declared type and the filename are
// never trusted.
export function sniffAttachmentType(bytes: Uint8Array): AttachmentType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, ...ascii("PNG\r\n"), 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return "image/webp";
  if (startsWith(bytes, ascii("%PDF-"))) return "application/pdf";
  if (isHeic(bytes)) return "image/heic";
  return null;
}

const attachmentColumns = {
  id: moneyAttachments.id,
  transactionId: moneyAttachments.transactionId,
  filename: moneyAttachments.filename,
  mime: moneyAttachments.mime,
  sizeBytes: moneyAttachments.sizeBytes,
  createdAt: moneyAttachments.createdAt,
};

// storagePath is always <userId>/<uuid>, written by addAttachment; the check makes a bad row fail
// rather than reach outside the user's folder.
function filePath(uploadsDir: string, userId: string, storagePath: string): string {
  const folder = path.resolve(uploadsDir, userId);
  const file = path.resolve(uploadsDir, storagePath);
  if (path.dirname(file) !== folder) {
    throw new Error("Attachment path is outside the user's uploads folder.");
  }
  return file;
}

export async function addAttachment(
  db: Db,
  input: {
    userId: string;
    uploadsDir: string;
    transactionId: string;
    filename: string;
    bytes: Uint8Array;
  },
): Promise<AddAttachmentResult> {
  const { userId, uploadsDir, transactionId, bytes } = input;
  if (bytes.byteLength > maxAttachmentBytes) return { ok: false, reason: "too-large" };
  const mime = sniffAttachmentType(bytes);
  if (!mime) return { ok: false, reason: "unsupported-type" };
  const [transaction] = await db
    .select({ id: moneyTransactions.id })
    .from(moneyTransactions)
    .where(and(eq(moneyTransactions.id, transactionId), eq(moneyTransactions.userId, userId)));
  if (!transaction) return { ok: false, reason: "transaction-not-found" };
  const [{ attached } = { attached: 0 }] = await db
    .select({ attached: count() })
    .from(moneyAttachments)
    .where(
      and(eq(moneyAttachments.transactionId, transactionId), eq(moneyAttachments.userId, userId)),
    );
  if (attached >= maxAttachmentsPerTransaction) return { ok: false, reason: "limit-reached" };

  const storagePath = `${userId}/${randomUUID()}`;
  const file = filePath(uploadsDir, userId, storagePath);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes, { flag: "wx" });
  try {
    const [attachment] = await db
      .insert(moneyAttachments)
      .values({
        userId,
        transactionId,
        filename: input.filename,
        mime,
        sizeBytes: bytes.byteLength,
        storagePath,
      })
      .returning(attachmentColumns);
    return { ok: true, attachment: attachment! };
  } catch (error) {
    // The transaction was deleted meanwhile, say: no row, so no file either.
    await rm(file, { force: true });
    throw error;
  }
}

// Oldest first; at most maxAttachmentsPerTransaction, which addAttachment enforces.
export async function listAttachments(
  db: Db,
  userId: string,
  transactionId: string,
): Promise<Attachment[]> {
  return db
    .select(attachmentColumns)
    .from(moneyAttachments)
    .where(
      and(eq(moneyAttachments.transactionId, transactionId), eq(moneyAttachments.userId, userId)),
    )
    .orderBy(asc(moneyAttachments.createdAt), asc(moneyAttachments.id))
    .limit(maxAttachmentsPerTransaction);
}

// The file and its metadata, or null when the id isn't one of the user's attachments.
export async function getAttachmentFile(
  db: Db,
  input: { userId: string; uploadsDir: string; attachmentId: string },
): Promise<(Attachment & { bytes: Buffer }) | null> {
  const { userId, uploadsDir, attachmentId } = input;
  const [row] = await db
    .select({ ...attachmentColumns, storagePath: moneyAttachments.storagePath })
    .from(moneyAttachments)
    .where(and(eq(moneyAttachments.id, attachmentId), eq(moneyAttachments.userId, userId)));
  if (!row) return null;
  const { storagePath, ...attachment } = row;
  const bytes = await readFile(filePath(uploadsDir, userId, storagePath));
  return { ...attachment, bytes };
}

// Returns whether one of the user's attachments was removed.
export async function removeAttachment(
  db: Db,
  input: { userId: string; uploadsDir: string; attachmentId: string },
): Promise<boolean> {
  const { userId, uploadsDir, attachmentId } = input;
  return db.transaction(async (tx) => {
    const removed = await tx
      .delete(moneyAttachments)
      .where(and(eq(moneyAttachments.id, attachmentId), eq(moneyAttachments.userId, userId)))
      .returning({ storagePath: moneyAttachments.storagePath });
    await removeAttachmentFiles(uploadsDir, userId, removed);
    return removed.length > 0;
  });
}

// Call inside the database transaction that deletes the rows, before it commits: if a file can't
// be removed, the rows stay and the user can retry. A missing file is already removed.
export async function removeAttachmentFiles(
  uploadsDir: string,
  userId: string,
  rows: { storagePath: string }[],
): Promise<void> {
  await Promise.all(
    rows.map(({ storagePath }) => rm(filePath(uploadsDir, userId, storagePath), { force: true })),
  );
}
