// PreToolUse hook on Bash and PowerShell: refuses `gh pr create` until the branch's review file shows the
// whole review ran on the commit being proposed, and the spec issue carries its record of what
// happened (docs/agents/skill-overrides.md, /code-review and /wrap). Exit code 2 blocks the
// command and shows the reason to the agent.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

// One heading per part of the review, so a skipped part is visible.
const SECTIONS = ["## Standards", "## Spec", "## Checks", "## Personal information"];

function block(reason) {
  process.stderr.write(
    `Review gate: ${reason}\nSee docs/agents/skill-overrides.md, /code-review and /wrap.\n`,
  );
  process.exit(2);
}

const input = JSON.parse(readFileSync(0, "utf8"));
const command = input.tool_input?.command ?? "";
if (!/\bgh\s+pr\s+create\b/.test(command)) process.exit(0);

function run(cmd, args, what) {
  const r = spawnSync(cmd, args, { cwd: input.cwd, encoding: "utf8", timeout: 5000 });
  if (r.status !== 0) block(`\`${cmd} ${args.join(" ")}\` failed, so ${what} can't be checked.`);
  return r.stdout.trim();
}
const git = (args) => run("git", args, "the review");

const root = git(["rev-parse", "--show-toplevel"]);
const branch = git(["branch", "--show-current"]);
const head = git(["rev-parse", "HEAD"]);
const file = `.reviews/${branch.replaceAll("/", "-")}.md`;

let review;
try {
  review = readFileSync(path.join(root, file), "utf8");
} catch {
  block(
    `no review file at ${file}. Run /code-review as skill-overrides.md says and write it there.`,
  );
}

const missing = SECTIONS.filter((heading) => !review.includes(heading));
if (missing.length) block(`${file} is missing: ${missing.join(", ")}.`);
if (!review.includes(`Reviewed commit: ${head}`)) {
  block(
    `${file} doesn't say "Reviewed commit: ${head}". Review the commits since the last ` +
      "review, then update that line.",
  );
}

// `Spec: #<n>` names the spec issue (or the standalone task's own issue), whose body /wrap
// appends to. `Spec: none - <why>` is the recorded exception for work with no issue.
const spec = review.match(/^Spec:\s*(?:#(\d+)|(none\s+-\s+\S.*))\s*$/m);
if (!spec) {
  block(`${file} has no "Spec: #<issue>" line (or "Spec: none - <why>" for work with no issue).`);
}
if (spec[1]) {
  const body = run(
    "gh",
    ["issue", "view", spec[1], "--json", "body", "--jq", ".body"],
    `issue #${spec[1]}`,
  );
  if (!/^## What actually happened\b/m.test(body)) {
    block(
      `issue #${spec[1]} has no "## What actually happened" section yet. /wrap step 5 adds it.`,
    );
  }
}
