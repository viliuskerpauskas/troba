import { describe, expect, it } from "vitest";
import { checkReview, specIssue } from "./review-evidence.mjs";

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const D = "d".repeat(40);

// A review that meets every rule for a branch at C changing two files, reviewed first at A.
function reviewFile({
  spec = "Spec: #7",
  first = `First reviewed commit: ${A}`,
  reviewed = `Reviewed commit: ${C}`,
  filesRead = "Files read:\n- `packages/core/src/a.ts`\n- `packages/core/src/a.test.ts`",
  mutation = "Mutation: dropping the guard fails `a.test.ts`.",
  checks = "Nothing else applies.",
  specAxis = "## Spec\n\nEvery acceptance item is met.",
  log = `Round 1: ${A}..${B}: fixed the guard.\nPass: ${B}..${C}: renamed a variable.`,
} = {}) {
  return [
    "# Review: feat/T7-x (T7 · feat: x)",
    spec,
    first,
    reviewed,
    log,
    "## Standards",
    filesRead,
    "",
    "No findings.",
    specAxis,
    "## Checks",
    mutation,
    checks,
    "## Personal information",
    "Clean.",
  ].join("\n");
}

const known = new Set([A, B, C, D]);

function check(
  review,
  changedFiles = ["packages/core/src/a.ts", "packages/core/src/a.test.ts"],
  branch = "feat/T7-x",
) {
  return checkReview({ review, branch, head: C, changedFiles, isCommit: (sha) => known.has(sha) });
}

describe("checkReview", () => {
  it("accepts a complete review", () => {
    expect(check(reviewFile())).toEqual([]);
  });

  it("names a missing section", () => {
    expect(check(reviewFile({ specAxis: "" }))).toEqual(["missing section: ## Spec"]);
  });

  describe("Spec line", () => {
    it("is required", () => {
      expect(check(reviewFile({ spec: "" }))).toEqual([
        'no "Spec: #<issue>" line (or "Spec: none - <why>" for work with no issue)',
      ]);
    });

    it("must name the issue in the branch name", () => {
      expect(check(reviewFile({ spec: "Spec: #8" }))).toEqual([
        'the Spec: line must be "Spec: #7": the branch feat/T7-x belongs to T7',
      ]);
    });

    it("may say none, with a reason, on a branch with no issue", () => {
      const review = reviewFile({ spec: "Spec: none - a one-line docs fix" });
      expect(check(review, undefined, "docs/typo")).toEqual([]);
      expect(check(review)).toEqual([
        'the Spec: line must be "Spec: #7": the branch feat/T7-x belongs to T7',
      ]);
    });

    it("gives the hook the issue to check, or none", () => {
      expect(specIssue(reviewFile())).toBe("7");
      expect(specIssue(reviewFile({ spec: "Spec: none - a docs fix" }))).toBeNull();
    });
  });

  it("refuses a review that doesn't name HEAD", () => {
    const problems = checkReview({
      review: reviewFile(),
      branch: "feat/T7-x",
      head: D,
      changedFiles: ["packages/core/src/a.ts", "packages/core/src/a.test.ts"],
      isCommit: (sha) => known.has(sha),
    });
    expect(problems).toEqual([`"Reviewed commit:" is ${C}, not HEAD (${D})`]);
  });

  describe("Files read", () => {
    it("is required in ## Standards", () => {
      expect(check(reviewFile({ filesRead: "Read everything." }))).toEqual([
        '## Standards has no "Files read:" list',
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

  it("requires a Mutation: line in ## Checks", () => {
    expect(check(reviewFile({ mutation: "Tests look fine." }))).toEqual([
      '## Checks has no "Mutation:" line',
    ]);
  });

  it("doesn't take a Mutation: line from another section", () => {
    const review = reviewFile({ mutation: "", specAxis: "## Spec\n\nMutation: n/a." });
    expect(check(review)).toEqual(['## Checks has no "Mutation:" line']);
  });

  describe("Headers", () => {
    const pageChange = ["packages/core/src/a.ts", "packages/core/src/a.test.ts"];

    it("is required when the diff changes a page", () => {
      const files = [...pageChange, "apps/web/src/app/(app)/settings/page.tsx"];
      const review = reviewFile({
        filesRead: `Files read:\n${files.map((f) => `- \`${f}\``).join("\n")}`,
      });
      expect(check(review, files)).toEqual([
        '## Checks has no "Headers:" line, but the diff changes apps/web/src/app/(app)/settings/page.tsx',
      ]);
    });

    it("is required when next.config.ts changes", () => {
      const files = [...pageChange, "apps/web/next.config.ts"];
      const review = reviewFile({
        filesRead: `Files read:\n${files.map((f) => `- \`${f}\``).join("\n")}`,
      });
      expect(check(review, files)).toEqual([
        '## Checks has no "Headers:" line, but the diff changes apps/web/next.config.ts',
      ]);
    });

    it("is satisfied by a Headers: line", () => {
      const files = [...pageChange, "apps/web/next.config.ts"];
      const review = reviewFile({
        filesRead: `Files read:\n${files.map((f) => `- \`${f}\``).join("\n")}`,
        checks: "- **Headers:** `/` returns X-Frame-Options: DENY.",
      });
      expect(check(review, files)).toEqual([]);
    });
  });

  describe("pnpm audit", () => {
    const files = ["packages/core/src/a.ts", "packages/core/src/a.test.ts", "pnpm-lock.yaml"];
    const filesRead = `Files read:\n${files.map((f) => `- \`${f}\``).join("\n")}`;

    it("is required when pnpm-lock.yaml changes", () => {
      expect(check(reviewFile({ filesRead }), files)).toEqual([
        '## Checks has no "pnpm audit:" line, but the diff changes pnpm-lock.yaml',
      ]);
    });

    it("is required when a package.json changes", () => {
      const changed = ["package.json", "apps/web/package.json"];
      const read = `Files read:\n${changed.map((f) => `- \`${f}\``).join("\n")}`;
      expect(check(reviewFile({ filesRead: read }), changed)).toEqual([
        '## Checks has no "pnpm audit:" line, but the diff changes package.json, apps/web/package.json',
      ]);
    });

    it("is satisfied by a pnpm audit: line", () => {
      const review = reviewFile({ filesRead, checks: "pnpm audit: no known vulnerabilities." });
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

    it("follows Review: ranges for new work, such as a merge of main", () => {
      const log = `Round 1: ${A}..${B}: fixed.\nReview: ${B}..${C}: the merge's own changes.`;
      expect(check(reviewFile({ log }))).toEqual([]);
    });

    it("leaves the title line alone, although it starts with Review:", () => {
      const review = reviewFile().replace("# Review: feat/T7-x", "# Review: deadbeef-notes");
      expect(check(review)).toEqual([]);
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

  it("keeps reading a section past a pasted ## heading that isn't a step", () => {
    const filesRead =
      "## Review summary\n\nFiles read:\n- `packages/core/src/a.ts`\n- `packages/core/src/a.test.ts`";
    expect(check(reviewFile({ filesRead }))).toEqual([]);
  });

  it("names an empty section", () => {
    const review = reviewFile().replace(
      "## Personal information\nClean.",
      "## Personal information\n",
    );
    expect(check(review)).toEqual(["## Personal information is empty"]);
  });

  it("names an empty Mutation: line", () => {
    expect(check(reviewFile({ mutation: "Mutation:" }))).toEqual([
      '## Checks has no "Mutation:" line',
    ]);
  });

  it("accepts evidence labels written in backticks", () => {
    const files = ["packages/core/src/a.ts", "packages/core/src/a.test.ts", "pnpm-lock.yaml"];
    const review = reviewFile({
      filesRead: `\`Files read:\`\n${files.map((f) => `- \`${f}\``).join("\n")}`,
      mutation: "- `Mutation`: dropping the guard fails a.test.ts.",
      checks: "- `pnpm audit:` no known vulnerabilities.",
    });
    expect(check(review, files)).toEqual([]);
  });

  describe("commit lines", () => {
    it("ignore prose that starts with Pass: or Round N:", () => {
      const log = `Round 1: ${A}..${B}: fixed.\n- Pass: all checklist items.\nRound 1: the range exists in git log.\nPass: ${B}..${C}: tidied.`;
      expect(check(reviewFile({ log }))).toEqual([]);
    });

    it("ignore a range repeated in prose", () => {
      const log = `Round 1: ${A}..${B}: fixed.\nPass: ${B}..${C}: tidied.\n- Round 1: \`${A}..${B}\` exists in git log.`;
      expect(check(reviewFile({ log }))).toEqual([]);
    });

    it("accept ranges quoted again out of order or only in part", () => {
      const quoted = `## Spec\n\n- Pass: \`${B}..${C}\` exists; diff only renames.\n- Round 1: \`${A}..${B}\` exists.\n- Reviewed commit: \`${C}\` is HEAD.`;
      expect(check(reviewFile({ specAxis: quoted }))).toEqual([]);
      const partial = `## Spec\n\n- Pass: \`${B}..${C}\` exists.`;
      expect(check(reviewFile({ specAxis: partial }))).toEqual([]);
    });

    it("ignore a Reviewed commit line in prose", () => {
      const review = reviewFile({ specAxis: "## Spec\n\nReviewed commit: matches HEAD." });
      expect(check(review)).toEqual([]);
    });

    it("read a round written as a heading", () => {
      const log = `### Round 1: ${A}..${B}\n\nFixed.\n\n### Pass: ${B}..${C}`;
      expect(check(reviewFile({ log }))).toEqual([]);
    });

    it("refuse more than one First reviewed commit line", () => {
      const review = reviewFile({
        first: `First reviewed commit: ${A}\nFirst reviewed commit: ${B}`,
      });
      expect(check(review)).toEqual(['more than one "First reviewed commit:" line']);
    });

    it("accept a list or bold label and text after the sha", () => {
      const review = reviewFile({
        first: `- **First reviewed commit:** \`${A}\``,
        reviewed: `**Reviewed commit:** ${C} (after the pass)`,
      });
      expect(check(review)).toEqual([]);
    });

    it("name a commit line whose sha can't be read", () => {
      const review = reviewFile({ reviewed: `Reviewed commit: ${C.slice(0, 7)}` });
      expect(check(review)).toEqual([
        `can't read a full 40-character sha in: "Reviewed commit: ${C.slice(0, 7)}"`,
      ]);
    });

    it("name a commit line with a 41-character sha instead of reading its first 40", () => {
      const review = reviewFile({ reviewed: `Reviewed commit: ${C}c` });
      expect(check(review)).toEqual([
        `can't read a full 40-character sha in: "Reviewed commit: ${C}c"`,
      ]);
    });

    it("name a round line whose range can't be read", () => {
      const log = `Round 1: ${A}..${B}: fixed.\nPass: ${B}...${C}: tidied.\nPass: ${B}..${C}: tidied.`;
      expect(check(reviewFile({ log }))).toEqual([
        `can't read a "<full sha>..<full sha>" range in: "Pass: ${B}...${C}: tidied."`,
      ]);
    });

    it("name a range with a 41-character sha", () => {
      const log = `Round 1: ${A}..${B}: fixed.\nPass: ${B}a..${C}: tidied.`;
      expect(check(reviewFile({ log }))).toEqual([
        `can't read a "<full sha>..<full sha>" range in: "Pass: ${B}a..${C}: tidied."`,
        `the review history ends at ${B}, but "Reviewed commit:" is ${C}`,
      ]);
    });
  });

  it("lists every problem at once", () => {
    const review = reviewFile({ mutation: "", specAxis: "", first: "" });
    expect(check(review)).toEqual([
      "missing section: ## Spec",
      '## Checks has no "Mutation:" line',
      'no "First reviewed commit: <sha>" line',
    ]);
  });
});
