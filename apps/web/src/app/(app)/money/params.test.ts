import { describe, expect, it } from "vitest";
import { categoryParam, parsePage } from "./params";

describe("money list parameters", () => {
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
