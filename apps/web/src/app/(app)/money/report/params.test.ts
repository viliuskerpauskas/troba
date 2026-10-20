import { monthOf } from "@troba/core";
import { describe, expect, it } from "vitest";
import { categoryParam, parsePage, parseReportMonth, parseSort } from "./params";

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

  it("reads a page number from 1, falling back to the first", () => {
    expect(parsePage("3")).toBe(3);
    for (const value of [undefined, "0", "-1", "1.5", "x", "100001"]) {
      expect(parsePage(value)).toBe(1);
    }
  });

  it("takes a category id or uncategorized", () => {
    expect(categoryParam.safeParse("uncategorized").success).toBe(true);
    expect(categoryParam.safeParse("3e413bad-a83a-40f4-954e-0bc4fd345c67").success).toBe(true);
    expect(categoryParam.safeParse("nope").success).toBe(false);
  });
});
