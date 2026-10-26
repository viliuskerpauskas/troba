---
status: accepted
date: 2026-10-11
decision-makers: owner
---

# Release flow: Conventional Commits, release-please and one image per commit

## Context and Problem Statement

`main` must always be deployable, staging should update on every merge, and production should change only on a deliberate release. How are versions, changelogs and promotions handled? ([SPEC-platform.md](../../SPEC-platform.md))

## Decision Drivers

- No manual version bumps or hand-written changelogs
- Prod runs exactly the image CI tested on staging
- One approval click for prod; no deploy without it
- Free (GitHub Actions, GHCR)

## Considered Options

- release-please on Conventional Commits, image promoted by tag
- semantic-release
- Manual tags and changelog
- Rebuild the image for each environment

## Decision Outcome

Chosen option: "release-please on Conventional Commits, image promoted by tag", because it keeps a reviewable release PR instead of publishing on every merge, and promoting a tag keeps prod on the tested image.

1. Commits on `main` follow [Conventional Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/); PRs are merged from short-lived `feat/…` / `fix/…` branches with CI green.
2. Each merge to `main` builds `ghcr.io/<owner>/troba-web:<sha>` once and deploys it to staging.
3. release-please keeps a release PR open with the next `vX.Y.Z` and `CHANGELOG.md`. Merging it creates the tag and GitHub Release.
4. In the same workflow (tags pushed by `GITHUB_TOKEN` don't trigger other workflows), the existing `:<sha>` image is tagged `:<version>` and deployed to prod through the `production` GitHub Environment, which requires the owner's approval.

### Consequences

- Good, because release notes are generated from commit messages.
- Good, because prod never runs an image that wasn't on staging first.
- Bad, because commit messages must follow the convention; a bad type means a wrong version bump.
- Bad, because the deliver workflow carries both the staging and the prod path, so it's longer than two separate workflows.

Amended by [ADR-0013](0013-dev-branch-to-staging.md): work lands on `dev`, whose pushes also deploy to staging, and reaches `main` through a merge-commit PR `dev → main`.

### Confirmation

The release-please PR shows the expected bump; prod's `/api/health` reports the released sha.

## Pros and Cons of the Options

### semantic-release

- Good, because fully automatic.
- Bad, because it releases on every qualifying merge, with no release PR to review or batch.

### Manual tags and changelog

- Bad, because error-prone and easy to skip.

### Rebuild per environment

- Bad, because prod would run an image nobody tested.
