---
status: accepted
date: 2026-11-06
decision-makers: owner
---

# AI suggests categories for transactions no rule matched; merchant text may go to a model provider, person names and direct transfers may not

## Context and Problem Statement

[M5](../../SPEC-money.md) rules categorize a transaction only when the user has written a rule for its merchant, so every new merchant stays uncategorized until someone makes one. The owner wants AI to categorize those transactions. A model can only do that from the merchant text, and [ADR-0015](0015-import-presets-and-ai-mapping.md) allows the opposite: a sample for the column mapping never carries a word of free text, because masking is by cell shape. What may leave the server for categorization, when does it run, and how far is the answer trusted?

## Decision Drivers

- The repo is public and bank data is personal: real people's names and account numbers must not reach a third party
- A merchant name is what makes categorization possible, and is not personal the way a person's name is
- A wrong category changes spending totals, so a guess must not count until the user accepts it
- Import must never fail or slow down because of the model
- Free/open-source tools or free tiers, no new dependency without a reason (AGENTS.md)

## Considered Options

- Send nothing: keep rules only
- Send the merchant text of card and merchant rows; withhold own-name and direct transfers; the answer is a suggestion
- Send the merchant text; apply the answer directly, marked as AI
- Send every row, including transfers, scrubbed by shape as in ADR-0015
- Run a local model, so nothing leaves the server

## Decision Outcome

Chosen option: "Send the merchant text of card and merchant rows; withhold own-name and direct transfers; the answer is a suggestion", because the merchant text is the minimum a model needs, a person's name is the one thing the owner counts as personal in it, and a suggestion cannot change a total behind the user's back.

1. **Which rows are sent.** A transaction that no rule matched, that is not **Transfers**, that is not a manual entry and has no category yet. A **direct transfer** is never sent: a row with a counterparty IBAN, or one the import profile marks as a transfer. There the counterparty is usually a person and the description is free text ("rent from Anna"), so those rows stay uncategorized for the rules and the manual path.
2. **What is sent.** The counterparty and description of those rows and the names of the user's categories. Rows are grouped by distinct counterparty, so each merchant is asked once. Before sending, these are masked:
   - the user's own name and every part of it, taken from the account profile, wherever it appears in the text;
   - IBAN-shaped values and long digit runs (7 or more digits with no separator), as in ADR-0015.

   Never sent: amounts, dates, account data, the raw row, the file, other users' data, or anything from a direct transfer. The request asks the provider not to store it where its API offers that.
3. **Residual risk, stated plainly.** No scrubber can tell a person's name from a merchant's by shape ("JOHN SMITH" and "GROCERY MART" look alike), so a name inside a card-terminal string, such as a market stall or a sole trader, can reach the provider. The rule above keeps the common case out (own name and person-to-person transfers); the rest is accepted and disclosed.
4. **When it runs.** On import, for the rows in (1) after rules have run, and on demand through a button for older uncategorized rows. The model call happens after the import is saved, never inside its database transaction. If the call fails, times out, or the feature is off or capped, the import is unaffected and the rows simply stay uncategorized.
5. **A suggestion, never a category.** The answer is validated (a category id that belongs to the user, nothing else) and stored as a suggestion on the transaction. The transaction stays uncategorized and out of spending totals until the user accepts it, one at a time or in bulk, or dismisses it. A category set by hand is never overwritten, and a suggestion is dropped when a category is set another way. Nothing is saved as a rule on the model's say-so.
6. **Switch and cost control.** Off unless the server owner sets `OPENAI_API_KEY`; with no key no text about the feature is shown. The model name comes from an environment variable, and each user has a daily cap on categorized merchants, counted separately from the mapping cap in ADR-0015 (`AI_CATEGORIZE_DAILY_LIMIT` overrides the default). The upload step tells the user what is sent before they upload, when the feature is on.
7. **Nothing from the exchange is logged**: not the payload, not the model's answer, in the success or the error path.

### Consequences

- Good, because new merchants get a category without the user writing a rule, and a suggestion cannot skew a month's totals.
- Good, because the privacy line is one the owner can state: own name and person-to-person transfers never leave the server.
- Good, because a failing or absent model costs nothing: rules and manual categorization keep working.
- Bad, because merchant text for card payments now leaves the server, which ADR-0015 did not allow for the mapping sample; this ADR is a second, separate exception, and the mapping sample keeps its stricter masking.
- Bad, because masking by pattern can miss a person's name inside a merchant string (point 3).
- Bad, because the user still has to accept suggestions; the speed-up is in not having to choose, not in not having to look. Turning an accepted suggestion into a rule is left for a later ticket.
- Bad, because the feature depends on a third-party service and needs a schema addition (a suggestion per transaction).

### Confirmation

- A test on the model client's input checks that fictional own-name parts, IBANs, long digit runs and direct-transfer rows never reach it, and that amounts and dates are absent.
- A test checks that a suggestion leaves the row uncategorized and out of the monthly totals until accepted, and that a hand-set category is never replaced.
- A test checks that an import succeeds with the model failing, timing out and capped.
- Review question: does any log line or error path carry the payload or the answer?

## Pros and Cons of the Options

### Send nothing: keep rules only

- Good, because nothing leaves the server.
- Bad, because every new merchant needs a hand-written rule, the thing the owner wants to stop doing.

### Apply the answer directly, marked as AI

- Good, because it is the least clicking.
- Bad, because a wrong guess changes spending totals until someone notices and fixes it.

### Send every row, scrubbed by shape as in ADR-0015

- Good, because the masking rule stays one rule.
- Bad, because shape masking removes the merchant, which is what categorization needs; and without a words-allowed rule there is nothing for the model to read.

### Run a local model

- Good, because nothing leaves the server.
- Bad, because it needs more RAM and ops than the VPS is sized for ([ADR-0008](0008-vps-docker-compose-caddy.md)); revisit if hardware changes.

## More Information

Amends the "no word of a free-text cell" rule in ADR-0015 for this feature only; the column-mapping sample is unchanged. Adds a section to [SPEC-money](../../SPEC-money.md) (M5) when the spec is written. Same transport as ADR-0015: plain HTTPS `fetch` with structured output; adopting an SDK, or another provider, needs its own ADR. Revisit if a person's name is found in a sent payload, if a second provider is added, or to let an accepted suggestion create an M5 rule.
