---
status: accepted
date: 2026-10-11
decision-makers: owner
---

# Node worker with pg-boss for background jobs

## Context and Problem Statement

Later modules need work outside the request cycle: receipt OCR, scheduled bank sync, voice-to-entry. Which job queue should the worker use? ([stack-options §3](../ideas/stack-options.md#3-background-jobs-node-worker--pg-boss-))

## Decision Drivers

- No extra service to run and back up on a single VPS
- Retries, cron schedules and singleton jobs
- Low volume (a handful of users)

## Considered Options

- pg-boss (queue in Postgres)
- Graphile Worker (queue in Postgres)
- BullMQ + Redis
- Temporal
- Plain cron

## Decision Outcome

Chosen option: "pg-boss", because the queue lives in the Postgres we already run, and it covers retries, cron and singleton jobs.

The worker is a separate Node app (`apps/worker`) sharing `packages/db` and `packages/core`. It's added with the receipts-ocr module; v1 CSV imports run synchronously in the web app.

### Consequences

- Good, because there's no Redis container, and jobs are included in the database backup.
- Good, because jobs can be enqueued in the same transaction as the data they act on.
- Bad, because throughput is lower than Redis queues, which doesn't matter at this scale.
- Bad, because a smaller community than BullMQ.

## Pros and Cons of the Options

### Graphile Worker

- Good, because also Postgres-based and very fast. Either would work.
- Neutral, because pg-boss's built-in cron and singleton options map more directly to the planned jobs.

### BullMQ + Redis

- Good, because more features and a dashboard.
- Bad, because one more container to run and back up.

### Temporal

- Bad, because overkill for a few users.

### Plain cron

- Bad, because no retries or job history.

## More Information

Checked 2026-10-11 on npm: `pg-boss` `latest` is 12.37.1 (10.x is a maintenance line). Re-check the major's API when `apps/worker` is added.
