# Intent: Personal Hub (troba)

Status: confirmed 2026-10-10 (interview-me)

| | |
|---|---|
| **Outcome** | Self-hosted personal hub. First module is money tracking: bank CSV imports and manual entries, categories with auto-rules, receipt photo/PDF attachments, a monthly spending-by-category view. |
| **Users** | Owner on several computers and a phone (responsive web app / PWA). Multi-user from day one so a handful of friends (assumed under ~10) can test on staging later. |
| **Why** | See where money goes and how it is spent, and build a portfolio project that mirrors a real development cycle. |
| **Stack** | pnpm monorepo, TypeScript. Next.js (App Router) web app, separate Node worker (pg-boss, added with receipt OCR), Drizzle, PostgreSQL, Better Auth, Docker Compose on an owned VPS. Free/open-source tools only. Details: [stack options](../ideas/stack-options.md). |
| **CI/CD** | GitHub Actions. PR checks; merge to `main` auto-deploys to staging; a release tag deploys to production after approval. Images in GHCR; staging and prod are separate stacks on one VPS. |
| **Docs & tickets** | Public GitHub repo, Issues + Projects board, README + `docs/` + ADRs in `docs/adr/`, Conventional Commits with generated release notes. |
| **Success** | Owner imports bank statements weekly and can answer "where did my money go this month?" without a spreadsheet. |
| **Out of scope (v1)** | Receipt OCR, price comparison (milk/bread), automatic bank sync through an aggregator, voice capture (phone/watch), tasks, calendar, native mobile apps, storing friends' real bank data in production. |

**Gates before real financial data goes into production:** off-VPS backups of Postgres and receipt files, and TOTP 2FA. Both are out of v1 scope but required before relying on prod. Postgres RLS and data export follow after v1.

## Roadmap after v1 (rough order)

1. Receipt OCR, extracting line items
2. Per-product price comparison (milk, bread) and deeper category analysis
3. Automatic bank sync through a licensed aggregator
4. Voice capture from phone/watch, turned into an expense or a todo
5. Tasks and calendar integrations

## Workflow (addyosmani/agent-skills)

Superseded for new work by [ADR-0012](../adr/0012-matt-pocock-agent-workflow.md) (Matt Pocock's engineering skills). Kept as the record of how v1 was defined and planned.

Each phase, the skill that drives it, and the artifact it leaves in the repo:

| Phase | Skill(s) | Artifact |
|---|---|---|
| Define | `interview-me` ✓, `idea-refine` (optional) | this file |
| Specify | `spec-driven-development`: capability map first (money, identity, later voice/tasks), then one spec per module | `SPEC.md` (map), `SPEC-money.md`, `SPEC-identity.md` |
| Decide | `documentation-and-adrs`, `constraint-driven-development` | `docs/adr/0001-*.md`, `CONSTRAINTS.md` |
| Agent context | `context-engineering` | `AGENTS.md` (shared rules, names GitHub Issues as the task tracker) + `CLAUDE.md` containing `@AGENTS.md` |
| Plan | `planning-and-task-breakdown` | `tasks/plan.md`, tasks as GitHub Issues (external tracker) instead of `tasks/todo.md` |
| Build | `incremental-implementation`, `test-driven-development`, `source-driven-development`, `frontend-ui-engineering`, `api-and-interface-design` | PRs, one thin slice each |
| Review | `code-review-and-quality`, `security-and-hardening` (auth, file uploads, financial data) | PR reviews |
| Ship | `git-workflow-and-versioning`, `ci-cd-and-automation`, `shipping-and-launch` | `.github/workflows/`, tags, release notes |

Suggested first slices: repo + CI skeleton deploying "hello" to staging → auth → manual transactions → CSV import → categories/rules → receipts → monthly view.
