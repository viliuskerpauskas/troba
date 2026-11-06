export type Crumb = { href: string; label: string };

// Each page's name, matching its <title>. ":id" stands for any one segment the list doesn't
// name itself, so /money/transactions/new still gets its own.
const labels: Record<string, string> = {
  "/money": "Money",
  "/money/report": "Monthly spending",
  "/money/report/transactions": "Spending in a category",
  "/money/transactions": "Transactions",
  "/money/transactions/new": "Add transaction",
  "/money/transactions/:id": "Edit transaction",
  "/money/import": "Import",
  "/money/accounts": "Accounts",
  "/money/categories": "Categories",
  "/money/rules": "Rules",
  "/settings": "Settings",
  "/admin": "Admin",
  "/admin/users": "Users",
  "/admin/invites": "Invites",
};

// The trail from the section down to the page at pathname, one crumb per level that has a name.
export function breadcrumbs(pathname: string): Crumb[] {
  const segments = pathname.split("/").filter(Boolean);
  const crumbs: Crumb[] = [];
  let pattern = "";
  segments.forEach((segment, index) => {
    const href = `/${segments.slice(0, index + 1).join("/")}`;
    const exact = `${pattern}/${segment}`;
    pattern = exact in labels ? exact : `${pattern}/:id`;
    const label = labels[pattern];
    if (label) crumbs.push({ href, label });
  });
  return crumbs;
}
