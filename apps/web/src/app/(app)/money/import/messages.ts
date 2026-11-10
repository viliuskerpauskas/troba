import type { AfterImportSuggestions, ImportRowFailure, PdfImportFailureReason } from "@troba/core";
import type { ProfileFormProblem } from "./profile-form";

// What the import wizard tells the user, by reason. Shared with the client wizard, so it imports
// only types from @troba/core: the package's runtime code is server-only.

export function tooLargeMessage(maxBytes: number): string {
  return `That file is over ${maxBytes / 1024 / 1024} MB. Export a shorter period.`;
}

export const notAStatementFileMessage =
  "That isn't a statement file. Export your statement from your bank as CSV.";
// A statement file troba recognises but doesn't import (here): spreadsheets not yet, PDFs only on a
// server with an AI key (ADR-0018).
export const unsupportedKindMessages = {
  spreadsheet:
    "Spreadsheet import isn't supported yet. Export your statement from your bank as CSV.",
  pdf: "PDF import isn't available on this server. Export your statement from your bank as CSV.",
} as const;

// Why the model's reading of a PDF statement failed. Nothing was saved either way.
export const pdfFailureMessages: Record<PdfImportFailureReason, string> = {
  unavailable: "AI couldn't read the statement just now. Nothing was saved. Try again in a while.",
  "invalid-answer":
    "AI's reading of the statement couldn't be used. Nothing was saved. Try again, or export the statement as CSV.",
};
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

// Why the mapping form opened the way it did for a file no profile fits, shown above it: "ai" when
// the form is filled from the model's proposal, "unavailable" when the model was asked and gave
// nothing usable, "capped" when the user had used up the day's mappings and it was not asked,
// "off" when the server has no model, "no-rows" when the file had no rows to send, and
// "profile-limit" when a preset knows the file but the user has no room for its copy.
export const suggestions = [
  "ai",
  "unavailable",
  "capped",
  "off",
  "no-rows",
  "profile-limit",
] as const;
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
  off: {
    text: "AI mapping suggestions are off on this server, so the form is blank. Fill it in below.",
  },
  "no-rows": {
    text: "troba found no rows under the column names to show AI, so the form is blank. Check the lines above the header, then fill it in below.",
  },
  "profile-limit": {
    lead: "This file matches a built-in bank format,",
    text: "but you already have as many import profiles as troba keeps, so it can't be saved as a new one.",
  },
};

// How the preview's profile was found from the file's columns: one of the user's own profiles, or
// a built-in preset that has just been copied into them. Absent when the user saved or edited the
// profile on the way here, since then they chose it.
export const formatSources = ["saved", "preset"] as const;
export type FormatSource = (typeof formatSources)[number];

// The badge beside the profile's name, and the sentence screen readers hear when the preview arrives.
export const formatSourceBadges: Record<FormatSource, string> = {
  saved: "Your profile",
  preset: "Built-in bank format",
};

export const formatSourceNotes: Record<FormatSource, string> = {
  saved: "Recognized by its columns as one of your import profiles.",
  preset:
    "Recognized by its columns as a built-in bank format. It's now saved in your import profiles, so you can edit it.",
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
