import type { ImportProfile } from "@troba/core";
import { describe, expect, it } from "vitest";
import { profileFormValues, profileFromForm, readOptionsFromForm } from "./profile-form";

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
      ok: true,
      profile: {
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
      } satisfies ImportProfile,
    });
  });

  it("reads 'detect' as no fixed delimiter, 'tab' as a tab, and no debit values as null", () => {
    const signed = { ...filled, "column.debitCredit": "", debitValues: "" };

    expect(profileFromForm(form({ ...signed, delimiter: "detect" }))).toMatchObject({
      profile: { delimiter: null, debitValues: null },
    });
    expect(profileFromForm(form({ ...filled, delimiter: "tab" }))).toMatchObject({
      profile: { delimiter: "\t" },
    });
  });

  it.each([
    ["no name", { name: " " }, "name"],
    ["no amount column", { "column.amount": "" }, "columns"],
    ["a debit/credit column without debit values", { debitValues: "" }, "debitValues"],
    ["debit values without the column", { "column.debitCredit": "" }, "debitValues"],
    ["an original amount without its currency", { "column.originalAmount": "Orig" }, "columns"],
    ["a field the profile doesn't have", { "column.secret": "Amount" }, "columns"],
    ["an unknown date format", { dateFormat: "YY-M-D" }, "dateFormat"],
    ["an unknown encoding", { encoding: "klingon" }, "encoding"],
    ["negative skip lines", { skipLines: "-1" }, "skipLines"],
    ["blank skip lines", { skipLines: " " }, "skipLines"],
    ["fractional skip lines", { skipLines: "1.5" }, "skipLines"],
    ["skip lines past 100", { skipLines: "101" }, "skipLines"],
  ])("refuses a form with %s, naming the field", (_case, change, problem) => {
    expect(profileFromForm(form({ ...filled, ...change }))).toEqual({ ok: false, problem });
  });
});

describe("profileFormValues", () => {
  it("gives back what profileFromForm reads", () => {
    const read = profileFromForm(form({ ...filled, delimiter: "tab" }));
    const profile = read.ok ? read.profile : null;

    expect(profileFromForm(form(profileFormValues(profile!)))).toEqual({ ok: true, profile });
  });
});

describe("readOptionsFromForm", () => {
  it("reads how to read the file, even when the rest of the form isn't valid yet", () => {
    expect(
      readOptionsFromForm(form({ skipLines: "2", delimiter: "tab", encoding: " UTF-8" })),
    ).toEqual({ skipLines: 2, delimiter: "\t", encoding: "utf-8" });
  });

  it("leaves skip lines to be guessed when they aren't a count up to 100", () => {
    for (const skipLines of ["", "1.5", "-1", "101"]) {
      expect(readOptionsFromForm(form({ ...filled, skipLines }))).toMatchObject({
        skipLines: undefined,
      });
    }
    expect(readOptionsFromForm(form({ ...filled, skipLines: "100" }))).toMatchObject({
      skipLines: 100,
    });
  });

  it("detects the delimiter unless the form fixes one it knows", () => {
    expect(readOptionsFromForm(form({ delimiter: "detect" }))).toMatchObject({ delimiter: null });
    expect(readOptionsFromForm(form({ delimiter: "|" }))).toMatchObject({ delimiter: null });
  });

  it("passes an encoding it doesn't know through, for the read to refuse it", () => {
    expect(readOptionsFromForm(form({ encoding: "Klingon" }))).toMatchObject({
      encoding: "klingon",
    });
    expect(readOptionsFromForm(form({}))).toMatchObject({ encoding: "utf-8" });
  });
});
