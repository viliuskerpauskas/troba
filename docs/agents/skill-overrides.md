# Skill overrides

Matt Pocock's engineering skills run **unmodified**, installed from upstream. They are written for one GitHub repo with PRs, which troba is, so most of their steps apply as written. This file covers the places where troba differs: worktrees and databases for parallel tickets, work landing on `dev` without a PR ([ADR-0013](../adr/0013-dev-branch-to-staging.md)), the optional review, and `/wrap`. **Where a skill's step and this file differ, this file wins.** Before running a skill below, read its section here in full.

Written against `mattpocock-skills` 1.3.1. Step numbers and quotes below are that version's; after an upgrade, re-read the upstream skills and update this file.

**Invoking them.** The stage skills (`grill-with-docs`, `to-spec`, `to-tickets`, `implement-spec`, `implement`) are user-invoked: they load only when their command is the first thing in a prompt, so an agent passes them on by putting the command at the start of a brief, never by calling the Skill tool. Claude Code ships a `code-review` of its own, so Matt's is always invoked by its full name, `/mattpocock-skills:code-review`.

Covered: [names](#names) · [worktrees](#worktrees) · [`/grill-with-docs`](#grill-with-docs) · [`/to-spec`](#to-spec) · [`/to-tickets`](#to-tickets) · [`/implement-spec`](#implement-spec) · [`/implement`](#implement) · [`/tdd`](#tdd) · [`/code-review`](#code-review) · [`/wrap`](#wrap) · [`/pr`](#pr) · [setup and the other skills](#setup-and-the-other-skills)

## Names

`<N>` is the spec issue's number and `<slug>` a short kebab-case name for the feature; `<M>` is a ticket's issue number.

| Name | What it is |
|---|---|
| **feature branch** | `feat/T<N>-<slug>`, cut from a freshly pulled `dev`. Tickets merge into it, and `/wrap` merges it into `dev`. Use `fix/`, `chore/` or `docs/` when that is the work's type. |
| **feature worktree** | `.claude/worktrees/t<N>-<slug>`, holding the feature branch. An optional review, fixes and `/wrap` run here. |
| **ticket branch** | `feat/T<N>-T<M>-<slug>` (always `feat/`), cut from the feature branch once the ticket's blockers have merged into it. |
| **ticket worktree** | `.claude/worktrees/t<N>-t<M>`, holding the ticket branch. |
| **main checkout** | The repo folder itself. Stays on `dev`, with whatever the owner has in it; feature work happens in worktrees, and a small task may be committed here on `dev`. |

A **standalone task** (an issue with no spec parent, including every issue from before this workflow) has a feature branch and worktree named after its own number, `feat/T<M>-<slug>`, and no ticket branches: `/implement` runs straight in the feature worktree. A small one may instead run on `dev` in the main checkout, when no other session is using it (see [/implement](#implement)).

## Worktrees

Parallel tickets share one machine and one Postgres container, so each worktree gets its own database, port and install. Integration tests already create a fresh database per run (`createTestDatabase`), but the dev server and E2E use `DATABASE_URL` directly: on a shared database, one ticket's migration lands under another ticket's code, and drizzle's migration journal stops matching either branch.

Every worktree is set up the same way, keyed by its issue number `<K>`: the ticket's `<M>` for a ticket worktree, `<N>` (or a standalone task's `<M>`) for a feature worktree.

**Create**, from the main checkout. A feature worktree, after `git pull --ff-only` on `dev`:

```bash
git worktree add .claude/worktrees/t<N>-<slug> -b feat/T<N>-<slug> dev
```

A ticket worktree:

```bash
git worktree add .claude/worktrees/t<N>-t<M> -b feat/T<N>-T<M>-<slug> feat/T<N>-<slug>
```

Then its database:

```bash
pnpm db:up
docker compose exec -T postgres createdb -U troba troba_t<K>
```

In the worktree, write its own `.env` (gitignored; it wins over `.env.example`). Start from a copy of the main checkout's `.env` when it has one, then set:

```
DATABASE_URL=postgres://troba:troba@localhost:<db port>/troba_t<K>
BETTER_AUTH_URL=http://localhost:<port>
```

and run `pnpm install --frozen-lockfile` and `pnpm db:migrate` there. `<port>` is `3200 + 10 × (<K> mod 100)`, e.g. 3920 for T72: distinct for any issues less than 100 apart, and clear of 3000 (the main checkout's `pnpm dev`) and 3100 (E2E). Start the dev server with `pnpm db:migrate && pnpm --filter @troba/web dev --port <port>`.

**One container, one database port.** `compose.yaml` fixes the project name, so `pnpm db:up` in any checkout manages the same container, using that checkout's `POSTGRES_PORT`. `<db port>` is therefore the same everywhere: 55432 by default, or the main checkout's `POSTGRES_PORT`, which the copied `.env` carries. A checkout with a different `POSTGRES_PORT` would recreate the shared container on its own port and cut off every other worktree.

If `pnpm db:up` fails with "access permissions" on Windows, port 55432 is inside a range Windows reserved at boot (`netsh int ipv4 show excludedportrange protocol=tcp`). Pick a free port and set it as `POSTGRES_PORT` and in `DATABASE_URL` in the main checkout's `.env` and in every worktree's `.env` at once.

**E2E runs in one worktree at a time.** `apps/web/playwright.config.ts` serves the built app on the fixed port 3100, so `pnpm test:e2e` runs only in the feature worktree, at `/wrap`.

**Remove**, from the main checkout, in this order:

```bash
docker compose exec -T postgres dropdb -U troba --if-exists troba_t<K>
git worktree remove .claude/worktrees/<folder>
```

Ticket branches stay until `/wrap` lands the feature on `dev`; after that, the clean-up in [AGENTS.md](../../AGENTS.md) deletes them with the feature branch.

## /grill-with-docs

Stage 1, from the main checkout. As written. Its `/domain-modeling` half writes `GLOSSARY.md` and ADRs in the format in [domain.md](domain.md). Those changes land with the feature: they stay uncommitted in the main checkout until `/implement-spec` step 3 moves them (or, for a small task done on `dev`, are committed with it), and the report at the end of the grill names each changed file so the move is exact.

## /to-spec

Stage 2. As written, with:

- **Publish** creates the spec issue described in [issue-tracker.md](issue-tracker.md): label `spec` and the module label, title `T<N> · spec(<module>): …`.
- **Add a section `## Blast radius`** after Implementation Decisions: which modules and tables it touches, whether a migration is needed and whether it is reversible, whether it touches auth, `user_id` filtering, uploads or money (then label the spec `security`), and whether a `/api/v1` shape changes.
- **Add a section `## Open questions`** at the end. An empty list usually means the spec is guessing.
- The issue is public; [issue-tracker.md](issue-tracker.md#the-repo-is-public-so-issues-are-public) has the rule.

## /to-tickets

Stage 3. As written, with:

- Publish to GitHub as in [issue-tracker.md](issue-tracker.md): sub-issues of the spec, native "blocked by" edges, the troba ticket body (with its `## Verification` section), titles `T<M> · …`, the project board, and an entry in [tasks/plan.md](../../tasks/plan.md).
- Slice migrations so each ticket carries the migration its own code needs; that is what keeps each ticket green on its own.
- The spec issue's body stays as `/to-spec` wrote it.

## /implement-spec

Stage 4. Run it once per feature, **from the main checkout**, with the spec issue: `/implement-spec #<N>`. The session is the orchestrator: it plans, starts and merges, and writes no ticket code itself.

**Resuming.** A rerun is the normal way to continue a feature. Before the first wave, check git for every ticket: a ticket branch already merged into the feature branch is done; an unmerged one with commits gets merged first; a live worktree with no running session gets a question to the owner (resume on its branch, or restart). Reuse an existing feature branch and worktree. Show the result as a table (ticket, what git shows, what happens next) and wait for a go-ahead.

Its steps, translated:

1. **Read the spec and tickets.** The task graph is the native "blocked by" edges; the frontier is every open ticket whose blockers have merged into the feature branch.
2. **Exploration subagent**: as written, except that its notes go to `.scratch/T<N>-<slug>/research/` in the main checkout. That is inside the repo but gitignored, and every worktree reads it by absolute path.
3. **"Create the integration branch"**: create the feature branch and its [worktree](#worktrees). If stage 1 left `GLOSSARY.md` or ADR changes in the main checkout, copy exactly those files into the feature worktree, commit them there as the feature's first commit (`docs: …`), then restore them in the main checkout with `git restore -- <files>` (new files: delete them). Leave any other change in the main checkout alone: it is the owner's. No PR is opened: `/wrap` merges the feature into `dev`.
4. **"Implementer subagents, each in its own worktree"**: for each frontier ticket, create its [ticket worktree](#worktrees) by command, then start the implementer as a **fresh session**, so the owner can watch and steer it. Call `start_session` with:
   - `initiation: "user_asked"` (invoking `/implement-spec` is the owner asking for these sessions), `context: "fresh"`, `use_worktree: false`, `cwd` = the ticket worktree's absolute path, `wake_when_done: true`, `title: "T<M> · <ticket title>"`;
   - `prompt` starting with the command, then pointers rather than content: `/implement #<M>` on its first line; then the spec number, the feature-branch sha the worktree was cut from, the worktree's port and database, the research folder, and *"follow the /implement section of docs/agents/skill-overrides.md"*;
   - `background` (80+ characters): the feature, that this session owns one ticket on its own branch, and that the orchestrator merges its work.

   Where sessions aren't available, use a background subagent with the same brief. A subagent can't invoke `/implement`, so its brief says to follow the upstream `implement` skill's steps inline, as amended in [/implement](#implement).

   Three parts of this are unconfirmed until the first real feature: that `start_session` accepts a `cwd` inside this repo, that a fresh session's prompt starting with `/implement` runs the command, and (for the fallback below) that `source_branch` takes a branch that exists only locally. Check each on the first ticket and record the outcome here.

   **If `cwd` is refused**, the app makes the session's worktree instead, so the ticket gets the same setup by another route:
   1. Remove the ticket worktree you created and delete its branch (`git worktree remove …`, `git branch -D feat/T<N>-T<M>-<slug>`; it has no commits yet). Keep its `troba_t<M>` database.
   2. Start the session with `use_worktree: true` and `source_branch: feat/T<N>-<slug>` in place of `cwd` and `use_worktree: false`, everything else as above.
   3. Its brief adds, before `/implement` runs anything: rename the branch the app made to the ticket branch with `git branch -m feat/T<N>-T<M>-<slug>` (a rename, so no stray branch is left behind); write the worktree's `.env` as [Worktrees](#worktrees) says, starting from a copy of the main checkout's `.env` (the brief gives its absolute path), or, when the main checkout has none, with just `DATABASE_URL` and `BETTER_AUTH_URL`, with the database `troba_t<M>` and the ticket's port; then `pnpm install --frozen-lockfile` and `pnpm db:migrate`. No `pnpm` command runs before that `.env` exists, or it would migrate the main checkout's database.
   4. Its report adds its worktree path, so steps 5 and 9 remove that path and drop `troba_t<M>`. The merger merges `feat/T<N>-T<M>-<slug>` as usual: the branch lives in the shared repository.
5. **"Merge its work with a merger subagent"**: when an implementer reports done, a merger subagent merges the ticket branch into the feature branch in the feature worktree (`git merge --no-ff feat/T<N>-T<M>-<slug>`). It resolves a conflict there, then runs `pnpm typecheck`, `pnpm test` and the integration tests the ticket touched. Then [remove](#worktrees) the ticket worktree: `.claude/worktrees/t<N>-t<M>`, or the path the session reported when the app made it.
6. **"Kick off more implementers"**: as written. The frontier advances in waves; when the owner says one ticket is done, merge it and start what it unblocks without waiting for the wave.
7. **"Call code-review on the integration branch, fix all issues"**: **skip**. A review is optional, run by the owner in the feature worktree; see [/code-review](#code-review).
8. **"Mark the PR ready / resolve each ticket"**: **stop and report**: the feature branch and its head sha, each ticket's state, and the next step, *"/wrap in the feature worktree"*. Tickets close when `/wrap`'s merge lands on `dev`.
9. **"Clean up all worktrees"**: every ticket worktree left (at its reported path when the app made it) and its database. Keep the feature worktree.

**Invoking `/implement-spec` is permission to commit on the feature's ticket and feature branches.** Merging into and pushing `dev` belong to `/wrap`; anything on `main` to the owner.

## /implement

When the brief names one ticket and this file, `/implement` runs in its ticket worktree as written, with these changes:

- **If the brief carries setup steps** (the [fallback](#implement-spec) in step 4, when the app made the worktree), do them before anything else.
- **Scope is the one ticket.** The spec is context; other tickets are other sessions' work.
- **Then**, confirm the worktree's branch was cut from the feature branch: the brief names the feature-branch sha the worktree was created from, and `git merge-base --is-ancestor <that sha> HEAD` must succeed. If not, stop and tell the orchestrator rather than resetting (upstream resets): a reset would discard whatever is on the branch.
- **Done means:** the ticket's acceptance criteria are met, `pnpm typecheck` passes, and `pnpm test` and `pnpm test:integration` pass against this worktree's database, after merging the feature branch's current tip into the ticket branch (upstream `implement-spec` gives implementers this duty, so the merger meets fewer conflicts).
- **"Use /code-review to review the work"**: **skip**. The feature review covers every ticket at once, where a clash between two tickets is visible.
- **"Commit your work to the current branch"**: as written, on the ticket branch. Conventional Commits with a `Refs #<M>` footer and no AI attribution trailers.
- **Report back** with the commit sha, anything the ticket left undone, and anything a later ticket should know.
- **UI changes:** check the change in the running app on the worktree's port before reporting done.

For a **standalone task**, `/implement #<M>` runs in its feature worktree with the same rules, minus the feature-branch checks; `/wrap` then lands it on `dev`. A **small task on `dev`** in the main checkout skips the worktree: commit there with a `Closes #<M>` footer once `pnpm lint`, `typecheck`, `test` and `test:integration` pass, push `dev` (asking for the task is permission to), tick the issue's boxes as `/wrap` step 3 does, and report the Deliver run (`gh run list --branch dev --workflow Deliver --limit 1`).

## /tdd

As written: red, then green, one behaviour at a time; refactoring belongs to the review stage. The seams named in the spec issue's Testing Decisions are the pre-agreed seams upstream `tdd` asks the user to confirm, so a ticket session builds on them without asking again. Integration tests (`*.int.test.ts`) run against real Postgres; the house style is in [CODING_STANDARDS.md](../../CODING_STANDARDS.md#tests).

## /code-review

Optional, in the feature worktree (or the main checkout for work already on `dev`), with `dev` as the fixed point: `/mattpocock-skills:code-review dev`. Worth running when a change touches auth, `user_id` filtering, uploads or money, and whenever the owner asks. Run as written, with these inputs:

- **Spec axis** gets the spec issue and its ticket issues as the checklist (fetched with `gh`), or for a standalone task the issue and the `SPEC-<module>.md` section it names.
- **Standards axis** gets [CODING_STANDARDS.md](../../CODING_STANDARDS.md) and [AGENTS.md](../../AGENTS.md) as the documented standards, alongside the skill's smell baseline, and a brief that follows "How to apply this file" at the top of CODING_STANDARDS.md. The skill's 400-word cap doesn't apply to it.
- **Checks no diff reading can do**, run by the reviewing session alongside the two axes: `pnpm audit` when a `package.json`, the lockfile or `pnpm-workspace.yaml` changed, the response headers of every changed page from the running app (`curl -sI`), checked against [CODING_STANDARDS.md](../../CODING_STANDARDS.md#security), and a mutation check of the tests: break the changed code in at least one place a test should catch, and note which test failed.
- **Personal information**: the reviewing session reads the diff and every commit message on the branch for the data AGENTS.md forbids.

**Severity.** Hard documented-standard breaches and Spec findings are Critical or Important; smells are always Suggestions. Fix every Critical and Important finding on the branch; list Suggestions and Nits for the owner, and fix the ones worth it. If a second round of fixes still turns up Critical or Important findings, stop and ask the owner: fixes that keep producing findings usually point at a design problem. A finding that belongs to another task becomes an issue.

**Record** the review in `.reviews/<branch>.md` (gitignored; `/` in the branch name becomes `-`), with the branch, the spec issue, `Reviewed commit: <full HEAD sha>`, and a section per axis and for the checks and personal information. `/wrap` reads it if it exists. No hook checks it ([ADR-0013](../adr/0013-dev-branch-to-staging.md) removed the review gate).

## /wrap

The last stage, in the feature worktree, typed by the owner. A project skill: [.claude/skills/wrap/SKILL.md](../../.claude/skills/wrap/SKILL.md). It checks the tickets are merged, runs lint, typecheck, unit and integration tests, ticks the issues' checkboxes, appends **What actually happened** to the spec issue, then merges the branch into `dev` with a message that closes the spec and its tickets, and pushes `dev`, which deploys to staging.

## /pr

Only for the PR `dev → main`, which the owner asks for; merging it deploys prod ([ADR-0014](../adr/0014-merge-to-main-deploys-prod.md)). Write its body with this skill's template (Summary, Evidence, Merge Danger), summarising what `dev` has that `main` doesn't (`git log --oneline origin/main..origin/dev`), and saying which staging run it was checked on. Title it `chore: ship to prod` or similar: it's merged with a merge commit, so release-please builds the release notes from the commits on `dev`, not from the PR title. Open it with `gh pr create --base main --head dev --body-file <file>`; merging is the owner's.

## Setup and the other skills

- **Configuration is this folder**, written by hand for troba. When a skill says the tracker or labels weren't provided and suggests `/setup-matt-pocock-skills`, read [issue-tracker.md](issue-tracker.md), [triage-labels.md](triage-labels.md) and [domain.md](domain.md) instead; the setup skill would replace them with generic defaults.
- **`/wayfinder`** and **`/triage`** aren't part of this flow; see [issue-tracker.md](issue-tracker.md#not-used-here).
