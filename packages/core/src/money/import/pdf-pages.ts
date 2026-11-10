import { inflateSync } from "node:zlib";

// How many pages a PDF has, read without a PDF library (T154): the page limit only needs the number,
// and it is checked before anything is sent to the model. The page tree's root says it as /Count;
// since PDF 1.5 that dictionary can sit in a compressed object stream, which is inflated to look.
// Null when the file doesn't say (encrypted object streams, say), and the PDF is then refused.

// The PDF the model is sent may not have more pages than this (SPEC-money M3).
export const maxPdfPages = 20;

// A bound on what the object streams may inflate to, together, so a crafted file (many small
// deflate bombs) can't exhaust memory. Past it the count is unknown, and the PDF is refused.
const maxInflatedBytes = 8 * 1024 * 1024;

const nameEnd = String.raw`(?![A-Za-z0-9#_.\-])`;
const pagesType = new RegExp(String.raw`/Type\s*/Pages${nameEnd}`, "g");
const pageType = new RegExp(String.raw`/Type\s*/Page${nameEnd}`, "g");
const count = /\/Count\s+(\d+)/;

export function countPdfPages(bytes: Uint8Array): number | null {
  const raw = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");
  const streams = objectStreams(raw);
  if (streams === null) return null;
  const texts = [raw, ...streams];

  let treeCount: number | null = null;
  let pageObjects = 0;
  for (const text of texts) {
    for (const match of text.matchAll(pagesType)) {
      const [start, end] = enclosingDict(text, match.index);
      const found = count.exec(text.slice(start, end));
      if (found) treeCount = Math.max(treeCount ?? 0, Number(found[1]));
    }
    pageObjects += [...text.matchAll(pageType)].length;
  }
  if (treeCount !== null) return treeCount;
  return pageObjects > 0 ? pageObjects : null;
}

// The inflated contents of the file's object streams (/Type /ObjStm), the ones that inflate; null
// once they inflate to more than maxInflatedBytes together.
function objectStreams(raw: string): string[] | null {
  const inflated: string[] = [];
  let budget = maxInflatedBytes;
  const streamStart = /stream\r?\n/g;
  for (const match of raw.matchAll(streamStart)) {
    // Not the tail of "endstream".
    if (raw.slice(match.index - 3, match.index) === "end") continue;
    const dict = raw.slice(raw.lastIndexOf("obj", match.index), match.index);
    if (!dict.includes("/ObjStm")) continue;
    const from = match.index + match[0].length;
    const to = raw.indexOf("endstream", from);
    if (to === -1) continue;
    let data: Buffer;
    try {
      data = inflateSync(Buffer.from(raw.slice(from, to), "latin1"), {
        maxOutputLength: budget + 1,
      });
    } catch (error) {
      // Past what is left of the bound: the file is refused, whatever the rest says.
      if ((error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") return null;
      // Not deflated or encrypted: it says nothing about the pages.
      continue;
    }
    budget -= data.byteLength;
    if (budget < 0) return null;
    inflated.push(data.toString("latin1"));
  }
  return inflated;
}

// The bounds of the << … >> dictionary around `index`, nested dictionaries skipped.
function enclosingDict(text: string, index: number): [number, number] {
  let start = 0;
  for (let i = index, depth = 0; i > 0; i--) {
    const pair = text.slice(i - 1, i + 1);
    if (pair === ">>") {
      depth++;
      i--;
    } else if (pair === "<<") {
      if (depth === 0) {
        start = i - 1;
        break;
      }
      depth--;
      i--;
    }
  }
  let end = text.length;
  for (let i = index, depth = 0; i < text.length - 1; i++) {
    const pair = text.slice(i, i + 2);
    if (pair === "<<") {
      depth++;
      i++;
    } else if (pair === ">>") {
      if (depth === 0) {
        end = i + 2;
        break;
      }
      depth--;
      i++;
    }
  }
  return [start, end];
}
