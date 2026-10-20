import { listTransactions, transactionListLimit } from "@troba/core";
import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/server/db";
import { requireMoneyUser } from "@/server/money";
import { formatAmount } from "../format";

export const metadata: Metadata = { title: "Transactions · troba" };

export default async function TransactionsPage() {
  const { userId } = await requireMoneyUser();
  const transactions = await listTransactions(db(), userId);

  return (
    <main>
      <h1>Transactions</h1>
      <p>
        <Link href="/money/transactions/new">Add transaction</Link>
      </p>

      {transactions.length === 0 ? (
        <p>No transactions yet.</p>
      ) : (
        // A list, not a table: four columns don't fit a phone.
        <ol aria-label="Transactions, newest first">
          {transactions.map((transaction) => {
            const title =
              [transaction.counterparty, transaction.description].filter(Boolean).join(": ") ||
              "No description";
            return (
              <li key={transaction.id}>
                <Link href={`/money/transactions/${transaction.id}`}>
                  <time dateTime={transaction.bookedOn}>{transaction.bookedOn}</time> {title}
                </Link>
                <br />
                {transaction.categoryName ?? "Uncategorized"} ·{" "}
                <strong>{formatAmount(transaction.amountCents, transaction.currency)}</strong>
              </li>
            );
          })}
        </ol>
      )}
      {transactions.length === transactionListLimit && (
        <p>Showing the latest {transactionListLimit}.</p>
      )}
    </main>
  );
}
