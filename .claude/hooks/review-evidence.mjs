// What .claude/hooks/review-gate.mjs checks in a review file (AGENTS.md, Workflow → Review).
// Pure: the hook passes in the file, HEAD, the branch's changed files and a commit lookup,
// and gets back one line per problem, so a refusal names everything that's missing at once.

// One heading per review step, so a skipped step is visible.
const SECTIONS = [
  "## code-review-and-quality",
  "## security-and-hardening",
  "## performance-optimization",
  "## Personal information",
  "## Fresh-context review",
  "## Review audit",
];

const SHA = "[0-9a-f]{40}";
const LIST_ITEM = /^\s*(?:[-*+]|\d+\.)\s/;

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const indent = (line) => line.match(/^\s*/)[0].length;

// Matches "Label:", "- Label:", "**Label:**" and "**Label**:" at the start of a line.
function labelRegex(label) {
  return new RegExp(
    String.raw`^\s*(?:(?:[-*+]|\d+\.)\s+)?(?:\*\*|__)?${escape(label)}(?:\*\*|__)?:`,
    "i",
  );
}

// A section's lines run from its heading to the next "## " heading.
function sectionLines(lines, heading) {
  const start = lines.findIndex((line) => line === heading || line.startsWith(`${heading} `));
  if (start === -1) return null;
  const end = lines.findIndex((line, i) => i > start && line.startsWith("## "));
  return lines.slice(start + 1, end === -1 ? undefined : end);
}

// The "Files read:" line plus the list under it: lines indented deeper than the label, or,
// when the label isn't itself a list item, list items at its own level.
function filesReadBlock(lines) {
  const at = lines.findIndex((line) => labelRegex("Files read").test(line));
  if (at === -1) return null;
  const base = indent(lines[at]);
  const labelIsItem = LIST_ITEM.test(lines[at]);
  const block = [lines[at]];
  for (const line of lines.slice(at + 1)) {
    if (
      !line.trim() ||
      indent(line) > base ||
      (!labelIsItem && LIST_ITEM.test(line) && indent(line) === base)
    ) {
      block.push(line);
    } else break;
  }
  return block.join("\n");
}

// A path counts only as a whole path, not as the tail of a longer one (README.md in docs/README.md).
function mentions(text, file) {
  return new RegExp(String.raw`(?<![\w./-])${escape(file)}(?![\w/-]|\.\w)`).test(text);
}

const isPage = (file) => file.startsWith("apps/web/src/app/") || file === "apps/web/next.config.ts";

function checkChain(review, head, isCommit) {
  const problems = [];
  const reviewed = [
    ...review.matchAll(new RegExp(String.raw`^\s*Reviewed commit:\s*\`?(${SHA})\`?\s*$`, "gm")),
  ];
  if (reviewed.length === 0) problems.push('no "Reviewed commit: <sha>" line');
  if (reviewed.length > 1) problems.push('more than one "Reviewed commit:" line');
  const last = reviewed.length === 1 ? reviewed[0][1] : null;
  if (last && last !== head) problems.push(`"Reviewed commit:" is ${last}, not HEAD (${head})`);

  const first = review.match(
    new RegExp(String.raw`^\s*First reviewed commit:\s*\`?(${SHA})\`?\s*$`, "m"),
  );
  if (!first) {
    problems.push('no "First reviewed commit: <sha>" line');
    return problems;
  }

  // Round and pass lines in file order, each "<from>..<to>"; together they must run from
  // the first reviewed commit to the Reviewed commit without a gap.
  const range = new RegExp(
    String.raw`^\s*(?:[-*+]\s+)?(?:\*\*|__)?(?:Round \d+|Pass)(?:\*\*|__)?:(?:\*\*|__)?\s*\`?(${SHA})\.\.(${SHA})\`?`,
    "gm",
  );
  let reached = first[1];
  const shas = new Set([reached]);
  for (const [, from, to] of review.matchAll(range)) {
    if (from !== reached) {
      problems.push(
        `the review history has a gap: it reaches ${reached}, but the next range starts at ${from}`,
      );
    }
    reached = to;
    shas.add(from).add(to);
  }
  if (last && reached !== last) {
    problems.push(`the review history ends at ${reached}, but "Reviewed commit:" is ${last}`);
  }
  for (const sha of shas) {
    if (!isCommit(sha)) problems.push(`${sha} isn't a commit in this repository`);
  }
  return problems;
}

export function checkReview({ review, head, changedFiles, isCommit }) {
  const lines = review.split(/\r?\n/);
  const problems = [];

  for (const heading of SECTIONS) {
    if (!sectionLines(lines, heading)) problems.push(`missing section: ${heading}`);
  }

  const quality = sectionLines(lines, "## code-review-and-quality");
  if (quality) {
    const filesRead = filesReadBlock(quality);
    if (filesRead === null) {
      problems.push('## code-review-and-quality has no "Files read:" list');
    } else {
      const unread = changedFiles.filter((file) => !mentions(filesRead, file));
      if (unread.length) problems.push(`"Files read:" leaves out: ${unread.join(", ")}`);
    }
    if (!quality.some((line) => labelRegex("Mutation").test(line))) {
      problems.push('## code-review-and-quality has no "Mutation:" line');
    }
  }

  const security = sectionLines(lines, "## security-and-hardening");
  if (security) {
    const pages = changedFiles.filter(isPage);
    if (pages.length && !security.some((line) => labelRegex("Headers").test(line))) {
      problems.push(
        `## security-and-hardening has no "Headers:" line, but the diff changes ${pages.join(", ")}`,
      );
    }
    if (
      changedFiles.includes("pnpm-lock.yaml") &&
      !security.some((line) => labelRegex("pnpm audit").test(line))
    ) {
      problems.push(
        '## security-and-hardening has no "pnpm audit:" line, but pnpm-lock.yaml changed',
      );
    }
  }

  return [...problems, ...checkChain(review, head, isCommit)];
}
