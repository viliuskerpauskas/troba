import { describe, expect, it } from "vitest";
import { matchingRule, type RuleMatcher } from "./rules";

const rule = (id: string, field: RuleMatcher["field"], pattern: string): RuleMatcher => ({
  id,
  field,
  pattern,
  categoryId: `category-${id}`,
});

describe("matching rules", () => {
  it("matches text the field contains, ignoring case", () => {
    const rules = [rule("food", "counterparty", "grocery mart")];

    expect(matchingRule(rules, { counterparty: "CARD GROCERY MART 12", description: null })).toBe(
      rules[0],
    );
    expect(matchingRule(rules, { counterparty: "GROCERY MALL", description: null })).toBeNull();
  });

  it("looks only at the rule's field", () => {
    const rules = [rule("fee", "description", "Monthly fee")];

    expect(matchingRule(rules, { counterparty: "EXAMPLE BANK", description: "monthly FEE" })).toBe(
      rules[0],
    );
    expect(
      matchingRule(rules, { counterparty: "Monthly fee", description: "Card purchase" }),
    ).toBeNull();
  });

  it("never matches a field the transaction doesn't have", () => {
    const rules = [rule("any", "description", "a")];

    expect(matchingRule(rules, { counterparty: "A", description: null })).toBeNull();
  });

  it("takes the first matching rule in order", () => {
    const rules = [
      rule("coffee", "description", "coffee"),
      rule("food", "counterparty", "MART"),
      rule("shopping", "counterparty", "GROCERY"),
    ];

    expect(
      matchingRule(rules, { counterparty: "GROCERY MART", description: "Card purchase" }),
    ).toBe(rules[1]);
    expect(matchingRule(rules, { counterparty: "GROCERY MART", description: "coffee" })).toBe(
      rules[0],
    );
  });
});
