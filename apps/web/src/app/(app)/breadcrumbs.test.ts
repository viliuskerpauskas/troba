import { describe, expect, it } from "vitest";
import { breadcrumbs } from "./breadcrumbs";

describe("breadcrumbs", () => {
  it("names a top-level page on its own", () => {
    expect(breadcrumbs("/money")).toEqual([{ href: "/money", label: "Money" }]);
  });

  it("names each level down to the current page", () => {
    expect(breadcrumbs("/money/report/transactions")).toEqual([
      { href: "/money", label: "Money" },
      { href: "/money/report", label: "Monthly spending" },
      { href: "/money/report/transactions", label: "Spending in a category" },
    ]);
  });

  it("names a transaction by what the page does, not by its id", () => {
    expect(breadcrumbs("/money/transactions/0b6f2a1e-7c1d-4e8a-9f3b-2d5c6e7f8a9b")).toEqual([
      { href: "/money", label: "Money" },
      { href: "/money/transactions", label: "Transactions" },
      {
        href: "/money/transactions/0b6f2a1e-7c1d-4e8a-9f3b-2d5c6e7f8a9b",
        label: "Edit transaction",
      },
    ]);
    expect(breadcrumbs("/money/transactions/new").at(-1)).toEqual({
      href: "/money/transactions/new",
      label: "Add transaction",
    });
  });

  it("ignores a trailing slash", () => {
    expect(breadcrumbs("/settings/")).toEqual([{ href: "/settings", label: "Settings" }]);
  });

  it("leaves out a level it has no name for rather than show the raw path", () => {
    expect(breadcrumbs("/admin/somewhere")).toEqual([{ href: "/admin", label: "Admin" }]);
  });
});
