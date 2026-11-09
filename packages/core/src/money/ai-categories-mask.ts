// Masking of the free text that may go to a model for categorization (ADR-0016, point 2). The
// merchant's counterparty and description are sent; the user's own name, IBAN-shaped values and
// long digit runs are not. This is a different rule from the column mapping's scrubber (ADR-0015),
// which removes every word; here the words are the point, so only what is known to be personal is
// taken out. A name inside a merchant string that isn't the user's can't be recognized (ADR-0016,
// point 3).

// Longest text sent per field; masking comes first so a cut can't leave a piece of a name.
export const maxMerchantTextLength = 200;

// A name part shorter than this is too common in other words to mask.
const minNamePartLength = 3;

// Placeholders are private-use characters while masking runs, so a later step can't match inside
// an earlier one's output (a user called "Name" or "Iban"), and become words at the end.
const ibanMark = "";
const numberMark = "";
const nameMark = "";

// A compact IBAN: two letters, two digits, 11 to 30 letters or digits.
const compactIban = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/gi;
// The same in groups of up to four. A group after the second needs a digit, so the words that
// follow an IBAN aren't taken for its last groups.
const groupedIban = /\b[A-Z]{2}\d{2} [A-Z0-9]{4}(?: (?=[A-Z0-9]{0,3}\d)[A-Z0-9]{1,4}){2,7}\b/gi;
const minGroupedIbanLength = 15;
const maxGroupedIbanLength = 34;
// Card, account, reference and phone numbers; amounts and short numbers have fewer digits.
const longDigitRun = /\d{7,}/g;

// A character as its base letter, lower case, so "Ž" and "z" compare equal. One text character can
// become several (or none); `map` says which original character each came from.
function fold(text: string): { folded: string; origin: number[] } {
  let folded = "";
  const origin: number[] = [];
  let index = 0;
  for (const char of text) {
    const base = char.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    for (const part of base) {
      folded += part;
      for (let i = 0; i < part.length; i++) origin.push(index);
    }
    index += char.length;
  }
  return { folded, origin };
}

// What to look for in folded text (words are letters and digits only, so they are safe in a
// regular expression): the name's words joined by any separators ("Anne-Marie Dubois"
// and "ANNE MARIE  DUBOIS" are one name), and each word of 3 or more letters on its own.
function namePatterns(ownName: string): RegExp[] {
  const words = fold(ownName)
    .folded.split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "");
  const patterns = new Set<string>();
  if (words.join("").length >= minNamePartLength) {
    patterns.add(words.join(String.raw`[^\p{L}\p{N}]+`));
  }
  for (const word of words) if (word.length >= minNamePartLength) patterns.add(word);
  return [...patterns].map((pattern) => new RegExp(pattern, "gu"));
}

function maskName(text: string, ownName: string): string {
  const patterns = namePatterns(ownName);
  if (patterns.length === 0) return text;

  const { folded, origin } = fold(text);
  // [start, end) in the original text. Folding can change a character's length, so ranges are
  // taken through `origin`.
  const ranges: [number, number][] = [];
  for (const pattern of patterns) {
    for (const match of folded.matchAll(pattern)) {
      const start = origin[match.index]!;
      const last = origin[match.index + match[0].length - 1]!;
      ranges.push([start, endOfCharAt(text, last)]);
    }
  }
  if (ranges.length === 0) return text;

  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    // Touching ranges become one mark: "JORDANQUINN" is one name, not two.
    if (previous && range[0] <= previous[1]) previous[1] = Math.max(previous[1], range[1]);
    else merged.push([...range]);
  }

  let masked = "";
  let from = 0;
  for (const [start, end] of merged) {
    masked += text.slice(from, start) + nameMark;
    from = end;
  }
  return masked + text.slice(from);
}

function endOfCharAt(text: string, index: number): number {
  return index + (text.codePointAt(index)! > 0xffff ? 2 : 1);
}

// The text as the model may see it: whitespace collapsed, the user's own name (and each part of it
// of 3 or more letters, ignoring case and diacritics, wherever it appears) as [NAME], IBAN-shaped
// values as [IBAN] and digit runs of 7 or more as [NUMBER].
export function maskMerchantText(text: string, ownName: string): string {
  let masked = text.replace(/\s+/g, " ").trim();
  // The numbers first, on the original text: a name can't split an IBAN and leave its digits.
  masked = masked.replace(compactIban, ibanMark);
  masked = masked.replace(groupedIban, (match) => {
    const length = match.replace(/ /g, "").length;
    return length >= minGroupedIbanLength && length <= maxGroupedIbanLength ? ibanMark : match;
  });
  masked = masked.replace(longDigitRun, numberMark);
  masked = maskName(masked, ownName);
  return masked
    .replaceAll(ibanMark, "[IBAN]")
    .replaceAll(numberMark, "[NUMBER]")
    .replaceAll(nameMark, "[NAME]")
    .slice(0, maxMerchantTextLength);
}
