// PreToolUse hook on Bash and PowerShell: refuses `gh pr create`, and `git push` on a branch
// with an open PR, until the branch's review file shows the whole review ran on the commit
// being proposed (AGENTS.md, Workflow → Review). Exit code 2 blocks the command and shows
// the reason to the agent. Which commands count is in gated-command.mjs, and what the file
// must contain in review-evidence.mjs.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { gatedCommands } from "./gated-command.mjs";
import { checkReview } from "./review-evidence.mjs";

// A hook that runs past its timeout in .claude/settings.json (15 s) lets the command through,
// so every git and gh call shares a budget that ends well before it, and running out refuses.
const deadline = Date.now() + 12000;

function block(reason) {
  process.stderr.write(`Review gate: ${reason}\nSee AGENTS.md, Workflow → Review.\n`);
  process.exit(2);
}

function run(cmd, args, { cwd, input, timeout = 5000 } = {}) {
  const left = Math.min(timeout, deadline - Date.now());
  const label = `\`${cmd} ${args.join(" ")}\``;
  if (left <= 0) block(`ran out of time before ${label}, so the review can't be checked.`);
  const r = spawnSync(cmd, args, { cwd, input, encoding: "utf8", timeout: left });
  if (r.error?.code === "ETIMEDOUT") block(`${label} timed out, so the review can't be checked.`);
  return r;
}

function git(args, cwd) {
  const r = run("git", args, { cwd });
  if (r.status !== 0) {
    block(
      `\`git ${args.join(" ")}\` failed in ${cwd}, so the review can't be checked. ` +
        "Shell variables and ~ in a directory aren't expanded here; use a literal path.",
    );
  }
  return r.stdout.trim();
}

// Git Bash writes C:\dev as /c/dev, which Node on Windows would read as C:\c\dev.
function nativePath(dir) {
  return process.platform === "win32" ? dir.replace(/^\/([A-Za-z])(?=\/|$)/, "$1:") : dir;
}

function check(kind, cwd) {
  const root = git(["rev-parse", "--show-toplevel"], cwd);
  const branch = git(["branch", "--show-current"], cwd);
  const file = `.reviews/${branch.replaceAll("/", "-")}.md`;

  let review = null;
  try {
    review = readFileSync(path.join(root, file), "utf8");
  } catch {
    // Handled below: opening a PR needs the file, a push without one isn't gated.
  }

  if (kind === "push") {
    // `main`, a detached HEAD and branches without a review file push freely; so does a branch
    // whose PR isn't open yet, since `gh pr create` checks the review before the PR exists.
    if (!branch || branch === "main" || review === null) return;
    const args = ["pr", "list", "--head", branch, "--state", "open", "--json", "number"];
    const r = run("gh", [...args, "--jq", "length"], { cwd, timeout: 10000 });
    if (r.status !== 0) {
      block(`\`gh pr list\` failed, so it can't tell whether ${branch} has an open PR.`);
    }
    if (r.stdout.trim() === "0") return;
  }

  if (review === null) {
    block(`no review file at ${file}. Run the review steps and write the review there.`);
  }

  // One lookup for every sha in the file.
  const shas = [...new Set(review.match(/(?<![0-9a-f])[0-9a-f]{40}(?![0-9a-f])/g))];
  const lookup = run("git", ["cat-file", "--batch-check"], { cwd, input: `${shas.join("\n")}\n` });
  if (lookup.status !== 0)
    block("`git cat-file --batch-check` failed, so the review can't be checked.");
  const commits = new Set(
    lookup.stdout
      .split("\n")
      .filter((line) => line.split(" ")[1] === "commit")
      .map((line) => line.split(" ")[0]),
  );
  const problems = checkReview({
    review,
    head: git(["rev-parse", "HEAD"], cwd),
    // -z keeps paths with non-ASCII characters unquoted.
    changedFiles: git(["diff", "--name-only", "-z", "main...HEAD"], cwd)
      .split("\0")
      .filter(Boolean),
    isCommit: (sha) => commits.has(sha),
  });
  if (problems.length) {
    block(
      `${file} isn't ready${kind === "push" ? ` for a push to ${branch}'s open PR` : ""}:\n` +
        problems.map((problem) => `- ${problem}`).join("\n") +
        "\nReview what's missing (for new commits, a fix round or pass), then update the file.",
    );
  }
}

// An uncaught error would exit 1, which lets the command through, so it refuses instead.
try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const shell = input.tool_name === "PowerShell" ? "powershell" : "bash";
  const base = input.cwd ?? process.cwd();
  for (const { kind, cwd } of gatedCommands(input.tool_input?.command ?? "", shell)) {
    if (kind === "unclear") {
      block(
        "this command has an unclosed quote, or quotes nested inside a `$(…)` in double " +
          "quotes, and mentions `git push` or `gh pr create`, so it can't tell what runs. " +
          "Close the quote, use single quotes inside the `$(…)`, or split the command up.",
      );
    }
    check(kind, cwd ? path.resolve(base, nativePath(cwd)) : base);
  }
} catch (error) {
  block(`couldn't check the review: ${error.message}`);
}
