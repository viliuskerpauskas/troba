import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { createdAt, id, timestamptz, updatedAt } from "./columns";

// Money tables (SPEC-money, data model). Amounts are integer cents in bigint columns, each with a
// currency beside it. Every table carries user_id; queries filter by it, the foreign keys between
// money tables don't check ownership.

export const accountTypes = ["bank", "cash", "other"] as const;
export type AccountType = (typeof accountTypes)[number];
export const transactionSources = ["manual", "csv_import"] as const;
export const categorySources = ["manual", "rule", "transfer"] as const;
export const ruleFields = ["counterparty", "description"] as const;
export const pdfImportStates = ["queued", "reading", "read", "failed"] as const;
export type PdfImportState = (typeof pdfImportStates)[number];
// Why a PDF import's reading failed (core's PdfImportFailureReason says what each means).
export const pdfImportFailureReasons = [
  "unavailable",
  "invalid-answer",
  "not-a-statement",
  "balance-mismatch",
  "daily-limit",
] as const;
export type PdfImportFailureReason = (typeof pdfImportFailureReasons)[number];
// How an import profile reads its files: a text file (CSV) or a spreadsheet's first sheet.
export const importProfileKinds = ["text", "spreadsheet"] as const;
export type ImportProfileKind = (typeof importProfileKinds)[number];

const userId = () =>
  uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" });
const currency = (name: string) => char(name, { length: 3 });
const cents = (name: string) => bigint(name, { mode: "bigint" });
// The check constraint's list, from the same array as the TypeScript type, so the two can't drift.
const oneOf = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(", "));

// Per-user money state. A row exists once the defaults were seeded (core/money/defaults.ts), so
// they are seeded once even after the user renames, archives or deletes them.
export const moneySettings = pgTable("money_settings", {
  userId: userId().primaryKey(),
  defaultsSeededAt: timestamptz("defaults_seeded_at").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const moneyAccounts = pgTable(
  "money_accounts",
  {
    id: id(),
    userId: userId(),
    name: text("name").notNull(),
    type: text("type", { enum: accountTypes }).notNull(),
    currency: currency("currency").default("EUR").notNull(),
    // Normalized: upper case, no spaces. Only bank accounts have one.
    iban: text("iban"),
    // Archived accounts are hidden from pickers; their transactions still count in reports.
    archivedAt: timestamptz("archived_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // Nulls are distinct, so accounts without an IBAN don't collide.
    uniqueIndex("money_accounts_user_id_iban_idx").on(table.userId, table.iban),
    check("money_accounts_type_check", sql`${table.type} in (${oneOf(accountTypes)})`),
    check("money_accounts_currency_check", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check("money_accounts_iban_check", sql`${table.iban} is null or ${table.type} = 'bank'`),
  ],
);

export const moneyCategories = pgTable(
  "money_categories",
  {
    id: id(),
    userId: userId(),
    name: text("name").notNull(),
    // Transfers between the user's own accounts aren't spending.
    excludedFromSpending: boolean("excluded_from_spending").default(false).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("money_categories_user_id_idx").on(table.userId)],
);

export const moneyImportProfiles = pgTable(
  "money_import_profiles",
  {
    id: id(),
    userId: userId(),
    name: text("name").notNull(),
    // A profile matches only files of its own kind. Delimiter and encoding apply to text only.
    kind: text("kind", { enum: importProfileKinds }).default("text").notNull(),
    headerFingerprint: text("header_fingerprint").notNull(),
    skipLines: integer("skip_lines").default(0).notNull(),
    // Null: detected per file.
    delimiter: text("delimiter"),
    encoding: text("encoding").default("utf-8").notNull(),
    decimalSeparator: text("decimal_separator").notNull(),
    dateFormat: text("date_format").notNull(),
    // Field → header in the file.
    columns: jsonb("columns").$type<Record<string, string>>().notNull(),
    // With an unsigned amount column: the indicator values that mean a debit.
    debitValues: text("debit_values").array(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check("money_import_profiles_kind_check", sql`${table.kind} in (${oneOf(importProfileKinds)})`),
    index("money_import_profiles_user_id_fingerprint_idx").on(
      table.userId,
      table.headerFingerprint,
    ),
  ],
);

// Raw bytes; drizzle has no bytea column of its own.
const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => "bytea",
  toDriver: (value) => Buffer.from(value),
  fromDriver: (value) => new Uint8Array(value),
});

// A PDF statement on its way to becoming an import (T152, ADR-0018): queued for the worker, being
// read by the model, read (its answer waits for the user to preview and confirm it) or failed. The
// bytes are kept only until the reading ends, either way, and the row is deleted once its import is
// saved or the user starts over.
export const moneyPdfImports = pgTable(
  "money_pdf_imports",
  {
    id: id(),
    userId: userId(),
    // The client's name, metadata only.
    filename: text("filename").notNull(),
    state: text("state", { enum: pdfImportStates }).default("queued").notNull(),
    bytes: bytea("bytes"),
    // The model's validated answer, once read. Never logged.
    answer: jsonb("answer"),
    // Why the reading failed; set with the failed state.
    failureReason: text("failure_reason", { enum: pdfImportFailureReasons }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // The import page shows the user's latest one.
    index("money_pdf_imports_user_id_created_at_idx").on(table.userId, table.createdAt),
    check("money_pdf_imports_state_check", sql`${table.state} in (${oneOf(pdfImportStates)})`),
    check(
      "money_pdf_imports_failure_reason_check",
      sql`${table.failureReason} is null or ${table.failureReason} in (${oneOf(pdfImportFailureReasons)})`,
    ),
  ],
);

// One row per AI mapping the model was asked for (T128, ADR-0015), counted per user over the last
// day to cap what one account can spend. Rows older than a day are deleted as new ones come.
export const moneyAiMappingUses = pgTable(
  "money_ai_mapping_uses",
  {
    id: id(),
    userId: userId(),
    createdAt: createdAt(),
  },
  (table) => [
    index("money_ai_mapping_uses_user_id_created_at_idx").on(table.userId, table.createdAt),
  ],
);

// One row per model call for AI-suggested categories (T138, ADR-0016): how many merchants it
// carried, counted per user over the last day to cap what one account can spend. Rows older than a
// day are deleted as new ones come.
export const moneyAiCategorizeUses = pgTable(
  "money_ai_categorize_uses",
  {
    id: id(),
    userId: userId(),
    merchants: integer("merchants").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("money_ai_categorize_uses_user_id_created_at_idx").on(table.userId, table.createdAt),
  ],
);

// One run of AI-suggested categories, done by the worker (T144, ADR-0020): from the "Suggest
// categories" button (import_id null) or after an import (that import, at most one run each). The
// web app queues it and reads back how it went; the counts are SuggestCategoriesResult's, set with
// finished_at when the run ends. No merchant text is kept here. A finished run is deleted a day
// later, when the user starts another.
export const moneyAiCategorizeRuns = pgTable(
  "money_ai_categorize_runs",
  {
    id: id(),
    userId: userId(),
    importId: uuid("import_id")
      .unique()
      .references(() => moneyImports.id, { onDelete: "cascade" }),
    finishedAt: timestamptz("finished_at"),
    merchantsAsked: integer("merchants_asked").default(0).notNull(),
    rowsSuggested: integer("rows_suggested").default(0).notNull(),
    failed: boolean("failed").default(false).notNull(),
    capped: boolean("capped").default(false).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("money_ai_categorize_runs_user_id_created_at_idx").on(table.userId, table.createdAt),
  ],
);

// One row per PDF import the model was asked to read (T154, ADR-0018), counted per user over the
// last day to cap what one account can spend. Keyed by the PDF import, so a retried job reuses its
// claim; no foreign key, since the use outlives the PDF import. Rows older than a day are deleted
// as new ones come.
export const moneyAiPdfImportUses = pgTable(
  "money_ai_pdf_import_uses",
  {
    id: id(),
    userId: userId(),
    pdfImportId: uuid("pdf_import_id").notNull().unique(),
    createdAt: createdAt(),
  },
  (table) => [
    index("money_ai_pdf_import_uses_user_id_created_at_idx").on(table.userId, table.createdAt),
  ],
);

export const moneyImports = pgTable(
  "money_imports",
  {
    id: id(),
    userId: userId(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => moneyAccounts.id),
    profileId: uuid("profile_id").references(() => moneyImportProfiles.id, {
      onDelete: "set null",
    }),
    filename: text("filename").notNull(),
    rowsParsed: integer("rows_parsed").notNull(),
    rowsNew: integer("rows_new").notNull(),
    rowsDuplicate: integer("rows_duplicate").notNull(),
    rowsFailed: integer("rows_failed").notNull(),
    importedAt: timestamptz("imported_at").defaultNow().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("money_imports_user_id_imported_at_idx").on(table.userId, table.importedAt),
    // Serves the set-null when a profile is deleted.
    index("money_imports_profile_id_idx").on(table.profileId),
  ],
);

export const moneyTransactions = pgTable(
  "money_transactions",
  {
    id: id(),
    userId: userId(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => moneyAccounts.id),
    bookedOn: date("booked_on").notNull(),
    // Negative is an expense. In the account's currency: what the bank charged.
    amountCents: cents("amount_cents").notNull(),
    currency: currency("currency").notNull(),
    // Only when the original currency differs from the account's.
    originalAmountCents: cents("original_amount_cents"),
    originalCurrency: currency("original_currency"),
    counterparty: text("counterparty"),
    counterpartyIban: text("counterparty_iban"),
    description: text("description"),
    bankTxType: text("bank_tx_type"),
    categoryId: uuid("category_id").references(() => moneyCategories.id, {
      onDelete: "set null",
    }),
    categorySource: text("category_source", { enum: categorySources }),
    // A category the model proposed (T135, ADR-0016). It exists only while the row has no category
    // of its own: every write that sets one clears it, and the check below refuses both at once.
    // The row stays out of the category totals until the user accepts it.
    suggestedCategoryId: uuid("suggested_category_id").references(() => moneyCategories.id, {
      onDelete: "set null",
    }),
    // When the row's merchant was sent to the model. Null: never asked. A merchant the model
    // couldn't place, or a suggestion the user dismissed, stays marked so it isn't sent again.
    suggestionAskedAt: timestamptz("suggestion_asked_at"),
    note: text("note"),
    source: text("source", { enum: transactionSources }).notNull(),
    importId: uuid("import_id").references(() => moneyImports.id, { onDelete: "set null" }),
    dedupKey: text("dedup_key"),
    // The bank's original row, for debugging and re-parsing. Never logged.
    raw: jsonb("raw"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // Dedup is a database guarantee: re-importing a file can't create duplicates.
    uniqueIndex("money_transactions_user_id_account_id_dedup_key_idx").on(
      table.userId,
      table.accountId,
      table.dedupKey,
    ),
    index("money_transactions_user_id_booked_on_idx").on(table.userId, table.bookedOn),
    // These serve the foreign-key checks when an account, category or import is deleted
    // (a user's deletion cascades to all three); without them each one scans every user's rows.
    index("money_transactions_account_id_idx").on(table.accountId),
    index("money_transactions_category_id_idx").on(table.categoryId),
    index("money_transactions_suggested_category_id_idx").on(table.suggestedCategoryId),
    // The pending suggestions of one user: counted on every render of the transactions list and
    // paged by "accept all". A user's suggestions are few next to their history, so this stays
    // small where an index over every row would not.
    index("money_transactions_pending_suggestion_idx")
      .on(table.userId)
      .where(sql`${table.suggestedCategoryId} is not null`),
    index("money_transactions_import_id_idx").on(table.importId),
    check("money_transactions_currency_check", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check(
      "money_transactions_original_check",
      sql`(${table.originalAmountCents} is null) = (${table.originalCurrency} is null)`,
    ),
    check(
      "money_transactions_category_source_check",
      sql`${table.categorySource} is null or ${table.categorySource} in (${oneOf(categorySources)})`,
    ),
    check(
      "money_transactions_suggestion_check",
      sql`${table.suggestedCategoryId} is null or ${table.categoryId} is null`,
    ),
    check(
      "money_transactions_source_check",
      sql`${table.source} in (${oneOf(transactionSources)})`,
    ),
  ],
);

export const moneyRules = pgTable(
  "money_rules",
  {
    id: id(),
    userId: userId(),
    field: text("field", { enum: ruleFields }).notNull(),
    pattern: text("pattern").notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => moneyCategories.id, { onDelete: "cascade" }),
    // Lower first; the first matching rule wins.
    position: integer("position").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("money_rules_user_id_position_idx").on(table.userId, table.position),
    index("money_rules_category_id_idx").on(table.categoryId),
    check("money_rules_field_check", sql`${table.field} in (${oneOf(ruleFields)})`),
  ],
);

export const moneyAttachments = pgTable(
  "money_attachments",
  {
    id: id(),
    userId: userId(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => moneyTransactions.id, { onDelete: "cascade" }),
    // The client's name, metadata only; the file is stored at storagePath.
    filename: text("filename").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    // <userId>/<uuid> under UPLOADS_DIR, never a user-supplied name.
    storagePath: text("storage_path").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("money_attachments_user_id_idx").on(table.userId),
    index("money_attachments_transaction_id_idx").on(table.transactionId),
  ],
);
