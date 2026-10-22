import type { ImportField } from "@troba/core";

// Shared with the client wizard, so it imports only types from @troba/core: the package's
// runtime code is server-only.

// Every field a profile can map, in the order the form shows them (SPEC-money M3, Import profile).
export const importFields: Record<ImportField, { label: string; hint?: string }> = {
  bookingDate: { label: "Booking date" },
  transactionDate: {
    label: "Transaction date",
    hint: "Used instead of the booking date when mapped: when you actually spent.",
  },
  amount: { label: "Amount" },
  debitCredit: {
    label: "Debit/credit indicator",
    hint: "Only when the amount has no sign.",
  },
  currency: { label: "Currency" },
  originalAmount: { label: "Original amount", hint: "For purchases in another currency." },
  originalCurrency: { label: "Original currency" },
  counterparty: { label: "Counterparty" },
  counterpartyIban: {
    label: "Counterparty IBAN",
    hint: "Moves between your own accounts become Transfers.",
  },
  description: { label: "Description" },
  transactionId: {
    label: "Transaction ID",
    hint: "Strongly recommended: the surest way to skip rows already imported.",
  },
  transactionType: { label: "Transaction type" },
  ownIban: { label: "Your account's IBAN", hint: "Picks the account for you." },
};

export const requiredFields: ReadonlySet<ImportField> = new Set(["bookingDate", "amount"]);
