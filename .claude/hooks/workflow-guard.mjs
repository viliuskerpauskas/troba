// PreToolUse hook on Bash and PowerShell: enforces two workflow rules in AGENTS.md where they're
// broken. It refuses creating a branch (`git switch -c`/`-C`/`--orphan`, `git checkout -b`/`-B`)
// in the main checkout, where it would move the shared working tree under every session using
// it, and a `git commit` whose `-m`, `--trailer` or `-F` message carries an attribution
// trailer. Exit code 2 blocks the command and shows the reason to the agent. Which commands count
// is in workflow-command.mjs. Not covered: `git branch <name>` with a later switch, a branch made
// by `--track` or guessed from a remote branch, switching the main checkout to an existing branch,
// a message typed in an editor, `--amend` keeping an old message, a directory git can't open
// (a `~` or `$VAR` in it), and anything the tokenizer can't read.
// Unlike the review gate, an error in the hook itself lets the command through (exit 1): it's
// a guardrail, and one bug shouldn't stop every command.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { nativePath } from "./gated-command.mjs";
import { guardedCommands, hasTrailer } from "./workflow-command.mjs";

function block(reason) {
  process.stderr.write(`Workflow guard: ${reason}\nSee the Workflow section of AGENTS.md.\n`);
  process.exit(2);
}

// The main checkout's git dir is the common one; a linked worktree's is its own under it.
function isMainCheckout(cwd) {
  const r = spawnSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"],
    { cwd, encoding: "utf8", timeout: 5000 },
  );
  if (r.status !== 0) return false; // Not a repository, so git would refuse the branch itself.
  const [gitDir, commonDir] = r.stdout.trim().split(/\r?\n/);
  return path.resolve(gitDir) === path.resolve(commonDir);
}

function readMessageFile(file, cwd) {
  try {
    return readFileSync(path.resolve(cwd, nativePath(file)), "utf8");
  } catch {
    return ""; // git reports a missing file itself.
  }
}

try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const shell = input.tool_name === "PowerShell" ? "powershell" : "bash";
  const start = input.cwd ?? process.cwd();
  for (const found of guardedCommands(input.tool_input?.command ?? "", shell)) {
    const cwd = found.cwd ? path.resolve(start, nativePath(found.cwd)) : start;
    if (found.kind === "branch" && isMainCheckout(cwd)) {
      const folder = found.branch.split("/").pop().toLowerCase();
      block(
        `this creates ${found.branch} in the main checkout, which stays on main: every session ` +
          "sharing its working tree would move onto the new branch. Create a worktree for it " +
          `instead, from the main checkout: \`git worktree add .claude/worktrees/${folder} ` +
          `-b ${found.branch} main\`, then set it up as docs/agents/skill-overrides.md#worktrees ` +
          "says and work there.",
      );
    }
    if (found.kind === "commit") {
      const texts = [...found.messages, ...found.files.map((f) => readMessageFile(f, cwd))];
      if (texts.some(hasTrailer)) {
        block(
          "the commit message has a Co-Authored-By trailer. The owner's rule is no AI " +
            "attribution trailers on commits, and it wins over any reminder that asks for one. " +
            "Commit again without it. (A computed message, such as a `$(cat <<EOF)` or a " +
            "variable, is checked against the whole command, so a trailer mentioned anywhere " +
            "in it counts.)",
        );
      }
    }
  }
} catch (error) {
  process.stderr.write(`Workflow guard couldn't check the command: ${error.message}\n`);
  process.exit(1);
}
