"use server";

import { addAttachment, assertNever, maxAttachmentBytes, removeAttachment } from "@troba/core";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { uploadsDir } from "@/server/env";
import { requireUser } from "@/server/session";
import { receiptMessages, receiptTooLargeMessage } from "./receipt-messages";

// Receipts on a transaction (SPEC-money M6). The file's type is checked by its content in core;
// the declared type and the name are the client's and only the name is kept, as metadata.

export type AttachState = { error?: string };

const Id = z.uuid();
const tooLarge = receiptTooLargeMessage(maxAttachmentBytes);
// Phones name photos; a file picked from elsewhere may have no usable name.
const Filename = z
  .string()
  .trim()
  .transform((name) => name.slice(0, 200) || "receipt");

function refresh(transactionId: string) {
  revalidatePath(`/money/transactions/${transactionId}`);
  revalidatePath("/money/transactions");
}

export async function attachReceiptAction(
  _state: AttachState,
  formData: FormData,
): Promise<AttachState> {
  const { userId } = await requireUser();
  const transactionId = Id.safeParse(formData.get("transactionId"));
  if (!transactionId.success) return { error: receiptMessages["transaction-not-found"] };
  const file = z.file().safeParse(formData.get("file"));
  if (!file.success || file.data.size === 0) return { error: receiptMessages.missing };
  // Checked before the file is read into memory.
  if (file.data.size > maxAttachmentBytes) return { error: tooLarge };

  const result = await addAttachment(db(), {
    userId,
    uploadsDir: uploadsDir(),
    transactionId: transactionId.data,
    filename: Filename.parse(file.data.name),
    bytes: new Uint8Array(await file.data.arrayBuffer()),
  });
  if (!result.ok) {
    switch (result.reason) {
      case "too-large":
        return { error: tooLarge };
      case "transaction-not-found":
      case "unsupported-type":
      case "limit-reached":
        return { error: receiptMessages[result.reason] };
      default:
        assertNever(result.reason);
    }
  }
  refresh(transactionId.data);
  return {};
}

export async function removeReceiptAction(formData: FormData): Promise<void> {
  const { userId } = await requireUser();
  const attachmentId = Id.safeParse(formData.get("attachmentId"));
  const transactionId = Id.safeParse(formData.get("transactionId"));
  if (!attachmentId.success || !transactionId.success) return;
  await removeAttachment(db(), {
    userId,
    uploadsDir: uploadsDir(),
    attachmentId: attachmentId.data,
  });
  refresh(transactionId.data);
}
