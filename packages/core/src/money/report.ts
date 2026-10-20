import { schema, type Db } from "@troba/db";
import { and, eq, gte, lt, not, sql } from "drizzle-orm";
import { monthRange } from "./month";

// Monthly spending (SPEC-money M7). Amounts are the account-currency ones; each currency is
// reported on its own, with no FX conversion. Spending is what went out (negative amounts),
// income what came in, so a refund counts as income rather than shrinking its category.

const { moneyCategories, moneyTransactions } = schema;

export type CategorySpending = {
  // Null for uncategorized.
  categoryId: string | null;
  categoryName: string | null;
  // Above zero.
  spentCents: bigint;
  transactionCount: number;
  // Of the currency's spending, in hundredths of a percent, rounded half up.
  shareBasisPoints: number;
};

export type CurrencyReport = {
  currency: string;
  // Zero or above.
  spentCents: bigint;
  incomeCents: bigint;
  // Categories with spending this month, largest first.
  categories: CategorySpending[];
};

// The spec's default currency leads; the rest follow alphabetically.
const defaultReportCurrency = "EUR";

// One query, grouped by currency and category; served by the (user_id, booked_on) index.
export async function monthlyReport(
  db: Db,
  userId: string,
  month: string,
): Promise<CurrencyReport[]> {
  const [from, to] = monthRange(month);
  const amount = moneyTransactions.amountCents;
  const rows = await db
    .select({
      currency: moneyTransactions.currency,
      categoryId: moneyCategories.id,
      categoryName: moneyCategories.name,
      spentCents: sql<string>`coalesce(sum(-${amount}) filter (where ${amount} < 0), 0)`,
      incomeCents: sql<string>`coalesce(sum(${amount}) filter (where ${amount} > 0), 0)`,
      expenseCount: sql<number>`count(*) filter (where ${amount} < 0)`.mapWith(Number),
    })
    .from(moneyTransactions)
    .leftJoin(
      moneyCategories,
      and(eq(moneyCategories.id, moneyTransactions.categoryId), eq(moneyCategories.userId, userId)),
    )
    .where(
      and(
        eq(moneyTransactions.userId, userId),
        // Transfers between the user's own accounts aren't spending or income.
        not(sql`coalesce(${moneyCategories.excludedFromSpending}, false)`),
        gte(moneyTransactions.bookedOn, from),
        lt(moneyTransactions.bookedOn, to),
      ),
    )
    .groupBy(moneyTransactions.currency, moneyCategories.id, moneyCategories.name);

  const byCurrency = new Map<string, CurrencyReport>();
  for (const row of rows) {
    let report = byCurrency.get(row.currency);
    if (!report) {
      report = { currency: row.currency, spentCents: 0n, incomeCents: 0n, categories: [] };
      byCurrency.set(row.currency, report);
    }
    const spentCents = BigInt(row.spentCents);
    report.spentCents += spentCents;
    report.incomeCents += BigInt(row.incomeCents);
    if (row.expenseCount > 0) {
      report.categories.push({
        categoryId: row.categoryId,
        categoryName: row.categoryName,
        spentCents,
        transactionCount: row.expenseCount,
        shareBasisPoints: 0,
      });
    }
  }

  const reports = [...byCurrency.values()].sort(byDefaultCurrencyFirst);
  for (const report of reports) {
    for (const category of report.categories) {
      category.shareBasisPoints = shareBasisPoints(category.spentCents, report.spentCents);
    }
    report.categories = sortReportCategories(report.categories, "amount", "desc");
  }
  return reports;
}

// The report table's columns. A share is an amount over the same total, so both sort alike.
export const reportSortKeys = ["amount", "share", "count"] as const;
export type ReportSortKey = (typeof reportSortKeys)[number];

// A sorted copy. Ties go by name either way, uncategorized last.
export function sortReportCategories(
  categories: CategorySpending[],
  sort: ReportSortKey,
  dir: "asc" | "desc",
): CategorySpending[] {
  const sign = dir === "asc" ? 1 : -1;
  const byColumn = (a: CategorySpending, b: CategorySpending) =>
    sort === "count"
      ? a.transactionCount - b.transactionCount
      : compareBigints(a.spentCents, b.spentCents);
  const byName = (a: CategorySpending, b: CategorySpending) =>
    a.categoryName === null
      ? b.categoryName === null
        ? 0
        : 1
      : b.categoryName === null
        ? -1
        : a.categoryName.localeCompare(b.categoryName);
  return categories.toSorted((a, b) => sign * byColumn(a, b) || byName(a, b));
}

// In bigint, so the share is exact before it is rounded.
function shareBasisPoints(partCents: bigint, totalCents: bigint): number {
  if (totalCents === 0n) return 0;
  return Number((partCents * 20000n + totalCents) / (2n * totalCents));
}

function compareBigints(a: bigint, b: bigint): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

function byDefaultCurrencyFirst(a: { currency: string }, b: { currency: string }) {
  if (a.currency === b.currency) return 0;
  if (a.currency === defaultReportCurrency) return -1;
  if (b.currency === defaultReportCurrency) return 1;
  return a.currency < b.currency ? -1 : 1;
}
