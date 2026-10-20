import {
  addMonths,
  centsToDecimal,
  monthlyReport,
  type CategorySpending,
  type CurrencyReport,
} from "@troba/core";
import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/server/db";
import { requireMoneyUser } from "@/server/money";
import { formatAmount } from "../format";
import { parseMonth, parseSort, type SortDirection, type SortKey } from "./params";
import { SpendingChart } from "./spending-chart";

const unsigned = { signed: false };

export const metadata: Metadata = { title: "Monthly spending · troba" };

export default async function ReportPage({ searchParams }: PageProps<"/money/report">) {
  const { userId } = await requireMoneyUser();
  const params = await searchParams;
  const month = parseMonth(params.month);
  const { sort, dir } = parseSort(params);
  const reports = await monthlyReport(db(), userId, month);

  return (
    <main>
      <h1>Monthly spending</h1>
      <form method="get">
        <label>
          Month <input type="month" name="month" defaultValue={month} required />
        </label>{" "}
        <button type="submit">Show</button>
      </form>
      <p>
        <Link href={`/money/report?month=${addMonths(month, -1)}`}>Previous month</Link>{" "}
        <Link href={`/money/report?month=${addMonths(month, 1)}`}>Next month</Link>
      </p>

      {reports.length === 0 ? (
        <p>No transactions in {month}.</p>
      ) : (
        reports.map((report) => (
          <CurrencySection
            key={report.currency}
            report={report}
            month={month}
            sort={sort}
            dir={dir}
            // Headings say the currency only when there is more than one.
            titled={reports.length > 1}
          />
        ))
      )}
      <p>Transfers between your own accounts aren&apos;t counted.</p>
    </main>
  );
}

function CurrencySection({
  report,
  month,
  sort,
  dir,
  titled,
}: {
  report: CurrencyReport;
  month: string;
  sort: SortKey;
  dir: SortDirection;
  titled: boolean;
}) {
  const { currency } = report;
  const headingId = `report-${currency}`;
  const categories = sortCategories(report.categories, sort, dir);
  const name = (category: CategorySpending) => category.categoryName ?? "Uncategorized";
  const href = (category: CategorySpending) =>
    `/money/report/transactions?month=${month}&category=${category.categoryId ?? "uncategorized"}`;

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>{titled ? `In ${currency}` : "Totals"}</h2>
      <dl>
        <dt>Total spent</dt>
        <dd>{formatAmount(report.spentCents, currency, unsigned)}</dd>
        <dt>Total income</dt>
        <dd>{formatAmount(report.incomeCents, currency, unsigned)}</dd>
      </dl>

      {report.categories.length > 0 && (
        <>
          <SpendingChart
            title={`Spending by category in ${currency}`}
            bars={report.categories.map((category) => ({
              name: name(category),
              amount: centsToDecimal(category.spentCents),
              label: formatAmount(category.spentCents, currency, unsigned),
            }))}
          />
          <table>
            <caption>Spending by category in {currency}</caption>
            <thead>
              <tr>
                <th scope="col">Category</th>
                <SortHeader label="Amount" sortKey="amount" {...{ month, sort, dir }} />
                <SortHeader label="%" sortKey="share" {...{ month, sort, dir }} />
                <SortHeader label="Count" sortKey="count" {...{ month, sort, dir }} />
              </tr>
            </thead>
            <tbody>
              {categories.map((category) => (
                <tr key={category.categoryId ?? "uncategorized"}>
                  <th scope="row">
                    <Link href={href(category)}>{name(category)}</Link>
                  </th>
                  <td>{formatAmount(category.spentCents, currency, unsigned)}</td>
                  <td>{formatShare(category.shareBasisPoints)}</td>
                  <td>{category.transactionCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

// Each column header links to the table sorted by it; the current column's link flips direction.
function SortHeader({
  label,
  sortKey,
  month,
  sort,
  dir,
}: {
  label: string;
  sortKey: SortKey;
  month: string;
  sort: SortKey;
  dir: SortDirection;
}) {
  const active = sort === sortKey;
  const next: SortDirection = active && dir === "desc" ? "asc" : "desc";
  return (
    <th scope="col" aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <Link href={`/money/report?month=${month}&sort=${sortKey}&dir=${next}`}>
        {label}
        {active && (dir === "asc" ? " ↑" : " ↓")}
      </Link>
    </th>
  );
}

function sortCategories(categories: CategorySpending[], sort: SortKey, dir: SortDirection) {
  const sign = dir === "asc" ? 1 : -1;
  // The share is the amount over the same total, so both sort the same way.
  const compare = (a: CategorySpending, b: CategorySpending) =>
    sort === "count"
      ? a.transactionCount - b.transactionCount
      : a.spentCents === b.spentCents
        ? 0
        : a.spentCents < b.spentCents
          ? -1
          : 1;
  return categories.toSorted((a, b) => sign * compare(a, b));
}

// "12.34%" from basis points, in integers.
function formatShare(basisPoints: number): string {
  return `${Math.floor(basisPoints / 100)}.${String(basisPoints % 100).padStart(2, "0")}%`;
}
