# Spec: money (v1)

Status: **approved 2026-10-11** (amended same day: generic CSV import profiles). Module id: `money` ([capability map](SPEC.md)). Depends on: `identity` (signed-in user → `userId`).

## Objective

Let a signed-in user see where their money goes and how it's spent. They get transactions in through bank CSV exports and manual entry, organize them with categories and auto-rules, attach receipts, and view spending by category per month.

**User:** the owner first, then a few friends on staging. Used on desktop and phone browsers.

**Success looks like:** the owner imports bank statements weekly and answers "where did my money go this month?" without a spreadsheet.

### User stories and acceptance criteria

**M1. Financial accounts**
- A user can create, rename and archive accounts. Each account has a name, type (`bank` | `cash` | `other`), currency (ISO 4217, default `EUR`) and, for bank accounts, an optional IBAN (unique per user).
- A new user gets one `Cash` account (EUR) and the default categories, seeded lazily and idempotently on first visit to money (`ensureMoneyDefaults(userId)`), so `identity` never calls into `money`.
- Archived accounts are hidden from pickers, but their transactions still count in reports.

**M2. Manual transactions**
- A user can add a transaction: account, date, amount, direction (expense/income), counterparty (optional), description (optional), category (optional), note (optional).
- The form works on a 360px-wide phone screen and in under 15 seconds of typing.
- Manual transactions can be edited and deleted (delete asks for confirmation).

**M3. Bank CSV import with import profiles (CSV only; PDF is out of scope)**

No bank-specific code ships in the repo. A user teaches troba their bank's format once, as an **import profile** stored in their own data.

- **First upload of an unknown format:** the app shows the detected headers and the first rows, and the user maps columns to fields (see [Import profile](#import-profile)). The mapping is saved as a named profile.
- **Later uploads:** the profile is matched automatically by the file's exact header set. The user can also pick or edit a profile by hand.
- Delimiter (`,` `;` tab) and a UTF-8 BOM are detected. Banks may put preamble lines (a statement title) above the header: the profile stores how many lines to skip, the mapping step guesses it (first line with the file's usual column count) and lets the user correct it. A trailing delimiter on every line (an empty last column) is ignored. The encoding is UTF-8 unless the profile says otherwise (e.g. a `windows-125x` code page, decoded with the built-in `TextDecoder`). Decimal separator and date format come from the profile.
- **Amount sign:** either a signed amount column, or an unsigned amount plus a debit/credit indicator column with the profile's list of debit values. Amounts are parsed from the decimal string into integer cents without going through a float.
- **Account:** if the profile maps an own-account IBAN column, rows go to the user's account with that IBAN. If none matches, the user is offered to create a bank account with that IBAN and currency. A file with more than one own IBAN is rejected. Without that column, the user picks the account.
- A row whose counterparty IBAN is one of the user's own account IBANs is auto-categorized as **Transfers**, before user rules run.
- The system shows a preview before saving: rows parsed, how many are new, how many are duplicates (skipped), and how many failed, each with a reason.
- On confirm, new rows are saved in one database transaction. All or nothing.
- Importing the same file, or an overlapping date range, twice creates **no duplicates**.
- A file missing a column its profile requires is rejected with a clear message. Nothing is saved.
- Auto-rules (M5) are applied to imported rows on save.
- Each imported transaction keeps the original raw row (JSONB) for debugging and later re-parsing.
- On imported transactions, only category and note are editable. Date, amount and counterparty stay as the bank reported them. Imported transactions can be deleted.

**M4. Categories**
- Each new user gets a default set: Food, Transport, Bills, Housing, Health, Shopping, Entertainment, Income, Transfers, Other.
- A user can add, rename and delete categories. Deleting one moves its transactions to *uncategorized* after confirmation.
- Flat list only in v1 (no subcategories).
- The `Transfers` category is excluded from spending totals, so moving money between your own accounts doesn't count as spending.

**M5. Auto-categorization rules**
- A rule says: field (`counterparty` | `description`) *contains* text (case-insensitive) → category. Example: counterparty contains `GROCERY MART` → Food.
- Rules have an order. The first match wins.
- Rules apply on import and on manual "apply rules to uncategorized".
- A category set by hand is never overwritten by rules.
- From an uncategorized transaction, the user can "create rule from this", pre-filled with the counterparty.

**M6. Receipt attachments**
- A user can attach one or more files to any transaction: JPEG, PNG, WebP, HEIC or PDF, at most 10 MB each.
- On phones, the upload offers the camera.
- Files are viewable and downloadable only by their owner. Every other user gets 404.
- Attachments can be removed. Deleting a transaction deletes its files.
- Files are stored only. No OCR in v1.

**M7. Monthly spending view**
- The user picks a month (default: current). Default currency is EUR. They see:
  - total spent and total income
  - spending per category as a bar chart and as a sortable table (amount, % of total, transaction count)
  - uncategorized as its own row, linking to those transactions
- Clicking a category lists that month's transactions in it.
- Reports use each transaction's **account-currency** amount. A card purchase in USD on an EUR account counts as the EUR amount the bank charged. The original amount and currency are kept and shown on the transaction.
- Accounts in a different currency (e.g. a USD account) are not converted. Their totals are shown separately per currency. No FX conversion in v1.
- Totals match the sum of the underlying transactions to the cent.

**M8. Transaction list**
- A paginated list, newest first, filterable by month, account, category and uncategorized, with text search over counterparty and description.
- Each row shows date, counterparty/description, category, amount, and a receipt indicator.

## Tech Stack

Per [AGENTS.md](AGENTS.md): Next.js (App Router) with server actions for UI mutations, Drizzle + PostgreSQL, Zod, shadcn/ui on Base UI + Tailwind, Recharts, Vitest, Playwright. Versions are pinned when `platform` scaffolds the repo.

## Commands

Defined by `platform`. Planned:

```
pnpm dev                        # web + db via docker compose
pnpm lint
pnpm typecheck
pnpm test                       # vitest: unit + integration
pnpm test:e2e                   # playwright
pnpm db:generate                # drizzle-kit generate migration
pnpm db:migrate
```

## Project Structure

```
packages/db/src/schema/money.ts          accounts, transactions, categories, rules, import profiles, attachments
packages/core/src/money/
  accounts.ts  transactions.ts  categories.ts  rules.ts  attachments.ts  report.ts
  import/csv.ts                          decode, sniff delimiter, split rows
  import/profile.ts                      profile schema (Zod), header matching, row → ParsedRow
  import/import.ts                       preview + commit, dedup
  *.test.ts                              unit tests next to code
packages/core/test/fixtures/csv/         fictional "Example Bank" exports (made-up headers and data)
apps/web/app/(app)/money/                pages: transactions, import, categories, rules, report
apps/web/app/(app)/money/actions.ts      thin server actions → packages/core
apps/web/app/api/files/[id]/route.ts     authenticated attachment download
apps/web/e2e/money.spec.ts               playwright
```

## Data Model (sketch)

All tables have `id` (uuid), `user_id`, `created_at` and `updated_at`.

| Table | Key columns |
|---|---|
| `money_accounts` | name, type, currency `char(3)`, iban null (unique per user), archived_at |
| `money_transactions` | account_id, booked_on `date`, amount_cents `bigint` (negative = expense, account currency), currency, original_amount_cents null, original_currency null, counterparty, counterparty_iban null, description, bank_tx_type null, category_id null, category_source (`manual` \| `rule` \| `transfer` \| null), note, source (`manual` \| `csv_import`), import_id null, dedup_key null, raw `jsonb` null |
| `money_categories` | name, excluded_from_spending `bool` |
| `money_rules` | field, pattern, category_id, position |
| `money_import_profiles` | name, header_fingerprint, skip_lines `int` default 0, delimiter null (auto), encoding, decimal_separator, date_format, columns `jsonb` (field → header), debit_values `text[]` null |
| `money_imports` | account_id, profile_id, filename, row counts, imported_at |
| `money_attachments` | transaction_id, filename, mime, size_bytes, storage_path |

- Unique index `(user_id, account_id, dedup_key)` makes dedup a database guarantee.
- `dedup_key` is `tx:` + the profile's transaction-id column when mapped and non-empty. Otherwise it's a hash of date + amount + debit/credit + counterparty + description, plus an occurrence index for identical rows in the same file.
- Files live on a Docker volume at `<userId>/<uuid>`, never at a user-supplied name. Per-user folders let `identity` delete a user's files without knowing about `money`.

### Import profile

| Field | Required | Maps to |
|---|---|---|
| booking date | yes | `booked_on` if no transaction date |
| transaction date | no | `booked_on` (preferred: banks often post card purchases a day later) |
| amount | yes | `amount_cents` (account currency) |
| debit/credit indicator + debit values | if amount is unsigned | sign |
| currency | no (defaults to the account's) | `currency` |
| original amount, original currency | no | `original_*`, stored only when it differs from the account currency |
| counterparty | no | `counterparty` |
| counterparty IBAN | no | `counterparty_iban` (transfer detection) |
| description | no | `description` |
| transaction id | no (strongly recommended) | `dedup_key` |
| transaction type | no | `bank_tx_type` |
| own account IBAN | no | account match |

Bank descriptions can contain masked card numbers and other personal details, so **never log descriptions or raw rows.**

## Code Style

Domain functions are plain, typed and take `db` and `userId` explicitly. Server actions only validate and delegate.

```ts
// packages/core/src/money/report.ts
export async function monthlySpending(db: Db, userId: string, month: string /* YYYY-MM */) {
  const rows = await db
    .select({
      categoryId: transactions.categoryId,
      currency: transactions.currency,
      spentCents: sql<string>`-sum(${transactions.amountCents})`,
      count: count(),
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(and(
      eq(transactions.userId, userId),
      lt(transactions.amountCents, 0),
      inMonth(transactions.bookedOn, month),
      or(isNull(categories.id), eq(categories.excludedFromSpending, false)),
    ))
    .groupBy(transactions.categoryId, transactions.currency);
  return rows.map((r) => ({ ...r, spentCents: BigInt(r.spentCents) }));
}
```

- Use kebab-case filenames and camelCase in TS. Tables are snake_case, prefixed `money_`.
- Amounts are always `amountCents`, never `amount`. Format only in UI through `Intl.NumberFormat`.
- Zod schemas sit next to the server action that uses them and are shared with forms.

## Testing Strategy

| Level | Tool | Covers |
|---|---|---|
| Unit | Vitest | CSV decoding (BOM, `;`/`,`/tab, windows-125x), profile parsing against fictional fixtures in two styles (signed amounts; unsigned amounts + D/C indicator with decimal comma), edge cases (refunds, fees, foreign-currency purchase, identical rows, missing required column, multiple own IBANs), decimal string → cents, dedup key, header-fingerprint matching, own-IBAN transfer detection, rule matching order |
| Integration | Vitest + real Postgres (Testcontainers or the CI Compose db) | import commit is atomic, re-import creates no duplicates, monthly totals to the cent, **user A can never read or modify user B's accounts, transactions, categories, rules or files** |
| E2E | Playwright | Upload fictional fixture → map columns → save profile → preview → confirm → rule categorizes → monthly view shows correct totals; attach a receipt and view it; phone viewport smoke test |

- Every acceptance criterion above maps to at least one test.
- Test parser bugs with a new fictional fixture first.
- A local-only test may run against a real-format fixture in `.private/fixtures/` and is skipped when that folder is absent (always in CI).
- Coverage numbers are not a goal; `CONSTRAINTS.md` may set one later.

## Boundaries

- **Always:** filter every query by `userId`. Validate uploads (size, MIME by content sniffing, not just extension). Keep imports atomic. Add a fixture and test for every parser fix. Use integer cents.
- **Ask first:** schema changes after the first prod deploy, new dependencies (e.g. a CSV or HEIC library), changing the dedup key formula once real data exists, adding FX conversion.
- **Never:** store real (non-anonymized) bank exports in the repo, log transaction contents or file contents, serve files by path or without an owner check, use floats for money.

## Success Criteria

1. After a one-time profile setup, the owner imports a real monthly export end to end in under 2 minutes, including reviewing the preview.
2. Re-importing any already-imported file adds 0 transactions.
3. After setting up about 10 rules, at least 80% of a typical month's imported transactions are auto-categorized.
4. Monthly view totals equal the sum of that month's imported debits by transaction date, excluding Transfers, to the cent. Totals can differ from the bank's statement at month edges when the bank books card purchases later.
5. The monthly view renders in under 1 s with 10,000 transactions in the database.
6. Every page works at 360px width. Forms are keyboard-operable and labelled (WCAG 2.1 AA basics).
7. The integration test suite proves cross-user isolation for every money table and the file route.

## Decisions (resolved 2026-10-11)

0. **Reporting date:** `booked_on` = the transaction date when the profile maps one (when you spent), else the booking date.
1. **Import format:** CSV only, through user-defined import profiles. No bank-specific code or docs in the repo; the owner's bank format lives in gitignored `.private/`. PDF statements are out of scope.
2. **No background worker in v1.** Imports run synchronously in the web request. `apps/worker` arrives with `receipts-ocr`.
3. **Deleted imported transactions come back on re-import.** No tombstones in v1.
4. **Currency:** reports use the account-currency amount the bank charged. The original currency is kept for display. Accounts in other currencies get separate totals, with no FX conversion.
5. **HEIC is stored as-is.**
6. **Capability map approved:** platform → identity → money.

## Open Questions

None. (Real-format check done 2026-10-11: findings in `.private/bank-format.md`, folded into M3 above. Repo fixtures are always fictional.)
