import type { AfterImportSuggestions, ImportRowFailure } from "@troba/core";
import type { ProfileFormProblem } from "./profile-form";

// What the import wizard tells the user, by reason. Shared with the client wizard, so it imports
// only types from @troba/core: the package's runtime code is server-only.

export function tooLargeMessage(maxBytes: number): string {
  return `That file is over ${maxBytes / 1024 / 1024} MB. Export a shorter period.`;
}

export const notCsvMessage = "That isn't a CSV file. Export your statement from your bank as CSV.";
export const startAgainMessage = "Something changed since the last step. Upload the file again.";

// Why the file can't be read with the profile's settings.
export const readErrors = {
  "unknown-encoding": "That encoding isn't one troba knows. Try utf-8 or windows-1252.",
  "invalid-encoding": "The file doesn't read as that encoding. Try another, such as windows-1252.",
  "unterminated-quote":
    "The file has a quote that never closes. Check the lines above the header and the delimiter.",
} as const;

export const problemMessages: Record<ProfileFormProblem, string> = {
  name: "Name the profile, such as the bank's name.",
  skipLines: "Enter how many lines to skip above the header, from 0 to 100.",
  encoding: readErrors["unknown-encoding"],
  decimalSeparator: "Pick a decimal separator.",
  dateFormat: "Pick the date format the file uses.",
  columns:
    "Map the booking date and the amount, and the original amount and original currency together or neither.",
  debitValues:
    "A debit/credit column needs its debit values, such as D, and debit values need the column.",
};

export const failureReasons: Record<ImportRowFailure["reason"], string> = {
  "invalid-date": "the date isn't in the profile's date format",
  "invalid-amount": "the amount isn't a number with the profile's decimal separator",
  "invalid-debit-credit": "the debit/credit indicator is empty",
  "invalid-currency": "the currency isn't a three-letter code",
  "invalid-original-amount": "the original amount isn't a number",
  "invalid-own-iban": "the account IBAN isn't valid",
  "duplicate-transaction-id": "another row has the same transaction ID",
  "currency-mismatch": "the row's currency isn't the account's",
};

// How the AI suggestion for an unknown format went, shown above the mapping form: "ai" when the
// form is filled from its proposal, "unavailable" when the model was asked and gave nothing usable,
// "capped" when the user had used up the day's mappings and it was not asked.
export const suggestions = ["ai", "unavailable", "capped"] as const;
export type Suggestion = (typeof suggestions)[number];

export const suggestionNotes: Record<Suggestion, { lead?: string; text: string }> = {
  ai: {
    lead: "Suggested by AI, check it.",
    text: "This mapping is a guess made from the file's columns and a few masked rows. Nothing is saved or imported until you press save, and every field can be changed.",
  },
  unavailable: {
    text: "AI couldn't suggest a mapping for this file, so the form is blank. Fill it in below.",
  },
  capped: {
    text: "You've used today's AI mapping suggestions, so the form is blank. Fill it in below, or try again tomorrow.",
  },
};

// The one-line note under the import result about the AI category suggestions (ADR-0016), or null
// when there is nothing to say: the feature is off for this server or user, or no new row needed
// the model. A suggestion never sets a category, so the note says where it is reviewed.
export function afterImportNote(suggestions: AfterImportSuggestions): string | null {
  switch (suggestions.status) {
    case "off":
    case "nothing":
      return null;
    case "suggested":
      return suggestions.rows === 1
        ? "AI suggested a category for 1 transaction. It stays uncategorized until you accept it on the transactions list."
        : `AI suggested categories for ${suggestions.rows} transactions. They stay uncategorized until you accept them on the transactions list.`;
    case "none":
      return "AI had no category suggestions for these transactions.";
    case "unavailable":
      return "AI category suggestions aren't available right now. The import is saved; try Suggest categories on the transactions list later.";
    case "capped": {
      const some =
        suggestions.rows > 0
          ? `AI suggested categories for ${suggestions.rows} ${suggestions.rows === 1 ? "transaction" : "transactions"}. `
          : "";
      return `${some}The daily limit on AI suggestions is reached, so the rest stay uncategorized for now.`;
    }
    case "pending":
      return "AI is still working on category suggestions. They will appear on the transactions list when ready.";
  }
}
