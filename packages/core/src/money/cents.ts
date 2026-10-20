// Amounts as text ↔ integer cents, without going through a float (SPEC-money M2, M3). Every
// currency is taken to have two minor digits, as the spec's amount_cents does.

export type DecimalSeparator = "." | ",";

// Enough for any real amount, and far inside bigint's range.
const maxIntegerDigits = 15;

// Thousands may be grouped by the other separator or by a space (banks print a no-break space).
const groupSeparators: Record<DecimalSeparator, string> = {
  ".": ",   ",
  ",": ".   ",
};

const patterns = new Map(
  (Object.keys(groupSeparators) as DecimalSeparator[]).map((decimal) => {
    const group = `[${groupSeparators[decimal]}]`;
    const point = decimal === "." ? "\\." : ",";
    // One grouping character throughout, in groups of three; at most two decimals.
    const integer = `\\d{1,3}(?<group>${group})\\d{3}(?:\\k<group>\\d{3})*|\\d+`;
    return [
      decimal,
      new RegExp(`^(?<sign>[+-])?(?<integer>${integer})?(?:${point}(?<fraction>\\d{1,2}))?$`),
    ];
  }),
);

// Returns null for anything that isn't exactly an amount: more than two decimals is refused,
// never rounded.
export function parseCents(
  text: string,
  options: { decimalSeparator?: DecimalSeparator } = {},
): bigint | null {
  const match = patterns.get(options.decimalSeparator ?? ".")!.exec(text.trim());
  if (!match) return null;
  const { sign, integer, fraction } = match.groups!;
  if (integer === undefined && fraction === undefined) return null;

  const digits = (integer ?? "").replace(/\D/g, "");
  if (digits.length > maxIntegerDigits) return null;
  const cents = BigInt(digits || "0") * 100n + BigInt((fraction ?? "").padEnd(2, "0"));
  return sign === "-" ? -cents : cents;
}

// An amount a person typed into a form. Phone keyboards in many languages offer a decimal comma,
// so a comma is the decimal when there is no point; a point is always the decimal. "12.345" and
// "1,234" are refused rather than read as thousands.
export function parseTypedCents(text: string): bigint | null {
  return parseCents(text, { decimalSeparator: text.includes(".") ? "." : "," });
}

// "-12.50" for -1250n: a decimal string Intl.NumberFormat formats exactly.
export function centsToDecimal(cents: bigint): string {
  const magnitude = cents < 0n ? -cents : cents;
  const units = magnitude / 100n;
  const fraction = (magnitude % 100n).toString().padStart(2, "0");
  return `${cents < 0n ? "-" : ""}${units}.${fraction}`;
}
