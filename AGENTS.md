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

Development follows [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills): define, specify, plan, build, review, ship.

- **Tasks are tracked in GitHub Issues** (Projects board), not `tasks/todo.md`. One issue per task, with acceptance criteria and verification steps in the body and dependencies as native "blocked by" links. `tasks/plan.md` keeps the design, risks and an ordered list of issue links.
- **References:** issues and PRs share one number sequence, so say which one you mean. A task is `T<issue number>` (issue #3 is T3), and issue titles start with it (`T3 · feat: …`). Write "PR #31" for a PR. Use a bare `#N` only where GitHub needs one: `Closes #3` in the PR body (the issue) and the `(#31)` that squash merges add to the commit title (the PR). PR titles stay plain Conventional Commits, without the T-id.
- **Build in thin vertical slices**, one PR each, test-first for logic.
- **Slice loop:** build → verify → review → PR → merge. Verify means `pnpm lint`, `typecheck`, `test`, `build` and `test:e2e` pass, plus a manual check in the running app for UI changes.
- **Review:** as soon as Verify passes, without waiting to be asked, review the branch's local commits in these steps:
  1. Run `/agent-skills:review`, the five-axis review from the `code-review-and-quality` skill, and follow it fully: read the whole diff file by file (never a truncated one) and write its structured output, each finding with a severity, `file:line` and a fix.
  2. Load `security-and-hardening` and `performance-optimization` with the Skill tool as well, and work through their checklists against the diff. The review command only names these skills; it doesn't load them, so this step is easy to skip by accident. The checklists are separate files the skills link (`references/security-checklist.md` and `references/performance-checklist.md` in the agent-skills plugin); read them. For security that includes `pnpm audit` when dependencies change and checking response headers when pages change.
  3. Check the diff and the commit messages for personal information.
  4. Get a fresh-context review: spawn the `agent-skills:code-reviewer` subagent with the issue, the spec section and the branch name, none of the session's working context, and ask for the same structured output. It reviews alongside steps 1–3, never instead of them. Triage its findings like your own.

  Write the review to `.reviews/<branch>.md` (gitignored; `/` in the branch name becomes `-`), with one section per step: `## code-review-and-quality`, `## security-and-hardening`, `## performance-optimization`, `## Personal information`, `## Fresh-context review`, and a `Reviewed commit: <full HEAD sha>` line. Findings that belong to another task become issues.

  Fix Critical and Important findings in fix rounds, so the review can't loop (the review skill's Required counts as Important, Optional as Suggestion):
  - A fix round re-runs Verify, then reviews only what changed since the sha on the `Reviewed commit:` line (`git diff <sha>..HEAD`; after a rebase, `git range-diff`): the five-axis review, the personal-information check of that diff and its commit messages, and the security and performance checklist items the fix touches. A fix to auth, `user_id` filtering, uploads or money gets the full security checklist. Re-run the fresh-context review when a fix changes the design, a schema or a public interface.
  - After each round, set `Reviewed commit:` to the HEAD it reviewed and add a line to the review file: `Round N: <old sha>..<new sha>: what was checked, what was found`. The sha only ever moves to a commit whose diff was reviewed.
  - Fixes for Suggestions and Nits don't count as a fix round, but they're still reviewed: fold them into the current round, or give their diff the same pass and record it as a round line. A fix that changes behaviour beyond its finding counts as a fix round.
  - The review is done when a fix round finds no new Critical or Important finding.
  - If the second fix round still finds a new Critical or Important finding, don't start a third: fixes that keep producing findings usually point at a design problem. Leave those findings unfixed, don't push or open the PR, list them in the review file and in chat, and ask the owner. If the owner accepts them, record that in the review file and open the PR; otherwise follow their direction.
  - Fixes pushed to an open PR for review or CI findings go through fix rounds too, although the hook only checks when the PR is opened.

  Once no Critical or Important findings are left, push and open the PR without asking. A PreToolUse hook ([.claude/hooks/review-gate.mjs](.claude/hooks/review-gate.mjs)) refuses `gh pr create` until that file has every section and names the current HEAD. Post the file as the PR's first comment (`gh pr comment --body-file`), and give the PR body a **Review** section summarising what each step found, even if that's "nothing", so the owner can see the whole review ran. Merging and release tags always need the owner's go-ahead.
- **Start a task only when every issue it's blocked by is closed** (normally by its merged PR). Branch from a freshly pulled `main`; don't stack a PR on another unmerged branch.
- **One task per session.** Sessions that run at the same time each work in their own worktree, never two on one checkout or branch.
- **An open PR only takes fixes for its review and CI findings.** Anything else found on the way becomes a new issue, or a separate small PR for docs and workflow changes.
- **Issue checkboxes:** just before opening the PR, tick each acceptance and verification item in the issue that is done and checked, and say in the PR body how each was verified. Items that need an owner setting or only happen after merge stay unticked and are listed in the PR under "Owner / after merge"; whoever does them ticks them. An item that was dropped or changed is struck through or edited with a reason, never ticked.
- **Checkpoints:** the PR that completes a checkpoint item in `tasks/plan.md` ticks it in the same PR.
- **After the owner merges:** switch to `main`, pull, remove the task's worktree, delete the merged branch locally with `git branch -D` (squash merges aren't detected by `-d`) and on the remote if it's still there, then name the next unblocked issue.
- **Commits follow Conventional Commits v1.0.0** (`feat:`, `fix:`, `docs:`, `chore:`…). Release notes are generated from them.
- **Branches:** `main` is always deployable. Use short-lived `feat/…`, `fix/…`, `docs/…` and `chore/…` branches merged by PR, with CI green.
- **Environments:** PR checks (the `ci` job) run lint, typecheck, unit and integration tests, the migration drift check, build and the Playwright smoke test, and must pass to merge. Merging to `main` auto-deploys to staging. A `vX.Y.Z` tag deploys to production after approval.
- **Record significant decisions** as an ADR in `docs/adr/`.

### Guide the owner through it

The owner follows this workflow for every feature and can lose track of where they are. At the start of a session, after each step finishes, and whenever they seem unsure, say in a line or two where the work stands and what comes next, naming the command to run. Work out where things stand from the current branch, `git status`, `gh pr status`, the PR's CI checks and the open issues; don't guess. In Claude Code, a SessionStart hook ([.claude/hooks/session-status.mjs](.claude/hooks/session-status.mjs)) already puts the branch, PR, CI state and unblocked issues into context.

| Phase | Done when | Next | Who starts it |
|---|---|---|---|
| Spec | `SPEC-<module>.md` is agreed | `/agent-skills:plan` | owner |
| Plan | issues exist with acceptance criteria and "blocked by" links, `tasks/plan.md` lists them | `/agent-skills:build` on the next unblocked issue | owner |
| Build | the task's tests pass and the work is committed on a `feat/…` or `fix/…` branch | Verify | agent |
| Verify | the checks in the slice loop pass | Review | agent, automatically |
| Review | all four review steps ran, `.reviews/<branch>.md` names the HEAD commit, and no Critical or Important findings remain | push and open the PR | agent, automatically |
| PR | CI is green | merge | owner |
| Merge | `main` deploys to staging | next issue, or Ship when a release is due | owner |
| Ship | `/agent-skills:ship` says go | tag `vX.Y.Z` and approve the production deploy | owner |
