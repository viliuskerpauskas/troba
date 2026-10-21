import { monthOf } from "@troba/core";
import { describe, expect, it } from "vitest";
import { parseReportMonth, parseSort } from "./params";

describe("report parameters", () => {
  it("takes a valid month and falls back to the current one otherwise", () => {
    const current = monthOf(new Date());
    expect(parseReportMonth("2026-10")).toBe("2026-10");
    for (const value of [undefined, "", "0000-05", "2026-13", ["2026-10", "2026-11"]]) {
      expect(parseReportMonth(value)).toBe(current);
    }
  });

  it("sorts by amount, largest first, unless asked for an allowed column and direction", () => {
    expect(parseSort({})).toEqual({ sort: "amount", dir: "desc" });
    expect(parseSort({ sort: "count", dir: "asc" })).toEqual({ sort: "count", dir: "asc" });
    expect(parseSort({ sort: "name; drop", dir: "sideways" })).toEqual({
      sort: "amount",
      dir: "desc",
    });
  });
});
