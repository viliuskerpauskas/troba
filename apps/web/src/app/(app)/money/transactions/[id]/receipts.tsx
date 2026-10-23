"use client";

import type { Attachment } from "@troba/core";
import { useActionState, useState } from "react";
import { attachReceiptAction, removeReceiptAction, type AttachState } from "./actions";
import { receiptHint, receiptMessages, receiptTooLargeMessage } from "./receipt-messages";

type Receipt = Pick<Attachment, "id" | "filename" | "sizeBytes">;

// The types attachReceiptAction takes. Listing image types (no capture attribute) makes phones
// offer the camera beside their photos and files; HEIC is what iPhones take.
const accept = "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,application/pdf";

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function Receipts(props: {
  transactionId: string;
  receipts: Receipt[];
  maxBytes: number;
  full: boolean;
}) {
  const [state, action, pending] = useActionState<AttachState, FormData>(attachReceiptAction, {});
  // A file over the limit is refused here: the server would drop the request before the action.
  const [tooLarge, setTooLarge] = useState(false);
  const error = tooLarge ? receiptTooLargeMessage(props.maxBytes) : state.error;

  return (
    <section aria-labelledby="receipts">
      <h2 id="receipts">Receipts</h2>
      {props.receipts.length === 0 ? (
        <p>No receipts attached.</p>
      ) : (
        <ul aria-label="Attached receipts">
          {props.receipts.map((receipt) => (
            <li key={receipt.id}>
              <a href={`/api/files/${receipt.id}`} target="_blank" rel="noopener">
                {receipt.filename}
              </a>{" "}
              ({formatSize(receipt.sizeBytes)}) ·{" "}
              <a href={`/api/files/${receipt.id}?download=1`}>Download</a>
              <form action={removeReceiptAction} style={{ display: "inline" }}>
                <input type="hidden" name="attachmentId" value={receipt.id} />
                <input type="hidden" name="transactionId" value={props.transactionId} />{" "}
                <button type="submit" aria-label={`Remove ${receipt.filename}`}>
                  Remove
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      {props.full ? (
        <p>{receiptMessages["limit-reached"]}</p>
      ) : (
        <form
          action={action}
          onSubmit={(event) => {
            if (tooLarge) event.preventDefault();
          }}
        >
          <input type="hidden" name="transactionId" value={props.transactionId} />
          <p>
            <label htmlFor="receipt-file">Add a receipt</label>
            <br />
            <small id="receipt-hint">{receiptHint(props.maxBytes)}</small>
            <br />
            <input
              id="receipt-file"
              type="file"
              name="file"
              accept={accept}
              aria-describedby="receipt-hint"
              required
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                setTooLarge(file !== undefined && file.size > props.maxBytes);
              }}
            />
          </p>
          {error && <p role="alert">{error}</p>}
          <button type="submit" disabled={pending}>
            {pending ? "Attaching…" : "Attach"}
          </button>
        </form>
      )}
    </section>
  );
}
