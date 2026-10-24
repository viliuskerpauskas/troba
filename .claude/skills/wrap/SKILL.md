---
name: wrap
description: Stage 6 of the troba flow. Reviews and verifies a feature branch, records what happened on its spec issue, then pushes and opens the PR.
disable-model-invocation: true
---

# /wrap: stage 6 of the flow

Turns a finished feature branch into a reviewed, verified PR with its record written. Run it in the **feature worktree** (`.claude/worktrees/t<N>-<slug>`, on `feat/T<N>-<slug>`). [docs/agents/skill-overrides.md](../../../docs/agents/skill-overrides.md) defines the names and is the authority where this file is unclear.

**The owner typing `/wrap` is permission to push this branch, edit its issues as steps 4 and 5 say, and open the PR.** Merging and release tags stay with the owner, always.

## Step 1: find the work

```bash
git branch --show-current
git status --short
git fetch origin main
git log --oneline origin/main..HEAD
```

- The branch must be a feature branch (`feat/`, `fix/`, `chore/`, `docs/`), never `main`. On `main`, stop and say so.
- **Find the issue.** The `T<N>` in the branch name is the spec issue or the standalone task. Read it, and for a spec its sub-issues: `gh issue view <N> --json number,title,body,labels` and `gh api repos/{owner}/{repo}/issues/<N>/sub_issues --jq '.[] | {number, title, state}'`. A branch with no `T<N>` is **work with no issue** (a small docs or workflow change): it skips step 4, records `Spec: none - <why>` in the review file, and puts step 5's section in the PR body.
- **Every ticket's branch must be merged into this branch.** For each sub-issue `<M>`, `git branch --list "feat/T<N>-T<M>-*" --no-merged HEAD` must print nothing, and `git log origin/main..HEAD -E --grep "Refs #<M>([^0-9]|$)"` must show its commits. An unmerged ticket branch, or a ticket with no commits here, means stage 4 is unfinished: report which and ask before going on.
- **Uncommitted changes** you didn't make: list them and ask. Never sweep someone else's half-finished work into a commit.
- **If `origin/main` has moved**, merge it in (`git merge origin/main`). The feature branch is made of ticket merges, which a rebase would flatten, replaying conflicts the merger already resolved.

## Step 2: review

Read `.reviews/<branch>.md` (`/` in the branch name becomes `-`):

- **Its `Reviewed commit:` equals HEAD**: the review already covers this code. Go on to step 3 and say so in the report.
- **HEAD has moved since**: review what changed since the reviewed sha: a fix round if the new commits are fixes, otherwise a `Review:` line, as the [/code-review section](../../../docs/agents/skill-overrides.md#code-review) says (including how a merge of `main` is reviewed).
- **No file**: run `/mattpocock-skills:code-review main` with the inputs that section lists, and write the file.

Fix Critical and Important findings in fix rounds, with the two-round limit in that section. If the limit is reached with findings left, stop here: list them in the file and in chat and ask the owner.

## Step 3: Verify

Run Verify as [AGENTS.md](../../../AGENTS.md) defines it, from the feature worktree with `pnpm db:up` run once. Every command must pass; a failure is fixed and reviewed as a fix round (step 2). For a UI change, also check the change in the running app on the worktree's port, at desktop and phone widths, and say what you checked.

## Step 4: tick the tickets

In each ticket issue (and a standalone task's own issue), tick each acceptance and verification checkbox that is done and was checked, following the issue-checkbox rule in [AGENTS.md](../../../AGENTS.md):

```bash
mkdir -p .scratch
gh issue view <M> --json body --jq .body > .scratch/body.md
# edit the boxes in .scratch/body.md (gitignored)
gh issue edit <M> --body-file .scratch/body.md
```

## Step 5: append "What actually happened"

The spec issue is the feature's one artifact: the plan above, the outcome below. Append this to the end of its body (a standalone task: its own issue; work with no issue: the PR body), leaving everything above it as it is:

```markdown
## What actually happened

**Wrapped <YYYY-MM-DD>** on `feat/T<N>-<slug>`, PR to follow.

- **What changed against the plan**: decisions that moved during implementation, and why.
- **What was measured**: numbers, not adjectives (test counts, timings, query plans). If nothing was measured, say so.
- **What was rejected**: alternatives tried and dropped, so the next session doesn't retry them.
- **What is left**: follow-ups, each with its new issue number.
```

Append with the same three commands as step 4 (`gh issue view <N> --json body --jq .body > .scratch/body.md`, add the section at the end, `gh issue edit <N> --body-file .scratch/body.md`), so the plan is carried over byte for byte.

Feed it from the ticket sessions' reports, the review file and the git log. Rejected alternatives are the part a future session can't rebuild from the diff, so look for them. The issue is public: fictional data only.

## Step 6: push and open the PR

1. If the feature completes a checkpoint item in `tasks/plan.md`, tick it now (a `docs:` commit) and record that commit as a `Review:` line.
2. Check the review file names the current HEAD.
3. `git push -u origin <branch>`.
4. Write the PR body with the `/pr` template, plus the additions in [skill-overrides.md](../../../docs/agents/skill-overrides.md#pr): `Closes #<N>` and one `Closes #<M>` per ticket, **Review**, **Verification**, **Owner / after merge**. End it with the attribution line the session's instructions give for PRs, if any.
5. From the feature worktree, `gh pr create --title "<type>(<scope>): <description>" --body-file <file>`. The title is a plain Conventional Commit without the T-id. The [review gate](../../hooks/review-gate.mjs) refuses this until the review file has its evidence, names HEAD, and the spec issue has its "What actually happened" section; each refusal names what's missing.
6. `gh pr comment --body-file .reviews/<branch>.md`, so the whole review is on the PR. Later fixes for review or CI findings are fix rounds in the same file; the gate refuses a push to the open PR until the file names HEAD and has its evidence, and each push's new `Round N:`, `Pass:` or `Review:` lines go on the PR as a comment.

A push or `gh` call that fails leaves the commits in place: that is a recoverable state, so report it and stop rather than rewriting history.

## Step 7: report

One message: the PR link, the branch head sha, what the review found and fixed, what Verify ran, which issue items are left for the owner, and the next step: *"CI runs on the PR; merging is yours. After the merge: switch the main checkout to `main`, pull, and remove the feature worktree, its database and the feature and ticket branches."*
