import { centsToDecimal } from "@troba/core";

// Display only. Formatting the decimal string, not a Number, keeps every cent exact.
export function formatAmount(cents: bigint, currency: string): string {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    signDisplay: "exceptZero",
  }).format(centsToDecimal(cents) as Intl.StringNumericLiteral);
}
