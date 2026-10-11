---
status: accepted
date: 2026-10-11
decision-makers: owner
---

# Drizzle ORM and drizzle-kit migrations

## Context and Problem Statement

The web app and the later worker share one Postgres schema. How do we define it, query it with types, and migrate it? ([stack-options §5](../ideas/stack-options.md#5-orm-drizzle-))

## Decision Drivers

- SQL knowledge should transfer; the generated SQL should be predictable
- Typed results shared through `packages/db`
- Forward-only migrations that run automatically on deploy
- Lightweight runtime

## Considered Options

- Drizzle ORM + drizzle-kit
- Prisma
- Kysely
- Raw `pg` + SQL

## Decision Outcome

Chosen option: "Drizzle", because it reads like SQL, gives typed results without a separate schema language, and `drizzle-kit` generates plain SQL migrations from `packages/db/src/schema.ts`.

We stay on the **0.x `latest` line** (pinned exactly) and use the core SQL-like API rather than the relational query builder for anything non-trivial, since that API changes most in v1.

The driver is **node-postgres (`pg`)**, not postgres.js, because pg-boss is built on `pg` ([ADR-0003](0003-pg-boss-for-background-jobs.md)), so the web app and the worker share one driver and one set of pool behaviors.

### Consequences

- Good, because the schema is TypeScript and shared by every app.
- Good, because migrations are reviewable SQL files committed to the repo.
- Bad, because the project is younger and its API is still moving: v1 is in release candidate. Moving to v1 is a planned upgrade with its own PR once it's tagged `latest`.
- Bad, because relations and the query API are less polished than Prisma's.
- Bad, because a `pg` pool emits `error` when the server drops an idle client, and an unhandled one crashes the process. `createDb` attaches a listener, covered by an integration test.

### Confirmation

`pnpm db:generate` produces no diff in CI (added with [#4](https://github.com/viliuskerpauskas/troba/issues/4)).

## Pros and Cons of the Options

### Prisma

- Good, because mature, great docs, highly hireable.
- Bad, because its own schema language hides more SQL.

### Kysely

- Good, because an excellent typed query builder.
- Bad, because migrations and schema are more do-it-yourself.

### Raw `pg` + SQL

- Good, because maximum control.
- Bad, because no type safety.

## More Information

Checked 2026-10-11 on npm (`npm view drizzle-orm dist-tags`): `latest` is 0.45.4; v1 is at `1.0.0-rc.5` on the `rc` tag. Release notes: <https://orm.drizzle.team/docs/latest-releases>. Revisit when v1 becomes `latest`.

Driver: `pg` 8.23.1 via `drizzle-orm/node-postgres`, as used in `packages/db/src/client.ts` since [#3](https://github.com/viliuskerpauskas/troba/issues/3).
