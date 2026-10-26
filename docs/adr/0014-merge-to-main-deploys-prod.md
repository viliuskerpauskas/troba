---
status: accepted
date: 2026-10-26
decision-makers: owner
---

# Merging into main deploys prod; release-please only versions

## Context and Problem Statement

[ADR-0013](0013-dev-branch-to-staging.md) moved everyday work to `dev`, which deploys to staging, and kept [ADR-0009](0009-release-flow.md)'s prod path: a `dev → main` PR, then release-please's release PR, then an approval click on the `production` environment. That's three owner steps for one decision. The owner wants prod to always run `main`, with their own merge into `main` as the approval.

## Decision Drivers

- Prod always runs what `main` is
- One owner action ships to prod
- Keep version numbers and `CHANGELOG.md` without making them gate a deploy

## Considered Options

- Every push to `main` deploys prod; release-please only tags versions
- Every push to `main` deploys prod; drop release-please
- Keep the release PR and the approval click (ADR-0013 as written)

## Decision Outcome

Chosen option: "Every push to `main` deploys prod; release-please only tags versions", because the owner's merge of the `dev → main` PR is already a deliberate, reviewed-by-CI act, and versions are still worth having for the changelog.

1. `main` changes only through PRs with a green `ci` (the ruleset). Each push to it runs CI, builds the image for its sha and deploys it to prod. The `production` environment has no required reviewers; it still only accepts deploys from `main`.
2. Staging deploys only from `dev`. The `dev → main` merge commit has the tree staging just ran under a new sha, so prod runs an image built from the same code, not the identical image.
3. release-please keeps its release PR open on `main`. Merging it, whenever the owner likes, tags `vX.Y.Z`, writes `CHANGELOG.md` and the GitHub Release, and tags that commit's image with the version. Its merge is a push to `main`, so it redeploys prod with only the version changed.
4. Every push to `main` is merged back into `dev` (usually a fast-forward), so the next `dev → main` PR is up to date.

### Consequences

- Good, because shipping is one merge.
- Good, because prod is always `main`, and `/api/health` names its sha.
- Bad, because prod no longer runs the exact image staging ran (ADR-0009's guarantee); it runs a rebuild of the same tree. The lockfile and pinned base image keep the rebuild close, but not digest for digest.
- Bad, because nothing pauses between the merge and prod: a mistaken merge deploys. Revert on `dev` and merge again, or `deploy.sh prod <older sha>` by hand.

### Confirmation

Merging a `dev → main` PR runs Deliver on `main` with `ci`, `image` and `deploy-prod` green and no approval prompt; prod's `/api/health` reports the merge commit's sha, and `dev` then contains `main`.

## Pros and Cons of the Options

### Drop release-please

- Good, because the workflow is shorter.
- Bad, because versions, tags and the changelog go with it.

### Keep the release PR and the approval

- Good, because prod runs the identical image staging ran.
- Bad, because shipping takes three owner steps.

## More Information

Supersedes point 4 of [ADR-0013](0013-dev-branch-to-staging.md) and points 3–4 of [ADR-0009](0009-release-flow.md) as far as deploying goes; versioning stays as ADR-0009 describes it.
