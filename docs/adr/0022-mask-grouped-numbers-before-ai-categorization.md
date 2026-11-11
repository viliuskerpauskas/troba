---
status: accepted
date: 2026-11-11
decision-makers: owner
---

# Hyphenated IBANs and card numbers written in groups are masked before AI categorization

## Context and Problem Statement

[ADR-0016](0016-ai-transaction-categorization.md) point 2 masks IBAN-shaped values and "long digit runs (7 or more digits with no separator)" in the merchant text sent for AI-suggested categories. In practice that meant an IBAN was masked compact or in groups separated by spaces, and a number only when its digits are unbroken. Two common ways of writing account data got through (T159, found while writing T143's tests, which pinned it):

- an IBAN in groups separated by hyphens (`DE89-3704-0044-0532-0130-00`): no IBAN pattern takes a hyphen and no group is 7 digits long;
- a card number in groups (`4000 0566 5566 5556`, `4000-0566-5566-5556`): it starts with digits, so no IBAN pattern fits, and no group is 7 digits long.

How far should the masking reach, without taking the dates, amounts and short references that help the model tell one merchant from another?

## Decision Drivers

- Account and card numbers must not reach the model provider in any common written form (ADR-0016)
- Dates, amounts and short reference numbers in a description are not personal and should stay
- The rule must be stateable in one sentence, for the spec and for the disclosure
- The column mapping's scrubber ([ADR-0015](0015-import-presets-and-ai-mapping.md)) already removes separators before it tests a cell, and is not changed

## Considered Options

- Strip every space and hyphen between digits, then mask runs of 7 or more
- Add two shape rules: a grouped IBAN may use hyphens, and digits written in groups that add up to a card number's length are masked
- Keep the rule as it is and disclose the gap

## Decision Outcome

Chosen option: "Add two shape rules", because it closes both gaps while leaving dates, amounts and short references as the model saw them before.

1. **A grouped IBAN** may be separated by single spaces or by single hyphens, one kind per value, otherwise as before: two letters, two digits, groups of up to four, 15 to 34 letters and digits in all, and a group after the second needs a digit so the words after an IBAN aren't taken for its last groups. It becomes `[IBAN]`.
2. **A card number written in groups**: three or more groups of 3 to 6 digits, separated by single spaces or by single hyphens, one kind per value, with 13 digits or more in all (the shortest card number). This takes 4-4-4-4, 4-6-5 and the longer forms. It becomes `[NUMBER]`, like a card number written in one run.
3. **Deliberately not masked by these rules**: a date (`2026-11-11`, `11-11-2026`: a group shorter than 3), an amount with grouped thousands (`1 234 567,89`, `12 345 678`: a short group or fewer than 13 digits), a short reference (`123-456-789`, `2026-0042`), digits in groups that add up to fewer than 13 (`1234 5678 9012`), and a terminal's masked card number (`****5556`). A phone number in groups is not taken either, unless its groups reach 13 digits; an unbroken run of 7 or more digits is still masked as before.

Every other part of ADR-0016 point 2 stands: the own-name masking, the compact IBAN, unbroken digit runs of 7 or more, and what is never sent.

### Consequences

- Good, because the two common written forms of an account or card number no longer reach the provider.
- Good, because the model still sees dates, amounts and short references, which carry no personal data.
- Bad, because a value written with mixed separators (`4000 0566-5566 5556`), or one split by other characters (dots, slashes), still passes; no statement seen prints one that way, and the rule can widen if one does.
- Bad, because three or more groups of 3 to 6 digits that add up to 13 or more are masked even when they are not a card (a list of amounts written without decimals); the cost is a word lost to the model, not data sent.

### Confirmation

- Unit tests on `maskMerchantText` check that a hyphenated IBAN and a card number in groups of spaces or hyphens (public test numbers) are masked, and that the dates, amounts and references in point 3 are not. Each fails when its rule is removed or loosened.

## Pros and Cons of the Options

### Strip every space and hyphen between digits, then mask runs of 7 or more

- Good, because it is one rule and catches any grouping.
- Bad, because it also takes dates (`2026-11-11` is 8 digits) and grouped amounts, which the model may use and which are not personal.

### Keep the rule and disclose the gap

- Good, because nothing changes.
- Bad, because a card number is exactly what the disclosure says is masked.

## More Information

Supersedes point 2 of [ADR-0016](0016-ai-transaction-categorization.md) as to which IBAN-shaped values and numbers are masked; the rest of ADR-0016 stands. [SPEC-money](../../SPEC-money.md) M5 describes the rule. The column-mapping scrubber of ADR-0015 is unchanged. Revisit if a statement prints account data in a form these rules miss.
