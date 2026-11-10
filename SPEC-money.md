# Spec: money (v1)

Status: **approved 2026-10-11** (amended same day: generic CSV import profiles; amended 2026-11-06: bank presets and AI-suggested mapping, [ADR-0015](docs/adr/0015-import-presets-and-ai-mapping.md); amended 2026-11-09: AI-suggested categories, [ADR-0016](docs/adr/0016-ai-transaction-categorization.md); amended 2026-11-10: no profile picker on upload, T147; amended 2026-11-10: spreadsheet statement files, [ADR-0019](docs/adr/0019-sheetjs-for-spreadsheet-statements.md)). Module id: `money` ([capability map](SPEC.md)). Depends on: `identity` (signed-in user → `userId`).

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

**M3. Statement file import: CSV and spreadsheets with import profiles, and PDF read by AI**

A **statement file** is what the user's bank exports: a CSV, or a spreadsheet (XLSX, old binary XLS or ODS). No bank-specific parser code ships in the repo. Every format is described as an **import profile** (see [Import profile](#import-profile)), stored in the user's own data. A profile comes from a built-in **preset**, from an AI suggestion the user confirmed, or from the user's own mapping. A preset is a data file naming one bank's export format, and the only place a bank name may appear ([ADR-0015](docs/adr/0015-import-presets-and-ai-mapping.md)).

- **Upload check.** The import page says which file types it takes. Before anything reads a file, it is refused if it is over the import size limit (5 MB), and then unless its content and its declared type agree on one kind: a CSV is text with no control characters, XLSX and ODS are ZIP containers, XLS is an OLE container. A file that is none of these (an image renamed `.xlsx`, say) is refused as not a statement file.
- **Spreadsheets read like a CSV** ([ADR-0019](docs/adr/0019-sheetjs-for-spreadsheet-statements.md)). Only the first sheet is read, into the same header row and data rows a CSV gives, so everything below applies to it unchanged. A cell stored as a number becomes its shortest round-trip decimal string (`-4.2`, `1234.56`) and is read with a decimal point whatever the profile says, so it imports to the cent; a cell stored as a date becomes that day (`YYYY-MM-DD`, from the date's serial number, with no time zone involved) and is read as such whatever the profile's date format. Booleans and empty cells become text. Text cells are the bank's own writing and are read with the profile's decimal separator and date format, as in a CSV. Preamble rows above the header are skipped as in a CSV; a sheet row ends at its last filled cell, so the guess takes the first row at least as wide as most rows. A workbook the reader can't open (corrupt, cut off, password-protected, or a ZIP or Office file that holds no workbook) is refused with a message saying to export it again without a password, and nothing is matched, sent or saved.
- **A profile has a kind**, `text` (a CSV) or `spreadsheet`, taken from the file it was saved for, never from the client. A preset declares its kind, `text` unless it says otherwise. Matching by headers runs only among profiles and presets of the file's kind, so a bank's CSV profile is never applied to its spreadsheet, whose dates and amounts are written differently, and the reverse; a preview or import with a saved profile of the other kind is refused. Delimiter and encoding apply to `text` only, and the mapping form doesn't ask for them for a spreadsheet.
- **Resolution order.** An upload finds its format in this order, matched by the file's exact header set (read with each candidate's own skip-lines, delimiter and encoding):
  1. **The user's saved profile.** It wins over everything, so the user's corrections are respected. The upload step asks only for the file: there is no picking a profile by hand, and the preview's "Edit profile" is how the user corrects the one found.
  2. **A built-in preset.** The file goes straight to the preview with nothing to map. The preset is copied into the user's own profiles at that moment, so it behaves like any profile (editable, shown in the import history, subject to the profile limit); only the requesting user gets a copy.
  3. **An AI-suggested mapping**, for a format troba has never seen, only when the server has an OpenAI key. The proposal prefills the mapping form, marked as a suggestion. Nothing is saved or imported until the user presses save.
  4. **The manual mapping form**, when AI is off, capped, fails, or the proposal doesn't fit the file. The app shows the detected headers and the first rows, and the user maps columns to fields. The mapping is saved as a named profile.
- **The step after the upload says which of these happened**, in one note under its heading: the preview names a match as one of the user's profiles or as a built-in bank format (now copied into theirs), and the mapping form says whether AI filled it in or, when it is blank, why (AI off, unavailable or capped, no rows to send, or the profile limit stopping a preset's copy). A preview reached by saving or editing a profile has no such note.
- **The AI step.** One attempt, bounded by a timeout, no retry loop. It sends only the detected header row and up to five data rows, scrubbed: IBAN-shaped values and long digit runs (7 or more digits with no separator) are masked, in the header row too; dates, amounts and currency codes are kept; other free text becomes a placeholder that keeps its length and character classes but none of its words; and a column whose every value is a code (one or two capital letters such as D/C, a currency code, or a debit/credit marker word such as DEBIT or CRDT) sends its distinct values instead of sampled cells. Whether a value is a code never depends on how often it repeats, so a short file or a column of one-word merchants is masked like any text. The lines above the header are never sent, and nothing is sent for a file a saved profile or preset recognizes. The upload step says so when the feature is on. The answer is parsed with the profile schema and checked against the file (every mapped header exists; a dry run reads at least one row), or discarded. A per-user daily cap limits calls. The payload and the answer are never logged.
- In a CSV, the delimiter (`,` `;` tab) and a UTF-8 BOM are detected. Banks may put preamble lines (a statement title) above the header: the profile stores how many lines to skip, the mapping step guesses it (first line with the file's usual column count) and lets the user correct it. A trailing delimiter on every line (an empty last column) is ignored. The encoding is UTF-8 unless the profile says otherwise (e.g. a `windows-125x` code page, decoded with the built-in `TextDecoder`). Decimal separator and date format come from the profile.
- **Amount sign:** either a signed amount column, or an unsigned amount plus a debit/credit indicator column with the profile's list of debit values. Amounts are parsed from the decimal string into integer cents without going through a float.
- **Account:** if the profile maps an own-account IBAN column, rows go to the user's account with that IBAN. If none matches, the user is offered to create a bank account with that IBAN and currency. A file with more than one own IBAN is rejected. Without that column, the user picks the account.
- A row whose counterparty IBAN is one of the user's own account IBANs is auto-categorized as **Transfers** (the category excluded from spending, whatever the user renamed it to), before user rules run.
- The system shows a preview before saving: rows parsed, how many are new, how many are duplicates (skipped), and how many failed, each with a reason.
- On confirm, new rows are saved in one database transaction. All or nothing.
- Importing the same file, or an overlapping date range, twice creates **no duplicates**.
- A file missing a column its profile requires is rejected with a clear message. Nothing is saved.
- Auto-rules (M5) are applied to imported rows on save.
- Each imported transaction keeps the original raw row (JSONB) for debugging and later re-parsing.
- On imported transactions, only category and note are editable. Date, amount and counterparty stay as the bank reported them. Imported transactions can be deleted.

**PDF statements** ([ADR-0018](docs/adr/0018-pdf-statements-read-by-a-model.md)) have no import profile: an AI model reads them, text or scanned, and only when the server has an OpenAI key. Without one the import page doesn't offer PDF, and a PDF upload is refused with a message saying PDF import isn't available.

- **Consent, every time.** Before anything is sent, the page says the whole statement goes to the AI provider, including amounts, names and account numbers, and asks the user to confirm. There is no "don't ask again". Declining sends and keeps nothing. Unlike the mapping sample above, nothing is masked.
- **Reading.** Confirming creates a user-owned **PDF import** holding the file, in state `queued`, and queues a job on the worker (`apps/worker`), which moves it to `reading` and ends it `read` or `failed`. The worker sends the PDF as a file input with a strict JSON schema, asks the provider not to store it, uses a timeout and makes one attempt. Nothing from the exchange is logged; an error carries an HTTP status at most. The file's bytes are deleted as soon as the reading ends, either way.
- **The answer** is parsed with a fixed schema: the statement's own IBAN(s) and currency, if printed, and for each transaction a booking date, a signed decimal-string amount, a currency, and optionally a counterparty, counterparty IBAN and description. An answer that fails the schema fails the reading. Amounts become cents through the same decimal-string parser as CSV, never through a float; a row with an unusable date, amount or currency is a failed row with a reason.
- **The page** shows a "reading your statement" state, which is still there when the user leaves and comes back, then the ordinary preview, with a note under its heading that it was read by AI, or a failure that saves nothing and offers to try again.
- **Then it is an ordinary import:** account matching by the statement's own IBAN (offer to create the account, more than one own IBAN refused, the user picks the account when none is printed), the currency rule, Transfers and rules, the preview, the all-or-nothing save and AI category suggestions after it (M5). The save reads the stored answer, never anything the client sends back, and deletes the PDF import. The import history shows it with no profile, and each transaction's raw JSONB is the model's row for it.
- **Duplicates.** A PDF row has no bank transaction id, and the model's text can differ between readings, so its dedup key is its date, amount and currency plus its occurrence within the statement: a re-import adds nothing, and two equal rows in one statement stay two. A PDF row never matches a CSV row for the same payment.

**M4. Categories**
- Each new user gets a default set: Food, Transport, Bills, Housing, Health, Shopping, Entertainment, Income, Transfers, Other.
- A user can add, rename and delete categories (except deleting `Transfers`, below). Deleting one moves its transactions to *uncategorized* after confirmation.
- Flat list only in v1 (no subcategories).
- The `Transfers` category is excluded from spending totals, so moving money between your own accounts doesn't count as spending.
- `Transfers` can be renamed but not deleted, since imports assign it (M3). It is the only category excluded from spending: new categories never are.

**M5. Auto-categorization rules**
- A rule says: field (`counterparty` | `description`) *contains* text (case-insensitive) → category. Example: counterparty contains `GROCERY MART` → Food.
- Rules have an order. The first match wins.
- Rules apply on import and on manual "apply rules to uncategorized".
- A category set by hand is never overwritten by rules.
- From an uncategorized transaction, the user can "create rule from this", pre-filled with the counterparty.

**M5 (continued). AI-suggested categories** ([ADR-0016](docs/adr/0016-ai-transaction-categorization.md), which amends ADR-0015 for this feature only)

Rules only categorize a merchant after the user has written one. When the server has an OpenAI key, troba also asks a model to **suggest** a category for the rows no rule matched. A suggestion is never a category: it does not count until the user accepts it.

- **Switch.** Off unless the server sets `OPENAI_API_KEY`. With no key there is no text, button, strip or disclosure about the feature anywhere, and nothing changes from M5 above. With a key, each user can turn it off for their own account (on by default); off means no row of theirs is read for it and the model is never reached.
- **Which rows are candidates.** A transaction of the user's that has no category, matched no rule, is not **Transfers**, is not a manual entry, and has no counterparty IBAN. A row with a counterparty IBAN is a **direct transfer**: its counterparty is usually a person and its description is free text (say, "rent for June"), so it is never sent, and its text is not even prepared for sending. (ADR-0016 also names rows an import profile marks as a transfer; a profile has no such mark today, so v1 decides by the counterparty IBAN alone.) Candidates stay uncategorized for rules and the manual path. A row already asked about is not a candidate again.
- **When it runs.**
  1. After an import is saved, for that import's candidate rows, once rules have run. The model call is made after the import's database transaction has committed, never inside it. The import waits for the model for at most 8 seconds so the result can say what happened; if it hasn't answered by then, the result says suggestions are still being prepared, the run carries on, and the preview and the result appear whether or not the model answers.
  2. On demand, through a "suggest categories" button on the transactions list, for all of the user's candidate rows, so rows imported before the feature existed, or while it was off, can use it. It reads candidates in pages, so a 10,000-row history is never loaded at once, and one run handles at most a fixed number of merchants.
  - If the model fails, times out, returns garbage, or the feature is off or capped, the rows stay untouched and unmarked and the import result is unchanged. The import result carries a one-line note saying suggestions were produced, are unavailable, or hit the daily limit; a capped or unavailable run says what is left to do (wait, or categorize by hand or by rule).
- **What is sent.** Rows are grouped by merchant: the counterparty compared case-insensitively, or the description when there is no counterparty. Each merchant is asked once, however many rows it has, with one representative description, plus the names of the user's categories as opaque references. Merchants go in batches of at most 50 per request, each request has a timeout, and there is no retry loop. Before sending, the text is masked: the user's own full name and each part of it of 3 or more letters, taken from the account profile and matched ignoring case and diacritics, wherever they appear; IBAN-shaped values; and digit runs of 7 or more with no separator. The request asks the provider not to store it.
- **Never sent.** Amounts, dates, account data, the raw row, the file, other users' data, manual entries, and anything from a direct transfer. This is a second, separate exception to the "no word of free text" rule of the AI mapping sample above; that sample keeps its stricter masking and its scrubber is not reused here.
- **Residual risk, shown to the user.** Masking works by pattern, and no pattern tells a person's name from a merchant's, so a name inside a card-terminal string (a market stall, a sole trader) can still reach the provider. A user who shares a name part with a common merchant word loses that word to the masking. The owner accepts this, and the upload step says so plainly.
- **Disclosure.** When the feature is on, the upload step tells the user, before they upload, what is sent and what is masked, and states the residual risk above.
- **The answer.** For each merchant the model gives the id of one of the user's own categories, or "none" when it cannot tell. Anything else (an unknown id, another user's id, a malformed answer) is discarded for that merchant, and `Transfers` is never suggested. A merchant answered "none", or discarded, is marked as asked and not sent again on later imports. A suggestion is stored on each candidate row of its merchant, and the row stays uncategorized.
- **In the list and the report.** An uncategorized row with a suggestion shows it as a chip, marked as a suggestion and apart from a category a person or rule set, with accept and dismiss (reachable by keyboard and announced to screen readers, and comfortable on a 360px phone). Next to it the row still offers "create rule from this", so a merchant the user trusts can become a rule; turning an accepted suggestion into a rule automatically is not part of v1. Suggested rows keep counting in the report's uncategorized row (M7) and in no category total until accepted. A strip above the list shows how many suggestions are waiting, with "accept all" (which asks for confirmation) and the "suggest categories" button, and one decision covers all of a merchant's rows: accepting or dismissing a suggestion applies to every uncategorized row of that merchant, and the strip counts merchants as well as rows. The list itself stays one row per transaction in v1; a list grouped by merchant is a later improvement.
- **Accept and dismiss.** Accepting sets the row's category from the suggestion, records the category source as manual so rules never overwrite it, and clears the suggestion. It applies to every uncategorized row of that merchant, or, for "accept all", to the selected set. Dismissing clears the suggestion and keeps the row marked as asked, so it is not sent again; an "ask again" action reconsiders dismissed rows, for after the user adds categories.
- **Suggestions never override.** A category set by hand is never replaced by a suggestion. Setting a category any other way (by hand, a rule, transfer detection, accepting) clears the suggestion, and so does deleting the suggested category (M4).
- **Daily cap.** Each user gets 200 merchants over a rolling 24 hours by default, counted in merchants, not requests, and separately from the AI mapping cap. `AI_CATEGORIZE_DAILY_LIMIT` overrides it; a value that is not a whole number from 1 up falls back to the default. The merchants of a batch are claimed just before its model call, under the same per-user lock as the mapping cap, so concurrent runs cannot slip under the limit.
- **Logging.** Nothing from the exchange is logged on any path: not the request, not the answer, not an error body. An error carries an HTTP status at most.
- **Isolation.** Every query for this feature filters by `user_id`: one user's rows are never read, sent or changed by another's run. Deleting an account deletes its suggestions and cap records with the rest of its data.

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
  import/upload.ts                       the upload check: size limit, then the statement file's kind from its content and declared type
  import/csv.ts                          decode, sniff delimiter, split rows
  import/spreadsheet.ts                  a workbook's first sheet → rows, typed cells normalized (SheetJS, ADR-0019)
  import/table.ts                        the reader for a file's kind: CSV or spreadsheet, as one table
  import/profile.ts                      profile schema (Zod), header matching, row → ParsedRow
  import/presets/                        built-in bank presets: one data file each, plus their registry (the only place a bank name may appear)
  import/resolve.ts                      format resolution: saved profile → preset (copied into the user's profiles) → unknown format
  import/ai-mapping.ts                   scrub the sample, ask the injected model client for a profile, validate it against the file
  import/import.ts                       preview + commit, dedup
  *.test.ts                              unit tests next to code
packages/core/test/fixtures/csv/         fictional "Example Bank" exports (made-up headers and data) in the two styles the profile tests read; each preset's own fixture sits beside it as import/presets/<id>.fixture.csv
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
| `money_transactions` | account_id, booked_on `date`, amount_cents `bigint` (negative = expense, account currency), currency, original_amount_cents null, original_currency null, counterparty, counterparty_iban null, description, bank_tx_type null, category_id null, category_source (`manual` \| `rule` \| `transfer` \| null), note, source (`manual` \| `csv_import`, which covers every statement file import), import_id null, dedup_key null, raw `jsonb` null |
| `money_categories` | name, excluded_from_spending `bool` |
| `money_rules` | field, pattern, category_id, position |
| `money_import_profiles` | name, kind (`text` \| `spreadsheet`, default `text`), header_fingerprint, skip_lines `int` default 0, delimiter null (auto), encoding, decimal_separator, date_format, columns `jsonb` (field → header), debit_values `text[]` null |
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
| Unit | Vitest | CSV decoding (BOM, `;`/`,`/tab, windows-125x), profile parsing against fictional fixtures in two styles (signed amounts; unsigned amounts + D/C indicator with decimal comma), edge cases (refunds, fees, foreign-currency purchase, identical rows, missing required column, multiple own IBANs), decimal string → cents, dedup key, header-fingerprint matching, own-IBAN transfer detection, rule matching order; AI mapping with a fake model client (the payload holds no IBAN, long digit run, free-text word or preamble line; bad, unreadable or failed answers are discarded; the daily cap and a missing key never call the client; own-name masking (case, diacritics, short name parts, a name inside a longer string) and answer validation as pure functions; the AI categorization client against a stubbed `fetch`: request shape, refusal and incomplete answers raise, errors never carry the body) |
| Integration | Vitest + real Postgres (Testcontainers or the CI Compose db) | import commit is atomic, re-import creates no duplicates, monthly totals to the cent, **user A can never read or modify user B's accounts, transactions, categories, rules or files**, format resolution (a saved profile beats a preset; a preset is copied only into the requesting user's profiles; every preset parses its own fictional fixture with no failed rows); AI-suggested categories with a fake model client: what the client was handed (no own-name part, IBAN, long digit run, direct-transfer row, manual entry, amount or date; one entry per merchant; the user's categories present), a stored suggestion leaves the row uncategorized and out of the report's category totals until accepted, accept, accept-all and dismiss, a hand-set category never replaced, a suggestion cleared when a category arrives another way or is deleted, an import that succeeds with the client failing, timing out, returning garbage or another user's category id, the daily cap in merchants (concurrent runs included), the opt-out and the no-key case, another user's rows never read, sent or changed, and user deletion removing the new rows |
| E2E | Playwright | Upload fictional fixture → map columns → save profile → preview → confirm → rule categorizes → monthly view shows correct totals; a fixture in a preset's shape goes straight to the preview; an unknown format with a fake model answer arrives prefilled and marked as a suggestion; import a fictional file with a fake model answer, see a suggestion on an uncategorized row, accept it and see the monthly view's totals change, while a transfer row in the file shows no suggestion; attach a receipt and view it; phone viewport smoke test (including the suggestion strip on the list) |

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
1. **Import format:** CSV only, through import profiles: the user's own, copies of built-in presets, or AI-suggested ones the user confirmed. Bank names appear only in the preset files and their registry (the presets folder), never elsewhere in code, tests, fixtures or docs ([ADR-0015](docs/adr/0015-import-presets-and-ai-mapping.md)); real exports and notes live in gitignored `.private/`. PDF statements are out of scope.
1a. **AI-suggested mapping (2026-11-06):** off unless the server sets `OPENAI_API_KEY`; a scrubbed sample of an unknown format may be sent to OpenAI, and each user gets 20 a day by default (`AI_MAPPING_DAILY_LIMIT` overrides it), and a proposal never takes effect without the user's save ([ADR-0015](docs/adr/0015-import-presets-and-ai-mapping.md)).
1b. **AI-suggested categories (2026-11-09):** off unless the server sets `OPENAI_API_KEY` (the same key as the mapping); the model comes from `OPENAI_MODEL` and must support structured output; the merchant text of card and merchant rows may be sent to OpenAI, with the user's own name, IBAN-shaped values and long digit runs masked and direct transfers never sent; each user gets 200 merchants a day by default (`AI_CATEGORIZE_DAILY_LIMIT` overrides it) and can opt out; and a suggestion never counts until the user accepts it ([ADR-0016](docs/adr/0016-ai-transaction-categorization.md)).
2. **No background worker in v1.** Imports run synchronously in the web request. `apps/worker` arrives with `receipts-ocr`.
3. **Deleted imported transactions come back on re-import.** No tombstones in v1.
4. **Currency:** reports use the account-currency amount the bank charged. The original currency is kept for display. Accounts in other currencies get separate totals, with no FX conversion.
5. **HEIC is stored as-is.**
6. **Capability map approved:** platform → identity → money.

## Open Questions

None. (Real-format check done 2026-10-11: findings in `.private/bank-format.md`, folded into M3 above. Repo fixtures are always fictional.)
