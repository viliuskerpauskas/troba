// What .claude/hooks/review-gate.mjs checks in a review file (docs/agents/skill-overrides.md,
// /code-review). Pure: the hook passes in the file, the branch, HEAD, the branch's changed files
// and a commit lookup, and gets back one line per problem, so a refusal names everything that's
// missing at once.

// One heading per part of the review, so a skipped part is visible.
const SECTIONS = ["## Standards", "## Spec", "## Checks", "## Personal information"];

const SHA = "[0-9a-f]{40}(?![0-9a-f])";
const LIST_ITEM = /^\s*(?:[-*+]|\d+\.)\s/;
const MARK = String.raw`(?:\*\*|__|\`)?`;
// `Spec: #<n>` names the spec issue (or the standalone task's own issue); `Spec: none - <why>`
// is the recorded exception for work with no issue.
const SPEC = /^Spec:\s*(?:#(\d+)|none\s+[-–—]\s+\S.*?)\s*$/m;

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

const isPart = (line) => SECTIONS.some((h) => line === h || line.startsWith(`${h} `));

// A section's lines run from its heading to the next part's heading, so a "## " heading pasted
// into a section (say from an axis's report) doesn't end it.
function sectionLines(lines, heading) {
  const start = lines.findIndex((line) => line === heading || line.startsWith(`${heading} `));
  if (start === -1) return null;
  const end = lines.findIndex((line, i) => i > start && isPart(line));
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
const isDependencies = (file) =>
  file === "pnpm-lock.yaml" || file === "package.json" || file.endsWith("/package.json");

// The lines labelled `label` whose text starts like a sha, with that text. Only these count, so
// prose such as "Pass: all checks green" or "Reviewed commit: matches HEAD." is left alone,
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
  // The same sha may be quoted again; two different ones conflict.
  const reviewedLines = shaLines(lines, "Reviewed commit");
  const reviewed = new Set(commitShas(reviewedLines, problems));
  if (reviewedLines.length === 0) problems.push('no "Reviewed commit: <sha>" line');
  if (reviewed.size > 1) problems.push('more than one "Reviewed commit:" line');
  const last = reviewed.size === 1 ? [...reviewed][0] : null;
  if (last && last !== head) problems.push(`"Reviewed commit:" is ${last}, not HEAD (${head})`);

  const firstLines = shaLines(lines, "First reviewed commit");
  const firsts = new Set(commitShas(firstLines, problems));
  if (firstLines.length === 0) problems.push('no "First reviewed commit: <sha>" line');
  if (firsts.size > 1) problems.push('more than one "First reviewed commit:" line');
  if (firsts.size !== 1) return problems;
  const [first] = firsts;

  // The distinct "<from>..<to>" ranges of the round, pass and review lines must run from the
  // first reviewed commit to the Reviewed commit without a gap. They're followed by sha, not by
  // file order, so a range quoted again, in any order, changes nothing. Shas are only checked to
  // exist: after a rebase the history isn't an ancestry chain.
  const range = new RegExp(String.raw`^\s*\`?(${SHA})\.\.(${SHA})`);
  const ranges = new Map();
  // The file's "# Review: <branch>" title is left out, although it reads like a Review: line.
  const rangeLines = lines.filter((line) => !/^#\s/.test(line));
  for (const { line, value } of shaLines(rangeLines, String.raw`Round \d+|Pass|Review`)) {
    const match = value.match(range);
    if (match) ranges.set(`${match[1]}..${match[2]}`, [match[1], match[2]]);
    else problems.push(`can't read a "<full sha>..<full sha>" range in: "${line.trim()}"`);
  }
  let reached = first;
  const shas = new Set([reached]);
  const unused = [...ranges.values()];
  while (unused.length) {
    let next = unused.findIndex(([from]) => from === reached);
    if (next === -1) {
      next = 0;
      problems.push(
        `the review history has a gap: it reaches ${reached}, but the next range starts at ${unused[0][0]}`,
      );
    }
    const [[from, to]] = unused.splice(next, 1);
    shas.add(from).add(to);
    reached = to;
  }
  if (last && reached !== last) {
    problems.push(`the review history ends at ${reached}, but "Reviewed commit:" is ${last}`);
  }
  for (const sha of shas) {
    if (!isCommit(sha)) problems.push(`${sha} isn't a commit in this repository`);
  }
  return problems;
}

// The issue number on the `Spec:` line, or null for `Spec: none - <why>` or no line.
export function specIssue(review) {
  return review.match(SPEC)?.[1] ?? null;
}

export function checkReview({ review, branch, head, changedFiles, isCommit }) {
  const lines = review.split(/\r?\n/);
  const problems = [];

  const spec = review.match(SPEC);
  if (!spec) {
    problems.push('no "Spec: #<issue>" line (or "Spec: none - <why>" for work with no issue)');
  } else {
    // A branch named after an issue always has that issue as its spec.
    const key = branch.match(/\/T(\d+)-/)?.[1];
    if (key && key !== spec[1]) {
      problems.push(
        `the Spec: line must be "Spec: #${key}": the branch ${branch} belongs to T${key}`,
      );
    }
  }

  for (const heading of SECTIONS) {
    const section = sectionLines(lines, heading);
    if (!section) problems.push(`missing section: ${heading}`);
    else if (!section.some((line) => line.trim())) problems.push(`${heading} is empty`);
  }

  const standards = sectionLines(lines, "## Standards");
  if (standards) {
    const filesRead = filesReadBlock(standards);
    if (filesRead === null) {
      problems.push('## Standards has no "Files read:" list');
    } else {
      const unread = changedFiles.filter((file) => !mentions(filesRead, file));
      if (unread.length) problems.push(`"Files read:" leaves out: ${unread.join(", ")}`);
    }
  }

  const checks = sectionLines(lines, "## Checks");
  if (checks) {
    if (!hasFilledLabel(checks, "Mutation")) problems.push('## Checks has no "Mutation:" line');
    const pages = changedFiles.filter(isPage);
    if (pages.length && !hasFilledLabel(checks, "Headers")) {
      problems.push(`## Checks has no "Headers:" line, but the diff changes ${pages.join(", ")}`);
    }
    const dependencies = changedFiles.filter(isDependencies);
    if (dependencies.length && !hasFilledLabel(checks, "pnpm audit")) {
      problems.push(
        `## Checks has no "pnpm audit:" line, but the diff changes ${dependencies.join(", ")}`,
      );
    }
  }

  return [...problems, ...checkChain(lines, head, isCommit)];
}
