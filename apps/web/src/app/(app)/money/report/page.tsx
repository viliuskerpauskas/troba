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
import { DescriptionList } from "@/components/description-list";
import { Page } from "@/components/page";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
    <Page>
      <h1>Monthly spending</h1>
      <form method="get" className="flex flex-wrap items-center gap-2">
        <FieldLabel htmlFor="report-month">Month</FieldLabel>
        <Input
          id="report-month"
          type="month"
          name="month"
          defaultValue={query.month}
          required
          className="w-auto"
        />
        <Button type="submit" variant="secondary">
          Show
        </Button>
      </form>
      <div className="flex gap-2">
        {previous && (
          <Link
            href={reportHref({ ...query, month: previous })}
            className={buttonVariants({ variant: "outline" })}
          >
            Previous month
          </Link>
        )}
        {next && (
          <Link
            href={reportHref({ ...query, month: next })}
            className={buttonVariants({ variant: "outline" })}
          >
            Next month
          </Link>
        )}
      </div>

      {reports.length === 0 ? (
        <p className="text-muted-foreground">No transactions in {query.month}.</p>
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
      <p className="text-sm text-muted-foreground">
        Transfers between your own accounts aren&apos;t counted.
      </p>
    </Page>
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
      <Card>
        <CardHeader>
          <h2 id={headingId}>{multiCurrency ? `In ${currency}` : "Totals"}</h2>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <DescriptionList className="text-base">
            <dt>Total spent</dt>
            <dd className="font-semibold">{formatAmount(report.spentCents, currency, unsigned)}</dd>
            <dt>Total income</dt>
            <dd className="font-semibold">
              {formatAmount(report.incomeCents, currency, unsigned)}
            </dd>
          </DescriptionList>

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
              <Table>
                <TableCaption>Spending by category in {currency}</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Category</TableHead>
                    <SortHeader label="Amount" sortKey="amount" query={query} />
                    <SortHeader label="%" sortKey="share" query={query} />
                    <SortHeader label="Count" sortKey="count" query={query} />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortReportCategories(report.categories, query.sort, query.dir).map(
                    (category) => (
                      <TableRow key={category.categoryId ?? "uncategorized"}>
                        <TableHead scope="row" className="whitespace-normal">
                          <Link href={href(category)}>{name(category)}</Link>
                        </TableHead>
                        <TableCell className="text-right">
                          {formatAmount(category.spentCents, currency, unsigned)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatShare(category.shareBasisPoints)}
                        </TableCell>
                        <TableCell className="text-right">{category.transactionCount}</TableCell>
                      </TableRow>
                    ),
                  )}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>
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
    <TableHead
      scope="col"
      aria-sort={active ? directions[query.dir].ariaSort : "none"}
      className="text-right"
    >
      <Link href={reportHref({ ...query, sort: sortKey, dir })}>
        {label}
        {active && directions[query.dir].arrow}
      </Link>
    </TableHead>
  );
}

// "12.34%" from basis points, in integers.
function formatShare(basisPoints: number): string {
  return `${Math.floor(basisPoints / 100)}.${String(basisPoints % 100).padStart(2, "0")}%`;
}
