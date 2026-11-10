import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readTable, readTableHeaders } from "../table";
import { headerFingerprint, parseRows } from "../profile";
import { definePreset, importPresets, presetBrand, type ImportPreset } from ".";

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

// A preset's fictional fixture sits beside it, in the kind of file the bank exports.
function fixtureName(preset: ImportPreset): string {
  return `${preset.id}.fixture.${preset.kind === "spreadsheet" ? "xlsx" : "csv"}`;
}

describe("definePreset", () => {
  it("accepts a preset the profile schema accepts", () => {
    expect(definePreset(example).fingerprint).toBe(headerFingerprint(example.headers));
  });

  it("describes a CSV export unless it declares a spreadsheet", () => {
    expect(definePreset(example).kind).toBe("text");
    expect(definePreset({ ...example, kind: "spreadsheet" }).kind).toBe("spreadsheet");
    expect(() => definePreset({ ...example, kind: "pdf" as "text" })).toThrow();
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

  it("takes badge colors as six-digit hex, and nothing else", () => {
    const brand = { background: "#112233", foreground: "#FFFFFF" };
    expect(definePreset({ ...example, brand }).brand).toEqual(brand);
    expect(() =>
      definePreset({ ...example, brand: { ...brand, background: "red; x: url(y)" } }),
    ).toThrow();
  });
});

describe("presetBrand", () => {
  const branded = importPresets.find((preset) => preset.brand)!;

  it("gives a profile copied from a branded preset that preset's colors, whatever its name", () => {
    const renamed = { ...branded.profile, name: "Renamed" };
    expect(presetBrand(renamed)).toEqual(branded.brand);
  });

  it("matches the columns however their keys are ordered, as they come back from the database", () => {
    const reordered = Object.fromEntries(
      Object.entries(branded.profile.columns).reverse(),
    ) as typeof branded.profile.columns;
    expect(presetBrand({ columns: reordered })).toEqual(branded.brand);
  });

  it("gives no colors to a profile whose mapping differs from every preset", () => {
    expect(presetBrand(example.profile)).toBeNull();
    const fewer = { ...branded.profile.columns };
    delete fewer.description;
    expect(presetBrand({ columns: fewer })).toBeNull();
  });
});

// The fictional fixture beside each preset is a file in the preset's own format.
describe.each(importPresets.map((preset) => [preset.id, preset] as const))(
  "preset %s",
  (id, preset) => {
    const bytes = readFileSync(path.join(import.meta.dirname, fixtureName(preset)));
    const parsed = () => {
      const table = readTable(bytes, preset.profile);
      if (!table.ok) throw new Error(table.reason);
      const result = parseRows(preset.profile, table, { accountCurrency: "EUR" });
      if (!result.ok) throw new Error(result.reason);
      return { table, result };
    };

    it("recognizes its fixture by its own fingerprint", () => {
      const table = readTableHeaders(bytes, preset.profile);
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
  const fixtureOf = (preset: ImportPreset) =>
    readFileSync(path.join(import.meta.dirname, fixtureName(preset)));

  it("have their own ids and fingerprints", () => {
    expect(new Set(importPresets.map((preset) => preset.id)).size).toBe(importPresets.length);
    expect(new Set(importPresets.map((preset) => preset.fingerprint)).size).toBe(
      importPresets.length,
    );
  });

  it.each(importPresets.map((preset) => [preset.id, preset] as const))(
    "never match another preset's file: %s",
    (id, preset) => {
      const bytes = fixtureOf(preset);
      for (const other of importPresets.filter((candidate) => candidate.id !== id)) {
        // Each is read with its own settings, as the upload flow does.
        const table = readTableHeaders(bytes, other.profile);
        expect(table.ok && headerFingerprint(table.headers)).not.toBe(other.fingerprint);
      }
      const own = readTableHeaders(bytes, preset.profile);
      expect(own.ok && headerFingerprint(own.headers)).toBe(preset.fingerprint);
    },
  );
});
