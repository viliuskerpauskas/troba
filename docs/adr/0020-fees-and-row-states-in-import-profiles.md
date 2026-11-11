---
status: accepted
date: 2026-11-11
decision-makers: owner
---

# A fee becomes its own transaction; rows that aren't completed are skipped

## Context and Problem Statement

Some bank exports charge a fee apart from the amount: the row has a signed amount, a separate fee column, and a balance that moves by both. Some also write each row's state, so a payment that is still pending, or was reverted, sits in the file beside completed ones. An import profile ([SPEC-money](../../SPEC-money.md#import-profile), [ADR-0015](0015-import-presets-and-ai-mapping.md)) read neither: the second preset ([T126](https://github.com/viliuskerpauskas/troba/issues/126)) imported an ATM withdrawal without its fee, so spending was understated, and imported pending and reverted rows like any other. [T129](https://github.com/viliuskerpauskas/troba/issues/129) asks how troba should treat both.

## Decision Drivers

- Spending must be counted to the cent: what troba imports has to move the balance as the bank's own balance column does
- Re-importing a file, or a later file that overlaps it, must not create duplicates (dedup keys stay stable)
- A transaction should keep the amount the bank shows for it, so the user can find it in their bank's app
- A row that may still change or never happen should not become a transaction that has to be fixed by hand later
- The user sees what was left out, as the preview already shows duplicates and failed rows

## Considered Options

- Fees: a fee transaction of its own, next to its payment
- Fees: folded into the payment's amount
- Non-completed rows: skipped, counted in the preview by state
- Non-completed rows: imported and flagged
- Non-completed rows: imported like any other (the status quo)

## Decision Outcome

Chosen options: **"a fee transaction of its own"** and **"skipped, counted in the preview by state"**, because the payment then keeps the bank's amount while the two together move the balance exactly as the file says, and a pending row is imported once it completes, with no state for troba to track in between.

1. **Two optional profile columns, `fee` and `state`, and a list of completed values.** They are profile data like the debit values, so a preset declares them and a user can map them in the form; a state column needs its completed values and the reverse. The AI mapping ([ADR-0015](0015-import-presets-and-ai-mapping.md)) leaves both unmapped: whether an amount already includes its fee, and which states mean completed, can't be told from a masked sample.
2. **A non-zero fee is money out, a transaction of its own.** It has the payment's row number, date, currency and counterparty, an amount of minus the fee's absolute value, the bank transaction type `Fee`, and the description `Fee` (or `Fee: <the payment's description>`). It has no counterparty IBAN, so a fee on a move between the user's own accounts is spending, not a transfer. A blank or zero fee adds nothing; a fee cell that isn't an amount fails the row.
3. **The fee's dedup key is the payment's key plus `:fee`.** The payment's own key is computed as before and doesn't depend on the fee, so a re-import matches both, and a file imported before fees were read gains only its fees on the next import.
4. **A row whose state isn't one of the completed values is skipped before it is read** (compared ignoring case; a blank state is not completed), so a pending row's missing completion date is not a failure. Skipped rows are neither new, duplicate nor failed: the preview lists them by state with a count, and says they come in with a later file once completed. The payment's date is its transaction date when the profile maps one, so its dedup key is the same once it completes.
5. **The preview's counts are transactions:** "New" and "Already imported" include fee transactions, and the preview says how many fees there are. "Rows in the file" stays the file's data rows.

### Consequences

- Good, because the imported amounts sum to the file's own balance change, which the preset test checks against the fixture's balance column.
- Good, because the payment's amount is the bank's, and the fee can be categorized (or found) on its own.
- Good, because nothing pending has to be edited or deleted later: troba imports only what happened.
- Bad, because a row can now give two transactions, so the preview's "New" can exceed the rows behind it; the preview says why.
- Bad, because a pending payment is invisible in troba until the user imports a file in which it completed.
- Bad, because a profile copied from the preset before this change keeps its old mapping (no fee, no state), and the user's saved copy wins over the preset. That user re-maps the profile in the form, or deletes it so the next upload copies the preset again. A data migration can't fix it without naming the bank outside the presets folder.
- Neutral: one nullable column on the profile table, `completed_values`; the two column names live in the existing `columns` JSON.

### Confirmation

- Unit tests on fictional rows: a fee row beside its payment with a derived key, the payment's key unchanged by the fee column, a fee written with a minus sign, a fee that isn't an amount, pending, reverted and blank states skipped and counted.
- Integration tests: preview and commit counts, a re-import that adds nothing, a file imported before fees were read gaining only its fees, a pending row imported once a later file has it completed.
- The preset contract test, for every preset: each row of its fixture is a payment or a skipped row, each non-zero fee a fee transaction, and the second preset's imported amounts match its fixture's balance column.

## Pros and Cons of the Options

### Fees folded into the payment's amount

- Good, because one row stays one transaction, and no profile column beyond the fee is needed.
- Bad, because the transaction no longer shows the amount the bank shows for it, and a fee can't be told apart from the purchase, or categorized differently.
- Bad, because changing the amount changes the row's dedup key, so a file imported before fees were read would import every fee-charged row again, as a duplicate.

### Non-completed rows imported and flagged

- Good, because a pending payment shows up in troba straight away.
- Bad, because a pending row can still change amount or be reverted, so troba would need a flag on transactions and a way to settle or remove it on a later import, which no other part of troba needs yet.

### Non-completed rows imported like any other

- Good, because it is the least work.
- Bad, because reverted payments count as spending, and a pending payment whose amount changes before it completes is imported twice: once as it was, once as it completed.

## More Information

Task: [T129](https://github.com/viliuskerpauskas/troba/issues/129). Extends the import profile in [SPEC-money](../../SPEC-money.md#import-profile) M3. Revisit if a bank writes a fee that is already included in its amount, a fee in another currency than the row's, or a refunded fee as a credit; or if pending payments should show before they complete.
