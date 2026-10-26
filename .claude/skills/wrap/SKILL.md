---
name: wrap
description: Last stage of the troba flow. Checks a feature or task branch, records what happened on its issue, then merges it into dev and pushes, which deploys it to staging.
disable-model-invocation: true
---

# /wrap: land the work on dev

Turns a finished feature or task branch into a merge on `dev`, with its record written. Run it in the **feature worktree** (`.claude/worktrees/t<N>-<slug>`, on `feat/T<N>-<slug>`, or a standalone task's own worktree). [docs/agents/skill-overrides.md](../../../docs/agents/skill-overrides.md) defines the names and is the authority where this file is unclear. Pushing `dev` deploys it to staging ([ADR-0013](../../../docs/adr/0013-dev-branch-to-staging.md)).

**The owner typing `/wrap` is permission to edit this work's issues as steps 3 and 4 say, merge the branch into `dev` and push `dev`.** The `dev → main` release PR, its merge and the production approval stay with the owner, always.

## Step 1: find the work

```bash
git branch --show-current
git status --short
git fetch origin dev
git log --oneline origin/dev..HEAD
```

- The branch must be a feature or task branch (`feat/`, `fix/`, `chore/`, `docs/`), never `dev` or `main`. On either, stop and say so.
- **Find the issue.** The `T<N>` in the branch name is the spec issue or the standalone task. Read it, and for a spec its sub-issues: `gh issue view <N> --json number,title,body,labels` and `gh api repos/{owner}/{repo}/issues/<N>/sub_issues --jq '.[] | {number, title, state}'`. A branch with no `T<N>` is **work with no issue** (a small docs or workflow change): it skips steps 3 and 4.
- **Every ticket's branch must be merged into this branch.** For each sub-issue `<M>`, `git branch --list "feat/T<N>-T<M>-*" --no-merged HEAD` must print nothing, and `git log origin/dev..HEAD -E --grep "Refs #<M>([^0-9]|$)"` must show its commits. An unmerged ticket branch, or a ticket with no commits here, means stage 4 is unfinished: report which and ask before going on.
- **Uncommitted changes** you didn't make: list them and ask. Never sweep someone else's half-finished work into a commit.
- **If `origin/dev` has moved**, merge it in (`git merge origin/dev`). The feature branch is made of ticket merges, which a rebase would flatten, replaying conflicts the merger already resolved.

## Step 2: check

From the worktree, with `pnpm db:up` run once: `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm test:integration` must pass; fix a failure here before going on. `build` and `test:e2e` run in CI on the push, before staging deploys. For a UI change, also check the change in the running app on the worktree's port, at desktop and phone widths, and say what you checked.

If `.reviews/<branch>.md` exists (the owner ran `/mattpocock-skills:code-review dev`), say whether its `Reviewed commit:` is HEAD and whether any Critical or Important finding is still open. An open one: ask before landing.

## Step 3: tick the issues

In each ticket issue (and a standalone task's own issue), tick each acceptance and verification checkbox that is done and was checked, following the issue-checkbox rule in [AGENTS.md](../../../AGENTS.md). An item checked only after the deploy (on staging) stays unticked and goes in the report:

```bash
mkdir -p .scratch
gh issue view <M> --json body --jq .body > .scratch/body.md
# edit the boxes in .scratch/body.md (gitignored)
gh issue edit <M> --body-file .scratch/body.md
```

## Step 4: append "What actually happened"

The spec issue is the feature's one artifact: the plan above, the outcome below. Append this to the end of its body (a standalone task: its own issue), leaving everything above it as it is:

```markdown
## What actually happened

**Landed <YYYY-MM-DD>** on `dev` from `feat/T<N>-<slug>`.

- **What changed against the plan**: decisions that moved during implementation, and why.
- **What was measured**: numbers, not adjectives (test counts, timings, query plans). If nothing was measured, say so.
- **What was rejected**: alternatives tried and dropped, so the next session doesn't retry them.
- **What is left**: follow-ups, each with its new issue number.
```

Append with the same three commands as step 3 (`gh issue view <N> --json body --jq .body > .scratch/body.md`, add the section at the end, `gh issue edit <N> --body-file .scratch/body.md`), so the plan is carried over byte for byte.

Feed it from the ticket sessions' reports, any review file and the git log. Rejected alternatives are the part a future session can't rebuild from the diff, so look for them. The issue is public: fictional data only.

## Step 5: merge into dev and push

1. If the work completes a checkpoint item in `tasks/plan.md`, tick it now (a `docs:` commit on this branch).
2. Write the merge message to `.scratch/merge.md`: a Conventional Commit title for the whole feature (`feat(<scope>): <description>`, no T-id), a blank line, then `Closes #<N>` and one `Closes #<M>` per ticket, one per line. `dev` is the default branch, so the push closes them.
3. Merge without touching the main checkout, which may be in use: from this worktree,

   ```bash
   git switch --detach origin/dev
   git merge --no-ff -F .scratch/merge.md <branch>
   git push origin HEAD:dev
   git switch <branch>
   ```

   If the push is refused because `dev` moved, `git fetch origin dev`, go back to step 1's merge of `origin/dev` and run the checks again.

A push or `gh` call that fails leaves the commits in place: that is a recoverable state, so report it and stop rather than rewriting history.

## Step 6: report

Find the push's run with `gh run list --branch dev --workflow Deliver --limit 1` (don't poll it). One message: the merge sha on `dev`, the run's link, what step 2 ran, which issue items are left for the owner, and the next step: *"Deliver runs CI and then deploys to staging; check the change there. Then remove this worktree, its database and the feature and ticket branches, and `git pull --ff-only` on `dev` in the main checkout. When staging has what should ship, open a PR `dev → main` and merge it with a merge commit."*
