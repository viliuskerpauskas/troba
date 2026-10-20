import { describe, expect, it } from "vitest";
import { addMonths, monthOf, monthRange } from "./month";

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

  it("takes the month of a date in UTC", () => {
    expect(monthOf(new Date("2026-10-31T23:59:59Z"))).toBe("2026-10");
    expect(monthOf(new Date("2026-11-01T00:00:00Z"))).toBe("2026-11");
  });
});
