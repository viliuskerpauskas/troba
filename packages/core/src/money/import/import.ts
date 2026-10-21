import { schema, type Db, type DbTransaction } from "@troba/db";
import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { accountColumns, createAccount, defaultCurrency, type Account } from "../accounts";
import { readCsv } from "./csv";
import {
  parseRows,
  type DebitCreditCount,
  type ImportProfile,
  type ParsedRow,
  type RowFailureReason,
} from "./profile";

// Bank CSV import (SPEC-money M3, persistence): a file read with its profile becomes a preview of
// what would be saved, and on confirm the new rows are saved in one transaction. Commit reads the
// file again rather than trusting a preview the client sends back.
//
// Descriptions and raw rows can hold masked card numbers: never log them.

const { moneyAccounts, moneyCategories, moneyImportProfiles, moneyImports, moneyTransactions } =
  schema;

// The largest file read: readCsv decodes and splits the whole file in memory, with no bound of
// its own. An upload handler should check it too, before reading the body.
export const maxImportFileBytes = 5 * 1024 * 1024;

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
  | { ok: false; reason: "file-too-large" }
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

// A row that can't be imported. currency-mismatch: amounts are stored in the account's currency,
// and the file says the row is in another.
export type ImportRowFailure = { row: number; reason: RowFailureReason | "currency-mismatch" };

export type ImportPreview = {
  account: Account;
  // Data rows in the file: new + duplicates + failed.
  rowsParsed: number;
  rowsNew: number;
  // Already saved for this account; skipped.
  rowsDuplicate: number;
  failed: ImportRowFailure[];
  // With a debit/credit column, the indicators seen, for the user to check (see parseRows).
  debitCredit: DebitCreditCount[] | null;
};

export type PreviewImportResult = ({ ok: true } & ImportPreview) | ImportRefusal;

export async function previewImport(
  db: Db,
  userId: string,
  input: ImportInput,
): Promise<PreviewImportResult> {
  const prepared = await prepareImport(db, userId, input);
  if (!prepared.ok) return prepared;
  const { rows, ...preview } = prepared;

  const existing = await existingDedupKeys(db, userId, preview.account.id, rows);
  const rowsDuplicate = rows.filter((row) => existing.has(row.dedupKey)).length;
  return { ...preview, rowsNew: rows.length - rowsDuplicate, rowsDuplicate };
}

export type CreateImportAccountInput = {
  profile: ImportProfile;
  bytes: Uint8Array;
  name: string;
};

export type CreateImportAccountResult =
  | { ok: true; account: Account }
  // The profile maps no own-IBAN column, or the file leaves it empty: the user picks an account.
  | { ok: false; reason: "no-account-in-file" }
  | Exclude<
      ImportRefusal,
      { reason: "unknown-account" | "account-required" | "account-not-found" | "account-mismatch" }
    >;

// The preview offers a bank account for an own IBAN the user has none for: this creates it, with
// the IBAN and currency read from the file again, never taken from the client. An account that
// already has the IBAN (another request created it first) is the one returned.
export async function createImportAccount(
  db: Db,
  userId: string,
  input: CreateImportAccountInput,
): Promise<CreateImportAccountResult> {
  const file = { profile: input.profile, bytes: input.bytes, filename: "" };
  const prepared = await prepareImport(db, userId, file);
  if (prepared.ok) return { ok: true, account: prepared.account };
  switch (prepared.reason) {
    case "account-required":
      return { ok: false, reason: "no-account-in-file" };
    case "unknown-account": {
      const { iban, currency } = prepared;
      const created = await createAccount(db, userId, {
        name: input.name,
        type: "bank",
        currency,
        iban,
      });
      if (created.ok) return created;
      // The IBAN was read and parsed from the file, and the account is a bank account, so only
      // iban-taken can happen: another request created it first.
      const again = await prepareImport(db, userId, file);
      if (again.ok) return { ok: true, account: again.account };
      throw new Error(`createImportAccount: ${created.reason}`);
    }
    case "account-not-found":
    case "account-mismatch":
      throw new Error(`createImportAccount: ${prepared.reason} without a picked account`);
    default:
      return prepared;
  }
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
    const { rows, ...preview } = prepared;
    const { account, rowsParsed, failed } = preview;

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
    return { ...preview, importId, rowsNew, rowsDuplicate };
  });
}

// Money moved between the user's own accounts is a transfer, not spending: a row whose
// counterparty IBAN is one of theirs goes to Transfers, before user rules run. Transfers is found
// by its flag, which survives a rename. It can't be deleted (SPEC-money M4), but a user who deleted
// it before that rule has none, and their rows stay uncategorized.
async function transferDetection(tx: DbTransaction, userId: string) {
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

// The preview without its duplicate counts, plus the rows that could be saved.
type PreparedImport = { ok: true; rows: ParsedRow[] } & Omit<
  ImportPreview,
  "rowsNew" | "rowsDuplicate"
>;

// What preview and commit share: the file read with its profile, and the account it goes to.
async function prepareImport(
  db: Db | DbTransaction,
  userId: string,
  input: ImportInput,
): Promise<PreparedImport | ImportRefusal> {
  if (input.bytes.byteLength > maxImportFileBytes) return { ok: false, reason: "file-too-large" };
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
  const rows: ParsedRow[] = [];
  const failed: ImportRowFailure[] = [...parsed.failed];
  for (const row of parsed.rows) {
    if (row.currency === account.currency) rows.push(row);
    else failed.push({ row: row.row, reason: "currency-mismatch" });
  }
  failed.sort((a, b) => a.row - b.row);

  return {
    ok: true,
    account,
    rowsParsed: table.rows.length,
    rows,
    failed,
    debitCredit: parsed.debitCredit,
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
