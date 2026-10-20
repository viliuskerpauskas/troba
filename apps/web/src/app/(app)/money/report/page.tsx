import {
  addMonths,
  isMonth,
  monthlyReport,
  sortReportCategories,
  type CategorySpending,
  type CurrencyReport,
  type ReportSortKey,
} from "@troba/core";
import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/server/db";
import { requireMoneyUser } from "@/server/money";
import { formatAmount } from "../format";
import { parseReportMonth, parseSort } from "./params";
import { SpendingChart } from "./spending-chart";

const unsigned = { signed: false };

export const metadata: Metadata = { title: "Monthly spending · troba" };

type SortDirection = "asc" | "desc";
type ReportQuery = { month: string; sort: ReportSortKey; dir: SortDirection };

const reportHref = (query: ReportQuery) =>
  `/money/report?month=${query.month}&sort=${query.sort}&dir=${query.dir}`;

export default async function ReportPage({ searchParams }: PageProps<"/money/report">) {
  const { userId } = await requireMoneyUser();
  const params = await searchParams;
  const query: ReportQuery = { month: parseReportMonth(params.month), ...parseSort(params) };
  const reports = await monthlyReport(db(), userId, query.month);
  // The picker's range ends somewhere; no link past it.
  const [previous, next] = [-1, 1]
    .map((step) => addMonths(query.month, step))
    .map((month) => (isMonth(month) ? month : null));

  return (
    <main>
      <h1>Monthly spending</h1>
      <form method="get">
        <label>
          Month <input type="month" name="month" defaultValue={query.month} required />
        </label>{" "}
        <button type="submit">Show</button>
      </form>
      <p>
        {previous && <Link href={reportHref({ ...query, month: previous })}>Previous month</Link>}{" "}
        {next && <Link href={reportHref({ ...query, month: next })}>Next month</Link>}
      </p>

      {reports.length === 0 ? (
        <p>No transactions in {query.month}.</p>
      ) : (
        reports.map((report) => (
          <CurrencySection
            key={report.currency}
            report={report}
            query={query}
            multiCurrency={reports.length > 1}
          />
        ))
      )}
      <p>Transfers between your own accounts aren&apos;t counted.</p>
    </main>
  );
}

function CurrencySection({
  report,
  query,
  multiCurrency,
}: {
  report: CurrencyReport;
  query: ReportQuery;
  // Headings name the currency only when there is more than one.
  multiCurrency: boolean;
}) {
  const { currency } = report;
  const headingId = `report-${currency}`;
  const name = (category: CategorySpending) => category.categoryName ?? "Uncategorized";
  const href = (category: CategorySpending) =>
    `/money/report/transactions?month=${query.month}&currency=${currency}` +
    `&category=${category.categoryId ?? "uncategorized"}`;

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>{multiCurrency ? `In ${currency}` : "Totals"}</h2>
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
              shareBasisPoints: category.shareBasisPoints,
              label: formatAmount(category.spentCents, currency, unsigned),
            }))}
          />
          <table>
            <caption>Spending by category in {currency}</caption>
            <thead>
              <tr>
                <th scope="col">Category</th>
                <SortHeader label="Amount" sortKey="amount" query={query} />
                <SortHeader label="%" sortKey="share" query={query} />
                <SortHeader label="Count" sortKey="count" query={query} />
              </tr>
            </thead>
            <tbody>
              {sortReportCategories(report.categories, query.sort, query.dir).map((category) => (
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

const directions = {
  asc: { ariaSort: "ascending", arrow: " ↑" },
  desc: { ariaSort: "descending", arrow: " ↓" },
} as const;

// Each column header links to the table sorted by it; the current column's link flips direction.
function SortHeader({
  label,
  sortKey,
  query,
}: {
  label: string;
  sortKey: ReportSortKey;
  query: ReportQuery;
}) {
  const active = query.sort === sortKey;
  const dir: SortDirection = active && query.dir === "desc" ? "asc" : "desc";
  return (
    <th scope="col" aria-sort={active ? directions[query.dir].ariaSort : "none"}>
      <Link href={reportHref({ ...query, sort: sortKey, dir })}>
        {label}
        {active && directions[query.dir].arrow}
      </Link>
    </th>
  );
}

// "12.34%" from basis points, in integers.
function formatShare(basisPoints: number): string {
  return `${Math.floor(basisPoints / 100)}.${String(basisPoints % 100).padStart(2, "0")}%`;
}
