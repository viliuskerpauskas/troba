// PreToolUse hook on Bash and PowerShell: refuses `gh pr create`, and `git push` on a branch
// with an open PR, until the branch's review file shows the whole review ran on the commit
// being proposed (AGENTS.md, Workflow → Review). Exit code 2 blocks the command and shows
// the reason to the agent. What the file must contain is in review-evidence.mjs.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { checkReview } from "./review-evidence.mjs";

function block(reason) {
  process.stderr.write(`Review gate: ${reason}\nSee AGENTS.md, Workflow → Review.\n`);
  process.exit(2);
}

const input = JSON.parse(readFileSync(0, "utf8"));
const command = input.tool_input?.command ?? "";
const prCreate = /\bgh\s+pr\s+create\b/.test(command);
// Gates pushes of the current branch only: an explicit refspec naming another branch is checked
// as if it were this one.
const push = /\bgit\s+(?:-c\s+\S+\s+)*push\b/.test(command);
if (!prCreate && !push) process.exit(0);

function run(cmd, args, timeout = 5000) {
  return spawnSync(cmd, args, { cwd: input.cwd, encoding: "utf8", timeout });
}

function git(args) {
  const r = run("git", args);
  if (r.status !== 0) block(`\`git ${args.join(" ")}\` failed, so the review can't be checked.`);
  return r.stdout.trim();
}

const root = git(["rev-parse", "--show-toplevel"]);
const branch = git(["branch", "--show-current"]);
const file = `.reviews/${branch.replaceAll("/", "-")}.md`;

let review = null;
try {
  review = readFileSync(path.join(root, file), "utf8");
} catch {
  // Handled below: opening a PR needs the file, a push without one isn't gated.
}

if (!prCreate) {
  // `main`, a detached HEAD and branches without a review file push freely; so does a branch
  // whose PR isn't open yet, since `gh pr create` checks the review before the PR exists.
  if (!branch || branch === "main" || review === null) process.exit(0);
  const r = run(
    "gh",
    ["pr", "list", "--head", branch, "--state", "open", "--json", "number", "--jq", "length"],
    10000,
  );
  if (r.status !== 0)
    block(`\`gh pr list\` failed, so it can't tell whether ${branch} has an open PR.`);
  if (r.stdout.trim() === "0") process.exit(0);
}

if (review === null)
  block(`no review file at ${file}. Run the review steps and write the review there.`);

const problems = checkReview({
  review,
  head: git(["rev-parse", "HEAD"]),
  changedFiles: git(["diff", "--name-only", "main...HEAD"]).split("\n").filter(Boolean),
  isCommit: (sha) => run("git", ["cat-file", "-e", `${sha}^{commit}`]).status === 0,
});
if (problems.length) {
  block(
    `${file} isn't ready${prCreate ? "" : ` for a push to ${branch}'s open PR`}:\n` +
      problems.map((problem) => `- ${problem}`).join("\n") +
      "\nReview what's missing (for new commits, a fix round or pass), then update the file.",
  );
}
