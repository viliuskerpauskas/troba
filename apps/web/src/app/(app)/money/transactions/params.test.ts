import { describe, expect, it } from "vitest";
import { parseListQuery, transactionsHref } from "./params";

const accountId = "3e413bad-a83a-40f4-954e-0bc4fd345c67";
const categoryId = "8c1f2d4e-5b6a-4c7d-9e8f-0a1b2c3d4e5f";

describe("transaction list parameters", () => {
  it("is the first page of everything when nothing is asked for", () => {
    expect(parseListQuery({})).toEqual({ page: 1 });
  });

  it("takes a month, account, category, search and page", () => {
    expect(
      parseListQuery({
        month: "2026-10",
        account: accountId,
        category: categoryId,
        q: "  grocery mart ",
        page: "2",
      }),
    ).toEqual({
      month: "2026-10",
      accountId,
      category: categoryId,
      search: "grocery mart",
      page: 2,
    });
    expect(parseListQuery({ category: "uncategorized" })).toEqual({
      category: "uncategorized",
      page: 1,
    });
  });

  it("leaves out what is malformed, as an edited URL would be", () => {
    expect(
      parseListQuery({
        month: "2026-13",
        account: "nope",
        category: ["uncategorized", categoryId],
        q: "   ",
        page: "0",
      }),
    ).toEqual({ page: 1 });
  });

  it("keeps the search to 100 characters", () => {
    expect(parseListQuery({ q: "a".repeat(150) }).search).toBe("a".repeat(100));
  });

  it("links to a page of the same filters, leaving out the empty ones and page 1", () => {
    expect(transactionsHref({ page: 1 })).toBe("/money/transactions");
    expect(
      transactionsHref({
        month: "2026-10",
        category: "uncategorized",
        search: "50% & more",
        page: 3,
      }),
    ).toBe("/money/transactions?month=2026-10&category=uncategorized&q=50%25+%26+more&page=3");
    expect(transactionsHref({ accountId, page: 1 })).toBe(
      `/money/transactions?account=${accountId}`,
    );
  });
});
