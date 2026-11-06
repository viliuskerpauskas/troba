import { definePreset } from "./define";

// Revolut: the CSV statement export. The header on the first line and nothing above it; one signed
// amount column (negative is money out, no debit/credit column), a currency on every row, decimal
// points and `YYYY-MM-DD HH:mm:ss` dates. The file names no account, so the user picks one.
// Fee and Balance are not read: the fee is charged apart from the amount, and the balance isn't a
// transaction. A payment still pending has no completed date, which the started date covers.
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
    },
    debitValues: null,
  },
});
