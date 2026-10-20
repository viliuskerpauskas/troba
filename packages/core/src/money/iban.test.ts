import { describe, expect, it } from "vitest";
import { parseIban } from "./iban";

// Fictional IBANs: made-up bank codes and account numbers with valid check digits.

describe("parseIban", () => {
  it("accepts an IBAN and returns it upper case without spaces", () => {
    expect(parseIban("de50 0000 0000 0123 4567 89")).toBe("DE50000000000123456789");
    expect(parseIban(" NL13TEST0123456789 ")).toBe("NL13TEST0123456789");
    expect(parseIban("FR49 0000 0000 0000 0000 0000 001")).toBe("FR4900000000000000000000001");
  });

  it("rejects wrong check digits", () => {
    expect(parseIban("DE51000000000123456789")).toBeNull();
    expect(parseIban("NL13TEST0123456798")).toBeNull();
  });

  it("rejects what isn't shaped like an IBAN", () => {
    expect(parseIban("")).toBeNull();
    expect(parseIban("1234567890")).toBeNull();
    expect(parseIban("DE50-0000-0000-0123-4567-89")).toBeNull();
    expect(parseIban("DE50")).toBeNull();
    expect(parseIban(`DE50${"0".repeat(40)}`)).toBeNull();
  });
});
