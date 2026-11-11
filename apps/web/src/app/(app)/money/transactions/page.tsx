import {
  activeCategorySuggestionRun,
  aiCategorizationEnabledFor,
  countPendingSuggestions,
  listAccounts,
  listCategories,
  listSuggestionsByMerchant,
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
import {
  merchantsViewHref,
  parseListQuery,
  parseView,
  searchMaxLength,
  transactionsHref,
} from "./params";
import { AcceptAll } from "./accept-all";
import { AskAgain } from "./ask-again";
import { SuggestCategories, SuggestionChip } from "./suggest-categories";
import { rowElementId } from "./row-id";
import { SuggestionControls } from "./suggestion-controls";
import { SuggestionGroups } from "./suggestion-groups";
import { SuggestionNotice } from "./suggestion-notice";

export const metadata: Metadata = { title: "Transactions · troba" };

// SPEC-money M8: newest first, a page at a time, filtered by the query in the URL.
export default async function TransactionsPage({ searchParams }: PageProps<"/money/transactions">) {
  const { userId } = await requireMoneyUser();
  const params = await searchParams;
  const query = parseListQuery(params);
  // Without a key the feature is not mentioned anywhere, so suggestions already stored stay hidden.
  const aiEnabled = aiCategorizationEnabled();
  // The suggestions grouped by merchant, in place of the list; only while the server has a key.
  const merchantsView = aiEnabled && parseView(params) === "merchants";
  const { page, ...filter } = query;
  const filtered = Object.keys(filter).length > 0;
  const [accounts, categories, rows, userOptedIn, pendingSuggestions, groups, activeRun] =
    await Promise.all([
      // Archived accounts keep their transactions, so they stay in the filter.
      listAccounts(db(), userId, { includeArchived: true }),
      listCategories(db(), userId),
      // One more than a page, to know whether there is a next one. Not read for the merchants view.
      merchantsView
        ? []
        : listTransactions(db(), userId, {
            ...filter,
            limit: transactionListLimit + 1,
            offset: (page - 1) * transactionListLimit,
          }),
      aiCategorizationEnabledFor(db(), userId),
      // One aggregate over the user's rows, for the strip; never the rows themselves. Without a key
      // the strip is never shown, so nothing is counted.
      aiEnabled ? countPendingSuggestions(db(), userId) : null,
      merchantsView ? listSuggestionsByMerchant(db(), userId) : null,
      // A run of the user's still with the worker (the button's, or an import's), which the strip
      // follows so its suggestions appear when it is done.
      aiEnabled ? activeCategorySuggestionRun(db(), userId) : null,
    ]);
  const transactions = rows.slice(0, transactionListLimit);
  // A user who opted out gets no button and no control that asks or accepts, but suggestions they
  // already have stay visible (and, once they can be dismissed, stay dismissable).
  const aiOffered = aiEnabled && userOptedIn;

  // The list of transactions, a page at a time, as it is without the merchants view.
  const transactionList = (
    <>
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
    </>
  );

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
      {aiOffered && pendingSuggestions && (
        <AcceptAll rows={pendingSuggestions.rows} merchants={pendingSuggestions.merchants} />
      )}
      <SuggestCategories enabled={aiOffered} runId={activeRun} />
      <AskAgain enabled={aiOffered} />
      <SuggestionNotice />
      {aiEnabled && (merchantsView || (pendingSuggestions?.rows ?? 0) > 0) && (
        <nav aria-label="Transaction views" className="flex flex-wrap gap-2">
          <Link
            href="/money/transactions"
            aria-current={merchantsView ? undefined : "page"}
            className={buttonVariants({ variant: merchantsView ? "ghost" : "secondary" })}
          >
            All transactions
          </Link>
          <Link
            href={merchantsViewHref}
            aria-current={merchantsView ? "page" : undefined}
            className={buttonVariants({ variant: merchantsView ? "secondary" : "ghost" })}
          >
            Suggestions by merchant
          </Link>
        </nav>
      )}

      {groups ? (
        <section aria-labelledby="suggestions-by-merchant" className="flex flex-col gap-4">
          <h2 id="suggestions-by-merchant" className="text-lg font-medium">
            Suggestions by merchant
          </h2>
          <SuggestionGroups
            groups={groups}
            merchants={pendingSuggestions?.merchants ?? groups.length}
            canAccept={aiOffered}
          />
        </section>
      ) : (
        transactionList
      )}
    </Page>
  );
}
