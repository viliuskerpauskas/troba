import { expect, it } from "vitest";

// Temporary: proves the main ruleset blocks merging a red PR. Reverted in the next commit.
it("fails on purpose", () => {
  expect(1).toBe(2);
});
