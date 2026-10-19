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

Development runs on [Matt Pocock's engineering skills](https://github.com/mattpocock/skills), installed unmodified and enabled for this project in `.claude/settings.json` ([ADR-0012](docs/adr/0012-matt-pocock-agent-workflow.md)). They are written for a GitHub repo with PRs; [docs/agents/skill-overrides.md](docs/agents/skill-overrides.md) says how each one runs here, and wins where it differs from a skill. **Before running `/implement-spec`, `/implement`, `/code-review` or `/wrap`, read its section there.**

One feature runs through six stages:

| Stage | Command | Where | Leaves behind |
|---|---|---|---|
| 1. Define | `/grill-with-docs` | main checkout | decisions in the conversation; `GLOSSARY.md` and ADR changes |
| 2. Spec | `/to-spec` | main checkout | a spec issue `T<N> · spec(<module>): …` |
| 3. Tickets | `/to-tickets #<N>` | main checkout | ticket sub-issues with "blocked by" edges, listed in `tasks/plan.md` |
| 4. Build | `/implement-spec #<N>` | main checkout, orchestrating one fresh session per ticket in its own worktree | `feat/T<N>-<slug>` with every ticket merged into it |
| 5. Review | `/code-review main` (optional here; `/wrap` runs it otherwise) | feature worktree, fresh session | `.reviews/<branch>.md`, fixes on the feature branch |
| 6. Close out | `/wrap` | feature worktree | Verify passed, "What actually happened" on the spec issue, the PR |

A **standalone task** (an issue with no spec parent, including every issue from before this workflow) skips stages 2–4: `/implement #<M>` in its own worktree, then `/wrap`.

- **Tasks are tracked in GitHub Issues** (Projects board), not `tasks/todo.md`. A spec is a parent issue; its tickets are sub-issues with acceptance criteria, verification steps and native "blocked by" links. [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md) is the authority on their shape. `tasks/plan.md` keeps the design, risks and an ordered list of issue links.
- **References:** issues and PRs share one number sequence, so say which one you mean. A task is `T<issue number>` (issue #3 is T3), and issue titles start with it (`T3 · feat: …`). Write "PR #31" for a PR. Use a bare `#N` only where GitHub needs one: `Closes #3` in the PR body (the issue), `Refs #3` in a commit footer, and the `(#31)` that squash merges add to the commit title (the PR). PR titles stay plain Conventional Commits, without the T-id.
- **Every ticket is a thin vertical slice, green on its own,** built test-first with `/tdd`. A feature is one PR: its tickets merge into the feature branch, and the PR closes the spec and every ticket.
- **Verify** means `pnpm lint`, `typecheck`, `test`, `test:integration`, `build` and `test:e2e` pass, plus a manual check in the running app for UI changes. A ticket session runs typecheck, unit and integration tests; the full Verify runs once on the feature branch, at `/wrap`.
- **Review** is Matt's `/code-review` on two axes, Standards and Spec, with [CODING_STANDARDS.md](CODING_STANDARDS.md) as the documented standards (it holds the security and performance bar), plus `pnpm audit`, response headers and a personal-information check. The review goes in `.reviews/<branch>.md`; Critical and Important findings are fixed in at most two fix rounds before the owner is asked. The procedure is in [skill-overrides.md](docs/agents/skill-overrides.md#code-review). A PreToolUse hook ([.claude/hooks/review-gate.mjs](.claude/hooks/review-gate.mjs)) refuses `gh pr create` until the review file is complete and names HEAD, and the spec issue has its "What actually happened" section.
- **Commit and push permissions:** `/implement-spec` and `/implement` may commit on the feature's ticket and feature branches. `/wrap` pushes the feature branch and opens the PR without asking. Merging and release tags always need the owner's go-ahead.
- **Start a feature or task only when every issue it's blocked by is closed** (normally by its merged PR). Cut the feature branch from a freshly pulled `main`; don't stack a PR on another unmerged branch.
- **Worktrees:** the main checkout stays on `main`. Every feature, ticket and standalone task works in its own worktree under `.claude/worktrees/`, with its own database and dev port, as [skill-overrides.md](docs/agents/skill-overrides.md#worktrees) sets up. Never two sessions on one checkout or branch.
- **An open PR only takes fixes for its review and CI findings,** and those go through fix rounds too. Anything else found on the way becomes a new issue, or a separate small PR for docs and workflow changes.
- **Issue checkboxes:** `/wrap` ticks each acceptance and verification item that is done and checked, and the PR body says how each was verified. Items that need an owner setting or only happen after merge stay unticked and are listed in the PR under "Owner / after merge"; whoever does them ticks them. An item that was dropped or changed is struck through or edited with a reason, never ticked.
- **Checkpoints:** the PR that completes a checkpoint item in `tasks/plan.md` ticks it in the same PR.
- **After the owner merges:** in the main checkout, switch to `main` and pull; remove the feature worktree and its database; delete the feature and ticket branches locally with `git branch -D` (squash merges aren't detected by `-d`) and on the remote if they're still there; then name the next unblocked spec or task.
- **Commits follow Conventional Commits v1.0.0** (`feat:`, `fix:`, `docs:`, `chore:`…), with no AI attribution trailers. Release notes are generated from the squashed PR titles.
- **Branches:** `main` is always deployable. Use short-lived `feat/…`, `fix/…`, `docs/…` and `chore/…` branches merged by PR, with CI green.
- **Environments:** PR checks (the `ci` job) run lint, typecheck, unit and integration tests, the migration drift check, build and the Playwright smoke test, and must pass to merge. Merging to `main` auto-deploys to staging. Merging release-please's release PR tags `vX.Y.Z`, which deploys to production after approval.
- **Record significant decisions** as an ADR in `docs/adr/` ([docs/agents/domain.md](docs/agents/domain.md)).
- **Don't run `/setup-matt-pocock-skills`.** `docs/agents/` is its output, written by hand for troba; the skill would replace it with generic defaults.

### Guide the owner through it

The owner follows this workflow for every feature and can lose track of where they are. At the start of a session, after each stage finishes, and whenever they seem unsure, say in a line or two where the work stands and what comes next, naming the command to run. Work out where things stand from the current branch and worktree, `git status`, `gh pr status`, the PR's CI checks and the open issues; don't guess. In Claude Code, a SessionStart hook ([.claude/hooks/session-status.mjs](.claude/hooks/session-status.mjs)) already puts the branch, PR, CI state and the unblocked specs and tasks into context.

| Stage | Done when | Next | Who starts it |
|---|---|---|---|
| Define | the owner's questions are answered and the design is settled | `/to-spec` | owner |
| Spec | the spec issue exists and the owner agrees with it | `/to-tickets #<N>` | owner |
| Tickets | the ticket sub-issues exist with "blocked by" edges and `tasks/plan.md` lists them | `/implement-spec #<N>` | owner |
| Build | every ticket is merged into `feat/T<N>-<slug>` | `/wrap` in the feature worktree (or `/code-review main` first, in a fresh session) | owner |
| Review | `.reviews/<branch>.md` names HEAD and no Critical or Important findings remain, or the owner accepted them | Verify and the PR, inside `/wrap` | agent, inside `/wrap` |
| PR | CI is green | merge | owner |
| Merge | `main` deploys to staging | clean-up, then the next spec or task | owner |
| Ship | the release-please PR lists what's due | merge it and approve the production deploy | owner |
