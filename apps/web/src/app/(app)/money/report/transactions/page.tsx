import { listCategories, listTransactions, transactionListLimit } from "@troba/core";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { requireMoneyUser } from "@/server/money";
import { formatAmount } from "../../format";
import { categoryParam, parseMonth } from "../params";

export const metadata: Metadata = { title: "Spending in a category · troba" };

// A report row's transactions: one month, one category or uncategorized, every currency.
export default async function ReportTransactionsPage({
  searchParams,
}: PageProps<"/money/report/transactions">) {
  const { userId } = await requireMoneyUser();
  const params = await searchParams;
  const month = parseMonth(params.month);
  const category = categoryParam.safeParse(params.category);
  if (!category.success) notFound();

  let categoryName = "Uncategorized";
  if (category.data !== "uncategorized") {
    const owned = (await listCategories(db(), userId)).find((c) => c.id === category.data);
    if (!owned) notFound();
    categoryName = owned.name;
  }
  const transactions = await listTransactions(db(), userId, { month, category: category.data });

  return (
    <main>
      <h1>
        {categoryName} in {month}
      </h1>
      <p>
        <Link href={`/money/report?month=${month}`}>Back to the report</Link>
      </p>

      {transactions.length === 0 ? (
        <p>No transactions.</p>
      ) : (
        <ol aria-label={`${categoryName} transactions, newest first`}>
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
                {transaction.accountName} ·{" "}
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
