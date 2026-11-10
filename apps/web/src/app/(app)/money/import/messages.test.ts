import { describe, expect, it } from "vitest";
import {
  pagesUnknownMessage,
  pdfDailyLimitMessage,
  pdfReadingCappedMessage,
  tooManyPagesMessage,
} from "./messages";

// The PDF limits' messages (T154): when the next PDF import is possible is said relative to now,
// since the server doesn't know the user's time zone.

const now = new Date("2026-03-02T12:00:00Z");
const later = (minutes: number) => new Date(now.getTime() + minutes * 60_000);

describe("pdfDailyLimitMessage", () => {
  it("says how many the day allows and when the next is possible", () => {
    expect(pdfDailyLimitMessage(10, later(179.5), now)).toBe(
      "You've used today's 10 PDF imports, so nothing was sent. You can import a PDF again in about 3 hours.",
    );
  });

  it("says one import, not one imports", () => {
    expect(pdfDailyLimitMessage(1, later(30), now)).toMatch(/^You've used today's 1 PDF import,/);
  });

  it.each([
    [-5, "You can import a PDF again now."],
    [0.2, "You can import a PDF again in a minute."],
    [42, "You can import a PDF again in 42 minutes."],
    [75, "You can import a PDF again in about an hour."],
    [23 * 60 + 50, "You can import a PDF again in about 24 hours."],
  ])("in %f minutes: %s", (minutes, when) => {
    expect(pdfDailyLimitMessage(10, later(minutes), now)).toContain(when);
  });

  it("says now when no place is held", () => {
    expect(pdfDailyLimitMessage(10, null, now)).toContain("You can import a PDF again now.");
  });
});

describe("pdfReadingCappedMessage", () => {
  it("says the statement wasn't sent and nothing saved, and when", () => {
    expect(pdfReadingCappedMessage(1, later(60), now)).toBe(
      "You'd already used today's 1 PDF import, so the statement wasn't sent to AI. Nothing was saved. You can import a PDF again in about an hour.",
    );
  });
});

describe("tooManyPagesMessage", () => {
  it("says the pages, the limit and to split it", () => {
    expect(tooManyPagesMessage(34, 20)).toBe(
      "That PDF has 34 pages, and troba reads up to 20 at a time. Split it into shorter PDFs and import each one.",
    );
  });
});

describe("pagesUnknownMessage", () => {
  it("says nothing was sent, the limit and what to do instead", () => {
    expect(pagesUnknownMessage(20)).toBe(
      "troba couldn't tell how many pages that PDF has, so nothing was sent. It reads PDFs of up to 20 pages that aren't password-protected. Save the statement as a new PDF, or export it as CSV, XLSX, XLS or ODS.",
    );
  });
});
