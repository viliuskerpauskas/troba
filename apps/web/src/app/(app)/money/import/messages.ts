import type { ImportRowFailure } from "@troba/core";
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
