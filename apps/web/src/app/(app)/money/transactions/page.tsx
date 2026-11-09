import {
  aiCategorizationEnabledFor,
  listAccounts,
  listCategories,
  listTransactions,
  transactionListLimit,
} from "@troba/core";
import type { Metadata } from "next";
import Link from "next/link";
import { Page } from "@/components/page";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { db } from "@/server/db";
import { aiCategorizationEnabled } from "@/server/env";
import { requireMoneyUser } from "@/server/money";
import { formatAmount } from "../format";
import { parseListQuery, searchMaxLength, transactionsHref } from "./params";
import { AskAgain } from "./ask-again";
import { SuggestCategories, SuggestionChip } from "./suggest-categories";
import { rowElementId } from "./row-id";
import { SuggestionControls } from "./suggestion-controls";
import { SuggestionNotice } from "./suggestion-notice";

export const metadata: Metadata = { title: "Transactions · troba" };

// SPEC-money M8: newest first, a page at a time, filtered by the query in the URL.
export default async function TransactionsPage({ searchParams }: PageProps<"/money/transactions">) {
  const { userId } = await requireMoneyUser();
  const query = parseListQuery(await searchParams);
  const { page, ...filter } = query;
  const filtered = Object.keys(filter).length > 0;
  const [accounts, categories, rows, userOptedIn] = await Promise.all([
    // Archived accounts keep their transactions, so they stay in the filter.
    listAccounts(db(), userId, { includeArchived: true }),
    listCategories(db(), userId),
    // One more than a page, to know whether there is a next one.
    listTransactions(db(), userId, {
      ...filter,
      limit: transactionListLimit + 1,
      offset: (page - 1) * transactionListLimit,
    }),
    aiCategorizationEnabledFor(db(), userId),
  ]);
  const transactions = rows.slice(0, transactionListLimit);
  // Without a key the feature is not mentioned anywhere, so suggestions already stored stay hidden.
  const aiEnabled = aiCategorizationEnabled();
  // A user who opted out gets no button and no control that asks or accepts, but suggestions they
  // already have stay visible (and, once they can be dismissed, stay dismissable).
  const aiOffered = aiEnabled && userOptedIn;

  return (
    <Page>
      <h1>Transactions</h1>
      <div className="flex flex-wrap gap-2">
        <Link href="/money/transactions/new" className={buttonVariants()}>
          Add transaction
        </Link>
        <Link href="/money/import" className={buttonVariants({ variant: "outline" })}>
          Import a bank statement
        </Link>
      </div>
      <SuggestCategories enabled={aiOffered} />
      <AskAgain enabled={aiOffered} />
      <SuggestionNotice />

      <form method="get" aria-label="Filter transactions" className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="filter-q">Search</FieldLabel>
          <Input
            id="filter-q"
            type="search"
            name="q"
            defaultValue={filter.search}
            maxLength={searchMaxLength}
            placeholder="Counterparty or description"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="filter-month">Month</FieldLabel>
          <Input id="filter-month" type="month" name="month" defaultValue={filter.month} />
        </Field>
        <Field>
          <FieldLabel htmlFor="filter-account">Account</FieldLabel>
          <NativeSelect
            id="filter-account"
            name="account"
            defaultValue={filter.accountId ?? ""}
            className="w-full"
          >
            <NativeSelectOption value="">All accounts</NativeSelectOption>
            {accounts.map((account) => (
              <NativeSelectOption key={account.id} value={account.id}>
                {account.name}
                {account.archivedAt ? " (archived)" : ""}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor="filter-category">Category</FieldLabel>
          <NativeSelect
            id="filter-category"
            name="category"
            defaultValue={filter.category ?? ""}
            className="w-full"
          >
            <NativeSelectOption value="">All categories</NativeSelectOption>
            <NativeSelectOption value="uncategorized">Uncategorized</NativeSelectOption>
            {categories.map((category) => (
              <NativeSelectOption key={category.id} value={category.id}>
                {category.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <div className="flex items-center gap-4 sm:col-span-2">
          <Button type="submit" variant="secondary">
            Filter
          </Button>
          {filtered && <Link href="/money/transactions">Clear filters</Link>}
        </div>
      </form>

      {transactions.length === 0 ? (
        <p className="text-muted-foreground">
          {page > 1
            ? "No more transactions."
            : filtered
              ? "No transactions match these filters."
              : "No transactions yet."}
        </p>
      ) : (
        // A list, not a table: four columns don't fit a phone.
        <ol
          aria-label="Transactions, newest first"
          className="flex flex-col divide-y rounded-xl ring-1 ring-foreground/10"
        >
          {transactions.map((transaction) => {
            const title =
              [transaction.counterparty, transaction.description].filter(Boolean).join(": ") ||
              "No description";
            return (
              <li
                key={transaction.id}
                id={rowElementId(transaction.id)}
                tabIndex={-1}
                className="flex flex-col gap-1 px-4 py-3"
              >
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
                  {transaction.categoryName ?? "Uncategorized"}
                  {aiEnabled && transaction.suggestedCategoryName && (
                    <>
                      {" "}
                      <SuggestionChip categoryName={transaction.suggestedCategoryName} />
                    </>
                  )}{" "}
                  ·{" "}
                  <strong className="text-foreground">
                    {formatAmount(transaction.amountCents, transaction.currency)}
                  </strong>
                  {transaction.hasReceipt && " · Receipt"}
                </div>
                {aiEnabled &&
                  transaction.suggestedCategoryId &&
                  transaction.suggestedCategoryName && (
                    <SuggestionControls
                      transactionId={transaction.id}
                      suggestedCategoryId={transaction.suggestedCategoryId}
                      categoryName={transaction.suggestedCategoryName}
                      merchant={title}
                      canAccept={aiOffered}
                    />
                  )}
              </li>
            );
          })}
        </ol>
      )}
      <div className="flex gap-2">
        {page > 1 && (
          <Link
            href={transactionsHref({ ...query, page: page - 1 })}
            className={buttonVariants({ variant: "outline" })}
          >
            Newer
          </Link>
        )}
        {rows.length > transactionListLimit && (
          <Link
            href={transactionsHref({ ...query, page: page + 1 })}
            className={buttonVariants({ variant: "outline" })}
          >
            Older
          </Link>
        )}
      </div>
    </Page>
  );
}
