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

The flow is `/grill-with-docs` → `/to-spec` → `/to-tickets` → `/implement-spec` (one fresh session per ticket in its own worktree) → `/code-review` → `/wrap`. The parts:

- **Tracker:** a spec is a parent GitHub issue labelled `spec`; tickets are its sub-issues with native "blocked by" edges. The spec issue is the feature's one artifact: `/wrap` appends "What actually happened" to it.
- **Branches:** `feat/T<N>-<slug>` per feature, ticket branches merged into it, one PR closing the spec and every ticket. The owner merges; `main` deploys to staging, tags to production ([ADR-0009](0009-release-flow.md)).
- **Review:** `/code-review` checks Standards and Spec in parallel sub-agents. The addy security and performance checklists are rewritten for troba as [CODING_STANDARDS.md](../../CODING_STANDARDS.md), which the Standards axis reads, so they apply on every review. The fresh-context reviewer is dropped: both axes already run in fresh sub-agents. The review file, the two-fix-round limit and the PR gate stay.
- **Config:** `docs/agents/` (issue tracker, labels, domain docs, skill overrides) and the `/wrap` project skill are written by hand; `/setup-matt-pocock-skills` isn't run.

Dropped from the other project's version, because troba is one repo: the notes vault and its links, the issue-tracker CLI (`gh` does it), the cross-repo contract check, the hand-written changelog (release-please writes it), and the commit-hygiene hook (its checks moved to the PR gate, since squash merges drop branch commit footers).

### Consequences

- Good, because tickets run in parallel, each with its own worktree, database and port.
- Good, because the security and performance bar is written down once and checked on every review, instead of depending on two checklists being loaded.
- Good, because a feature's plan, outcome and rejected alternatives live in one issue.
- Bad, because a feature PR is larger than a one-ticket PR, so it is harder for the owner to read.
- Bad, because the translation layer has to track upstream skill changes.

### Confirmation

`.claude/hooks/review-gate.mjs` refuses `gh pr create` until the review file has every section, names HEAD and the spec issue has its "What actually happened" section.

## More Information

Superseded process: the agent-skills workflow described in the Workflow section of `AGENTS.md` before this ADR. The upstream skills are `mattpocock-skills` 1.3.1, enabled for this project in `.claude/settings.json`.
