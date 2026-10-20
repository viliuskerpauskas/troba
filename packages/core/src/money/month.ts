// Calendar months as YYYY-MM, the report's and the transaction list's unit (SPEC-money M7, M8).

// 1900-01 to 9999-12: four-digit years Postgres takes as dates (it refuses year 0000), and
// nothing a person tracks happened earlier.
const monthPattern = /^(19\d\d|[2-9]\d{3})-(0[1-9]|1[0-2])$/;

export function isMonth(value: string): boolean {
  return monthPattern.test(value);
}

function format(year: number, monthNumber: number): string {
  return `${String(year).padStart(4, "0")}-${String(monthNumber).padStart(2, "0")}`;
}

// The month n months after (or before, for negative n) the given one.
export function addMonths(month: string, n: number): string {
  const [year, monthNumber] = month.split("-").map(Number) as [number, number];
  const index = year * 12 + (monthNumber - 1) + n;
  return format(Math.floor(index / 12), (index % 12) + 1);
}

// YYYY-MM → the first day of that month and of the next, as YYYY-MM-DD.
export function monthRange(month: string): [from: string, to: string] {
  return [`${month}-01`, `${addMonths(month, 1)}-01`];
}

// The server's clock is UTC, as the new-transaction form's default date is.
export function monthOf(date: Date): string {
  return format(date.getUTCFullYear(), date.getUTCMonth() + 1);
}
