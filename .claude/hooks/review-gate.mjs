// PreToolUse hook on Bash and PowerShell: refuses `gh pr create` until the branch's review file shows the
// whole review ran on the commit being proposed, and the spec issue carries its record of what
// happened (docs/agents/skill-overrides.md, sections /code-review and /wrap). Exit code 2 blocks the
// command and shows the reason to the agent; every failure inside the hook blocks too, because
// any other exit code lets the command run.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

// One heading per part of the review, so a skipped part is visible.
const SECTIONS = ["Standards", "Spec", "Checks", "Personal information"];

function block(reason) {
  process.stderr.write(
    `Review gate: ${reason}\nSee the /code-review and /wrap sections of docs/agents/skill-overrides.md.\n`,
  );
  process.exit(2);
}

function main() {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const command = input.tool_input?.command ?? "";
  // `gh pr new` is an alias of `gh pr create`. Any mention counts, wherever it sits (a subshell,
  // an env prefix, `bash -c`): a false block costs a reworded command, a missed one an
  // unreviewed PR. So a commit message that names the command goes in a file (`git commit -F`).
  // gh takes flags between `pr` and the subcommand (`gh pr -R o/r create`), and a full path may
  // be quoted (`& "C:\…\gh.exe" pr create`), so anything up to the next ; & | or line break may
  // sit between them. A bare help call is the one form that opens nothing.
  if (!/\bgh(\.exe)?["']?\s+pr\b[^\n;&|]*?\b(create|new)\b/.test(command)) return;
  if (/^\s*gh(\.exe)?\s+pr\s+(create|new)\s+(--help|-h)\s*$/.test(command)) return;

  // The gate reads the branch and review file of the session's folder, so it can only vouch
  // for a PR opened from that folder, for its own branch.
  const elsewhere =
    /(^|[\s;&|({`])(cd|pushd|popd|chdir|sl|Set-Location|Push-Location)(\s|$)|\bGH_(REPO|HOST)=|--repo\b|--head\b|\s-[RH](\s|\S)/;
  if (elsewhere.test(command)) {
    block(
      "open the PR from the feature worktree itself, for its current branch (no cd, GH_REPO, --repo or --head).",
    );
  }

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
      `no review file at ${file}. Run the review as skill-overrides.md says and write it there.`,
    );
  }

  const missing = SECTIONS.filter((name) => !new RegExp(`^## ${name}\\s*$`, "m").test(review));
  if (missing.length) block(`${file} is missing: ${missing.map((n) => `## ${n}`).join(", ")}.`);
  if (!review.includes(`Reviewed commit: ${head}`)) {
    block(
      `${file} doesn't say "Reviewed commit: ${head}". Review the commits since the last ` +
        "review, then update that line.",
    );
  }

  // `Spec: #<n>` names the spec issue (or the standalone task's own issue), whose body /wrap
  // appends to. `Spec: none - <why>` is the recorded exception for work with no issue.
  const spec = review.match(/^Spec:\s*(?:#(\d+)|none\s+[-–—]\s+\S.*?)\s*$/m);
  if (!spec) {
    block(`${file} has no "Spec: #<issue>" line (or "Spec: none - <why>" for work with no issue).`);
  }
  // A branch named after an issue always has that issue as its spec.
  const key = branch.match(/\/T(\d+)-/)?.[1];
  if (key && key !== spec[1]) {
    block(`${file} must say "Spec: #${key}": the branch ${branch} belongs to T${key}.`);
  }
  if (!spec[1]) return;
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

try {
  main();
} catch (error) {
  block(`the gate itself failed (${error.message}), so nothing was checked.`);
}
