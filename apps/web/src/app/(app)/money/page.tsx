import type { Metadata } from "next";
import Link from "next/link";
import { Page } from "@/components/page";
import { requireMoneyUser } from "@/server/money";

export const metadata: Metadata = { title: "Money · troba" };

const links = [
  { href: "/money/report", label: "Monthly spending" },
  { href: "/money/transactions", label: "Transactions" },
  { href: "/money/import", label: "Import a bank statement" },
  { href: "/money/accounts", label: "Accounts" },
  { href: "/money/categories", label: "Categories" },
  { href: "/money/rules", label: "Rules" },
] as const;

export default async function MoneyPage() {
  await requireMoneyUser();

  return (
    <Page>
      <h1>Money</h1>
      <ul className="grid gap-3 sm:grid-cols-2">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="block rounded-xl bg-card p-4 font-medium ring-1 ring-foreground/10 hover:bg-muted"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </Page>
  );
}
