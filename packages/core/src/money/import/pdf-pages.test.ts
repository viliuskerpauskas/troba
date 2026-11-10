import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { countPdfPages } from "./pdf-pages";

// Fictional PDFs, built as text: only the parts the page count reads.

const encode = (text: string) => new TextEncoder().encode(text);

function pageObjects(count: number, from = 3) {
  return Array.from(
    { length: count },
    (_, i) => `${from + i} 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n`,
  ).join("");
}

function plainPdf(pages: number) {
  return encode(
    [
      "%PDF-1.4",
      "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj",
      `2 0 obj\n<< /Type /Pages /Kids [] /Count ${pages} >>\nendobj`,
      pageObjects(pages),
      "%%EOF",
    ].join("\n"),
  );
}

// PDF 1.5+: the page tree sits in a compressed object stream, invisible in the raw bytes.
function compressedPdf(pages: number) {
  const objects = `<</Type/Pages/Count ${pages}/Kids[]>>${pageObjects(pages)}`;
  const stream = deflateSync(Buffer.from(objects, "latin1"));
  const head = encode(
    `%PDF-1.7\n5 0 obj\n<< /Type /ObjStm /Filter /FlateDecode /Length ${stream.length} >>\nstream\n`,
  );
  const tail = encode("\nendstream\nendobj\n%%EOF\n");
  return new Uint8Array([...head, ...stream, ...tail]);
}

describe("countPdfPages", () => {
  it.each([1, 20, 21])("reads the page tree's count of %i pages", (pages) => {
    expect(countPdfPages(plainPdf(pages))).toBe(pages);
  });

  it("reads a page tree kept in a compressed object stream", () => {
    expect(countPdfPages(compressedPdf(37))).toBe(37);
  });

  it("takes the largest count, the root's, when the tree has branches", () => {
    const bytes = encode(
      [
        "%PDF-1.4",
        "2 0 obj\n<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 30 >>\nendobj",
        "3 0 obj\n<< /Type /Pages /Parent 2 0 R /Count 10 >>\nendobj",
        "4 0 obj\n<< /Count 20 /Parent 2 0 R /Type /Pages >>\nendobj",
      ].join("\n"),
    );
    expect(countPdfPages(bytes)).toBe(30);
  });

  it("counts the page objects when there is no page tree count", () => {
    expect(countPdfPages(encode(`%PDF-1.4\n${pageObjects(4)}`))).toBe(4);
  });

  it("doesn't take the page tree's /Type /Pages for a page", () => {
    expect(countPdfPages(encode("%PDF-1.4\n<< /Type /Pages /Kids [] >>\n"))).toBeNull();
  });

  it("is null when it can't tell", () => {
    expect(countPdfPages(encode("%PDF-1.7\n% a fictional statement\n"))).toBeNull();
  });

  it("is null once the object streams inflate to more than 8 MB together", () => {
    // Each stream inflates to 1 MB, well under the bound alone; nine of them pass it.
    const padding = " ".repeat(1024 * 1024 - 100);
    const stream = deflateSync(Buffer.from(`<</Type/Pages/Count 3/Kids[]>>${padding}`, "latin1"));
    const object = (n: number) =>
      new Uint8Array([
        ...encode(`${n} 0 obj\n<< /Type /ObjStm /Filter /FlateDecode >>\nstream\n`),
        ...stream,
        ...encode("\nendstream\nendobj\n"),
      ]);
    const pdf = (streams: number) =>
      new Uint8Array([
        ...encode("%PDF-1.7\n"),
        ...Array.from({ length: streams }, (_, i) => [...object(i + 1)]).flat(),
        ...encode("%%EOF\n"),
      ]);

    expect(countPdfPages(pdf(7))).toBe(3);
    expect(countPdfPages(pdf(9))).toBeNull();
  });

  it("skips a stream that doesn't inflate", () => {
    const bytes = encode(
      `%PDF-1.7\n<< /Filter /FlateDecode >>\nstream\nnot deflated\nendstream\n${pageObjects(2)}`,
    );
    expect(countPdfPages(bytes)).toBe(2);
  });
});
