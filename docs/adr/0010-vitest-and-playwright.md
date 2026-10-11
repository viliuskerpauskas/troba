---
status: accepted
date: 2026-10-11
decision-makers: owner
---

# Vitest against real Postgres, and Playwright end to end

## Context and Problem Statement

Logic is built test-first, money totals must be exact, and one user must never see another's data. Which test tools, and what do integration tests run against? ([stack-options §8](../ideas/stack-options.md#8-testing))

## Decision Drivers

- Fast, ESM- and TypeScript-native unit tests with little config
- Queries and user isolation tested against the real database, not mocks
- The same setup locally and in CI
- Browser tests for the flows that matter, including a phone viewport

## Considered Options

- Vitest + Postgres from Compose (locally) or a service container (CI) + Playwright
- Vitest + Testcontainers + Playwright
- Jest + Playwright

## Decision Outcome

Chosen option: "Vitest + Compose / service-container Postgres + Playwright", because Vitest runs TypeScript and ESM without extra config, and a plain Postgres container is the same database the app uses, with no extra library.

- One root `vitest.config.ts` with two projects: **unit** (`*.test.ts`, no database) and **integration** (`*.int.test.ts`, real Postgres via `DATABASE_URL`, files run serially).
- Locally, integration tests need `pnpm db:up`; in CI, a Postgres service container.
- **Playwright** runs end-to-end tests against the built app: a smoke test in CI first, then the v1 flows.

### Consequences

- Good, because pure logic (CSV parsing, money math) stays in fast unit tests, and isolation and query tests hit real SQL.
- Good, because no Docker-in-test library is needed; CI and local use the same `DATABASE_URL` contract.
- Bad, because integration tests share one database, so they run serially and each test must clean up or use unique data.
- Bad, because integration tests don't run unless Postgres is up, so the CI job is the backstop.

### Confirmation

CI runs `pnpm test`, `pnpm test:integration` and the Playwright smoke test on every PR, and the `main` ruleset requires them.

## Pros and Cons of the Options

### Testcontainers

- Good, because each run gets a fresh database without a manual `db:up`.
- Bad, because one more dependency and slower startup, for a benefit `db:up` already gives.

### Jest

- Bad, because slower and more config-heavy with ESM and TypeScript.

## More Information

Checked 2026-10-11: the scaffold pins `vitest@5.0.3`. Playwright is added with the CI task (#4).
