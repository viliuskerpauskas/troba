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

    it("reads a signed amount with its own sign", () => {
      if (preset.profile.columns.debitCredit !== undefined) return;
      const { table, result } = parsed();
      const column = table.headers.indexOf(preset.profile.columns.amount);
      const signs = table.rows.map((row, i) => {
        const negative = row[column]!.trim().startsWith("-");
        expect(result.rows[i]!.amountCents < 0n).toBe(negative);
        return negative;
      });
      // The fixture has money out and money in, so a sign read the wrong way shows.
      expect(signs).toContain(true);
      expect(signs).toContain(false);
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

// Presets are found by their headers, so no two may be told apart by anything else.
describe("the presets together", () => {
  const fixtureOf = (id: string) =>
    readFileSync(path.join(import.meta.dirname, `${id}.fixture.csv`));

  it("have their own ids and fingerprints", () => {
    expect(new Set(importPresets.map((preset) => preset.id)).size).toBe(importPresets.length);
    expect(new Set(importPresets.map((preset) => preset.fingerprint)).size).toBe(
      importPresets.length,
    );
  });

  it.each(importPresets.map((preset) => [preset.id, preset] as const))(
    "never match another preset's file: %s",
    (id, preset) => {
      const bytes = fixtureOf(id);
      for (const other of importPresets.filter((candidate) => candidate.id !== id)) {
        // Each is read with its own settings, as the upload flow does.
        const table = readCsvHeaders(bytes, other.profile);
        expect(table.ok && headerFingerprint(table.headers)).not.toBe(other.fingerprint);
      }
      const own = readCsvHeaders(bytes, preset.profile);
      expect(own.ok && headerFingerprint(own.headers)).toBe(preset.fingerprint);
    },
  );
});
