import type { Metadata } from "next";
import Link from "next/link";
import { requireMoneyUser } from "@/server/money";

export const metadata: Metadata = { title: "Money · troba" };

export default async function MoneyPage() {
  await requireMoneyUser();

  return (
    <main>
      <h1>Money</h1>
      <p>
        <Link href="/money/transactions">Transactions</Link>
      </p>
      <p>
        <Link href="/money/accounts">Accounts</Link>
      </p>
      <p>
        <Link href="/money/categories">Categories</Link>
      </p>
    </main>
  );
}
