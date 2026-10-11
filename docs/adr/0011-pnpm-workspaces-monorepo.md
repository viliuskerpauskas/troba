---
status: accepted
date: 2026-10-11
decision-makers: owner
---

# pnpm workspaces monorepo with source-only packages

## Context and Problem Statement

The web app and the later worker share domain logic (`packages/core`) and the schema (`packages/db`). How is the repo organized and how do apps consume shared packages? ([stack-options §9](../ideas/stack-options.md#9-monorepo))

## Decision Drivers

- One repo, one install, one lockfile
- Shared packages without a build step to keep in sync
- Strict dependency isolation (no phantom dependencies)
- Reproducible installs

## Considered Options

- pnpm workspaces, packages export TypeScript source
- pnpm workspaces + Turborepo
- Nx
- npm workspaces

## Decision Outcome

Chosen option: "pnpm workspaces, packages export TypeScript source", because it's the least tooling that gives one lockfile and strict isolation.

- Layout: `apps/*` (deployables) and `packages/*` (shared libraries).
- Packages export source (`"exports": "./src/index.ts"`) and have no build step. `apps/web` compiles them through `transpilePackages`; Node runs scripts like the migrator directly.
- `tsc -b` type-checks everything through project references from the root `tsconfig.json`.
- Node is pinned in `.nvmrc`, pnpm in `packageManager`, and dependencies use exact versions (`.npmrc` `save-exact`).

### Consequences

- Good, because a change in `packages/core` is picked up by every app immediately, with no stale `dist/`.
- Good, because exact pins and one lockfile make CI and production installs reproducible.
- Bad, because every consumer must be able to compile TypeScript; a future tool that can't would need a build step for that package.
- Bad, because there's no task caching. Add Turborepo only once builds get slow.

### Confirmation

`pnpm install --frozen-lockfile` and `pnpm typecheck` in CI.

## Pros and Cons of the Options

### Turborepo

- Good, because free local caching.
- Bad, because not needed until builds are slow.

### Nx

- Good, because powerful and familiar from Angular.
- Bad, because more config than this repo needs.

### npm workspaces

- Bad, because slower and looser dependency isolation.

## More Information

Checked 2026-10-11: the scaffold pins `pnpm@10.34.6` and Node `>=24.18.0 <25`.
