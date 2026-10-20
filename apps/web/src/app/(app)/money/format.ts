import { centsToDecimal } from "@troba/core";

// Display only. Formatting the decimal string, not a Number, keeps every cent exact. Amounts are
// stored with two minor digits in every currency, so the format shows exactly two: a currency's
// own digits would round (JPY) or pad (BHD) what is stored.
export function formatAmount(
  cents: bigint,
  currency: string,
  // Unsigned for totals and report figures, where a sign would say nothing.
  options: { signed?: boolean } = {},
): string {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    signDisplay: (options.signed ?? true) ? "exceptZero" : "never",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(centsToDecimal(cents) as Intl.StringNumericLiteral);
}
