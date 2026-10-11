# Implementation Plan: troba v1 (platform → identity → money)

Specs: [SPEC.md](../SPEC.md), [SPEC-platform.md](../SPEC-platform.md), [SPEC-identity.md](../SPEC-identity.md), [SPEC-money.md](../SPEC-money.md).

**Tasks are tracked in GitHub Issues** (one per task, acceptance criteria and verification in the body, dependencies as native "blocked by" links). This file keeps the design, risks and the ordered index below.

## Overview

v1 is a deployable Next.js + Postgres app where invited users import bank CSVs through their own import profiles, categorize spending with rules, attach receipts and see monthly spending by category. It's built in thin vertical slices, one PR each, test-first for logic.

## Architecture Decisions

- **Local dev and CI come first, deploys last.** There's no VPS or domain yet, so the deploy tasks (T7–T9) are labelled `blocked-external` and nothing else depends on them. Everything up to the image in GHCR can be built now.
- **Domain logic in `packages/core`, taking `db` and `userId`.** Server actions and route handlers only call `requireUser()`, validate with Zod and delegate.
- **CSV parsing is pure and lands early (T19),** in parallel with identity. It's the riskiest money logic, and it needs no database.
- **One isolation test helper (T14)** loops over every table with `user_id`, so each later module is covered by adding its tables, not by writing new tests.
- **Stack choices become ADRs first (T1),** from `docs/ideas/stack-options.md`.

## Dependency graph

```
T2 scaffold ─┬─ T3 db + health ─┬─ T4 CI ──┐
             │                  ├─ T5 image ┴─ T6 GHCR + release-please ─ T8 staging ─ T9 prod
             │                  │                       T7 VPS runbook ──┘   (T7–T9 blocked: no VPS)
             │                  └─ T10 auth ─┬─ T11 rate limit
             │                               ├─ T12 invites ─ T15 admin + resets
             │                               ├─ T13 settings ─ T14 delete account
             │                               └─ T16 money schema + accounts ─ T17 transactions ─┬─ T18 categories ─┬─ T23 monthly view
             │                                                                                   ├─ T24 list filters │
             │                                                                                   └─ T25 attachments  │
             └─ T19 CSV parsing ──────────────────────────────────────────────────── T20 import core ─┴─ T21 import UI
                                                                                                    └─ T22 rules
T1 ADRs (independent)                                          T26 v1 E2E ← T21, T22, T23, T24, T25
```

## Task List

T-numbers are issue numbers (T7 = issue #7); see References in [AGENTS.md](../AGENTS.md). Board: [troba project](https://github.com/users/viliuskerpauskas/projects/3).

### Phase 1: Platform (local + CI)
- [T1](https://github.com/viliuskerpauskas/troba/issues/1) docs: record stack decisions as ADRs
- [T2](https://github.com/viliuskerpauskas/troba/issues/2) chore: scaffold pnpm monorepo with Next.js app
- [T3](https://github.com/viliuskerpauskas/troba/issues/3) feat: Postgres, Drizzle migrations and health endpoint
- [T4](https://github.com/viliuskerpauskas/troba/issues/4) ci: PR checks with Playwright smoke test
- [T5](https://github.com/viliuskerpauskas/troba/issues/5) feat: production container image with migrate step
- [T6](https://github.com/viliuskerpauskas/troba/issues/6) ci: publish image to GHCR, release-please and Dependabot

### Checkpoint A: platform
- [ ] Fresh clone → running app in under 5 minutes
- [ ] A PR with a failing test can't merge
- [ ] `:<sha>` image in GHCR

### Phase 2: Identity
- [T10](https://github.com/viliuskerpauskas/troba/issues/10) feat(identity): Better Auth, sign-in/out and admin bootstrap CLI
- [T11](https://github.com/viliuskerpauskas/troba/issues/11) feat(identity): sign-in rate limiting
- [T12](https://github.com/viliuskerpauskas/troba/issues/12) feat(identity): invites and invite sign-up
- [T13](https://github.com/viliuskerpauskas/troba/issues/13) feat(identity): account settings and sessions
- [T14](https://github.com/viliuskerpauskas/troba/issues/14) feat(identity): delete account
- [T15](https://github.com/viliuskerpauskas/troba/issues/15) feat(identity): admin user management and password reset links

### Checkpoint B: identity
- [ ] Invite → sign up → sign in works locally end to end
- [ ] Isolation helper and delete-account test green
- [ ] Review with owner before money

### Phase 3: Money
- [T19](https://github.com/viliuskerpauskas/troba/issues/19) feat(money): CSV decoding and profile row parsing (can start after T2)
- [T16](https://github.com/viliuskerpauskas/troba/issues/16) feat(money): schema, defaults and financial accounts
- [T17](https://github.com/viliuskerpauskas/troba/issues/17) feat(money): manual transactions and basic list
- [T18](https://github.com/viliuskerpauskas/troba/issues/18) feat(money): categories
- [T20](https://github.com/viliuskerpauskas/troba/issues/20) feat(money): import preview and atomic commit
- [T21](https://github.com/viliuskerpauskas/troba/issues/21) feat(money): import UI with column mapping
- [T22](https://github.com/viliuskerpauskas/troba/issues/22) feat(money): auto-categorization rules
- [T23](https://github.com/viliuskerpauskas/troba/issues/23) feat(money): monthly spending view
- [T24](https://github.com/viliuskerpauskas/troba/issues/24) feat(money): transaction list filters, search and pagination
- [T25](https://github.com/viliuskerpauskas/troba/issues/25) feat(money): receipt attachments
- [T26](https://github.com/viliuskerpauskas/troba/issues/26) test(money): v1 end-to-end, phone viewport and accessibility pass

### Checkpoint C: money
- [ ] Owner imports a real export locally in under 2 minutes, re-import adds 0
- [ ] Monthly totals match to the cent
- [ ] All SPEC-money success criteria checked

### Phase 4: Deploy (blocked: needs VPS + domain)
- [T7](https://github.com/viliuskerpauskas/troba/issues/7) docs: VPS runbook and deploy scripts
- [T8](https://github.com/viliuskerpauskas/troba/issues/8) ci: auto-deploy main to staging
- [T9](https://github.com/viliuskerpauskas/troba/issues/9) ci: production deploy behind approval

### Checkpoint D: shipped
- [ ] All platform success criteria, including rollback and `nmap` check
- [ ] Before real data in prod: backups and TOTP 2FA (post-v1 gates from the specs)

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Better Auth plugin APIs differ from the spec's assumptions (invites, admin, rate limit) | High | Verify current docs before T10 (`source-driven-development`); invites are a custom table anyway |
| Bank CSV quirks beyond the known ones | Med | T19 tests fictional fixtures for each quirk, plus a local-only test on the real export |
| Cross-user data leak | High | `requireUser()` first everywhere, `userId` in every core function, table-looping isolation tests |
| Next.js caching/server-action surprises | Med | Keep pages dynamic per user; E2E covers each flow |
| No VPS delays staging feedback | Low | Everything except T7–T9 runs locally and in CI |

## Open Questions

- VPS and domain: owner adds them later; T7–T9 wait.
