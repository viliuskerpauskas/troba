import type { ImportProfile } from "@troba/core";
import { describe, expect, it } from "vitest";
import { profileFormValues, profileFromForm } from "./profile-form";

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) data.set(name, value);
  return data;
}

const filled = {
  name: " Example Bank ",
  skipLines: "1",
  delimiter: ";",
  encoding: "utf-8",
  decimalSeparator: ",",
  dateFormat: "YYYY-MM-DD",
  "column.bookingDate": "Date",
  "column.transactionDate": "",
  "column.amount": "Amount",
  "column.debitCredit": "D/C",
  "column.description": "Purpose",
  debitValues: "D, Debit ,",
};

describe("profileFromForm", () => {
  it("reads the mapping form into a profile, leaving out unmapped fields", () => {
    expect(profileFromForm(form(filled))).toEqual({
      name: "Example Bank",
      skipLines: 1,
      delimiter: ";",
      encoding: "utf-8",
      decimalSeparator: ",",
      dateFormat: "YYYY-MM-DD",
      columns: {
        bookingDate: "Date",
        amount: "Amount",
        debitCredit: "D/C",
        description: "Purpose",
      },
      debitValues: ["D", "Debit"],
    } satisfies ImportProfile);
  });

  it("reads 'detect' as no fixed delimiter, 'tab' as a tab, and no debit values as null", () => {
    const signed = { ...filled, "column.debitCredit": "", debitValues: "" };

    expect(profileFromForm(form({ ...signed, delimiter: "detect" }))).toMatchObject({
      delimiter: null,
      debitValues: null,
    });
    expect(profileFromForm(form({ ...filled, delimiter: "tab" }))).toMatchObject({
      delimiter: "\t",
    });
  });

  it.each([
    ["no name", { name: " " }],
    ["no amount column", { "column.amount": "" }],
    ["a debit/credit column without debit values", { debitValues: "" }],
    ["a field the profile doesn't have", { "column.secret": "Amount" }],
    ["an unknown date format", { dateFormat: "YY-M-D" }],
    ["skip lines that aren't a count", { skipLines: "-1" }],
  ])("refuses a form with %s", (_case, change) => {
    expect(profileFromForm(form({ ...filled, ...change }))).toBeNull();
  });
});

describe("profileFormValues", () => {
  it("gives back what profileFromForm reads", () => {
    const profile = profileFromForm(form({ ...filled, delimiter: "tab" }))!;

    expect(profileFromForm(form(profileFormValues(profile)))).toEqual(profile);
  });
});
