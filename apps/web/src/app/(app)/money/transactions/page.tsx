import { listAccounts, listCategories, listTransactions, transactionListLimit } from "@troba/core";
import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/server/db";
import { requireMoneyUser } from "@/server/money";
import { formatAmount } from "../format";
import { parseListQuery, searchMaxLength, transactionsHref } from "./params";

export const metadata: Metadata = { title: "Transactions · troba" };

// SPEC-money M8: newest first, a page at a time, filtered by the query in the URL.
export default async function TransactionsPage({ searchParams }: PageProps<"/money/transactions">) {
  const { userId } = await requireMoneyUser();
  const query = parseListQuery(await searchParams);
  const { page, ...filter } = query;
  const filtered = Object.keys(filter).length > 0;
  const [accounts, categories, rows] = await Promise.all([
    // Archived accounts keep their transactions, so they stay in the filter.
    listAccounts(db(), userId, { includeArchived: true }),
    listCategories(db(), userId),
    // One more than a page, to know whether there is a next one.
    listTransactions(db(), userId, {
      ...filter,
      limit: transactionListLimit + 1,
      offset: (page - 1) * transactionListLimit,
    }),
  ]);
  const transactions = rows.slice(0, transactionListLimit);

  return (
    <main>
      <h1>Transactions</h1>
      <p>
        <Link href="/money/transactions/new">Add transaction</Link>
      </p>
      <p>
        <Link href="/money/import">Import a bank statement</Link>
      </p>

      <form method="get" aria-label="Filter transactions">
        <p>
          <label>
            Search{" "}
            <input
              type="search"
              name="q"
              defaultValue={filter.search}
              maxLength={searchMaxLength}
              placeholder="Counterparty or description"
            />
          </label>
        </p>
        <p>
          <label>
            Month <input type="month" name="month" defaultValue={filter.month} />
          </label>
        </p>
        <p>
          <label>
            Account{" "}
            <select name="account" defaultValue={filter.accountId ?? ""}>
              <option value="">All accounts</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                  {account.archivedAt ? " (archived)" : ""}
                </option>
              ))}
            </select>
          </label>
        </p>
        <p>
          <label>
            Category{" "}
            <select name="category" defaultValue={filter.category ?? ""}>
              <option value="">All categories</option>
              <option value="uncategorized">Uncategorized</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
        </p>
        <p>
          <button type="submit">Filter</button>{" "}
          {filtered && <Link href="/money/transactions">Clear filters</Link>}
        </p>
      </form>

      {transactions.length === 0 ? (
        <p>
          {page > 1
            ? "No more transactions."
            : filtered
              ? "No transactions match these filters."
              : "No transactions yet."}
        </p>
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
                {transaction.hasReceipt && " · Receipt"}
              </li>
            );
          })}
        </ol>
      )}
      <p>
        {page > 1 && <Link href={transactionsHref({ ...query, page: page - 1 })}>Newer</Link>}{" "}
        {rows.length > transactionListLimit && (
          <Link href={transactionsHref({ ...query, page: page + 1 })}>Older</Link>
        )}
      </p>
    </main>
  );
}
