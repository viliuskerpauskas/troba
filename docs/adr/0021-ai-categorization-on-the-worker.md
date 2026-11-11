---
status: accepted
date: 2026-11-11
decision-makers: owner
---

# AI-suggested categories are asked for by the worker; no request waits on the model

## Context and Problem Statement

[ADR-0016](0016-ai-transaction-categorization.md) point 4 put the model calls for AI-suggested categories in the request that triggers them, because there was no worker yet: "Suggest categories" could make up to four sequential model requests of up to 30 seconds each inside one server action, and an import waited up to 8 seconds for the model before answering. A slow provider could hold a request that long, or past a proxy's timeout. The worker now exists ([ADR-0003](0003-pg-boss-for-background-jobs.md), and PDF import already runs on it, [ADR-0018](0018-pdf-statements-read-by-a-model.md)). Where should the categorization calls run, and how does the user learn how a run went (T144)?

## Decision Drivers

- No web request may wait on the model, however slow the provider is
- The button still tells the user how its run went: how many rows got a suggestion, or that the model failed or the daily cap stopped it
- The daily cap, the per-user opt-out, the masking and the no-logging rule of ADR-0016 hold unchanged
- One user's runs never touch or reveal another's (AGENTS.md)
- No new dependency

## Considered Options

- Keep the calls in the request, with a shorter bound on the whole action
- Queue a job per run on the worker, with a small user-owned run row the page reads back
- Queue a job per run and read its outcome from pg-boss's own job tables

## Decision Outcome

Chosen option: "Queue a job per run on the worker, with a small user-owned run row the page reads back", because it takes the model off every request path and keeps what the page reads in an app table that carries `user_id` like every other.

1. **A run.** Pressing "Suggest categories" (or "Ask again"), or saving an import with new rows, creates a row in `money_ai_categorize_runs` (the user, the import for an import's run, and once it ends the counts `suggestCategories` returns: merchants asked, rows suggested, failed, capped) and queues a `suggest-categories` job with `{ userId, runId }` in the same transaction. No merchant text is stored on the run.
2. **The job.** The worker runs `suggestCategories` for the run's user, scoped to its import if it has one, and records the result on the run. It runs only a run of that user's that has not finished, so a repeated job (pg-boss retries one after a crash) or one queued for another user does nothing. A worker without `OPENAI_API_KEY` records the run as failed.
3. **The button.** The action answers at once with the run under way; the page asks how it is going every few seconds and shows the same sentences as before once it is done, refreshing the list when rows got a suggestion. A button run already under way is the one followed rather than a second one. The transactions list, when it loads, follows a run of the user's still under way, so leaving and coming back works.
4. **An import.** The import result never waits: it says suggestions are being prepared and that they appear on the transactions list when ready. Each import gets at most one run. If the run can't be queued, the import is still saved and the result says suggestions are unavailable, as before. The run is queued after the import's transaction commits, as ADR-0016 required of the model call.
5. **A run that never ends.** A run not finished 15 minutes after it started (longer than its job can take with its one retry) is given up on: it reads as failed, its job does nothing if it ever runs, and the user can start another. Finished runs are deleted a day later, when the user starts another.
6. **Unchanged from ADR-0016.** The cap is claimed by the worker just before each model request, under the same per-user lock (`claimWithinDailyCap`); `AI_CATEGORIZE_DAILY_LIMIT` is now read by the worker. The opt-out is checked before a run is queued and again by the worker before anything is read or sent. Nothing from the exchange is logged; the job handler rethrows any unexpected error without its message, since pg-boss stores what a handler throws. The OpenAI categorization client moves from the web app to core, beside the statement client.

### Consequences

- Good, because a slow or failing provider can no longer hold a web request or meet a proxy timeout.
- Good, because the user can leave the page while a run works; the suggestions are on the list when they come back.
- Good, because the cap, opt-out and masking code paths are the same functions as before, now called from the worker.
- Bad, because an import's result can no longer say how many rows got a suggestion; it says they are being prepared, and the list shows them.
- Bad, because suggestions now depend on the worker running: with it stopped, a run stays under way until it is given up on after 15 minutes.
- Bad, because the page polls while a run is under way, a few small requests per run.

### Confirmation

- Integration tests in core check that a run is queued with its job, finishes with its result, runs once, does nothing for another user, is scoped to its import, keeps the daily cap, and is given up on when stale; that an import queues its run and answers without the model; and that an opted-out user or a server with no key queues nothing.
- The worker's integration tests run a queued run under the worker's daily limit, and check that no path of the model exchange in the job handler prints anything.
- The web actions' integration tests check that the button answers before the model is asked and reports each outcome once the run is done.

## Pros and Cons of the Options

### Keep the calls in the request, with a shorter bound

- Good, because it needs no new table and the answer comes in one round trip.
- Bad, because any bound short enough for a proxy cuts a healthy run of four batches short, and the request still waits on the provider.

### Read the outcome from pg-boss's job tables

- Good, because it needs no table of troba's own.
- Bad, because those tables are pg-boss's (ADR-0003) and have no `user_id` column; ownership would rest on the job's data, and pg-boss's retention would decide how long an outcome can be read.

## More Information

Supersedes point 4 ("When it runs") of [ADR-0016](0016-ai-transaction-categorization.md) as to where the model call is made and what the import waits for; the rest of ADR-0016 stands. [SPEC-money](../../SPEC-money.md) M5 describes the behaviour. Revisit if suggestions should be pushed to the page rather than polled for.
