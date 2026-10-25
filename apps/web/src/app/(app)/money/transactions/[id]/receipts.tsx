"use client";

import type { Attachment } from "@troba/core";
import { useActionState, useState } from "react";
import { FormError } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
    <section aria-labelledby="receipts" className="flex flex-col gap-3">
      <h2 id="receipts">Receipts</h2>
      {props.receipts.length === 0 ? (
        <p className="text-muted-foreground">No receipts attached.</p>
      ) : (
        <ul
          aria-label="Attached receipts"
          className="flex flex-col divide-y rounded-xl ring-1 ring-foreground/10"
        >
          {props.receipts.map((receipt) => (
            <li
              key={receipt.id}
              className="flex flex-wrap items-center justify-between gap-2 px-4 py-2"
            >
              <span className="[overflow-wrap:anywhere]">
                <a href={`/api/files/${receipt.id}`} target="_blank" rel="noopener">
                  {receipt.filename}
                </a>{" "}
                ({formatSize(receipt.sizeBytes)}) ·{" "}
                <a href={`/api/files/${receipt.id}?download=1`}>Download</a>
              </span>
              <form action={removeReceiptAction}>
                <input type="hidden" name="attachmentId" value={receipt.id} />
                <input type="hidden" name="transactionId" value={props.transactionId} />
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  aria-label={`Remove ${receipt.filename}`}
                >
                  Remove
                </Button>
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
          className="flex flex-col gap-4"
        >
          <input type="hidden" name="transactionId" value={props.transactionId} />
          <Field>
            <FieldLabel htmlFor="receipt-file">Add a receipt</FieldLabel>
            <FieldDescription id="receipt-hint">{receiptHint(props.maxBytes)}</FieldDescription>
            <Input
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
          </Field>
          {error && <FormError>{error}</FormError>}
          <Button type="submit" variant="secondary" disabled={pending} className="self-start">
            {pending ? "Attaching…" : "Attach"}
          </Button>
        </form>
      )}
    </section>
  );
}
