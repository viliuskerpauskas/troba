---
name: wrap
description: Close out a troba feature or standalone task: confirm its tickets are merged, review it, run the full Verify, append "What actually happened" to the spec issue, then push the branch and open the PR. Use at stage 6 of the flow, in the feature worktree ("/wrap", "wrap this up", "open the PR"). Not for a review alone (that's /code-review) and never for merging.
---

# /wrap: stage 6 of the flow

Turns a finished feature branch into a reviewed, verified PR with its record written. Run it in the **feature worktree** (`.claude/worktrees/t<N>-<slug>`, on `feat/T<N>-<slug>`). [docs/agents/skill-overrides.md](../../../docs/agents/skill-overrides.md) defines the names and is the authority where this file is unclear.

**Invoking `/wrap` is permission to push this branch, edit the spec issue as step 5 says, and open the PR.** Merging and release tags stay with the owner, always.

## Step 1: find the work

```bash
git branch --show-current
git status --short
git fetch origin main
git log --oneline origin/main..HEAD
```

- The branch must be a feature branch (`feat/`, `fix/`, `chore/`, `docs/`), never `main`. On `main`, stop and say so.
- Find the spec: the `T<N>` in the branch name is the spec issue or the standalone task. Read it, and for a spec its sub-issues: `gh issue view <N> --json number,title,body,labels` and `gh api repos/{owner}/{repo}/issues/<N>/sub_issues --jq '.[] | {number, title, state}'`.
- **Every ticket's branch must be merged into this branch.** For each sub-issue, `git branch --list "feat/T<N>-T<M>-*" --no-merged HEAD` must print nothing. An unmerged ticket branch, or a sub-issue with no commits here (`git log --grep "#<M>"` is empty), means stage 4 is unfinished: report which and ask before going on.
- **Uncommitted changes** you didn't make: list them and ask. Never sweep someone else's half-finished work into a commit.
- If `origin/main` has moved, rebase onto it (`git rebase origin/main`) before the review, so the review and Verify see what will merge. A branch already pushed is merged with `main` instead of rebased.

## Step 2: review

Read `.reviews/<branch>.md` (`/` in the branch name becomes `-`):

- **Its `Reviewed commit:` equals HEAD**: the review already covers this code. Skip to step 3 and say so in the report.
- **HEAD has moved since**: run a fix round on `git diff <reviewed sha>..HEAD` (after a rebase, `git range-diff`).
- **No file**: run the full `/code-review main` as [skill-overrides.md](../../../docs/agents/skill-overrides.md#code-review) describes and write the file.

Fix Critical and Important findings in fix rounds, with the two-round limit in that section. If the limit is reached with findings left, stop here: list them in the file and in chat and ask the owner.

## Step 3: Verify

From the feature worktree, with `pnpm db:up` run once:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm test:e2e
```

Every one must pass. A failure is fixed and re-reviewed as a fix round (step 2), not skipped. For a UI change, also check the change in the running app (`pnpm --filter @troba/web dev --port <port>`), at desktop and phone widths, and say what you checked.

## Step 4: tick the tickets

In each ticket issue (and a standalone task's own issue), tick each acceptance and verification checkbox that is done and was checked: `gh issue view <M> --json body`, edit the text, `gh issue edit <M> --body-file <file>`. Leave unticked the items that need an owner setting or only happen after merge. Strike through, with a reason, an item that was dropped or changed; never tick it.

## Step 5: append "What actually happened" to the spec

The spec issue is the feature's one artifact: the plan above, the outcome below. Append to the end of its body, never editing the plan:

```markdown
## What actually happened

**Wrapped <YYYY-MM-DD>** on `feat/T<N>-<slug>`, PR to follow.

- **What changed against the plan**: decisions that moved during implementation, and why.
- **What was measured**: numbers, not adjectives (test counts, timings, query plans). If nothing was measured, say so.
- **What was rejected**: alternatives tried and dropped, so the next session doesn't retry them.
- **What is left**: follow-ups, each with its new issue number.
```

Feed it from the ticket sessions' reports, the review file and the git log. Rejected alternatives are the part a future session can't rebuild from the diff, so look for them. The issue is public: fictional data only.

For a **standalone task**, append it to the task's own issue. Work with no issue at all (a small docs or workflow PR) records `Spec: none - <why>` in the review file, and the section goes into the PR body instead.

## Step 6: push and open the PR

1. Check the review file names the current HEAD (step 2 again if steps 3 or 4 changed code).
2. `git push -u origin <branch>`.
3. Write the PR body with the `/pr` template, plus the additions in [skill-overrides.md](../../../docs/agents/skill-overrides.md#pr): `Closes #<N>` and one `Closes #<M>` per ticket, **Review**, **Verification**, **Owner / after merge**. End it with the attribution line the session's instructions give for PRs, if any.
4. `gh pr create --title "<type>(<scope>): <description>" --body-file <file>`. The title is a plain Conventional Commit without the T-id. The [review gate](../../hooks/review-gate.mjs) refuses this until the review file is complete, names HEAD, and the spec issue has its "What actually happened" section.
5. `gh pr comment --body-file .reviews/<branch>.md`, so the whole review is on the PR.
6. If the feature completes a checkpoint item in `tasks/plan.md`, tick it in this PR (a `docs:` commit, then push).

If a push or `gh` call fails, say so plainly and leave the commits in place: a local commit with a failed push is a recoverable state.

## Step 7: report

One message: the PR link, the branch head sha, what the review found and fixed, what Verify ran, which issue items are left for the owner, and the next step: *"CI runs on the PR; merging is yours. After the merge: switch the main checkout to `main`, pull, and remove the feature worktree, its database and the feature and ticket branches."*
