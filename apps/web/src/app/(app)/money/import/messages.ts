import type { AfterImportSuggestions, ImportRowFailure, PdfImportFailureReason } from "@troba/core";
import type { ProfileFormProblem } from "./profile-form";

// What the import wizard tells the user, by reason. Shared with the client wizard, so it imports
// only types from @troba/core: the package's runtime code is server-only.

export function tooLargeMessage(maxBytes: number): string {
  return `That file is over ${maxBytes / 1024 / 1024} MB. Export a shorter period.`;
}

// The statement files the import page takes, for its copy and its file picker.
export const acceptedFileTypes = "CSV, XLSX, XLS or ODS";
// Extensions and types both: some pickers filter by one, some by the other.
export const acceptedFiles = [
  ".csv",
  ".xlsx",
  ".xls",
  ".ods",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.oasis.opendocument.spreadsheet",
].join(",");
// The same with PDF, on a server that can read one (ADR-0018).
export const acceptedFileTypesWithPdf = "CSV, XLSX, XLS, ODS or PDF";
export const acceptedFilesWithPdf = `${acceptedFiles},.pdf,application/pdf`;

export const notAStatementFileMessage = `That isn't a statement file. Export your statement from your bank as ${acceptedFileTypes}.`;
// A PDF on a server with no AI key: PDFs are read by AI (ADR-0018).
export const pdfUnavailableMessage = `PDF import isn't available on this server. Export your statement from your bank as ${acceptedFileTypes}.`;

// Why the model's reading of a PDF statement failed. Nothing was saved either way. A balance
// mismatch has a message of its own, with the difference (balanceMismatchMessage), and so does the
// daily limit, with when (pdfReadingCappedMessage).
export const pdfFailureMessages: Record<
  Exclude<PdfImportFailureReason, "balance-mismatch" | "daily-limit">,
  string
> = {
  unavailable: "AI couldn't read the statement just now. Nothing was saved. Try again in a while.",
  "invalid-answer":
    "AI's reading of the statement couldn't be used. Nothing was saved. Try again, or export the statement as CSV.",
  "not-a-statement":
    "AI says this file isn't a bank statement. Nothing was saved. Upload the statement PDF your bank gives you.",
};

// The opening balance plus what AI read isn't the closing balance: it misread or missed a row.
// difference: the gap, formatted and unsigned; less when the rows come to less than the closing.
export function balanceMismatchMessage(difference: string, less: boolean): string {
  return `The statement didn't add up: its opening balance plus the transactions AI read is ${difference} ${less ? "less" : "more"} than its closing balance, so AI misread or missed something. Nothing was saved. Try again, or export the statement as CSV.`;
}

// Under a PDF preview whose rows couldn't be checked against the statement's balances.
export const balanceUncheckedNote =
  "The statement doesn't print both an opening and a closing balance, so its total couldn't be checked. Check the transactions carefully before you import.";

// The page limit on PDF statements (T154), checked before anything is sent.
export function tooManyPagesMessage(pages: number, maxPages: number): string {
  return `That PDF has ${pages} pages, and troba reads up to ${maxPages} at a time. Split it into shorter PDFs and import each one.`;
}

// The daily cap on PDF imports (T154): refused before anything was sent, with when the next is
// possible, or, for a reading that met the cap after it was queued, the same said afterwards.
// `nextAt` null means a place is free again now.
export function pdfDailyLimitMessage(limit: number, nextAt: Date | null, now = new Date()): string {
  return `You've used today's ${pdfImports(limit)}, so nothing was sent. ${whenAgain(nextAt, now)}`;
}

export function pdfReadingCappedMessage(limit: number, nextAt: Date | null, now = new Date()) {
  return `You'd already used today's ${pdfImports(limit)}, so the statement wasn't sent to AI. Nothing was saved. ${whenAgain(nextAt, now)}`;
}

function pdfImports(count: number): string {
  return count === 1 ? "1 PDF import" : `${count} PDF imports`;
}

// Relative, so it needs no time zone: the server doesn't know the user's.
function whenAgain(nextAt: Date | null, now: Date): string {
  const minutes = nextAt ? Math.ceil((nextAt.getTime() - now.getTime()) / 60_000) : 0;
  if (minutes <= 0) return "You can import a PDF again now.";
  if (minutes === 1) return "You can import a PDF again in a minute.";
  if (minutes < 60) return `You can import a PDF again in ${minutes} minutes.`;
  const hours = Math.round(minutes / 60);
  return hours === 1
    ? "You can import a PDF again in about an hour."
    : `You can import a PDF again in about ${hours} hours.`;
}
export const startAgainMessage = "Something changed since the last step. Upload the file again.";

// Why the file can't be read with the profile's settings.
export const readErrors = {
  "unknown-encoding": "That encoding isn't one troba knows. Try utf-8 or windows-1252.",
  "invalid-encoding": "The file doesn't read as that encoding. Try another, such as windows-1252.",
  "unterminated-quote":
    "The file has a quote that never closes. Check the lines above the header and the delimiter.",
  "unreadable-workbook":
    "troba can't open this spreadsheet. It may be damaged or protected with a password: export it from your bank again, without a password.",
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

// The same for a PDF statement, which has no profile: what the AI read can't be used.
export const pdfFailureReasons: Record<ImportRowFailure["reason"], string> = {
  ...failureReasons,
  "invalid-date": "AI read a date that isn't a real date",
  "invalid-amount": "AI read an amount that isn't a number of cents",
  "invalid-currency": "AI read a currency that isn't a three-letter code",
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
