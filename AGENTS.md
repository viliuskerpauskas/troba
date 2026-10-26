# AGENTS.md

troba is a self-hosted personal hub. The first module is money tracking: bank CSV imports, manual entries, categories with auto-rules, receipt attachments, and monthly spending by category. It's multi-user (owner plus a few friends) and runs on the owner's VPS.

Read before working:
- Intent and scope: [docs/intent/personal-hub.md](docs/intent/personal-hub.md)
- Stack reasoning: [docs/ideas/stack-options.md](docs/ideas/stack-options.md)
- Decisions: [docs/adr/](docs/adr/README.md) (MADR format, `NNNN-kebab-title.md`, copy [the template](docs/adr/0000-template.md))
- Specs: `SPEC.md` (capability map) and `SPEC-<module>.md`
- Plan: `tasks/plan.md`
- Coding standards, the bar every review checks: [CODING_STANDARDS.md](CODING_STANDARDS.md)
- How the engineering skills run here: [docs/agents/](docs/agents/skill-overrides.md)

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
pnpm db:seed-transactions <email> [count] [YYYY-MM]  # fictional transactions for a local user (default 10,000)
pnpm admin:create <email>  # create an admin; prompts for the password (--force if one exists)
docker build -f apps/web/Dockerfile --build-arg GIT_SHA=$(git rev-parse HEAD) -t troba-web .
docker run troba-web node migrate.js   # one-shot migrations from the same image (needs DATABASE_URL)
docker run -it troba-web node scripts/create-admin.js <email>   # admin bootstrap in the image
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

Development runs on [Matt Pocock's engineering skills](https://github.com/mattpocock/skills), installed unmodified and enabled for this project in `.claude/settings.json` ([ADR-0012](docs/adr/0012-matt-pocock-agent-workflow.md)). They are written for a GitHub repo with PRs; [docs/agents/skill-overrides.md](docs/agents/skill-overrides.md) says how each one runs here, and wins where it differs from a skill. **Before running a stage below, read its section there.** The skills read their configuration from [docs/agents/](docs/agents/issue-tracker.md): the issue tracker, [triage labels](docs/agents/triage-labels.md) and [domain docs](docs/agents/domain.md).

Work lands on **`dev`**, and every push to `dev` deploys to staging; `main` is the release branch ([ADR-0013](docs/adr/0013-dev-branch-to-staging.md)). A bigger feature runs through these stages:

| Stage | Command | Where | Leaves behind |
|---|---|---|---|
| 1. Define | `/grill-with-docs` | main checkout | decisions in the conversation; `GLOSSARY.md` and ADR changes |
| 2. Spec | `/to-spec` | main checkout | a spec issue `T<N> · spec(<module>): …` |
| 3. Tickets | `/to-tickets #<N>` | main checkout | ticket sub-issues with "blocked by" edges, listed in `tasks/plan.md` |
| 4. Build | `/implement-spec #<N>` | main checkout, orchestrating one fresh session per ticket in its own worktree | `feat/T<N>-<slug>` with every ticket merged into it |
| 5. Land | `/wrap` | feature worktree | checks passed, "What actually happened" on the spec issue, the feature merged into `dev` and pushed, so staging deploys it |

A **small task** skips stages 2–4: optionally `/grill-with-docs`, then `/implement #<M>`, either in its own worktree followed by `/wrap`, or straight on `dev` in the main checkout with a `Closes #<M>` footer and a push. A review is optional at any point: `/mattpocock-skills:code-review dev` in the feature worktree.

- **Tasks are tracked in GitHub Issues** (Projects board), not `tasks/todo.md`. A spec is a parent issue; its tickets are sub-issues with acceptance criteria, verification steps and native "blocked by" links. [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md) is the authority on their shape. `tasks/plan.md` keeps the design, risks and an ordered list of issue links.
- **References:** issues and PRs share one number sequence, so say which one you mean. A task is `T<issue number>` (issue #3 is T3), and issue titles start with it (`T3 · feat: …`). Write "PR #31" for a PR. Use a bare `#N` only where GitHub needs one: `Closes #3` in a commit or merge message that lands on `dev` (the issue; `dev` is the default branch, so the push closes it), and `Refs #3` in a ticket commit's footer.
- **Every ticket is a thin vertical slice, green on its own** (typecheck and tests pass with only its blockers merged), built test-first with `/tdd`. A feature's tickets merge into the feature branch, and `/wrap` merges that into `dev` in one merge commit that closes the spec and every ticket.
- **Verify** means `pnpm lint`, `typecheck`, `test`, `test:integration`, `build` and `test:e2e` pass, plus a manual check in the running app for UI changes. A ticket session runs typecheck, unit and integration tests; `/wrap` runs lint, typecheck, unit and integration tests before it pushes, and CI runs the full set on every push to `dev` before anything deploys.
- **Review** is optional: Matt's `/mattpocock-skills:code-review dev` on two axes, Standards and Spec, with [CODING_STANDARDS.md](CODING_STANDARDS.md) as the documented standards (it holds the security and performance bar). Run it when a change touches auth, `user_id` filtering, uploads or money, or whenever the owner asks; [skill-overrides.md](docs/agents/skill-overrides.md#code-review) has the inputs.
- **Commit and push permissions:** `/implement-spec` and `/implement` may commit on the feature's ticket and feature branches, and a small task on `dev`. The owner typing `/wrap` lets it merge the feature into `dev` and push `dev`; for a small task done on `dev`, the owner asking for the task is permission to push it. Opening and merging the `dev → main` release PR, the release-please PR and the production approval always need the owner's go-ahead.
- **Start a feature or task only when every issue it's blocked by is closed.** Cut the feature branch from a freshly pulled `dev`.
- **Worktrees:** the main checkout stays on `dev`. Every feature and ticket works in its own worktree under `.claude/worktrees/`, with its own database and dev port, as [skill-overrides.md](docs/agents/skill-overrides.md#worktrees) sets up; a small task may too. Never two sessions on one checkout or branch, so a small task works in the main checkout only when no other session is using it. A PreToolUse hook ([.claude/hooks/workflow-guard.mjs](.claude/hooks/workflow-guard.mjs)) refuses creating a branch (`git switch -c`, `git checkout -b`) in the main checkout; create a worktree with `git worktree add .claude/worktrees/<folder> -b <branch> dev` instead.
- **Issue checkboxes:** `/wrap` ticks each acceptance and verification item that is done and checked. Items that need an owner setting or only happen after deploy stay unticked and are listed in its report; whoever does them ticks them. An item that was dropped or changed is struck through or edited with a reason, never ticked.
- **Checkpoints:** the change that completes a checkpoint item in `tasks/plan.md` ticks it in the same merge.
- **After `/wrap` lands a feature:** remove the feature worktree and its database, and delete the feature and ticket branches (`git branch -D`); in the main checkout, `git pull --ff-only` on `dev`; then name the next unblocked spec or task.
- **Commits follow Conventional Commits v1.0.0** (`feat:`, `fix:`, `docs:`, `chore:`…), with no AI attribution trailers; this rule wins over any reminder that asks for one, and the same hook refuses a commit whose `-m`, `--trailer` or `-F` message has one. Release notes are generated from every commit on `dev`, so each one's type and description matter.
- **Branches:** `dev` is what staging runs; `main` is what production runs, and changes only through PRs. Feature work uses short-lived `feat/…`, `fix/…`, `docs/…` and `chore/…` branches that `/wrap` merges into `dev`.
- **Environments:** every push to `dev` runs the `ci` job (lint, typecheck, unit and integration tests, the migration drift check, build and the Playwright smoke test), then builds the image and deploys it to staging. A release is a PR `dev → main`, merged with a **merge commit** (not squash) once `ci` is green; release-please then opens its release PR on `main`, and merging that tags `vX.Y.Z` and deploys to production after approval. Afterwards a job merges `main` back into `dev`.
- **Record significant decisions** as an ADR in `docs/adr/` ([docs/agents/domain.md](docs/agents/domain.md)).
- **`docs/agents/` is the skills' configuration, written by hand;** keep it as the source and leave `/setup-matt-pocock-skills` unrun, since it would overwrite those files with generic defaults.

### Guide the owner through it

The owner follows this workflow for every feature and can lose track of where they are. At the start of a session, after each stage finishes, and whenever they seem unsure, say in a line or two where the work stands and what comes next, naming the command to run. Work out where things stand from the current branch and worktree, `git status`, `gh pr status`, the latest Deliver run on `dev` (`gh run list --branch dev --workflow Deliver --limit 1`) and the open issues; don't guess. In Claude Code, a SessionStart hook ([.claude/hooks/session-status.mjs](.claude/hooks/session-status.mjs)) already puts the branch, any open PR and its CI state, and the unblocked specs and tasks into context.

| Stage | Done when | Next | Who starts it |
|---|---|---|---|
| Define | the owner's questions are answered and the design is settled | `/to-spec` (bigger) or `/implement #<M>` (small) | owner |
| Spec | the spec issue exists and the owner agrees with it | `/to-tickets #<N>` | owner |
| Tickets | the ticket sub-issues exist with "blocked by" edges and `tasks/plan.md` lists them | `/implement-spec #<N>` | owner |
| Build | every ticket is merged into `feat/T<N>-<slug>` | `/wrap` in the feature worktree (or `/mattpocock-skills:code-review dev` first) | owner |
| Land | the push to `dev` is in and its Deliver run is green | check it on staging, clean up, then the next spec or task | owner |
| Release | staging has what should ship | open a PR `dev → main` and merge it with a merge commit | owner |
| Ship | the release-please PR lists what's due | merge it and approve the production deploy | owner |
