# AGENTS.md

troba is a self-hosted personal hub. The first module is money tracking: bank CSV imports, manual entries, categories with auto-rules, receipt attachments, and monthly spending by category. It's multi-user (owner plus a few friends) and runs on the owner's VPS.

Read before working:
- Intent and scope: [docs/intent/personal-hub.md](docs/intent/personal-hub.md)
- Stack reasoning: [docs/ideas/stack-options.md](docs/ideas/stack-options.md)
- Decisions: [docs/adr/](docs/adr/README.md) (MADR format, `NNNN-kebab-title.md`, copy [the template](docs/adr/0000-template.md))
- Specs: `SPEC.md` (capability map) and `SPEC-<module>.md`
- Plan: `tasks/plan.md`

## Stack

TypeScript, pnpm workspaces, Next.js (App Router), a Node worker with pg-boss, Drizzle, PostgreSQL, Better Auth, Tailwind with shadcn/ui on Base UI, Recharts, Zod, Vitest, Playwright, Docker Compose, Caddy, GitHub Actions, GHCR.

Use only free/open-source tools or generous free tiers. Don't add a dependency without a reason, and record notable ones as an ADR.

## Layout

```
apps/web       Next.js App Router (standalone output): UI, server actions, /api/v1 route handlers
packages/core  domain logic: plain functions that take a db, no framework imports
packages/db    Drizzle schema + migrations, shared by web and (later) worker
```

Planned: `apps/worker` (pg-boss jobs: OCR, bank sync, voice), added with receipts-ocr; v1 imports run in web.

Workspace packages export TypeScript source (`exports: ./src/index.ts`); `apps/web` lists them in `transpilePackages`. `tsc -b` type-checks everything through project references from the root `tsconfig.json`. Node is pinned in `.nvmrc`, pnpm in `packageManager`, and dependencies use exact versions (`.npmrc` `save-exact`).

## Commands

```
pnpm install
pnpm dev               # db:up, db:migrate, then next dev on http://localhost:3000
pnpm lint              # eslint . && prettier --check . (Markdown is not Prettier-formatted)
pnpm format            # prettier --write .
pnpm typecheck         # next typegen (route types) && tsc -b
pnpm test              # unit tests (vitest project "unit")
pnpm test:integration  # *.int.test.ts against Postgres (needs db:up)
pnpm build             # next build (standalone)
pnpm test:e2e          # Playwright against the built app (needs build and db:up)
pnpm db:up             # Postgres in Docker on 127.0.0.1:55432
pnpm db:generate       # drizzle-kit migration from packages/db/src/schema.ts
pnpm db:migrate        # apply pending migrations
```

Env files live at the repo root. Real env vars win over `.env`; outside production, `.env.example` fills in the local defaults, so a fresh clone runs without copying it.

## Rules

- **Money is integer minor units (cents) in a `bigint` column, plus a currency column.** Never use floats or `numeric` for amounts. Format only at display time.
- **Domain logic lives in `packages/core`.** Server actions, route handlers and worker jobs are thin callers, so phone/watch clients can use the same logic later through `/api/v1`.
- **Every user-owned row carries `user_id`, and every query filters by it.** One user must never see another's data.
- **Validate at boundaries with Zod:** form input, API bodies, imported bank files, uploads. Uploads also need a size limit, a MIME allowlist, and must be served only to their owner.
- **Never commit secrets.** They go in GitHub Secrets / `.env` (gitignored). The repo is public.
- **Zero personal information in the repo, issues, commits or PRs:** no bank names, countries, cities, real merchants, IBANs or real exports. Use fictional data ("Example Bank", "GROCERY MART"). Personal notes and real-format fixtures live only in gitignored `.private/`.
- **Migrations are forward-only** and run automatically on deploy.

## Workflow

Development follows [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills): define, specify, plan, build, review, ship.

- **Tasks are tracked in GitHub Issues** (Projects board), not `tasks/todo.md`. One issue per task, with acceptance criteria and verification steps in the body and dependencies as native "blocked by" links. `tasks/plan.md` keeps the design, risks and an ordered list of issue links.
- **References:** issues and PRs share one number sequence, so say which one you mean. A task is `T<issue number>` (issue #3 is T3), and issue titles start with it (`T3 · feat: …`). Write "PR #31" for a PR. Use a bare `#N` only where GitHub needs one: `Closes #3` in the PR body (the issue) and the `(#31)` that squash merges add to the commit title (the PR). PR titles stay plain Conventional Commits, without the T-id.
- **Build in thin vertical slices**, one PR each, test-first for logic.
- **Commits follow Conventional Commits v1.0.0** (`feat:`, `fix:`, `docs:`, `chore:`…). Release notes are generated from them.
- **Branches:** `main` is always deployable. Use short-lived `feat/…` and `fix/…` branches merged by PR, with CI green.
- **Environments:** PR checks (the `ci` job) run lint, typecheck, unit and integration tests, the migration drift check, build and the Playwright smoke test, and must pass to merge. Merging to `main` auto-deploys to staging. A `vX.Y.Z` tag deploys to production after approval.
- **Record significant decisions** as an ADR in `docs/adr/`.
