---
status: accepted
date: 2026-10-26
decision-makers: owner
---

# Work lands on dev, which deploys to staging; main is the release branch

## Context and Problem Statement

Under [ADR-0012](0012-matt-pocock-agent-workflow.md) every feature and every small task ended in a reviewed PR to `main`, held by a review gate hook that checked the review file's evidence before `gh pr create` and every push to an open PR. For one owner working with agents, that ceremony cost more than it caught: the gate kept refusing ordinary commands, and a one-line fix needed a worktree, a review file, `/wrap` and a PR. How can work reach staging quickly while production still changes only on a deliberate, approved release?

## Decision Drivers

- A push should reach staging with no PR and no manual step
- Production still runs only an image that ran on staging, after the owner's approval ([ADR-0009](0009-release-flow.md))
- Keep grill → spec → tickets → implement-spec for bigger features, and allow grill → implement (or just implement) for small ones
- No hook that refuses the owner's normal commands

## Considered Options

- `dev` deploys to staging, `main` deploys to production through a `dev → main` PR
- Push to `dev`, and a bot fast-forwards `main` when CI passes
- `dev` replaces `main` entirely

## Decision Outcome

Chosen option: "`dev` deploys to staging, `main` deploys to production through a `dev → main` PR", because it removes the PR from everyday work but keeps release-please and the prod approval exactly as ADR-0009 set them up.

1. `dev` is the default branch and the integration branch. Every push to it runs the `ci` job (from `deliver.yml`, calling `ci.yml`), then builds `ghcr.io/<owner>/troba-web:<sha>` and deploys it to staging. Staging never gets a commit whose checks failed.
2. A feature's tickets still merge into `feat/T<N>-<slug>`; `/wrap` then merges it into `dev` with a `--no-ff` merge whose message closes the spec and its tickets, and pushes `dev`. A small task commits straight to `dev` (in the main checkout, which now sits on `dev`) or goes through a worktree branch the same way.
3. A release is a PR `dev → main`, merged with a **merge commit** so release-please on `main` reads every Conventional Commit from `dev` and `main` keeps `dev`'s history. The `main` ruleset (PR, green `ci`, up to date) applies only to `main`; it allows merge commits.
4. On `main` nothing else changes: each push deploys to staging, release-please keeps its PR, merging that PR tags `vX.Y.Z` and deploys the same image to production after approval. A `sync-dev` job then merges `main` back into `dev`, so the release commits reach `dev` and the next release PR is up to date.
5. The review gate hook and its evidence checks are removed. `/mattpocock-skills:code-review dev` stays available whenever the owner wants a review; it's no longer required.

### Consequences

- Good, because a push to `dev` is on staging in about the time CI and a build take, with no PR.
- Good, because production keeps ADR-0009's guarantees: the release image ran on staging and the owner approved it.
- Bad, because nothing forces a review before code reaches `dev` and staging; CI is the only gate there.
- Bad, because release notes list every commit on `dev`, ticket commits included, rather than one squashed line per feature.
- Bad, because each push to `main` (the release PR's merge, the release commit) briefly puts staging on `main` until the next push to `dev`.

### Confirmation

A push to `dev` runs Deliver: `ci`, `image` and `deploy-staging` go green and staging's `/api/health` reports the pushed sha. After a release, `dev` contains `main` (`git merge-base --is-ancestor origin/main origin/dev`).

## Pros and Cons of the Options

### Bot fast-forwards main

- Good, because `main` stays the one branch that matters.
- Bad, because a bot pushing to a protected `main` needs a bypass of the ruleset, and staging and prod no longer have separate branches to reason about.

### dev replaces main

- Good, because there's one branch.
- Bad, because release-please, the ruleset and the environments would all move, for no gain over keeping `main` as the release branch.

## More Information

Point 4 (prod deploys only a release, after approval) was superseded the same day by [ADR-0014](0014-merge-to-main-deploys-prod.md): every push to `main` deploys prod, and the merge is the approval.

Supersedes the PR-per-feature and review-gate parts of [ADR-0012](0012-matt-pocock-agent-workflow.md), and point 2 of [ADR-0009](0009-release-flow.md) ("each merge to `main` deploys to staging" now also covers each push to `dev`). GitHub settings changed with it: the default branch is `dev`, the `main` ruleset targets `refs/heads/main` explicitly (it targeted the default branch) and allows merge commits, and the `staging` environment allows deploys from `dev` as well as `main`.
