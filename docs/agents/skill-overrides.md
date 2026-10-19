# Skill overrides

Matt Pocock's engineering skills run **unmodified**, installed from upstream. They are written for one GitHub repo with PRs, which troba is, so most of their steps apply as written. This file covers the places where troba differs: worktrees and databases for parallel tickets, one PR per feature, the review file the PR gate checks, and `/wrap`. **Where a skill's step and this file differ, this file wins.** Before running a skill below, read its section here in full.

Covered: [names](#names) · [worktrees](#worktrees) · [`/grill-with-docs`](#grill-with-docs) · [`/to-spec`](#to-spec) · [`/to-tickets`](#to-tickets) · [`/implement-spec`](#implement-spec) · [`/implement`](#implement) · [`/tdd`](#tdd) · [`/code-review`](#code-review) · [`/wrap`](#wrap) · [`/pr`](#pr) · [not run here](#not-run-here)

## Names

`<N>` is the spec issue's number and `<slug>` a short kebab-case name for the feature; `<M>` is a ticket's issue number.

| Name | What it is |
|---|---|
| **feature branch** | `feat/T<N>-<slug>`, cut from a freshly pulled `main`. Tickets merge into it, and it becomes the feature's one PR. Use `fix/`, `chore/` or `docs/` when that is the work's type. |
| **feature worktree** | `.claude/worktrees/t<N>-<slug>`, holding the feature branch. Review, fixes and `/wrap` run here. |
| **ticket branch** | `feat/T<N>-T<M>-<slug>`, cut from the feature branch once the ticket's blockers have merged into it. |
| **ticket worktree** | `.claude/worktrees/t<N>-t<M>`, holding the ticket branch. |
| **main checkout** | The repo folder itself. Stays on `main`, with whatever the owner has in it; feature work happens in worktrees. |

A **standalone task** (an issue with no spec parent, including every issue from before this workflow) has a feature branch and worktree named after its own number, `feat/T<M>-<slug>`, and no ticket branches: `/implement` runs straight in the feature worktree.

## Worktrees

Parallel tickets share one machine and one Postgres container, so each worktree gets its own database, port and install. Integration tests already create a fresh database per run (`createTestDatabase`), but the dev server and E2E use `DATABASE_URL` directly: on a shared database, one ticket's migration lands under another ticket's code, and drizzle's migration journal stops matching either branch.

**Create** (from the main checkout):

```bash
git worktree add .claude/worktrees/t<N>-t<M> -b feat/T<N>-T<M>-<slug> feat/T<N>-<slug>
pnpm db:up
docker compose exec -T postgres createdb -U troba troba_t<M>
```

Then, in the worktree, write its own `.env` (gitignored; it wins over `.env.example`):

```
COMPOSE_PROJECT_NAME=troba
DATABASE_URL=postgres://troba:troba@localhost:55432/troba_t<M>
BETTER_AUTH_URL=http://localhost:<port>
```

and run `pnpm install --frozen-lockfile` and `pnpm db:migrate` there. `COMPOSE_PROJECT_NAME` matters: Compose names a project after its folder, so without it `pnpm db:up` in a worktree starts a second Postgres container that fails on the taken port 55432. `<port>` is `3000 + 10 × (the ticket's position in the spec)`, e.g. 3020 for the second ticket; start the dev server with `pnpm db:migrate && pnpm --filter @troba/web dev --port <port>`. A feature worktree uses the database `troba_t<N>` and port 3000 when the main checkout isn't running a dev server.

**E2E runs in one worktree at a time.** `apps/web/playwright.config.ts` serves the built app on the fixed port 3100, so `pnpm test:e2e` runs only in the feature worktree, at `/wrap`.

**Remove** (from the main checkout), in this order:

```bash
docker compose exec -T postgres dropdb -U troba --if-exists troba_t<M>
git worktree remove .claude/worktrees/t<N>-t<M>
```

Ticket branches stay until the feature's PR is merged; after the merge, the clean-up in [AGENTS.md](../../AGENTS.md) deletes them with the feature branch.

## /grill-with-docs

Stage 1, from the main checkout. As written. Its `/domain-modeling` half writes `GLOSSARY.md` and ADRs in the format in [domain.md](domain.md). A grill that creates or changes those files has produced a `docs/` change: it lands with the feature's PR, so leave it uncommitted in the main checkout and carry it into the feature worktree at `/implement-spec`, or commit it on its own `docs/` branch if the owner asks.

## /to-spec

Stage 2. As written, with:

- **Publish** creates the spec issue described in [issue-tracker.md](issue-tracker.md): label `spec` and the module label, title `T<N> · spec(<module>): …`.
- **Add a section `## Blast radius`** after Implementation Decisions: which modules and tables it touches, whether a migration is needed and whether it is reversible, whether it touches auth, `user_id` filtering, uploads or money (then label the spec `security`), and whether a `/api/v1` shape changes.
- **Add a section `## Open questions`** at the end. An empty list usually means the spec is guessing.
- Fictional data only: the issue is public.

## /to-tickets

Stage 3. As written, with:

- Publish to GitHub as in [issue-tracker.md](issue-tracker.md): sub-issues of the spec, native "blocked by" edges, the troba ticket body (with its `## Verification` section), titles `T<M> · …`, the project board, and an entry in [tasks/plan.md](../../tasks/plan.md).
- Each ticket must be green on its own: typecheck and tests pass with only its blockers merged. Slice migrations so each ticket carries the migration its own code needs.
- Don't edit the spec issue's body.

## /implement-spec

Stage 4. Run it once per feature, **from the main checkout**, with the spec issue: `/implement-spec #<N>`. The session is the orchestrator: it plans, starts and merges, and writes no ticket code itself.

**Resuming.** A rerun is the normal way to continue a feature. Before the first wave, check git for every ticket: a ticket branch already merged into the feature branch is done; an unmerged one with commits gets merged first; a live worktree with no running session gets a question to the owner (resume on its branch, or restart). Reuse an existing feature branch and worktree. Show the result as a table (ticket, what git shows, what happens next) and wait for a go-ahead.

Its steps, translated:

1. **Read the spec and tickets.** The task graph is the native "blocked by" edges; the frontier is every open ticket whose blockers have merged into the feature branch.
2. **Exploration subagent**: as written. Its notes go to `.scratch/T<N>-<slug>/research/` in the main checkout (gitignored), so every worktree can read them by absolute path.
3. **"Create the integration branch"**: `git pull --ff-only` on `main`, then create the feature branch and the [feature worktree](#worktrees). Bring in any uncommitted `GLOSSARY.md` or ADR change from stage 1 as the feature's first commit (`docs: …`). The draft PR is **not** opened here; `/wrap` opens the PR.
4. **"Implementer subagents, each in its own worktree"**: for each frontier ticket, create its [ticket worktree](#worktrees) by command (the names matter, so not the Agent tool's own worktree isolation), then start the implementer as a **fresh session**, not a subagent: `start_session` with `context: "fresh"`, `cwd` = the ticket worktree, `use_worktree: false`. The brief is pointers, not content: the ticket number, the spec number, the worktree's port and database, the research folder, and the line *"run /implement on this one ticket; follow the /implement section of docs/agents/skill-overrides.md"*. Where sessions aren't available, a background subagent with the same brief does the job.
5. **"Merge its work with a merger subagent"**: when an implementer reports done, a merger subagent merges the ticket branch into the feature branch in the feature worktree (`git merge --no-ff feat/T<N>-T<M>-<slug>`). It resolves a conflict there, then runs `pnpm typecheck`, `pnpm test` and the integration tests the ticket touched. Then [remove](#worktrees) the ticket worktree.
6. **"Kick off more implementers"**: as written. The frontier advances in waves; when the owner says one ticket is done, merge it and start what it unblocks without waiting for the wave.
7. **"Call code-review on the integration branch"**: **skip**. The review runs at `/wrap`, or earlier in a fresh session with `/code-review main` in the feature worktree; see [/code-review](#code-review).
8. **"Mark the PR ready / resolve each ticket"**: **stop and report**: the feature branch and its head sha, each ticket's state, and the next step, *"/wrap in the feature worktree"*. Tickets close when the PR merges.
9. **"Clean up all worktrees"**: every ticket worktree and its database. Keep the feature worktree.

**Invoking `/implement-spec` is permission to commit on the feature's ticket and feature branches.** Pushing, opening the PR and anything on `main` belong to `/wrap` and the owner.

## /implement

When the brief names one ticket and this file, `/implement` runs in its ticket worktree as written, with these changes:

- **Scope is the one ticket.** The spec is context; other tickets are other sessions' work.
- **Done means:** the ticket's acceptance criteria are met, `pnpm typecheck` passes, and `pnpm test` and `pnpm test:integration` pass against this worktree's database.
- **"Use /code-review to review the work"**: **skip**. The feature review covers every ticket at once, where a clash between two tickets is visible.
- **"Commit your work to the current branch"**: as written, on the ticket branch. Conventional Commits with a `Refs #<M>` footer, no AI attribution trailers.
- **Report back** with the commit sha, anything the ticket left undone, and anything a later ticket should know.
- **UI changes:** check the change in the running app on the worktree's port before reporting done.

For a **standalone task**, `/implement #<M>` runs in its feature worktree with the same rules; the review and the PR then follow at `/wrap`.

## /tdd

As written. It is how every ticket gets built: red, green, refactor, at the seams the spec named. Integration tests (`*.int.test.ts`) run against real Postgres; the house style is in [CODING_STANDARDS.md](../../CODING_STANDARDS.md#tests).

## /code-review

Stage 5, in the feature worktree, with `main` as the fixed point: `/code-review main`. Run as written, with these inputs:

- **Spec axis** gets the spec issue and its ticket issues as the checklist (fetched with `gh`), or for a standalone task the issue and the `SPEC-<module>.md` section it names.
- **Standards axis** gets [CODING_STANDARDS.md](../../CODING_STANDARDS.md) and [AGENTS.md](../../AGENTS.md) as the documented standards, alongside the skill's smell baseline. Its brief adds: *"Read the whole diff file by file, test files included, and apply every section of CODING_STANDARDS.md that the diff touches, in full. Give each finding a severity (Critical, Important, Suggestion, Nit) and a `file:line`."* The skill's 400-word cap doesn't apply to it.
- **Checks no diff reading can do**, run by the reviewing session alongside the two axes: `pnpm audit` when `package.json` or the lockfile changed, and the response headers of every changed page from the running app (`curl -sI`), checked against [CODING_STANDARDS.md](../../CODING_STANDARDS.md#security).
- **Personal information**: the reviewing session reads the diff and every commit message on the branch for the data AGENTS.md forbids.

**Severity.** Hard documented-standard breaches and Spec findings are Critical or Important; smells are always Suggestions. **Fixing**, which replaces the skill's "fix all issues": fix every Critical and Important finding on the feature branch, in fix rounds; list Suggestions and Nits for the owner, and fix the ones worth it in the same round. A finding that belongs to another task becomes an issue.

**Record** the review in `.reviews/<branch>.md` (gitignored; `/` in the branch name becomes `-`). The PR gate ([review-gate.mjs](../../.claude/hooks/review-gate.mjs)) refuses `gh pr create` until the file has every one of these:

```markdown
# Review: <branch> (T<N> · …)

Spec: #<N>
Reviewed commit: <full HEAD sha>

## Standards
## Spec
## Checks
## Personal information
```

`## Checks` records the audit and header results, or why neither applied. `Spec:` names the spec issue, or a standalone task's own issue; work with no issue writes `Spec: none - <why>`. Before letting the PR through, the gate also checks that the named issue has its `## What actually happened` section.

**Fix rounds**, bounded so the review can't loop:

- A fix round re-runs the checks in `/wrap`'s Verify step, then reviews only `git diff <reviewed sha>..HEAD` (after a rebase, `git range-diff`) on both axes, plus the personal-information check of that diff and its commit messages. A fix to auth, `user_id` filtering, uploads or money gets the whole security section of CODING_STANDARDS.md, and a fix to queries the whole performance section.
- After each round, move `Reviewed commit:` to the HEAD it reviewed and add a line: `Round N: <old sha>..<new sha>: what was checked, what was found`. The sha only moves to a commit whose diff was reviewed.
- Fixes for Suggestions and Nits alone are recorded as `Pass: <old sha>..<new sha>: …` and don't count towards the limit, unless they change behaviour beyond the finding or turn up a Critical or Important finding.
- The review is done when a round finds no Critical or Important finding, new or unresolved.
- If the **second** fix round still finds one, stop: fixes that keep producing findings usually point at a design problem. List them in the review file and in chat, don't push, and ask the owner. If the owner accepts them, record that in the review file and carry on to the PR.

## /wrap

Stage 6, in the feature worktree. A project skill: [.claude/skills/wrap/SKILL.md](../../.claude/skills/wrap/SKILL.md). It checks the tickets are merged, runs the review if `.reviews/<branch>.md` doesn't cover HEAD, runs the full Verify, appends **What actually happened** to the spec issue, ticks the tickets' checkboxes, pushes and opens the PR.

## /pr

`/wrap` writes the PR body with this skill's template (Summary, Evidence, Merge Danger), and adds below it:

- `Closes #<N>` and one `Closes #<M>` per ticket;
- **Review**: one line per section of the review file, even when it is "nothing found";
- **Verification**: how each acceptance item was checked;
- **Owner / after merge**: items that need an owner setting or only happen after merge.

The PR title is a plain Conventional Commit, without the T-id: it becomes the squashed commit on `main` and the release-notes line.

## Not run here

- **`/setup-matt-pocock-skills`**: the files it would write are this folder, written by hand. Running it would overwrite them with generic defaults.
- **`/wayfinder`** and **`/triage`**: not part of this flow; see [issue-tracker.md](issue-tracker.md#not-used-here).
