import { listAccounts, listCategories } from "@troba/core";
import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/server/db";
import { requireMoneyUser } from "@/server/money";
import { TransactionForm } from "../transaction-form";

export const metadata: Metadata = { title: "Add transaction · troba" };

export default async function NewTransactionPage() {
  const { userId } = await requireMoneyUser();
  const [accounts, categories] = await Promise.all([
    listAccounts(db(), userId),
    listCategories(db(), userId),
  ]);

  return (
    <main>
      <h1>Add transaction</h1>
      <p>
        <Link href="/money/transactions">Back to transactions</Link>
      </p>
      {accounts.length === 0 ? (
        <p>
          You have no active accounts. <Link href="/money/accounts">Create one</Link> first.
        </p>
      ) : (
        <TransactionForm
          mode="new"
          accounts={accounts}
          categories={categories}
          // The server's date (UTC); the user can change it.
          initial={{ bookedOn: new Date().toISOString().slice(0, 10) }}
        />
      )}
    </main>
  );
}
