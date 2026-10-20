# Domain docs

How the engineering skills read troba's domain documentation. troba is one context: the pnpm workspace splits code by layer (`apps/web`, `packages/core`, `packages/db`), not by domain, so there is no `GLOSSARY-MAP.md`.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root, when it exists. `/domain-modeling` (reached through `/grill-with-docs`) creates it the first time a term gets resolved; until then, proceed without it.
- **`docs/adr/`**: the ADRs touching the area you're working in. [docs/adr/README.md](../adr/README.md) indexes them.
- **The module spec** (`SPEC-platform.md`, `SPEC-identity.md`, `SPEC-money.md`) for capability-level intent, and [SPEC.md](../../SPEC.md) for the map.

## Writing ADRs

ADRs are MADR 4, in `docs/adr/NNNN-kebab-title.md`, copied from [0000-template.md](../adr/0000-template.md) with the next free number. Add a row to the table in [docs/adr/README.md](../adr/README.md) in the same change. Supersede an accepted ADR with a new one rather than rewriting it. `/domain-modeling`'s own ADR format gives way to this one.

## Use the glossary's vocabulary

Name domain concepts (import profile, auto-rule, financial account, minor units) as `GLOSSARY.md` and the specs name them, in issue titles, test names and code. A concept with no name there yet is either invented language (reconsider) or a gap for `/domain-modeling`.

## Flag ADR conflicts

When your output contradicts an ADR, say so explicitly rather than overriding it silently:

> _Contradicts ADR-0004 (integer money), but worth reopening because…_

## What lives where

| Document | Goes to |
|---|---|
| Decision | `docs/adr/` |
| Domain terms | `GLOSSARY.md` |
| Capability intent | `SPEC-<module>.md` |
| A feature's plan and outcome | its spec issue (see [issue-tracker.md](issue-tracker.md)) |
| Release notes | `CHANGELOG.md`, which release-please writes in its release PR from the squashed commit titles; never hand-edited |
| Personal notes, real bank formats | `.private/` (gitignored) |
