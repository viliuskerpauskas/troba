# AGENTS.md

troba is a self-hosted personal hub. The first module is money tracking: bank CSV imports, manual entries, categories with auto-rules, receipt attachments, and monthly spending by category. It's multi-user (owner plus a few friends) and runs on the owner's VPS.

Read before working:
- Intent and scope: [docs/intent/personal-hub.md](docs/intent/personal-hub.md)
- Stack reasoning: [docs/ideas/stack-options.md](docs/ideas/stack-options.md)
- Decisions: `docs/adr/` (MADR format, `NNNN-kebab-title.md`)
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
pnpm dev          # next dev on http://localhost:3000
pnpm lint         # eslint . && prettier --check . (Markdown is not Prettier-formatted)
pnpm format       # prettier --write .
pnpm typecheck    # tsc -b
pnpm test         # vitest run
pnpm build        # next build (standalone)
```

Planned: `pnpm test:e2e`, `pnpm db:up`, `pnpm db:generate`, `pnpm db:migrate` (see SPEC-platform.md).

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

- **Tasks are tracked in GitHub Issues** (Projects board), not `tasks/todo.md`. One issue per task, with acceptance criteria and verification steps in the body and dependencies as "blocked by #N". `tasks/plan.md` keeps the design, risks and an ordered list of issue links.
- **Build in thin vertical slices**, one PR each, test-first for logic.
- **Commits follow Conventional Commits v1.0.0** (`feat:`, `fix:`, `docs:`, `chore:`…). Release notes are generated from them.
- **Branches:** `main` is always deployable. Use short-lived `feat/…` and `fix/…` branches merged by PR, with CI green.
- **Environments:** PR checks run lint, typecheck, test and build. Merging to `main` auto-deploys to staging. A `vX.Y.Z` tag deploys to production after approval.
- **Record significant decisions** as an ADR in `docs/adr/`.
