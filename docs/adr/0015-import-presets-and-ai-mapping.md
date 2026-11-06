---
status: accepted
date: 2026-11-06
decision-makers: owner
---

# Bank names in preset data files; a scrubbed sample may go to a model provider

## Context and Problem Statement

Importing a bank CSV starts with a mapping form that asks every user to match columns, a date format, a decimal separator and debit values, and every user of the server repeats it for the same bank. [T122](https://github.com/viliuskerpauskas/troba/issues/122) fixes that with built-in bank presets and an AI-suggested mapping for formats troba has never seen. Both collide with written rules: [SPEC-money](../../SPEC-money.md) M3 said no bank-specific code ships in the repo, and the privacy rule in [AGENTS.md](../../AGENTS.md) forbids bank names anywhere in a public repo. A preset has to say which bank's format it reads, and an AI mapping has to send something derived from a user's file to a third party. Where may bank names appear, and what may leave the server?

## Decision Drivers

- The repo, issues, commits and PRs are public, so the privacy rule must stay clear and checkable
- A user should not need to know what a "debit value" is to import a file
- Bank data is personal: account numbers, names and merchants must not reach a third party
- Free/open-source tools or free tiers, no new dependency without a reason (AGENTS.md)

## Considered Options

- Keep "no bank names anywhere"; presets get anonymous names, AI sees the raw header and rows
- Allow bank names in preset data files only; send a scrubbed sample of unknown formats to a model provider
- Allow bank names anywhere in code; send the full file to a model provider
- No presets and no AI: keep the manual mapping form

## Decision Outcome

Chosen option: "Allow bank names in preset data files only; send a scrubbed sample of unknown formats to a model provider", because presets are only useful when the user can see which bank they match, and a scrubbed sample gives the model what it needs to tell a date format from a decimal separator without telling it who the user is.

1. **Bank names are allowed in preset data files and nowhere else.** A preset is one data file in the presets folder of the import module, describing one bank export format: a display name, the file's read settings, the header set it is recognized by and the profile fields. The folder's files (names and contents) and the registry inside that folder that lists them may name a bank. Everywhere else in the repo, in issues, commits and PRs, the existing rule holds: no bank names, countries, cities, real merchants, IBANs or real exports. Tests and fixtures stay fictional ("Example Bank", "GROCERY MART"), even those that exercise a real preset; a preset's header set and settings are copied across by hand from the gitignored `.private/` folder, as names and settings only, never rows.
2. **A scrubbed sample of an unknown format may be sent to a third-party model provider** (OpenAI, to suggest a column mapping), when the server owner has set `OPENAI_API_KEY`. With no key the feature is off and no text about it is shown. What is sent:
   - the detected header row, and up to five data rows after scrubbing: IBAN-shaped values and long digit runs are masked, cells that read as a date, an amount or a currency code are kept, and any other free text becomes a shape placeholder that keeps its length and character classes but none of its words;
   - for columns with few distinct values across the file (debit/credit markers, transaction types, currencies), those distinct values instead of sampled cells.

   What is never sent: the lines above the header (statement title, holder name, account number), the rest of the file, any word of a free-text cell, or anything for a file that matches a saved profile or a preset. The request asks the provider not to store it where its API offers that.
3. **Nothing from the exchange is logged**: not the payload, not the model's answer, in the success or the error path. This is the existing rule for raw rows and descriptions.
4. **Nothing is saved or imported on the model's say-so.** The answer is validated against the profile schema and a dry run of the file; a failing proposal is discarded. A surviving one only prefills the mapping form, marked as a suggestion, and takes effect when the user saves it.
5. **The server owner controls cost and exposure**: a per-user daily cap on AI mappings, the key and the model name set by environment variables, and the upload step telling the user about the sample before they upload when the feature is on.

### Consequences

- Good, because a known bank imports with no mapping step, and an unknown one arrives pre-filled.
- Good, because the privacy rule stays one sentence with one named exception that can be searched for: a bank name outside the presets folder is a finding.
- Good, because adding a bank is adding a data file, not parser code.
- Bad, because a bank name now sits in a public repo, so each preset is a deliberate act of the owner, and the exception must not creep into comments or tests.
- Bad, because a small part of a user's file leaves the server for an unknown format. Masking is by cell shape, not by understanding, so it can miss; the invariant is tested directly against fictional data, and the disclosure tells the user.
- Bad, because the feature depends on a third-party service. Any failure falls back to the manual form, which is always there.

### Confirmation

- A test iterates over every preset and checks its fictional fixture parses with no failed rows.
- A test on the model client's input checks that no IBAN, long digit run, free-text word or line above the header reaches it.
- Review question: does a bank name appear outside the presets folder, in a commit message or in an issue?

## Pros and Cons of the Options

### Keep "no bank names anywhere"; AI sees the raw header and rows

- Good, because the privacy rule stays absolute.
- Bad, because presets cannot say which bank they are for, and a raw sample sends personal data to a third party.

### Allow bank names anywhere in code; send the full file

- Good, because it is the least work.
- Bad, because the privacy rule becomes unenforceable, and the whole file, with names and merchants, leaves the server.

### No presets and no AI

- Good, because nothing changes and nothing leaves the server.
- Bad, because the first upload of every format stays a chore, repeated for every user.

## More Information

Spec: [T122](https://github.com/viliuskerpauskas/troba/issues/122). Amends the bank-names rule in [AGENTS.md](../../AGENTS.md), [CODING_STANDARDS.md](../../CODING_STANDARDS.md) and [docs/agents/issue-tracker.md](../agents/issue-tracker.md), and M3 of [SPEC-money](../../SPEC-money.md). The OpenAI API is called over plain HTTPS `fetch` with structured output; adopting the OpenAI SDK, or another provider, needs its own ADR. Revisit if a preset's header set or a sample ever has to carry something personal, or if a second provider is added.
