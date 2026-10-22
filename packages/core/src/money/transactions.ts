import { schema, type Db } from "@troba/db";
import { and, desc, eq, gte, ilike, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { removeAttachmentFiles } from "./attachments";
import { monthRange } from "./month";

// Transactions (SPEC-money M2, M8). Manual ones are entered by hand and fully editable; imported
// ones (csv_import) keep what the bank reported, so only their category and note change.

const { moneyAccounts, moneyAttachments, moneyCategories, moneyTransactions } = schema;

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
  // At least one receipt attached (SPEC-money M6).
  hasReceipt: boolean;
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
  hasReceipt: sql<boolean>`exists (
    select 1 from ${moneyAttachments}
    where ${moneyAttachments.transactionId} = ${moneyTransactions.id}
      and ${moneyAttachments.userId} = ${moneyTransactions.userId}
  )`,
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
// Its attachments go with it, rows and files. Returns whether one of the user's was deleted.
export async function deleteTransaction(
  db: Db,
  userId: string,
  input: { transactionId: string; uploadsDir: string },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const attachments = await tx
      .delete(moneyAttachments)
      .where(
        and(
          eq(moneyAttachments.transactionId, input.transactionId),
          eq(moneyAttachments.userId, userId),
        ),
      )
      .returning({ storagePath: moneyAttachments.storagePath });
    const deleted = await tx
      .delete(moneyTransactions)
      .where(
        and(eq(moneyTransactions.id, input.transactionId), eq(moneyTransactions.userId, userId)),
      )
      .returning({ id: moneyTransactions.id });
    await removeAttachmentFiles(input.uploadsDir, userId, attachments);
    return deleted.length > 0;
  });
}

export type TransactionFilter = {
  month?: string; // YYYY-MM
  accountId?: string;
  // Text in the counterparty or description, ignoring case.
  search?: string;
  // A category id, or the transactions without one.
  category?: string | "uncategorized";
  // With expensesOnly, what makes up a monthly report row (report.ts).
  currency?: string;
  expensesOnly?: boolean;
};

function filterWhere(filter: TransactionFilter): SQL | undefined {
  const conditions: SQL[] = [];
  if (filter.month) {
    const [from, to] = monthRange(filter.month);
    conditions.push(gte(moneyTransactions.bookedOn, from), lt(moneyTransactions.bookedOn, to));
  }
  if (filter.accountId) conditions.push(eq(moneyTransactions.accountId, filter.accountId));
  const search = optionalText(filter.search);
  if (search) {
    // LIKE's wildcards and its escape character, backslash, are matched as typed.
    const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
    conditions.push(
      or(
        ilike(moneyTransactions.counterparty, pattern),
        ilike(moneyTransactions.description, pattern),
      )!,
    );
  }
  if (filter.category === "uncategorized") conditions.push(isNull(moneyTransactions.categoryId));
  else if (filter.category) conditions.push(eq(moneyTransactions.categoryId, filter.category));
  if (filter.currency) conditions.push(eq(moneyTransactions.currency, filter.currency));
  if (filter.expensesOnly) conditions.push(lt(moneyTransactions.amountCents, 0n));
  return and(...conditions);
}

// Newest first, a page at a time.
export async function listTransactions(
  db: Db,
  userId: string,
  options: TransactionFilter & { limit?: number; offset?: number } = {},
): Promise<Transaction[]> {
  return selectTransactions(db, userId, filterWhere(options))
    .orderBy(
      desc(moneyTransactions.bookedOn),
      desc(moneyTransactions.createdAt),
      desc(moneyTransactions.id),
    )
    .limit(options.limit ?? transactionListLimit)
    .offset(options.offset ?? 0);
}
