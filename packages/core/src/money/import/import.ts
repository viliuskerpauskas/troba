import { schema, type Db } from "@troba/db";
import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { Account } from "../accounts";
import { readCsv } from "./csv";
import { parseRows, type ImportProfile, type ParsedRow, type RowFailure } from "./profile";

// Bank CSV import (SPEC-money M3, persistence): a file read with its profile becomes a preview of
// what would be saved, and on confirm the new rows are saved in one transaction. Commit reads the
// file again rather than trusting a preview the client sends back.
//
// Descriptions and raw rows can hold masked card numbers: never log them.

const { moneyAccounts, moneyCategories, moneyImportProfiles, moneyImports, moneyTransactions } =
  schema;

type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type ImportInput = {
  profile: ImportProfile;
  filename: string;
  bytes: Uint8Array;
  // The account the user picked, for a file without an own IBAN. A candidate id from the client,
  // checked against the user's accounts.
  accountId?: string | null;
  // The saved profile the file was read with, recorded on the import. A candidate id too.
  profileId?: string | null;
};

// Why nothing in the file can be imported as it stands.
export type ImportRefusal =
  | { ok: false; reason: "profile-not-found" }
  | { ok: false; reason: "unknown-encoding" | "invalid-encoding" | "unterminated-quote" }
  | { ok: false; reason: "missing-columns"; columns: string[] }
  | { ok: false; reason: "multiple-own-ibans" }
  // The UI offers to create a bank account with this IBAN and currency.
  | { ok: false; reason: "unknown-account"; iban: string; currency: string }
  // No own IBAN in the file, and no account picked.
  | { ok: false; reason: "account-required" }
  | { ok: false; reason: "account-not-found" }
  // The picked account isn't the one the file's own IBAN names.
  | { ok: false; reason: "account-mismatch" };

export type ImportPreview = {
  account: Account;
  // Data rows in the file: new + duplicates + failed.
  rowsParsed: number;
  rowsNew: number;
  // Already saved for this account; skipped.
  rowsDuplicate: number;
  failed: RowFailure[];
};

export type PreviewImportResult = ({ ok: true } & ImportPreview) | ImportRefusal;

const accountColumns = {
  id: moneyAccounts.id,
  name: moneyAccounts.name,
  type: moneyAccounts.type,
  currency: moneyAccounts.currency,
  iban: moneyAccounts.iban,
  archivedAt: moneyAccounts.archivedAt,
};

export async function previewImport(
  db: Db,
  userId: string,
  input: ImportInput,
): Promise<PreviewImportResult> {
  const prepared = await prepareImport(db, userId, input);
  if (!prepared.ok) return prepared;
  const { account, rowsParsed, rows, failed } = prepared;

  const existing = await existingDedupKeys(db, userId, account.id, rows);
  const rowsDuplicate = rows.filter((row) => existing.has(row.dedupKey)).length;
  return {
    ok: true,
    account,
    rowsParsed,
    rowsNew: rows.length - rowsDuplicate,
    rowsDuplicate,
    failed,
  };
}

export type CommitImportResult = ({ ok: true; importId: string } & ImportPreview) | ImportRefusal;

// Rows per statement: an inserted row binds up to 17 parameters, and Postgres allows 65,535.
const insertBatchSize = 1000;
const lookupBatchSize = 10000;

// All or nothing: the import record and every new row commit together. Duplicates are left to the
// unique dedup index, so two imports of one file at once still save each row once.
export async function commitImport(
  db: Db,
  userId: string,
  input: ImportInput,
): Promise<CommitImportResult> {
  return db.transaction(async (tx) => {
    const prepared = await prepareImport(tx, userId, input);
    if (!prepared.ok) return prepared;
    const { account, rowsParsed, rows, failed } = prepared;

    const [created] = await tx
      .insert(moneyImports)
      .values({
        userId,
        accountId: account.id,
        profileId: input.profileId ?? null,
        filename: input.filename,
        rowsParsed,
        rowsNew: 0,
        rowsDuplicate: 0,
        rowsFailed: failed.length,
      })
      .returning({ id: moneyImports.id });
    const importId = created!.id;
    const transfer = await transferDetection(tx, userId);

    let rowsNew = 0;
    for (let i = 0; i < rows.length; i += insertBatchSize) {
      const inserted = await tx
        .insert(moneyTransactions)
        .values(
          rows.slice(i, i + insertBatchSize).map((row) => ({
            userId,
            accountId: account.id,
            bookedOn: row.bookedOn,
            amountCents: row.amountCents,
            currency: row.currency,
            originalAmountCents: row.originalAmountCents,
            originalCurrency: row.originalCurrency,
            counterparty: row.counterparty,
            counterpartyIban: row.counterpartyIban,
            description: row.description,
            bankTxType: row.bankTxType,
            ...transfer(row),
            source: "csv_import" as const,
            importId,
            dedupKey: row.dedupKey,
            raw: row.raw,
          })),
        )
        .onConflictDoNothing({
          target: [
            moneyTransactions.userId,
            moneyTransactions.accountId,
            moneyTransactions.dedupKey,
          ],
        })
        .returning({ id: moneyTransactions.id });
      rowsNew += inserted.length;
    }

    const rowsDuplicate = rows.length - rowsNew;
    await tx
      .update(moneyImports)
      .set({ rowsNew, rowsDuplicate })
      .where(and(eq(moneyImports.id, importId), eq(moneyImports.userId, userId)));
    return { ok: true, importId, account, rowsParsed, rowsNew, rowsDuplicate, failed };
  });
}

// Money moved between the user's own accounts is a transfer, not spending: a row whose
// counterparty IBAN is one of theirs goes to Transfers, before user rules run. Transfers is found
// by its flag, which survives a rename; with no such category the row stays uncategorized (T74).
async function transferDetection(tx: Transaction, userId: string) {
  const owned = await tx
    .select({ iban: moneyAccounts.iban })
    .from(moneyAccounts)
    .where(and(eq(moneyAccounts.userId, userId), isNotNull(moneyAccounts.iban)));
  const ownIbans = new Set(owned.map((account) => account.iban));
  const [transfers] = await tx
    .select({ id: moneyCategories.id })
    .from(moneyCategories)
    .where(and(eq(moneyCategories.userId, userId), eq(moneyCategories.excludedFromSpending, true)))
    .orderBy(asc(moneyCategories.createdAt), asc(moneyCategories.id))
    .limit(1);

  return (row: ParsedRow) =>
    transfers && row.counterpartyIban && ownIbans.has(row.counterpartyIban)
      ? { categoryId: transfers.id, categorySource: "transfer" as const }
      : {};
}

// The currency a new account gets (SPEC-money M1).
const defaultCurrency = "EUR";

// What preview and commit share: the file read with its profile, and the account it goes to.
async function prepareImport(
  db: Db | Transaction,
  userId: string,
  input: ImportInput,
): Promise<
  | { ok: true; account: Account; rowsParsed: number; rows: ParsedRow[]; failed: RowFailure[] }
  | ImportRefusal
> {
  const { profile } = input;
  if (input.profileId) {
    const [saved] = await db
      .select({ id: moneyImportProfiles.id })
      .from(moneyImportProfiles)
      .where(
        and(eq(moneyImportProfiles.id, input.profileId), eq(moneyImportProfiles.userId, userId)),
      );
    if (!saved) return { ok: false, reason: "profile-not-found" };
  }
  const table = readCsv(input.bytes, profile);
  if (!table.ok) return table;
  // The account isn't known until the file's own IBAN is read, so the first pass assumes the
  // default currency and is redone in the account's when that differs.
  let parsed = parseRows(profile, table, { accountCurrency: defaultCurrency });
  if (!parsed.ok) return parsed;

  let account: Account | undefined;
  if (parsed.ownIban) {
    // Archived accounts too: the statement is still that account's.
    [account] = await db
      .select(accountColumns)
      .from(moneyAccounts)
      .where(and(eq(moneyAccounts.userId, userId), eq(moneyAccounts.iban, parsed.ownIban)));
    if (!account) {
      const currency = parsed.rows[0]?.currency ?? defaultCurrency;
      return { ok: false, reason: "unknown-account", iban: parsed.ownIban, currency };
    }
    if (input.accountId && input.accountId !== account.id) {
      return { ok: false, reason: "account-mismatch" };
    }
  } else {
    if (!input.accountId) return { ok: false, reason: "account-required" };
    // Archived accounts are hidden from pickers.
    [account] = await db
      .select(accountColumns)
      .from(moneyAccounts)
      .where(
        and(
          eq(moneyAccounts.id, input.accountId),
          eq(moneyAccounts.userId, userId),
          isNull(moneyAccounts.archivedAt),
        ),
      );
    if (!account) return { ok: false, reason: "account-not-found" };
  }

  if (account.currency !== defaultCurrency) {
    parsed = parseRows(profile, table, { accountCurrency: account.currency });
    if (!parsed.ok) return parsed;
  }
  return {
    ok: true,
    account,
    rowsParsed: table.rows.length,
    rows: parsed.rows,
    failed: parsed.failed,
  };
}

// Served by the unique dedup index. Batched like the inserts, one parameter per key.
async function existingDedupKeys(db: Db, userId: string, accountId: string, rows: ParsedRow[]) {
  const existing = new Set<string | null>();
  for (let i = 0; i < rows.length; i += lookupBatchSize) {
    const found = await db
      .select({ dedupKey: moneyTransactions.dedupKey })
      .from(moneyTransactions)
      .where(
        and(
          eq(moneyTransactions.userId, userId),
          eq(moneyTransactions.accountId, accountId),
          inArray(
            moneyTransactions.dedupKey,
            rows.slice(i, i + lookupBatchSize).map((row) => row.dedupKey),
          ),
        ),
      );
    for (const row of found) existing.add(row.dedupKey);
  }
  return existing;
}
