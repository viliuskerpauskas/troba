# Coding standards

The documented standards `/code-review` checks every diff against (the Standards axis), alongside the rules in [AGENTS.md](AGENTS.md). Formatting and lint rules are enforced by `pnpm lint` and aren't repeated here.

**How to apply this file.** Read the whole diff, test files included, and apply every section the diff touches, in full. A breach of [Money](#money), [Ownership](#ownership), [Security](#security) or [Personal information](#personal-information) is **Critical**; a breach of the other sections is **Important** unless the finding says why it is smaller. Each finding names the rule it breaks, a `file:line` and a fix.

## Money

- Amounts are integer minor units (cents) in a `bigint` column with a currency column beside them. Floats, `numeric` and `Number` arithmetic on amounts are breaches; parse to minor units at the boundary (CSV, form) and format only at display time.
- Every sum, comparison and sort on amounts happens in one currency, or is explicitly grouped by currency.
- Parsing a bank amount is exact: decimal separators, thousands separators, signs and debit/credit columns are handled by tested code, and a value that doesn't parse is rejected with the row number, never rounded or guessed.

## Ownership

- Every user-owned table has `user_id ... not null references users on delete cascade`. The isolation helper (`packages/db/src/user-tables.ts`) then covers it in the delete-account and isolation tests.
- Every query on a user-owned table filters by the signed-in user's id, including updates, deletes and joins, and including lookups by a primary key the client sent. An id from the client is a candidate, never proof of ownership (IDOR).
- The `userId` comes from the session (`requireUser()`), never from the request body, query or form.

## Layering

- Domain logic lives in `packages/core` as plain functions that take a `db` and a `userId`. Server actions and route handlers authenticate, validate with Zod, call core and map the result; logic in them is a breach.
- `packages/core` imports nothing from Next.js or React.

## Security

**Authentication and authorization**
- Every page, server action and route handler that isn't public calls `requireUser()` or `requireAdmin()` first. A server action is a public endpoint: it checks its own auth even when its page does.
- Auth goes through Better Auth: no hand-rolled password hashing or session cookies. Link tokens come from `packages/core/src/identity/tokens.ts`: the database keeps only their hash and looks them up by it.
- Tokens in links (invites, resets) are single-use, time-limited, and checked again inside the transaction that consumes them.
- Sign-in and password checks stay behind the rate limiter.

**Input**
- Every boundary validates with Zod: form data, API bodies, query parameters, route params, imported files and uploads. Schemas use allowlists, bound string lengths and numeric ranges.
- SQL goes through Drizzle or parameterised queries; identifiers built from data go through `pg.escapeIdentifier`.
- Redirect targets are relative paths or allowlisted; a redirect to a URL taken from input is open redirect.
- No server-side fetch of a URL that came from input.

**Uploads**
- A size limit, a MIME allowlist checked against the content (magic bytes), not just the declared type or extension.
- Stored under `UPLOADS_DIR/<userId>/` with a server-generated name; the client's filename is metadata only. Paths are resolved and checked to stay inside the user's folder.
- Served only to the owner, through a handler that checks ownership, with `Content-Disposition` and `X-Content-Type-Options: nosniff`.

**Responses and headers**
- Responses and logs never carry password hashes, tokens, reset links, session ids or another user's data. Errors shown to users are generic; details go to the server log.
- Changed pages keep the headers set in `apps/web/next.config.ts` (currently `frame-ancestors 'none'`); once T43 lands, the script CSP and HSTS too. A review of changed pages checks them on the running app with `curl -sI`.

**Secrets and dependencies**
- No secrets in the diff; `.env.example` holds only local-development placeholders.
- A new dependency needs a reason in the PR (and an ADR when notable), exact version, and `pnpm audit` clean or each finding triaged with a reason. A dependency's build script runs only when it is approved in `pnpm-workspace.yaml` (`onlyBuiltDependencies`); one that doesn't need it goes under `ignoredBuiltDependencies`.

## Performance

- No N+1 queries: a list loads its related rows in one query (join or `inArray`), not one query per row.
- Lists of user data (transactions, imports, rules) are paginated or bounded with `limit`; an unbounded `select` on a table that grows with use is a breach.
- A new query filtering or sorting a growing table has an index that matches its shape (equality columns first, then the range or sort), starting with `user_id`. Say in the review which index serves it; when unsure, check with `EXPLAIN` on realistic data.
- Bulk work (an import) inserts in batches inside one transaction, not row by row; dedup uses the unique key, not a read-then-write per row.
- One database pool per process (`packages/db/src/client.ts`); no clients created per request.
- Heavy or slow work (OCR, bank sync) goes to the worker, not a request handler.
- Pages render on the server by default; a client component needs a reason (interaction). Charts and other heavy client code load only on the pages that use them.

## Migrations

- Generated with `pnpm db:generate` from `packages/db/src/schema.ts`, never hand-edited after they're merged. Forward-only: they run automatically on deploy.
- A destructive change (drop, rename, type change, new `not null` without a default) is split expand–contract across releases, or the spec's blast radius says why it is safe now.

## Tests

- Logic is built test-first. Tests check behaviour through public interfaces (core functions, route handlers, pages), not internals.
- Anything touching the database has an integration test (`*.int.test.ts`) on real Postgres via `createTestDatabase`; no mocked database.
- Ownership rules have a two-user test: user B can't read, change or delete user A's rows.
- Every acceptance criterion maps to a test or to a written manual check. A user-visible flow gets a Playwright test.
- A test that would stay green with the behaviour removed is a finding: say so, ideally with the mutation that proves it.

## Personal information

The repo, issues and PRs are public. Code, tests, fixtures, commit messages and issue text contain no real bank names, countries, cities, merchants, IBANs, names or exports. Use fictional data ("Example Bank", "GROCERY MART", IBANs from the published test ranges). Real-format samples stay in `.private/`.

## Comments and names

- Comments say why, not what, and sit where the reason applies.
- Names use the vocabulary of the specs and `GLOSSARY.md`.
