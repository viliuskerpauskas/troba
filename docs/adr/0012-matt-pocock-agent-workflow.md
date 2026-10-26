---
status: accepted
date: 2026-10-19
decision-makers: owner
---

# Agent workflow on Matt Pocock's engineering skills

## Context and Problem Statement

Development so far followed addyosmani/agent-skills: one PR per task, a four-step review (five-axis review, security and performance checklists, personal-information check, fresh-context reviewer), and a PR gate on the review file. The owner already runs a workflow built on Matt Pocock's engineering skills on another project and wants troba on the same flow. What does that flow look like in a single public GitHub repo?

## Decision Drivers

- The same stages and guardrails as the owner's other project, so there is one way of working
- Parallel tickets without one ticket breaking another's checkout or database
- Keep troba's review rigour for auth, `user_id` filtering, uploads and money
- The repo is public: specs and tickets can't hold personal information
- Upstream skills stay unmodified, so they can be updated

## Considered Options

- Stay on agent-skills
- Matt Pocock's skills, with a hand-written translation layer, one PR per feature (chosen)
- Matt Pocock's skills, one PR per ticket

## Decision Outcome

Chosen option: "Matt Pocock's skills, one PR per feature", because the skills are written for a GitHub repo with PRs, so they fit troba with a thin translation layer, and one PR per feature lets tickets run in parallel worktrees and be reviewed together, where a clash between two tickets is visible.

The flow is `/grill-with-docs` → `/to-spec` → `/to-tickets` → `/implement-spec` (one fresh session per ticket in its own worktree) → `/mattpocock-skills:code-review` → `/wrap`. The parts:

- **Tracker:** a spec is a parent GitHub issue labelled `spec`; tickets are its sub-issues with native "blocked by" edges. The spec issue is the feature's one artifact: `/wrap` appends "What actually happened" to it.
- **Branches:** `feat/T<N>-<slug>` per feature, ticket branches merged into it, one PR closing the spec and every ticket. The owner merges; `main` deploys to staging, tags to production ([ADR-0009](0009-release-flow.md)).
- **Review:** Matt's `code-review` checks Standards and Spec in parallel sub-agents. The addy security and performance checklists are rewritten for troba as [CODING_STANDARDS.md](../../CODING_STANDARDS.md), which the Standards axis reads, so they apply on every review. The fresh-context reviewer is dropped: both axes already run in fresh sub-agents. The review file, the two-fix-round limit and the PR gate stay.
- **Config:** `docs/agents/` (issue tracker, labels, domain docs, skill overrides) and the `/wrap` project skill are written by hand; `/setup-matt-pocock-skills` isn't run.

Dropped from the other project's version, because troba is one repo: the notes vault and its links, the issue-tracker CLI (`gh` does it), the cross-repo contract check, the hand-written changelog (release-please writes it), and the commit-hygiene hook. That hook checked commit footers, which squash merges drop from `main`; the record it protected now lives on the spec issue, which the PR gate checks, and commit-message conventions are left to the personal-information review step and the squashed PR title.

Additions and departures from the approved proposal, made while building it:

- **No `GLOSSARY.md` up front.** Upstream `/domain-modeling` creates it the first time a term is resolved; seeding it by hand would mean guessing terms.
- **The PR gate doesn't check `Closes #…` in the PR body.** `/wrap` writes those lines; parsing a body file from the command line is fragile, and a missing line shows in the PR before merge.
- **`/to-spec` gets two extra sections**, `## Blast radius` and `## Open questions`, and a `security` label for specs touching auth, `user_id` filtering, uploads or money.
- **The review file also has `## Checks`** (audit and headers) **and a `Spec:` line**, which is how the gate finds the issue.
- **`docs/agents/triage-labels.md`** maps the skills' label roles, as upstream setup would.
- **Compose gets a fixed project name** (`name: troba`), so every worktree reaches the one Postgres container.
- **A ticket session whose branch wasn't cut from the feature branch stops and reports**, where upstream `implement-spec` resets it onto the integration branch: a reset would discard work on the branch.
- **The PR gate blocks any command that mentions opening a PR**, wherever the mention sits, and any PR opened for another folder or branch. A false block costs a reworded command; a missed one, an unreviewed PR.

### Consequences

- Good, because tickets run in parallel, each with its own worktree, database and port.
- Good, because the security and performance bar is written down once and checked on every review, instead of depending on two checklists being loaded.
- Good, because a feature's plan, outcome and rejected alternatives live in one issue.
- Bad, because a feature PR is larger than a one-ticket PR, so it is harder for the owner to read.
- Bad, because the translation layer has to track upstream skill changes.

### Confirmation

`.claude/hooks/review-gate.mjs` refuses `gh pr create` (and its alias `gh pr new`) until the review file has every section, names HEAD and the spec issue has its "What actually happened" section.

## More Information

The PR per feature and the review gate were superseded by [ADR-0013](0013-dev-branch-to-staging.md): features land on `dev` through `/wrap`, and the review is optional.

Superseded process: the agent-skills workflow described in the Workflow section of `AGENTS.md` before this ADR. The upstream skills are `mattpocock-skills` 1.3.1, enabled for this project in `.claude/settings.json`.
