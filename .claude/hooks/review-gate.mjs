// PreToolUse hook on Bash and PowerShell: refuses `gh pr create`, and `git push` on a branch
// with an open PR, until the branch's review file shows the whole review ran on the commit being
// proposed, and (for the PR) the spec issue carries its record of what happened
// (docs/agents/skill-overrides.md, sections /code-review and /wrap). Exit code 2 blocks the
// command and shows the reason to the agent. Which commands count is in gated-command.mjs, and
// what the file must contain in review-evidence.mjs.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { gatedCommands } from "./gated-command.mjs";
import { checkReview, shasIn, specIssue } from "./review-evidence.mjs";

// A hook that runs past its timeout in .claude/settings.json (30 s) lets the command through,
// so every git and gh call shares a budget that ends well before it, and running out refuses.
const deadline = Date.now() + 25000;
// review-gate.test.mjs points this at a stub script, since spawnSync can't find a stub `gh.cmd`
// on Windows; nothing else sets it, and a command can't set the hook's own environment.
const ghStub = process.env.REVIEW_GATE_GH_STUB;
// Set while checking a command that only names `git push` or `gh pr create` somewhere.
let mentioned = false;

function block(reason) {
  const hint = mentioned
    ? "\nThe command names it where the gate can't tell whether it runs (a message, a heredoc, " +
      "another program's argument), so it was checked as if it ran. If it doesn't run, put the " +
      "text in a file (`git commit -F`, `--body-file`)."
    : "";
  process.stderr.write(
    `Review gate: ${reason}${hint}\nSee the /code-review and /wrap sections of docs/agents/skill-overrides.md.\n`,
  );
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

function gh(args, cwd, what) {
  const r = ghStub
    ? run(process.execPath, [ghStub, ...args], { cwd, timeout: 10000 })
    : run("gh", args, { cwd, timeout: 10000 });
  if (r.status !== 0) block(`\`gh ${args.slice(0, 2).join(" ")}\` failed, so ${what}.`);
  return r.stdout.trim();
}

function hasOpenPr(branch, cwd) {
  const args = ["pr", "list", "--head", branch, "--state", "open", "--json", "number"];
  return (
    gh([...args, "--jq", "length"], cwd, `it can't tell whether ${branch} has an open PR`) !== "0"
  );
}

function check({ kind, branches, all }, cwd) {
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
    if (all) {
      block(
        "`git push --all`, `--branches` or `--mirror` can reach any branch's open PR: push one at a time.",
      );
    }
    // `main`, a detached HEAD and branches without a review file push freely; so does a branch
    // whose PR isn't open yet, since `gh pr create` checks the review before the PR exists. The
    // review file is the checked-out branch's, so it can't vouch for a push to another branch.
    let gated = false;
    for (const target of new Set((branches ?? ["HEAD"]).map((b) => (b === "HEAD" ? branch : b)))) {
      if (!target || target === "main") continue;
      if (target !== branch) {
        if (hasOpenPr(target, cwd)) {
          block(
            `${target} has an open PR, but this folder has ${branch || "a detached HEAD"} ` +
              `checked out, so its review can't be checked here. Push ${target} from its own worktree.`,
          );
        }
      } else if (review !== null && hasOpenPr(target, cwd)) gated = true;
    }
    if (!gated) return;
  }

  if (review === null) {
    block(
      `no review file at ${file}. Run the review as skill-overrides.md says and write it there.`,
    );
  }

  // One lookup for every sha in the file.
  const shas = shasIn(review);
  const lookup = run("git", ["cat-file", "--batch-check"], { cwd, input: `${shas.join("\n")}\n` });
  if (lookup.status !== 0)
    block("`git cat-file --batch-check` failed, so the review can't be checked.");
  const commits = new Set(
    lookup.stdout
      .split("\n")
      .filter((line) => line.split(" ")[1] === "commit")
      .map((line) => line.split(" ")[0]),
  );
  // /wrap merges origin/main, so a local main that wasn't pulled would count main's newer
  // commits as the branch's.
  const remote = run("git", ["rev-parse", "--verify", "--quiet", "origin/main"], { cwd });
  const base = remote.status === 0 ? "origin/main" : "main";
  const problems = checkReview({
    review,
    branch,
    head: git(["rev-parse", "HEAD"], cwd),
    // -z keeps paths with non-ASCII characters unquoted.
    changedFiles: git(["diff", "--name-only", "-z", `${base}...HEAD`], cwd)
      .split("\0")
      .filter(Boolean),
    isCommit: (sha) => commits.has(sha),
  });
  if (problems.length) {
    block(
      `${file} isn't ready${kind === "push" ? ` for a push to ${branch}'s open PR` : ""}:\n` +
        problems.map((problem) => `- ${problem}`).join("\n") +
        "\nReview what's missing (for new commits, a fix round, pass or review line), then update the file.",
    );
  }

  // The PR needs the spec issue's record too; once it's open, a push only needs the review.
  const issue = specIssue(review);
  if (kind !== "pr-create" || issue === null) return;
  const body = gh(
    ["issue", "view", issue, "--json", "body", "--jq", ".body"],
    cwd,
    `issue #${issue} can't be checked`,
  );
  if (!/^## What actually happened\b/m.test(body)) {
    block(`issue #${issue} has no "## What actually happened" section yet. /wrap step 5 adds it.`);
  }
}

// An uncaught error would exit 1, which lets the command through, so it refuses instead.
try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const shell = input.tool_name === "PowerShell" ? "powershell" : "bash";
  const start = input.cwd ?? process.cwd();
  for (const found of gatedCommands(input.tool_input?.command ?? "", shell)) {
    const { kind, cwd } = found;
    mentioned = Boolean(found.mentioned);
    if (kind === "unclear") {
      block(
        "it can't tell what this command runs: it has an unclosed quote, quotes nested inside " +
          "a `$(…)` in double quotes, an encoded PowerShell command, or a push whose target " +
          "isn't a plain branch name (a variable or `$(…)`), and it mentions `git push` or " +
          "`gh pr create`. Close the quote, use single quotes inside the `$(…)`, name the " +
          "branch, or split the command up.",
      );
    }
    if (kind === "pr-elsewhere") {
      block(
        "open the PR from the feature worktree for its current branch, without -R, --repo, " +
          "-H, --head, GH_REPO or GH_HOST" +
          (mentioned ? " (and, for a command the gate can't read, without a cd)" : "") +
          ": the review file only vouches for this folder's branch.",
      );
    }
    if (kind === "push-elsewhere") {
      mentioned = false; // The message below already says what to do about the mention.
      block(
        "this command names `git push` next to a directory change (cd, pushd, Set-Location…), " +
          "where the gate can't tell which folder it would push from. If it pushes, run the " +
          "push in the worktree it belongs to, without the cd. If it only names it (a commit " +
          "message, say), put that text in a file: `git commit -F <file>`.",
      );
    }
    check(found, cwd ? path.resolve(start, nativePath(cwd)) : start);
  }
} catch (error) {
  block(`couldn't check the review: ${error.message}`);
}
