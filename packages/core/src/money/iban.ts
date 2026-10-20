// IBANs (ISO 13616): stored upper case without spaces, so the same account always compares equal.
// Only the shape and the check digits are checked, not each country's length; that catches typos
// without a per-country table.

const shape = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/;

// The normalized IBAN, or null when it isn't one.
export function parseIban(input: string): string | null {
  const iban = input.replace(/\s+/g, "").toUpperCase();
  if (!shape.test(iban)) return null;
  // Move the country and check digits to the end, letters become 10–35, and the number mod 97
  // must be 1. Computed piecewise: the number has up to 70 digits.
  const digits = [...(iban.slice(4) + iban.slice(0, 4))]
    .map((char) => Number.parseInt(char, 36).toString())
    .join("");
  let remainder = 0;
  for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder === 1 ? iban : null;
}
