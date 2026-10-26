import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The hook end to end, in a scratch repository with a linked worktree beside it.
const hook = path.join(path.dirname(fileURLToPath(import.meta.url)), "workflow-guard.mjs");
let root;
let repo;
let tree;

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

function guard(command, { cwd = repo, tool = "Bash" } = {}) {
  const input = JSON.stringify({ tool_name: tool, cwd, tool_input: { command } });
  const r = spawnSync(process.execPath, [hook], { input, encoding: "utf8" });
  return { status: r.status, stderr: r.stderr };
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "workflow-guard-"));
  repo = path.join(root, "repo");
  tree = path.join(root, "tree");
  git(root, "init", "-q", "-b", "main", repo);
  git(
    repo,
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@example.test",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "init",
  );
  git(repo, "worktree", "add", "-q", tree, "-b", "chore/T1-x", "main");
  writeFileSync(path.join(tree, "msg.txt"), "feat: x\n\nCo-Authored-By: A <a@example.test>\n");
  writeFileSync(path.join(tree, "clean.txt"), "feat: x\n\nRefs #1\n");
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("workflow-guard hook", () => {
  it("refuses a new branch in the main checkout and names the worktree command", () => {
    for (const command of ["git switch -c chore/x", "git checkout -b chore/x"]) {
      const r = guard(command);
      expect(r.status, command).toBe(2);
      expect(r.stderr).toContain("git worktree add .claude/worktrees/x -b chore/x dev");
    }
  });

  it("refuses a new branch aimed at the main checkout from a worktree", () => {
    expect(guard(`git -C "${repo}" switch -c chore/x`, { cwd: tree }).status).toBe(2);
    expect(
      guard(`Set-Location "${repo}"; git switch -c chore/x`, { cwd: tree, tool: "PowerShell" })
        .status,
    ).toBe(2);
  });

  it("lets a new branch through in a linked worktree, and other commands in the main checkout", () => {
    expect(guard("git switch -c chore/x", { cwd: tree }).status).toBe(0);
    expect(guard("git switch main").status).toBe(0);
    expect(guard('grep -n "git switch -c" AGENTS.md').status).toBe(0);
  });

  it("refuses a commit whose message or message file has an attribution trailer", () => {
    const commands = [
      'git commit -m "feat: x" -m "Co-Authored-By: A <a@example.test>"',
      "git commit -F msg.txt",
      "git commit -m \"$(cat <<'EOF'\nfeat: x\n\nCo-authored-by: A\nEOF\n)\"",
    ];
    for (const command of commands) {
      const r = guard(command, { cwd: tree });
      expect(r.status, command).toBe(2);
      expect(r.stderr).toContain("attribution");
    }
    const ps = "git commit -m @'\nfeat: x\n\nCo-Authored-By: A\n'@";
    expect(guard(ps, { cwd: tree, tool: "PowerShell" }).status).toBe(2);
  });

  it("lets a commit without one through, and commands that only mention a trailer", () => {
    expect(guard('git commit -m "feat: x" -m "Refs #1"', { cwd: tree }).status).toBe(0);
    expect(guard("git commit -F clean.txt", { cwd: tree }).status).toBe(0);
    expect(guard('grep -rn "Co-Authored-By:" .', { cwd: tree }).status).toBe(0);
    const issue = "gh issue create --body-file - <<'EOF'\nNo Co-Authored-By: trailers.\nEOF";
    expect(guard(issue, { cwd: tree }).status).toBe(0);
  });
});
