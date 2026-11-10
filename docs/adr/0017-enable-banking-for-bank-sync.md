---
status: rejected
date: 2026-11-10
decision-makers: owner
---

# Bank sync through Enable Banking (rejected: file import stays the primary path)

**Rejected 2026-11-10, for legal reasons.** troba does not sync from banks. Importing statement files (SPEC-money M3) stays the primary way transactions arrive. The analysis below was written when the option below was the intended choice, and is kept so it isn't redone; revisit it only if the legal position changes.

## Context and Problem Statement

Importing bank CSVs means mapping columns and remembering to upload. The owner wants troba to sync transactions from the bank instead, through an open-banking (PSD2 account information) aggregator, for the owner plus one to four friends, permanently and at no cost. Which aggregator, and on what terms? CSV import (SPEC-money M3) stays as the fallback, and for history older than the sync window.

## Decision Drivers

- Free, permanent use: no trial window, no fees ("free/open-source tools or generous free tiers", AGENTS.md)
- Usable by a private individual, with no company and no contract
- Each of a handful of users syncs only their own banks; one user never sees another's data
- troba may later open to the public. Then a paid, contracted provider is acceptable, so the provider sits behind one seam

## Considered Options

- Enable Banking, restricted production mode, one application per user (bring your own credentials)
- Enable Banking, restricted mode, one application owned by the owner
- Salt Edge, through its Partner Program
- GoCardless Bank Account Data (formerly Nordigen)

## Decision Outcome

Chosen option: "Enable Banking, restricted production mode, one application per user", because it's the only option found that a private individual can use permanently for free, and giving each user their own application keeps each user's bank access in their own hands.

1. Each user registers their own free Enable Banking application, links their own bank accounts to it, and gives troba its application id and private key.
2. troba talks to Enable Banking only through one bank-sync provider interface in `packages/core`, so another provider can replace it without touching the rest of the money module.
3. Each user's application id and private key are stored encrypted in the database (AES-256-GCM with Node's built-in `crypto`, under a server-side key from an env var), so a leaked database backup alone can't read anyone's bank data. A user can replace or delete their credentials at any time.
4. Staging uses Enable Banking's sandbox (mock banks) only, with its own application; real bank data exists only in production.

### Consequences

- Good, because there's no cost, no contract and no trial window.
- Good, because a user's credentials can only read that user's linked accounts, and the user can revoke them in Enable Banking's control panel without the owner.
- Bad, because every user does a one-time setup outside troba (register an application, whitelist troba's redirect URL, link accounts), which troba has to explain step by step.
- Bad, because troba stores a private key per user that can read their bank data while a consent is active, so the keys need protecting at rest.
- Bad, because restricted mode is described as being for internal testing and personal use; if its terms change, sync stops and CSV import is the fallback.
- Bad, because consents expire (typically after 180 days) and each user has to reconnect.

### Confirmation

An integration test shows that user A's bank connections, credentials and synced transactions are invisible to user B. A test against the Enable Banking sandbox (or a recorded fake of it) covers connecting, syncing and an expired consent.

## Pros and Cons of the Options

### Enable Banking, restricted mode, one application owned by the owner

- Good, because there's one setup, done once, by the owner.
- Bad, because the API returns only accounts linked by the application's owner and strips out the rest, so friends can't sync.

### Salt Edge Partner Program

- Good, because the API is mature, and it refreshes connections automatically every day.
- Bad, because both its "Client" and "Partner" are defined as legal entities, and the Partner Program asks for a company and a signed agreement. It publishes no prices.
- Bad, because its Test status (live banks, at most 100 connections) lasts 90 days, so it isn't permanent without a contract.
- The candidate if troba opens to the public.

### GoCardless Bank Account Data

- Bad, because neither its sign-up status nor its free tier could be confirmed: the product pages cover payments only, and the portal sits behind a login.

## More Information

Sources checked 2026-11-06:
- Enable Banking docs (FAQ, control panel, quick start): https://enablebanking.com/docs/
- Salt Edge API v6 docs: https://docs.saltedge.com/v6/
- Salt Edge Partner Program: https://saltedge.com/products/account_information/partner_program

Unconfirmed when this was written: any cap on linked accounts or time limit in Enable Banking's restricted mode. Its terms page didn't load. Re-check them before production.

Revisit when troba is opened to people outside the owner's circle, or if Enable Banking's restricted mode changes.
