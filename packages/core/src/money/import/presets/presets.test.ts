import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readCsv, readCsvHeaders } from "../csv";
import { headerFingerprint, parseRows } from "../profile";
import { definePreset, importPresets } from ".";

const example = {
  id: "example-bank",
  headers: ["Date", "Amount", "D/C"],
  profile: {
    name: "Example Bank",
    skipLines: 0,
    delimiter: ";" as const,
    encoding: "utf-8",
    decimalSeparator: "," as const,
    dateFormat: "YYYY-MM-DD" as const,
    columns: { bookingDate: "Date", amount: "Amount", debitCredit: "D/C" },
    debitValues: ["D"],
  },
};

describe("definePreset", () => {
  it("accepts a preset the profile schema accepts", () => {
    expect(definePreset(example).fingerprint).toBe(headerFingerprint(example.headers));
  });

  it("rejects a preset mapping a column it doesn't recognize", () => {
    const columns = { ...example.profile.columns, amount: "Total" };
    expect(() => definePreset({ ...example, profile: { ...example.profile, columns } })).toThrow(
      /Total/,
    );
  });

  it("rejects a profile the profile schema rejects", () => {
    // A debit/credit column without debit values.
    expect(() =>
      definePreset({ ...example, profile: { ...example.profile, debitValues: null } }),
    ).toThrow();
  });

  it("rejects a header listed twice and an id that isn't kebab-case", () => {
    expect(() => definePreset({ ...example, headers: [...example.headers, "Date"] })).toThrow();
    expect(() => definePreset({ ...example, id: "Example Bank" })).toThrow();
  });
});

// The fictional fixture beside each preset is a file in the preset's own format.
describe.each(importPresets.map((preset) => [preset.id, preset] as const))(
  "preset %s",
  (id, preset) => {
    const bytes = readFileSync(path.join(import.meta.dirname, `${id}.fixture.csv`));
    const parsed = () => {
      const table = readCsv(bytes, preset.profile);
      if (!table.ok) throw new Error(table.reason);
      const result = parseRows(preset.profile, table, { accountCurrency: "EUR" });
      if (!result.ok) throw new Error(result.reason);
      return { table, result };
    };

    it("recognizes its fixture by its own fingerprint", () => {
      const table = readCsvHeaders(bytes, preset.profile);
      expect(table.ok && headerFingerprint(table.headers)).toBe(preset.fingerprint);
    });

    it("reads every row of its fixture", () => {
      const { table, result } = parsed();
      expect(table.rows.length).toBeGreaterThan(0);
      expect(result.failed).toEqual([]);
      expect(result.rows).toHaveLength(table.rows.length);
    });

    it("reads the debit values the right way", () => {
      const { table, result } = parsed();
      const indicator = preset.profile.columns.debitCredit;
      if (indicator === undefined) return;
      const column = table.headers.indexOf(indicator);
      const debits = preset.profile.debitValues!.map((value) => value.toUpperCase());
      for (const [i, row] of table.rows.entries()) {
        const debit = debits.includes(row[column]!.toUpperCase());
        expect(result.rows[i]!.amountCents < 0n).toBe(debit);
      }
    });
  },
);
