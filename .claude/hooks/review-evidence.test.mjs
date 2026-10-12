import { describe, expect, it } from "vitest";
import { checkReview } from "./review-evidence.mjs";

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const D = "d".repeat(40);

// A review that meets every rule for a branch at C changing two files, reviewed first at A.
function reviewFile({
  first = `First reviewed commit: ${A}`,
  reviewed = `Reviewed commit: ${C}`,
  filesRead = "Files read:\n- `packages/core/src/a.ts`\n- `packages/core/src/a.test.ts`",
  mutation = "Mutation: dropping the guard fails `a.test.ts`.",
  security = "Nothing applies.",
  audit = "## Review audit\n\nNo gaps.",
  log = `Round 1: ${A}..${B}: fixed the guard.\nPass: ${B}..${C}: renamed a variable.`,
} = {}) {
  return [
    "# Review: chore/x",
    first,
    reviewed,
    "## code-review-and-quality",
    filesRead,
    "",
    mutation,
    "## security-and-hardening",
    security,
    "## performance-optimization",
    "Fine.",
    "## Personal information",
    "Clean.",
    "## Fresh-context review",
    "No findings.",
    audit,
    "",
    log,
  ].join("\n");
}

const known = new Set([A, B, C, D]);

function check(review, changedFiles = ["packages/core/src/a.ts", "packages/core/src/a.test.ts"]) {
  return checkReview({ review, head: C, changedFiles, isCommit: (sha) => known.has(sha) });
}

describe("checkReview", () => {
  it("accepts a complete review", () => {
    expect(check(reviewFile())).toEqual([]);
  });

  it("names a missing section, including the review audit", () => {
    expect(check(reviewFile({ audit: "" }))).toEqual(["missing section: ## Review audit"]);
  });

  it("refuses a review that doesn't name HEAD", () => {
    const problems = checkReview({
      review: reviewFile(),
      head: D,
      changedFiles: ["packages/core/src/a.ts", "packages/core/src/a.test.ts"],
      isCommit: (sha) => known.has(sha),
    });
    expect(problems).toEqual([`"Reviewed commit:" is ${C}, not HEAD (${D})`]);
  });

  describe("Files read", () => {
    it("is required in ## code-review-and-quality", () => {
      expect(check(reviewFile({ filesRead: "Read everything." }))).toEqual([
        '## code-review-and-quality has no "Files read:" list',
      ]);
    });

    it("names each changed file the list leaves out, tests included", () => {
      const problems = check(reviewFile({ filesRead: "Files read:\n- `packages/core/src/a.ts`" }), [
        "packages/core/src/a.ts",
        "packages/core/src/a.test.ts",
        "README.md",
      ]);
      expect(problems).toEqual([
        '"Files read:" leaves out: packages/core/src/a.test.ts, README.md',
      ]);
    });

    it("doesn't count a path that only appears inside a longer path", () => {
      const problems = check(reviewFile({ filesRead: "Files read:\n- `docs/README.md`" }), [
        "README.md",
      ]);
      expect(problems).toEqual(['"Files read:" leaves out: README.md']);
    });

    it("doesn't count a path mentioned elsewhere in the section", () => {
      const problems = check(
        reviewFile({
          filesRead:
            "Files read:\n- `packages/core/src/a.ts`\n\nSee `packages/core/src/a.test.ts`.",
        }),
      );
      expect(problems).toEqual(['"Files read:" leaves out: packages/core/src/a.test.ts']);
    });

    it("accepts a bold label, an inline path and a nested list under a list item", () => {
      const filesRead = [
        "- **Files read:** `packages/core/src/a.ts`",
        "  - `packages/core/src/a.test.ts`",
        "- Correctness: fine.",
      ].join("\n");
      expect(check(reviewFile({ filesRead }))).toEqual([]);
    });

    it("ends a nested list at the next item at its own level", () => {
      const filesRead = [
        "- Files read:",
        "  - `packages/core/src/a.ts`",
        "- Also looked at `packages/core/src/a.test.ts`.",
      ].join("\n");
      expect(check(reviewFile({ filesRead }))).toEqual([
        '"Files read:" leaves out: packages/core/src/a.test.ts',
      ]);
    });
  });

  it("requires a Mutation: line in ## code-review-and-quality", () => {
    expect(check(reviewFile({ mutation: "Tests look fine." }))).toEqual([
      '## code-review-and-quality has no "Mutation:" line',
    ]);
  });

  it("doesn't take a Mutation: line from another section", () => {
    const review = reviewFile({ mutation: "", security: "Mutation: n/a." });
    expect(check(review)).toEqual(['## code-review-and-quality has no "Mutation:" line']);
  });

  describe("Headers", () => {
    const pageChange = ["packages/core/src/a.ts", "packages/core/src/a.test.ts"];

    it("is required when the diff changes a page", () => {
      const files = [...pageChange, "apps/web/src/app/(app)/settings/page.tsx"];
      const review = reviewFile({
        filesRead: `Files read:\n${files.map((f) => `- \`${f}\``).join("\n")}`,
      });
      expect(check(review, files)).toEqual([
        '## security-and-hardening has no "Headers:" line, but the diff changes apps/web/src/app/(app)/settings/page.tsx',
      ]);
    });

    it("is required when next.config.ts changes", () => {
      const files = [...pageChange, "apps/web/next.config.ts"];
      const review = reviewFile({
        filesRead: `Files read:\n${files.map((f) => `- \`${f}\``).join("\n")}`,
      });
      expect(check(review, files)).toEqual([
        '## security-and-hardening has no "Headers:" line, but the diff changes apps/web/next.config.ts',
      ]);
    });

    it("is satisfied by a Headers: line", () => {
      const files = [...pageChange, "apps/web/next.config.ts"];
      const review = reviewFile({
        filesRead: `Files read:\n${files.map((f) => `- \`${f}\``).join("\n")}`,
        security: "- **Headers:** `/` returns X-Frame-Options: DENY.",
      });
      expect(check(review, files)).toEqual([]);
    });
  });

  describe("pnpm audit", () => {
    const files = ["packages/core/src/a.ts", "packages/core/src/a.test.ts", "pnpm-lock.yaml"];
    const filesRead = `Files read:\n${files.map((f) => `- \`${f}\``).join("\n")}`;

    it("is required when pnpm-lock.yaml changes", () => {
      expect(check(reviewFile({ filesRead }), files)).toEqual([
        '## security-and-hardening has no "pnpm audit:" line, but pnpm-lock.yaml changed',
      ]);
    });

    it("is satisfied by a pnpm audit: line", () => {
      const review = reviewFile({ filesRead, security: "pnpm audit: no known vulnerabilities." });
      expect(check(review, files)).toEqual([]);
    });
  });

  describe("Reviewed commit chain", () => {
    it("needs a First reviewed commit: line", () => {
      expect(check(reviewFile({ first: "" }))).toEqual(['no "First reviewed commit: <sha>" line']);
    });

    it("accepts a first review with no rounds, when it is HEAD", () => {
      const review = reviewFile({ first: `First reviewed commit: ${C}`, log: "" });
      expect(check(review)).toEqual([]);
    });

    it("names a gap between ranges", () => {
      const log = `Round 1: ${A}..${B}: fixed.\nPass: ${D}..${C}: tidied.`;
      expect(check(reviewFile({ log }))).toEqual([
        `the review history has a gap: it reaches ${B}, but the next range starts at ${D}`,
      ]);
    });

    it("names a gap after the first reviewed commit", () => {
      const log = `Round 1: ${B}..${C}: fixed.`;
      expect(check(reviewFile({ log }))).toEqual([
        `the review history has a gap: it reaches ${A}, but the next range starts at ${B}`,
      ]);
    });

    it("names a history that stops short of the Reviewed commit", () => {
      const log = `Round 1: ${A}..${B}: fixed.`;
      expect(check(reviewFile({ log }))).toEqual([
        `the review history ends at ${B}, but "Reviewed commit:" is ${C}`,
      ]);
    });

    it("reads round lines written as list items with a backticked range", () => {
      const log = `- Round 1: \`${A}..${B}\`: fixed.\n- **Pass:** ${B}..${C}: tidied.`;
      expect(check(reviewFile({ log }))).toEqual([]);
    });

    it("names a sha that isn't a commit", () => {
      const E = "e".repeat(40);
      const log = `Round 1: ${A}..${E}: fixed.\nPass: ${E}..${C}: tidied.`;
      expect(check(reviewFile({ log }))).toEqual([`${E} isn't a commit in this repository`]);
    });

    it("refuses more than one Reviewed commit line", () => {
      const review = reviewFile({ reviewed: `Reviewed commit: ${B}\nReviewed commit: ${C}` });
      expect(check(review)).toEqual(['more than one "Reviewed commit:" line']);
    });
  });

  it("lists every problem at once", () => {
    const review = reviewFile({ mutation: "", audit: "", first: "" });
    expect(check(review)).toEqual([
      "missing section: ## Review audit",
      '## code-review-and-quality has no "Mutation:" line',
      'no "First reviewed commit: <sha>" line',
    ]);
  });
});
