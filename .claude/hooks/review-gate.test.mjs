import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The hook end to end, in a scratch repository with a `main` worktree and a `docs/x` worktree.
// Nothing here has a GitHub remote, so any check that needs `gh` fails, which the hook must
// treat as a refusal.
const hook = path.join(path.dirname(fileURLToPath(import.meta.url)), "review-gate.mjs");
let root;
let repo;
let mainTree;
let head;

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

function gate(command, { cwd = repo, tool = "Bash", stdin } = {}) {
  const input = stdin ?? JSON.stringify({ tool_name: tool, cwd, tool_input: { command } });
  const r = spawnSync(process.execPath, [hook], { input, encoding: "utf8" });
  return { status: r.status, stderr: r.stderr };
}

function writeReview({ mutation = "Mutation: none - docs only" } = {}) {
  writeFileSync(
    path.join(repo, ".reviews", "docs-x.md"),
    [
      "# Review: docs/x",
      "Spec: none - a scratch change",
      `First reviewed commit: ${head}`,
      `Reviewed commit: ${head}`,
      "## Standards",
      "Files read:",
      "- `notes.md`",
      "## Spec",
      "No issue.",
      "## Checks",
      mutation,
      "## Personal information",
      "Clean.",
    ].join("\n"),
  );
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "review-gate-"));
  repo = path.join(root, "repo");
  mainTree = path.join(root, "main");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "test@example.test");
  git(repo, "config", "user.name", "Test");
  writeFileSync(path.join(repo, ".gitignore"), ".reviews/\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "chore: start");
  git(repo, "switch", "-qc", "docs/x");
  writeFileSync(path.join(repo, "notes.md"), "notes\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "docs: notes");
  git(repo, "worktree", "add", "-q", mainTree, "main");
  head = git(repo, "rev-parse", "HEAD");
  mkdirSync(path.join(repo, ".reviews"));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("review-gate", { timeout: 30000 }, () => {
  it("lets other commands through", () => {
    expect(gate("git status && pnpm test").status).toBe(0);
  });

  it("opens the PR when the review file is complete", () => {
    writeReview();
    expect(gate("gh pr create --fill")).toEqual({ status: 0, stderr: "" });
  });

  it("refuses the PR and names what the review file is missing", () => {
    writeReview({ mutation: "" });
    const { status, stderr } = gate("gh pr create --fill");
    expect(status).toBe(2);
    expect(stderr).toContain('## Checks has no "Mutation:" line');
  });

  it("refuses the PR without a review file", () => {
    rmSync(path.join(repo, ".reviews", "docs-x.md"), { force: true });
    const { status, stderr } = gate("gh pr create --fill");
    expect(status).toBe(2);
    expect(stderr).toContain("no review file at .reviews/docs-x.md");
  });

  it("checks a PR create inside bash -c, and in the folder a cd names", () => {
    writeReview({ mutation: "" });
    expect(gate("bash -c 'gh pr create --fill'").status).toBe(2);
    expect(gate(`cd "${repo}" && gh pr create`, { cwd: mainTree }).status).toBe(2);
  });

  it("pushes freely from main and from a branch with no review file", () => {
    rmSync(path.join(repo, ".reviews", "docs-x.md"), { force: true });
    expect(gate("git push").status).toBe(0);
    expect(gate("git push origin main", { cwd: mainTree }).status).toBe(0);
  });

  it("refuses a push it can't check for an open PR", () => {
    writeReview();
    const { status, stderr } = gate("git push");
    expect(status).toBe(2);
    expect(stderr).toContain("`gh pr list` failed");
    // Pushing another branch than the one checked out asks gh too, whatever this folder holds.
    expect(gate("git push origin docs/x", { cwd: mainTree }).status).toBe(2);
  });

  it("refuses a push of every branch", () => {
    const { status, stderr } = gate("git push --all origin");
    expect(status).toBe(2);
    expect(stderr).toContain("push one at a time");
  });

  it("refuses a PR aimed elsewhere and a command it can't read", () => {
    expect(gate("export GH_REPO=o/r; gh pr create").stderr).toContain("without -R, --repo");
    expect(gate("git commit -m \"it's; git push").stderr).toContain("can't tell what runs");
    expect(gate("pwsh -EncodedCommand ZwBpAHQA", { tool: "PowerShell" }).status).toBe(2);
  });

  it("refuses when its input can't be read, rather than letting the command run", () => {
    const { status, stderr } = gate("", { stdin: "not json" });
    expect(status).toBe(2);
    expect(stderr).toContain("couldn't check the review");
  });
});
