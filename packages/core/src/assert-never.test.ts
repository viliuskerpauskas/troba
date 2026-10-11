import { describe, expect, it } from "vitest";
import { assertNever } from "./assert-never";

describe("assertNever", () => {
  it("throws with the unexpected value", () => {
    expect(() => assertNever("surprise" as never)).toThrow('Unexpected value: "surprise"');
  });

  it("serializes bigint fields instead of failing on them", () => {
    expect(() => assertNever({ amount: 1n } as never)).toThrow('Unexpected value: {"amount":"1"}');
  });
});
