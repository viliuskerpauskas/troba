import { describe, expect, it } from "vitest";
import { aiCategorizeDailyLimitFrom, defaultAiCategorizeDailyLimit } from "./ai-categories-limit";

describe("aiCategorizeDailyLimitFrom", () => {
  it("is 200 merchants a day unless AI_CATEGORIZE_DAILY_LIMIT says otherwise", () => {
    expect(defaultAiCategorizeDailyLimit).toBe(200);
    expect(aiCategorizeDailyLimitFrom({})).toBe(200);
    expect(aiCategorizeDailyLimitFrom({ AI_CATEGORIZE_DAILY_LIMIT: " 50 " })).toBe(50);
  });

  it.each(["", "0", "-3", "2.5", "many", "1e999"])("ignores %j", (value) => {
    expect(aiCategorizeDailyLimitFrom({ AI_CATEGORIZE_DAILY_LIMIT: value })).toBe(200);
  });
});
