import { describe, expect, it } from "vitest";
import { maskMerchantText } from "./ai-categories-mask";

describe("maskMerchantText", () => {
  it("leaves a merchant name alone", () => {
    expect(maskMerchantText("GROCERY MART 24/7", "Example User")).toBe("GROCERY MART 24/7");
  });

  it("masks the full name and each part of 3 or more letters, ignoring case", () => {
    expect(maskMerchantText("Payment by jordan quinn", "Jordan Quinn")).toBe("Payment by [NAME]");
    expect(maskMerchantText("QUINN, J. at GROCERY MART", "Jordan Quinn")).toBe(
      "[NAME], J. at GROCERY MART",
    );
    expect(maskMerchantText("JORDAN card payment", "Jordan Quinn")).toBe("[NAME] card payment");
  });

  it("matches across diacritics in either the name or the text", () => {
    expect(maskMerchantText("PAYMENT ŽOË EXAMPLE", "Zoe Example")).toBe("PAYMENT [NAME]");
    expect(maskMerchantText("Payment Zoe", "Zoë Example")).toBe("Payment [NAME]");
  });

  it("matches letters that have an ASCII spelling but no combining mark", () => {
    expect(maskMerchantText("CARD LUKASZ EXAMPLE", "Łukasz Example")).toBe("CARD [NAME]");
    expect(maskMerchantText("Payment Łukasz", "Lukasz Example")).toBe("Payment [NAME]");
    expect(maskMerchantText("SOREN SHOP", "Søren Example")).toBe("[NAME] SHOP");
    expect(maskMerchantText("STRASSE CAFE", "Straße Example")).toBe("[NAME] CAFE");
    expect(maskMerchantText("DJORDJE KIOSK", "Đorđe Example")).toBe("DJORDJE KIOSK");
    expect(maskMerchantText("DORDE KIOSK", "Đorđe Example")).toBe("[NAME] KIOSK");
  });

  it("drops its own placeholder characters from the input", () => {
    expect(maskMerchantText("PAY \uE000 \uE001 \uE002 MART", "X")).toBe("PAY MART");
  });

  it("masks a name inside a longer string", () => {
    expect(maskMerchantText("PAYPAL*JORDANQUINN 4029357733", "Jordan Quinn")).toBe(
      "PAYPAL*[NAME] [NUMBER]",
    );
    expect(maskMerchantText("Jordan's Kiosk", "Jordan Quinn")).toBe("[NAME]'s Kiosk");
  });

  it("leaves short name parts alone", () => {
    expect(maskMerchantText("AL LI SHOP", "Al Li")).toBe("[NAME] SHOP");
    expect(maskMerchantText("AL SHOP, LI KIOSK", "Al Li")).toBe("AL SHOP, LI KIOSK");
    expect(maskMerchantText("Jo at the Mart", "Jo Quinn")).toBe("Jo at the Mart");
    expect(maskMerchantText("Berg bakery", "Jan Berg")).toBe("[NAME] bakery");
  });

  it("masks hyphenated and multi-part names part by part", () => {
    expect(maskMerchantText("Anne-Marie Dubois Ltd", "Anne-Marie Dubois")).toBe("[NAME] Ltd");
    expect(maskMerchantText("MARIE SHOP", "Anne-Marie Dubois")).toBe("[NAME] SHOP");
  });

  it("copes with a missing or blank name", () => {
    expect(maskMerchantText("GROCERY MART", "")).toBe("GROCERY MART");
    expect(maskMerchantText("GROCERY MART", "  ")).toBe("GROCERY MART");
  });

  it("masks IBAN-shaped values, compact or in groups", () => {
    expect(maskMerchantText("Rent DE89370400440532013000 monthly", "X")).toBe(
      "Rent [IBAN] monthly",
    );
    expect(maskMerchantText("to DE89 3704 0044 0532 0130 00 thanks", "X")).toBe("to [IBAN] thanks");
    expect(maskMerchantText("ref:de89370400440532013000", "X")).toBe("ref:[IBAN]");
  });

  it("does not let a grouped IBAN swallow the words after it", () => {
    expect(maskMerchantText("DE89 3704 0044 0532 0130 00 GROCERY MART", "X")).toBe(
      "[IBAN] GROCERY MART",
    );
  });

  it("masks digit runs of 7 or more and keeps shorter ones", () => {
    expect(maskMerchantText("CARD 1234567 GROCERY MART 24", "X")).toBe(
      "CARD [NUMBER] GROCERY MART 24",
    );
    expect(maskMerchantText("order 123456 and 9876543210", "X")).toBe("order 123456 and [NUMBER]");
  });

  it("collapses whitespace and bounds the length", () => {
    expect(maskMerchantText("  GROCERY \n  MART  ", "X")).toBe("GROCERY MART");
    expect(maskMerchantText("A".repeat(500), "X")).toHaveLength(200);
  });
});
