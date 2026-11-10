import { definePreset } from "./define";

// SEB, Lithuania: the CSV statement export. A statement title on the first line, then the header,
// every line ending in a semicolon; unsigned amounts with a D/C column, decimal commas, ISO dates.
// Fixture: seb-lt.fixture.csv (fictional rows).
export default definePreset({
  id: "seb-lt",
  headers: [
    "DOK NR.",
    "DATA",
    "VALIUTA",
    "SUMA",
    "MOKĖTOJO ARBA GAVĖJO PAVADINIMAS",
    "MOKĖTOJO ARBA GAVĖJO IDENTIFIKACINIS KODAS",
    "SĄSKAITA",
    "KREDITO ĮSTAIGOS PAVADINIMAS",
    "KREDITO ĮSTAIGOS SWIFT KODAS",
    "MOKĖJIMO PASKIRTIS",
    "TRANSAKCIJOS KODAS",
    "DOKUMENTO DATA",
    "TRANSAKCIJOS TIPAS",
    "NUORODA",
    "DEBETAS/KREDITAS",
    "SUMA SĄSKAITOS VALIUTA",
    "SĄSKAITOS NR",
    "SĄSKAITOS VALIUTA",
  ],
  profile: {
    name: "SEB Lithuania",
    skipLines: 1,
    delimiter: ";",
    encoding: "utf-8",
    decimalSeparator: ",",
    dateFormat: "YYYY-MM-DD",
    columns: {
      bookingDate: "DATA",
      transactionDate: "DOKUMENTO DATA",
      amount: "SUMA SĄSKAITOS VALIUTA",
      debitCredit: "DEBETAS/KREDITAS",
      currency: "SĄSKAITOS VALIUTA",
      originalAmount: "SUMA",
      originalCurrency: "VALIUTA",
      counterparty: "MOKĖTOJO ARBA GAVĖJO PAVADINIMAS",
      counterpartyIban: "SĄSKAITA",
      description: "MOKĖJIMO PASKIRTIS",
      transactionId: "TRANSAKCIJOS KODAS",
      transactionType: "TRANSAKCIJOS TIPAS",
      ownIban: "SĄSKAITOS NR",
    },
    debitValues: ["D"],
  },
  // SEB green with near-black text (about 10:1); white on that green would be under 2:1.
  brand: { background: "#60CD18", foreground: "#0B1F00" },
});
