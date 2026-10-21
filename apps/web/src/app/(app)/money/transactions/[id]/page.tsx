import { centsToDecimal, getTransaction, listAccounts, listCategories } from "@troba/core";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { db } from "@/server/db";
import { requireMoneyUser } from "@/server/money";
import { formatAmount } from "../../format";
import { DeleteTransaction, TransactionForm } from "../transaction-form";

export const metadata: Metadata = { title: "Edit transaction · troba" };

export default async function EditTransactionPage({
  params,
}: PageProps<"/money/transactions/[id]">) {
  const { userId } = await requireMoneyUser();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const [transaction, accounts, categories] = await Promise.all([
    getTransaction(db(), userId, id.data),
    listAccounts(db(), userId, { includeArchived: true }),
    listCategories(db(), userId),
  ]);
  if (!transaction) notFound();
  const imported = transaction.source === "csv_import";
  // Archived accounts aren't offered, except the one the transaction is already in.
  const pickable = accounts.filter(
    (account) => !account.archivedAt || account.id === transaction.accountId,
  );
  const amountCents = transaction.amountCents;

  return (
    <main>
      <h1>Edit transaction</h1>
      <p>
        <Link href="/money/transactions">Back to transactions</Link>
      </p>
      {imported && (
        <section aria-labelledby="as-imported">
          <h2 id="as-imported">As the bank reported it</h2>
          <p>Imported transactions keep their date, amount and counterparty.</p>
          <dl>
            <dt>Account</dt>
            <dd>{transaction.accountName}</dd>
            <dt>Date</dt>
            <dd>{transaction.bookedOn}</dd>
            <dt>Amount</dt>
            <dd>{formatAmount(amountCents, transaction.currency)}</dd>
            {transaction.counterparty && (
              <>
                <dt>Counterparty</dt>
                <dd>{transaction.counterparty}</dd>
              </>
            )}
            {transaction.description && (
              <>
                <dt>Description</dt>
                <dd>{transaction.description}</dd>
              </>
            )}
          </dl>
        </section>
      )}
      <TransactionForm
        mode="edit"
        transactionId={transaction.id}
        imported={imported}
        accounts={pickable}
        categories={categories}
        initial={{
          accountId: transaction.accountId,
          bookedOn: transaction.bookedOn,
          amount: centsToDecimal(amountCents < 0n ? -amountCents : amountCents),
          direction: amountCents < 0n ? "expense" : "income",
          counterparty: transaction.counterparty ?? "",
          description: transaction.description ?? "",
          categoryId: transaction.categoryId ?? "",
          note: transaction.note ?? "",
        }}
      />
      {!transaction.categoryId && (
        <p>
          <Link href={`/money/rules?from=${transaction.id}`}>Create rule from this</Link>
        </p>
      )}
      <DeleteTransaction transactionId={transaction.id} />
    </main>
  );
}
