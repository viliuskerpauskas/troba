import { describe, expect, it } from "vitest";
import { sortReportCategories, type CategorySpending } from "./report";

const row = (categoryName: string | null, spentCents: bigint, transactionCount: number) => ({
  categoryId: categoryName && `id-${categoryName}`,
  categoryName,
  spentCents,
  transactionCount,
  shareBasisPoints: 0,
});

// As monthlyReport returns them: largest first.
const categories: CategorySpending[] = [
  row("Food", 3000n, 1),
  row(null, 2000n, 5),
  row("Bills", 1000n, 2),
  row("Transport", 1000n, 5),
];
const names = (sorted: CategorySpending[]) => sorted.map((c) => c.categoryName ?? "Uncategorized");

describe("sorting report categories", () => {
  it("sorts by amount either way, ties by name", () => {
    expect(names(sortReportCategories(categories, "amount", "desc"))).toEqual([
      "Food",
      "Uncategorized",
      "Bills",
      "Transport",
    ]);
    expect(names(sortReportCategories(categories, "amount", "asc"))).toEqual([
      "Bills",
      "Transport",
      "Uncategorized",
      "Food",
    ]);
  });

  it("sorts by share as by amount: both are over the same total", () => {
    expect(sortReportCategories(categories, "share", "asc")).toEqual(
      sortReportCategories(categories, "amount", "asc"),
    );
  });

  it("sorts by transaction count either way, ties by name", () => {
    expect(names(sortReportCategories(categories, "count", "desc"))).toEqual([
      "Transport",
      "Uncategorized",
      "Bills",
      "Food",
    ]);
    expect(names(sortReportCategories(categories, "count", "asc"))).toEqual([
      "Food",
      "Bills",
      "Transport",
      "Uncategorized",
    ]);
  });

  it("leaves its input as it was", () => {
    const before = names(categories);
    sortReportCategories(categories, "count", "asc");
    expect(names(categories)).toEqual(before);
  });
});
