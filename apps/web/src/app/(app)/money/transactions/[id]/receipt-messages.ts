// What the receipt form tells the user. Shared with the client form, so it imports nothing from
// @troba/core: the package's runtime code is server-only, so the limit is passed in.

export function receiptTooLargeMessage(maxBytes: number): string {
  return `That file is over ${maxBytes / 1024 / 1024} MB. Take the photo at a lower resolution or attach a PDF.`;
}

export function receiptHint(maxBytes: number): string {
  return `A JPEG, PNG, WebP or HEIC photo, or a PDF, up to ${maxBytes / 1024 / 1024} MB.`;
}

export const receiptMessages = {
  missing: "Choose a photo or a file to attach.",
  "unsupported-type": "Attach a JPEG, PNG, WebP or HEIC photo, or a PDF.",
  "limit-reached": "This transaction has as many receipts as it can take. Remove one first.",
  "transaction-not-found": "That transaction doesn't exist.",
} as const;
