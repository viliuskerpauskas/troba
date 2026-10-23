import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

// The hook end to end, in a scratch repository (the main checkout) with a linked worktree on
// `feat/x`, and a stub in place of `gh` that always fails, so no lookup reaches the network.
const hook = path.join(path.dirname(fileURLToPath(import.meta.url)), "session-status.mjs");
let root;
let repo;
let linked;
let stub;

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

function status(cwd) {
  const keep = ["PATH", "Path", "SystemRoot", "HOME", "USERPROFILE", "TEMP", "TMP"];
  const env = Object.fromEntries(
    keep.filter((k) => process.env[k]).map((k) => [k, process.env[k]]),
  );
  const r = spawnSync(process.execPath, [hook], {
    cwd,
    encoding: "utf8",
    env: { ...env, SESSION_STATUS_GH_STUB: stub },
  });
  return JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "session-status-"));
  repo = path.join(root, "repo");
  linked = path.join(root, "linked");
  stub = path.join(root, "gh-stub.mjs");
  writeFileSync(stub, "process.exit(1);\n");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "test@example.test");
  git(repo, "config", "user.name", "Test");
  writeFileSync(path.join(repo, "notes.md"), "notes\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "chore: start");
  git(repo, "worktree", "add", "-q", linked, "-b", "feat/x");
});

afterEach(() => {
  git(repo, "switch", "-q", "main");
  git(repo, "checkout", "-q", "--", ".");
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("session-status", { timeout: 30000 }, () => {
  it("warns in the main checkout on a branch other than main, listing the worktrees", () => {
    git(repo, "switch", "-qc", "feat/y");
    const out = status(repo);
    expect(out).toContain("another session may be using this checkout");
    expect(out).toContain("git worktree add <path> -b <branch> main");
    expect(out).toMatch(/linked\s+\w+ \[feat\/x\]/);
    git(repo, "switch", "-q", "main");
    git(repo, "branch", "-qD", "feat/y");
  });

  it("warns in the main checkout on main with an uncommitted change", () => {
    writeFileSync(path.join(repo, "notes.md"), "edited\n");
    const out = status(repo);
    expect(out).toContain("it is on main with uncommitted changes");
    expect(out).toMatch(/linked\s+\w+ \[feat\/x\]/);
  });

  it("stays quiet in a clean main checkout on main, and in a linked worktree", () => {
    expect(status(repo)).not.toMatch(/Warning|Checkout:/);
    writeFileSync(path.join(linked, "notes.md"), "edited\n");
    expect(status(linked)).not.toMatch(/Warning|Checkout:/);
    git(linked, "checkout", "-q", "--", ".");
  });

  it("reports the checkout as unknown, not clear, when git status fails", () => {
    const index = path.join(repo, ".git", "index");
    const saved = readFileSync(index);
    writeFileSync(index, "not an index");
    try {
      const out = status(repo);
      expect(out).toContain("Checkout: unknown whether it is in use (git status failed).");
      expect(out).toContain("uncommitted changes unknown");
    } finally {
      writeFileSync(index, saved);
    }
  });
});
