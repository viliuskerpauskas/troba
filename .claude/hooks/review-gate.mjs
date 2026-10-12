// PreToolUse hook on Bash and PowerShell: refuses `gh pr create` until the branch's review file shows the
// whole review ran on the commit being proposed (AGENTS.md, Workflow → Review). Exit code 2
// blocks the command and shows the reason to the agent.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

// One heading per review step, so a skipped step is visible.
const SECTIONS = [
  "## code-review-and-quality",
  "## security-and-hardening",
  "## performance-optimization",
  "## Personal information",
  "## Fresh-context review",
];

function block(reason) {
  process.stderr.write(`Review gate: ${reason}\nSee AGENTS.md, Workflow → Review.\n`);
  process.exit(2);
}

const input = JSON.parse(readFileSync(0, "utf8"));
const command = input.tool_input?.command ?? "";
if (!/\bgh\s+pr\s+create\b/.test(command)) process.exit(0);

function git(args) {
  const r = spawnSync("git", args, { cwd: input.cwd, encoding: "utf8", timeout: 5000 });
  if (r.status !== 0) block(`\`git ${args.join(" ")}\` failed, so the review can't be checked.`);
  return r.stdout.trim();
}

const root = git(["rev-parse", "--show-toplevel"]);
const branch = git(["branch", "--show-current"]);
const head = git(["rev-parse", "HEAD"]);
const file = `.reviews/${branch.replaceAll("/", "-")}.md`;

let review;
try {
  review = readFileSync(path.join(root, file), "utf8");
} catch {
  block(`no review file at ${file}. Run the review steps and write the review there.`);
}

const missing = SECTIONS.filter((heading) => !review.includes(heading));
if (missing.length) block(`${file} is missing: ${missing.join(", ")}.`);
if (!review.includes(`Reviewed commit: ${head}`)) {
  block(
    `${file} doesn't say "Reviewed commit: ${head}". Review the commits since the last ` +
      "review, then update that line.",
  );
}
