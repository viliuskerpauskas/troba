# Capability Map: troba

Status: **approved 2026-10-11**. Source: [docs/intent/personal-hub.md](docs/intent/personal-hub.md)

Each module gets its own `SPEC-<id>.md` before it's built. This table is the index of what exists. Module ids are stable; never rename them.

| Module id | Responsibility | Depends on | Phase | Spec |
|---|---|---|---|---|
| platform | Monorepo scaffold, Docker Compose, Caddy, CI/CD (PR checks → staging → prod), migrations on deploy. No worker until receipts-ocr | — | v1 | [SPEC-platform.md](SPEC-platform.md) |
| identity | Accounts, sign-up/sign-in, sessions, per-user data isolation, invite-only sign-up for friends | platform | v1 | [SPEC-identity.md](SPEC-identity.md) |
| money | Financial accounts, transactions (bank CSV import + manual), categories and rules, receipt attachments, monthly spending view | identity | v1 | [SPEC-money.md](SPEC-money.md) |
| receipts-ocr | Read attached receipts into line items (product, quantity, price) | money | later | — |
| price-insights | Per-product price history and comparison (milk, bread), deeper category analysis | receipts-ocr | later | — |
| bank-sync | Automatic bank sync through a licensed open-banking aggregator, feeding the money import pipeline | money | later | — |
| capture | Voice/text quick capture from phone or watch, routed to an expense, task… | identity, money (later tasks) | later | — |
| tasks | Todos | identity | later | — |
| calendar | Calendar integrations | identity | later | — |

Build order (v1): **platform → identity → money**

Later order (rough): receipts-ocr → price-insights → bank-sync → tasks → capture → calendar

## Boundaries between modules

- `money` gets the current user from `identity` as a `userId`. It never reads auth tables directly.
- `receipts-ocr`, `bank-sync` and `capture` write into `money` only through functions that `money` exports from `packages/core`, never by writing its tables directly.
- Cross-cutting rules (money in cents, `user_id` on every row, validation at boundaries) live in [AGENTS.md](AGENTS.md), not in each spec.
