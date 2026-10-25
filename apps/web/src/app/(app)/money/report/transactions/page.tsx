import { getCategory, listTransactions, transactionListLimit } from "@troba/core";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Page } from "@/components/page";
import { buttonVariants } from "@/components/ui/button";
import { db } from "@/server/db";
import { requireMoneyUser } from "@/server/money";
import { formatAmount } from "../../format";
import { categoryParam, parsePage } from "../../params";
import { parseReportMonth } from "../params";

export const metadata: Metadata = { title: "Spending in a category · troba" };

const currencyParam = z.string().regex(/^[A-Z]{3}$/);

// What makes up one report row: a month's expenses in one category (or uncategorized) and one
// currency, so the list adds up to the row's amount and count. A page at a time.
export default async function ReportTransactionsPage({
  searchParams,
}: PageProps<"/money/report/transactions">) {
  const { userId } = await requireMoneyUser();
  const params = await searchParams;
  const month = parseReportMonth(params.month);
  const page = parsePage(params.page);
  const category = categoryParam.safeParse(params.category);
  const currency = currencyParam.safeParse(params.currency);
  if (!category.success || !currency.success) notFound();

  let categoryName = "Uncategorized";
  if (category.data !== "uncategorized") {
    const owned = await getCategory(db(), userId, category.data);
    if (!owned) notFound();
    categoryName = owned.name;
  }
  // One more than a page, to know whether there is a next one.
  const rows = await listTransactions(db(), userId, {
    month,
    category: category.data,
    currency: currency.data,
    expensesOnly: true,
    limit: transactionListLimit + 1,
    offset: (page - 1) * transactionListLimit,
  });
  const transactions = rows.slice(0, transactionListLimit);
  const pageHref = (to: number) =>
    `/money/report/transactions?month=${month}&currency=${currency.data}` +
    `&category=${category.data}&page=${to}`;

  return (
    <Page>
      <h1>
        {categoryName} spending in {month} ({currency.data})
      </h1>
      <p>
        <Link href={`/money/report?month=${month}`}>Back to the report</Link>
      </p>

      {transactions.length === 0 ? (
        <p className="text-muted-foreground">No transactions.</p>
      ) : (
        <ol
          aria-label={`${categoryName} transactions, newest first`}
          className="flex flex-col divide-y rounded-xl ring-1 ring-foreground/10"
        >
          {transactions.map((transaction) => {
            const title =
              [transaction.counterparty, transaction.description].filter(Boolean).join(": ") ||
              "No description";
            return (
              <li key={transaction.id} className="flex flex-col gap-1 px-4 py-3">
                <Link
                  href={`/money/transactions/${transaction.id}`}
                  className="font-medium [overflow-wrap:anywhere] hover:underline"
                >
                  <time dateTime={transaction.bookedOn} className="text-muted-foreground">
                    {transaction.bookedOn}
                  </time>{" "}
                  {title}
                </Link>
                <div className="text-sm text-muted-foreground">
                  {transaction.accountName} ·{" "}
                  <strong className="text-foreground">
                    {formatAmount(transaction.amountCents, transaction.currency)}
                  </strong>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <div className="flex gap-2">
        {page > 1 && (
          <Link href={pageHref(page - 1)} className={buttonVariants({ variant: "outline" })}>
            Newer
          </Link>
        )}
        {rows.length > transactionListLimit && (
          <Link href={pageHref(page + 1)} className={buttonVariants({ variant: "outline" })}>
            Older
          </Link>
        )}
      </div>
    </Page>
  );
}
