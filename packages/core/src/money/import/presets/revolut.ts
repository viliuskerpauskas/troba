import { definePreset } from "./define";

// Revolut: the CSV statement export. The header on the first line and nothing above it; one signed
// amount column (negative is money out, no debit/credit column), a currency on every row, decimal
// points and `YYYY-MM-DD HH:mm:ss` dates. The file names no account, so the user picks one.
// The fee is charged apart from the amount (the balance moves by both), so a non-zero fee becomes a
// fee transaction of its own; only completed rows are imported, so a pending or reverted payment is
// skipped until a later export has it completed (ADR-0020). Balance is not read: it isn't a
// transaction.
// Fixture: revolut.fixture.csv (fictional rows).
export default definePreset({
  id: "revolut",
  headers: [
    "Type",
    "Product",
    "Started Date",
    "Completed Date",
    "Description",
    "Amount",
    "Fee",
    "Currency",
    "State",
    "Balance",
  ],
  profile: {
    name: "Revolut",
    skipLines: 0,
    delimiter: ",",
    encoding: "utf-8",
    decimalSeparator: ".",
    dateFormat: "YYYY-MM-DD HH:mm:ss",
    columns: {
      bookingDate: "Completed Date",
      transactionDate: "Started Date",
      amount: "Amount",
      currency: "Currency",
      counterparty: "Description",
      transactionType: "Type",
      fee: "Fee",
      state: "State",
    },
    debitValues: null,
    completedValues: ["COMPLETED"],
  },
});
