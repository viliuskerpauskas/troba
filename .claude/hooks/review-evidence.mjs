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

const SHA = "[0-9a-f]{40}(?![0-9a-f])";
const LIST_ITEM = /^\s*(?:[-*+]|\d+\.)\s/;
const MARK = String.raw`(?:\*\*|__|\`)?`;

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const indent = (line) => line.match(/^\s*/)[0].length;

// Matches "Label:", "- Label:", "### Label:", "**Label:**", "**Label**:" and "`Label:`" at the
// start of a line, and captures the rest of the line. `label` is a regex source.
function labelRegex(label) {
  return new RegExp(
    String.raw`^\s*(?:(?:[-*+]|\d+\.|#{1,6})\s+)?${MARK}(?:${label})${MARK}:${MARK}(.*)$`,
    "i",
  );
}

const isStep = (line) => SECTIONS.some((h) => line === h || line.startsWith(`${h} `));

// A section's lines run from its heading to the next step's heading, so a "## " heading pasted
// into a section (say from a skill's template) doesn't end it.
function sectionLines(lines, heading) {
  const start = lines.findIndex((line) => line === heading || line.startsWith(`${heading} `));
  if (start === -1) return null;
  const end = lines.findIndex((line, i) => i > start && isStep(line));
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

// True when some line has the label with text after it.
function hasFilledLabel(lines, label) {
  return lines.some((line) => labelRegex(label).exec(line)?.[1].trim());
}

// A path counts only as a whole path, not as the tail of a longer one (README.md in docs/README.md).
function mentions(text, file) {
  return new RegExp(String.raw`(?<![\w./-])${escapeRegex(file)}(?![\w/-]|\.\w)`).test(text);
}

const isPage = (file) => file.startsWith("apps/web/src/app/") || file === "apps/web/next.config.ts";

// The lines labelled `label` whose text starts like a sha, with that text. Only these count, so
// prose such as "Pass: all checklist items" or "Reviewed commit: matches HEAD." is left alone,
// while a short sha or a three-dot range is still named.
function shaLines(lines, label) {
  const regex = labelRegex(label);
  return lines
    .map((line) => ({ line, value: regex.exec(line)?.[1] }))
    .filter(({ value }) => value !== undefined && /^\s*`?[0-9a-f]{7,}(?![g-z])/i.test(value));
}

// The sha on each line; a line without a readable full sha is a problem.
function commitShas(found, problems) {
  const shas = [];
  for (const { line, value } of found) {
    const sha = value.match(new RegExp(String.raw`^\s*\`?(${SHA})`))?.[1];
    if (sha) shas.push(sha);
    else problems.push(`can't read a full 40-character sha in: "${line.trim()}"`);
  }
  return shas;
}

function checkChain(lines, head, isCommit) {
  const problems = [];
  const reviewedLines = shaLines(lines, "Reviewed commit");
  const reviewed = commitShas(reviewedLines, problems);
  if (reviewedLines.length === 0) problems.push('no "Reviewed commit: <sha>" line');
  if (reviewedLines.length > 1) problems.push('more than one "Reviewed commit:" line');
  const last = reviewedLines.length === 1 ? (reviewed[0] ?? null) : null;
  if (last && last !== head) problems.push(`"Reviewed commit:" is ${last}, not HEAD (${head})`);

  const firstLines = shaLines(lines, "First reviewed commit");
  const [first] = commitShas(firstLines, problems);
  if (firstLines.length === 0) problems.push('no "First reviewed commit: <sha>" line');
  if (firstLines.length > 1) problems.push('more than one "First reviewed commit:" line');
  if (!first || firstLines.length > 1) return problems;

  // Round and pass lines in file order, each "<from>..<to>"; together they must run from
  // the first reviewed commit to the Reviewed commit without a gap. A range already read
  // (say, quoted again by the audit) is skipped. Shas are only checked to exist: after a
  // rebase the history isn't an ancestry chain, so ancestry is left to the audit.
  const range = new RegExp(String.raw`^\s*\`?(${SHA})\.\.(${SHA})`);
  let reached = first;
  const shas = new Set([reached]);
  const seen = new Set();
  for (const { line, value } of shaLines(lines, String.raw`Round \d+|Pass`)) {
    const match = value.match(range);
    if (!match) {
      problems.push(`can't read a "<full sha>..<full sha>" range in: "${line.trim()}"`);
      continue;
    }
    const [, from, to] = match;
    if (seen.has(`${from}..${to}`)) continue;
    seen.add(`${from}..${to}`);
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
    const section = sectionLines(lines, heading);
    if (!section) problems.push(`missing section: ${heading}`);
    else if (!section.some((line) => line.trim())) problems.push(`${heading} is empty`);
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
    if (!hasFilledLabel(quality, "Mutation")) {
      problems.push('## code-review-and-quality has no "Mutation:" line');
    }
  }

  const security = sectionLines(lines, "## security-and-hardening");
  if (security) {
    const pages = changedFiles.filter(isPage);
    if (pages.length && !hasFilledLabel(security, "Headers")) {
      problems.push(
        `## security-and-hardening has no "Headers:" line, but the diff changes ${pages.join(", ")}`,
      );
    }
    if (changedFiles.includes("pnpm-lock.yaml") && !hasFilledLabel(security, "pnpm audit")) {
      problems.push(
        '## security-and-hardening has no "pnpm audit:" line, but pnpm-lock.yaml changed',
      );
    }
  }

  return [...problems, ...checkChain(lines, head, isCommit)];
}
