---
status: accepted
date: 2026-11-10
decision-makers: owner
---

# PDF statements are read by a model; the whole statement may go to the provider, with consent on every import

## Context and Problem Statement

Importing statement files is the only way bank transactions reach troba ([ADR-0017](0017-enable-banking-for-bank-sync.md) rejected bank sync), and some banks give a usable statement only as a PDF, sometimes scanned. A PDF has no columns that stay put, so an import profile can't describe one. [ADR-0015](0015-import-presets-and-ai-mapping.md) lets only a scrubbed sample with no free text reach a model, and [ADR-0016](0016-ai-transaction-categorization.md) never sends person names or direct transfers. How does troba read a PDF statement, and what may leave the server to do it?

## Decision Drivers

- Statement PDFs, including scanned ones, must import without per-bank parser code
- Money must be right: a made-up or dropped row changes balances and spending
- A user must never send a whole statement to a third party without noticing
- A model call can take a minute and must not hold up a web request
- Free/open-source tools or free tiers (AGENTS.md)

## Considered Options

- Extract the text layer locally, rebuild a table from word positions, and use the import profile pipeline (AI only for the scrubbed mapping sample)
- Send the PDF to a model, which returns the transactions
- Extract text locally, replace IBANs and the user's name with reversible tokens, and send only that text
- Local text extraction first, the model as an opt-in fallback

## Decision Outcome

Chosen option: "Send the PDF to a model, which returns the transactions", because it is the only option that reads both text and scanned PDFs of any layout, and masking would leave counterparties' names in place anyway while losing the layout the model reads best.

This is a third, separate exception to ADR-0015's "no free text" rule. ADR-0015's mapping sample and ADR-0016's categorization keep their own rules.

1. PDF import exists only when the server has an OpenAI key. Without one, a PDF upload is refused with a message.
2. Before each PDF import, the user confirms a plain statement that the whole file is sent to the provider, including amounts, names and account numbers. There is no "don't ask again". The request asks the provider not to store it, and nothing from the exchange is logged.
3. The model returns a fixed transaction schema (date, signed decimal amount, currency, counterparty, counterparty IBAN, description, plus the statement's own IBAN, currency, and opening and closing balance when printed). It is parsed with Zod; amounts become integer cents from the decimal string, never through a float. PDFs have no import profile.
4. When the statement prints both balances, opening plus the sum of the amounts must equal closing, in cents, or the import is refused with the difference shown. When it doesn't print them, the preview says the total could not be checked.
5. Everything after that is the ordinary import: account matching, transfer detection, rules, preview, an all-or-nothing save, and AI categorization (ADR-0016).
6. The call runs as a pg-boss job in `apps/worker` ([ADR-0003](0003-pg-boss-for-background-jobs.md)), not in the request. The PDF is not stored; each row's raw JSONB is the model's row.
7. Limits: 5 MB, 20 pages, and a per-user daily cap of PDF imports (10 by default, overridable by env), separate from the other AI caps.

### Consequences

- Good, because any bank's PDF, scanned or not, imports without parser code or a mapping step.
- Good, because the balance check catches most made-up or dropped rows before anything is saved.
- Bad, because every PDF import sends the whole statement (the user's own name, address and IBAN, counterparties' names and IBANs, every amount) to the provider. The per-import consent makes this the user's choice each time; it doesn't make it private.
- Bad, because PDF rows carry no bank transaction id. Their dedup key is the date, amount and currency plus the row's occurrence, so re-importing the same PDF finds them, but a PDF and a CSV covering the same period don't recognize each other's rows. The preview warns when the account already has rows of the other kind in that date range.
- Bad, because the answer is not deterministic. A statement with no printed balances is checked only by the user's preview.
- Bad, because it brings `apps/worker` forward from the receipts-ocr feature.

### Confirmation

Tests with a recorded model answer cover: refusal without a key; refusal without the consent; a balance mismatch refused; a re-import of the same PDF finding every row as a duplicate; and user A's PDF import never reading or writing user B's data. A check confirms nothing from the exchange is logged.

## Pros and Cons of the Options

### Local table rebuild, AI only for the mapping sample

- Good, because the file never leaves the server and money stays deterministic.
- Bad, because scanned PDFs can't be read at all, and layouts with wrapped lines or repeated page headers rebuild unreliably.

### Reversible tokens over extracted text

- Good, because IBANs and the user's own name stay on the server.
- Bad, because counterparties' names still go, scanned PDFs still need the file itself, and the model loses the layout.

### Local first, model as fallback

- Good, because only PDFs that fail locally are sent.
- Bad, because it means building and maintaining both paths.

## More Information

Revisit if a local model good enough for statement extraction runs on the VPS, which would remove the need to send anything.
