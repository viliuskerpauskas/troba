import { describe, expect, it } from "vitest";
import { addMonths, isMonth, monthOf, monthRange } from "./month";

describe("months", () => {
  it("spans a month from its first day to the next month's", () => {
    expect(monthRange("2026-02")).toEqual(["2026-02-01", "2026-03-01"]);
    expect(monthRange("2026-12")).toEqual(["2026-12-01", "2027-01-01"]);
  });

  it("steps back and forward across year ends", () => {
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-10", 0)).toBe("2026-10");
    expect(addMonths("2026-10", -22)).toBe("2024-12");
  });

  it("accepts only months from 1900-01 to 9999-12", () => {
    expect(["1900-01", "2026-10", "9999-12"].map(isMonth)).toEqual([true, true, true]);
    // 0000 isn't a year Postgres takes; nothing real happened before 1900.
    expect(
      ["0000-05", "1899-12", "10000-01", "2026-13", "2026-1", " 2026-10"].map(isMonth),
    ).toEqual([false, false, false, false, false, false]);
    expect(isMonth(addMonths("1900-01", -1))).toBe(false);
  });

  it("takes the month of a date in UTC", () => {
    expect(monthOf(new Date("2026-10-31T23:59:59Z"))).toBe("2026-10");
    expect(monthOf(new Date("2026-11-01T00:00:00Z"))).toBe("2026-11");
  });
});
