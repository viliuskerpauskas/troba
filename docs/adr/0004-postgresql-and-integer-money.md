---
status: accepted
date: 2026-10-11
decision-makers: owner
---

# PostgreSQL, with money as integer minor units

## Context and Problem Statement

troba stores financial transactions for several users, queried by month and category, and shared between the web app and a later worker process. Which database, and how are amounts stored? ([stack-options §4](../ideas/stack-options.md#4-database-postgresql-))

## Decision Drivers

- Several users and a separate worker process writing concurrently
- Aggregates and window functions for monthly and category totals
- Raw import rows kept as JSON
- Totals must match the bank statement to the cent
- The owner already knows it

## Considered Options

- PostgreSQL
- SQLite

## Decision Outcome

Chosen option: "PostgreSQL" (latest major, official Docker image), because it handles concurrent writers and the reporting queries well, JSONB holds raw import rows, and it doubles as the job queue ([ADR-0003](0003-pg-boss-for-background-jobs.md)).

**Money rule:** amounts are integer minor units (cents) in a `bigint` column, plus a currency column. Never `float`, never `numeric`. Format only at display time.

- Floats can't represent most decimals (`0.1 + 0.2 === 0.30000000000000004`), so sums drift by cents.
- `numeric` is exact in Postgres, but `pg` returns it as a string, and parsing it in JS brings floats back.
- Integer cents sum exactly in SQL and in JS (`bigint`).
- The currency column keeps 10.00 USD and 10.00 EUR distinct.

### Consequences

- Good, because one database serves app data, sessions and jobs.
- Good, because totals are exact everywhere.
- Bad, because one more service to run and back up than SQLite. Nightly `pg_dump` off the VPS is a gate before real data goes to prod.
- Bad, because every display path must format cents explicitly.

### Confirmation

Review rejects `real`, `double precision` or `numeric` columns for amounts. Postgres is reachable only on `127.0.0.1` locally and never published on the VPS.

## Pros and Cons of the Options

### SQLite

- Good, because no server to run, and trivial backups.
- Bad, because awkward with a separate worker process and multiple users writing.
