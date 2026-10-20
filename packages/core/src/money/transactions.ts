import { schema, type Db } from "@troba/db";
import { and, desc, eq, isNull, type SQL } from "drizzle-orm";

// Transactions (SPEC-money M2, M8). Manual ones are entered by hand and fully editable; imported
// ones (csv_import) keep what the bank reported, so only their category and note change.

const { moneyAccounts, moneyCategories, moneyTransactions } = schema;

export const transactionDirections = ["expense", "income"] as const;
export type Direction = (typeof transactionDirections)[number];

export type Transaction = {
  id: string;
  accountId: string;
  accountName: string;
  bookedOn: string; // YYYY-MM-DD
  // Negative is an expense. In the account's currency.
  amountCents: bigint;
  currency: string;
  counterparty: string | null;
  description: string | null;
  categoryId: string | null;
  categoryName: string | null;
  // Who set the category: rules never overwrite one set by hand.
  categorySource: (typeof schema.categorySources)[number] | null;
  note: string | null;
  source: (typeof schema.transactionSources)[number];
};

// What the bank would report: fixed on imported transactions.
export type TransactionDetails = {
  accountId: string;
  bookedOn: string; // YYYY-MM-DD
  // Above zero; the direction gives the sign.
  amountCents: bigint;
  direction: Direction;
  counterparty?: string | null;
  description?: string | null;
};

export type NewTransaction = TransactionDetails & {
  categoryId?: string | null;
  note?: string | null;
};

export type CreateTransactionResult =
  | { ok: true; transaction: Transaction }
  | { ok: false; reason: "invalid-amount" | "account-not-found" | "category-not-found" };

// The newest first; the list page shows this many.
export const transactionListLimit = 100;

const transactionColumns = {
  id: moneyTransactions.id,
  accountId: moneyTransactions.accountId,
  accountName: moneyAccounts.name,
  bookedOn: moneyTransactions.bookedOn,
  amountCents: moneyTransactions.amountCents,
  currency: moneyTransactions.currency,
  counterparty: moneyTransactions.counterparty,
  description: moneyTransactions.description,
  categoryId: moneyTransactions.categoryId,
  categoryName: moneyCategories.name,
  categorySource: moneyTransactions.categorySource,
  note: moneyTransactions.note,
  source: moneyTransactions.source,
};

// Transactions with their account and category names, in one query.
function selectTransactions(db: Db, userId: string, where?: SQL) {
  return db
    .select(transactionColumns)
    .from(moneyTransactions)
    .innerJoin(
      moneyAccounts,
      and(eq(moneyAccounts.id, moneyTransactions.accountId), eq(moneyAccounts.userId, userId)),
    )
    .leftJoin(
      moneyCategories,
      and(eq(moneyCategories.id, moneyTransactions.categoryId), eq(moneyCategories.userId, userId)),
    )
    .where(and(eq(moneyTransactions.userId, userId), where));
}

// Empty text is no text.
function optionalText(text: string | null | undefined): string | null {
  return text?.trim() || null;
}

function signedCents(amountCents: bigint, direction: Direction): bigint {
  return direction === "expense" ? -amountCents : amountCents;
}

// The currency of one of the user's accounts, or null. Archived accounts aren't offered for new
// entries; a transaction already in one may stay there.
async function accountCurrency(
  db: Db,
  userId: string,
  accountId: string,
  options: { allowArchived?: boolean } = {},
) {
  const [account] = await db
    .select({ currency: moneyAccounts.currency })
    .from(moneyAccounts)
    .where(
      and(
        eq(moneyAccounts.id, accountId),
        eq(moneyAccounts.userId, userId),
        options.allowArchived ? undefined : isNull(moneyAccounts.archivedAt),
      ),
    );
  return account?.currency ?? null;
}

async function ownsCategory(db: Db, userId: string, categoryId: string) {
  const [category] = await db
    .select({ id: moneyCategories.id })
    .from(moneyCategories)
    .where(and(eq(moneyCategories.id, categoryId), eq(moneyCategories.userId, userId)));
  return category !== undefined;
}

export async function getTransaction(
  db: Db,
  userId: string,
  transactionId: string,
): Promise<Transaction | null> {
  const [transaction] = await selectTransactions(
    db,
    userId,
    eq(moneyTransactions.id, transactionId),
  );
  return transaction ?? null;
}

// The account and category are ids from the client: each must be the user's.
export async function createTransaction(
  db: Db,
  userId: string,
  input: NewTransaction,
): Promise<CreateTransactionResult> {
  if (input.amountCents <= 0n) return { ok: false, reason: "invalid-amount" };
  const currency = await accountCurrency(db, userId, input.accountId);
  if (!currency) return { ok: false, reason: "account-not-found" };
  const categoryId = input.categoryId ?? null;
  if (categoryId && !(await ownsCategory(db, userId, categoryId))) {
    return { ok: false, reason: "category-not-found" };
  }

  const [created] = await db
    .insert(moneyTransactions)
    .values({
      userId,
      accountId: input.accountId,
      bookedOn: input.bookedOn,
      amountCents: signedCents(input.amountCents, input.direction),
      currency,
      counterparty: optionalText(input.counterparty),
      description: optionalText(input.description),
      categoryId,
      categorySource: categoryId ? "manual" : null,
      note: optionalText(input.note),
      source: "manual",
    })
    .returning({ id: moneyTransactions.id });
  return { ok: true, transaction: (await getTransaction(db, userId, created!.id))! };
}

export type TransactionUpdate = {
  transactionId: string;
  // Left out to change only the category and note, which is all an imported transaction allows.
  details?: TransactionDetails;
  categoryId: string | null;
  note: string | null;
};

export type UpdateTransactionResult =
  | { ok: true; transaction: Transaction }
  | {
      ok: false;
      reason:
        "not-found" | "imported" | "invalid-amount" | "account-not-found" | "category-not-found";
    };

export async function updateTransaction(
  db: Db,
  userId: string,
  input: TransactionUpdate,
): Promise<UpdateTransactionResult> {
  const [current] = await db
    .select({
      source: moneyTransactions.source,
      accountId: moneyTransactions.accountId,
      categoryId: moneyTransactions.categoryId,
      categorySource: moneyTransactions.categorySource,
    })
    .from(moneyTransactions)
    .where(
      and(eq(moneyTransactions.id, input.transactionId), eq(moneyTransactions.userId, userId)),
    );
  if (!current) return { ok: false, reason: "not-found" };

  let details: Partial<typeof moneyTransactions.$inferInsert> = {};
  if (input.details) {
    // Date, amount and counterparty stay as the bank reported them.
    if (current.source !== "manual") return { ok: false, reason: "imported" };
    if (input.details.amountCents <= 0n) return { ok: false, reason: "invalid-amount" };
    const { accountId } = input.details;
    const currency = await accountCurrency(db, userId, accountId, {
      allowArchived: accountId === current.accountId,
    });
    if (!currency) return { ok: false, reason: "account-not-found" };
    details = {
      accountId,
      bookedOn: input.details.bookedOn,
      amountCents: signedCents(input.details.amountCents, input.details.direction),
      currency,
      counterparty: optionalText(input.details.counterparty),
      description: optionalText(input.details.description),
    };
  }
  if (input.categoryId && !(await ownsCategory(db, userId, input.categoryId))) {
    return { ok: false, reason: "category-not-found" };
  }

  // Saving the form with the category a rule chose keeps it the rule's; a change is by hand,
  // and rules never overwrite that.
  const categoryChanged = input.categoryId !== current.categoryId;
  await db
    .update(moneyTransactions)
    .set({
      ...details,
      categoryId: input.categoryId,
      categorySource: categoryChanged
        ? input.categoryId
          ? "manual"
          : null
        : current.categorySource,
      note: optionalText(input.note),
    })
    .where(
      and(eq(moneyTransactions.id, input.transactionId), eq(moneyTransactions.userId, userId)),
    );
  return { ok: true, transaction: (await getTransaction(db, userId, input.transactionId))! };
}

// Manual or imported; a deleted imported transaction comes back if its file is imported again.
// Its attachment rows go with it (on delete cascade). Returns whether one of the user's was deleted.
export async function deleteTransaction(
  db: Db,
  userId: string,
  input: { transactionId: string },
): Promise<boolean> {
  const deleted = await db
    .delete(moneyTransactions)
    .where(and(eq(moneyTransactions.id, input.transactionId), eq(moneyTransactions.userId, userId)))
    .returning({ id: moneyTransactions.id });
  return deleted.length > 0;
}

// Newest first, bounded: filters and paging over the whole history come with the full list.
export async function listTransactions(
  db: Db,
  userId: string,
  options: { limit?: number } = {},
): Promise<Transaction[]> {
  return selectTransactions(db, userId)
    .orderBy(
      desc(moneyTransactions.bookedOn),
      desc(moneyTransactions.createdAt),
      desc(moneyTransactions.id),
    )
    .limit(options.limit ?? transactionListLimit);
}
