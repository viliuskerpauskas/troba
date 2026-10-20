import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// The hook end to end, in a scratch repository with a `main` worktree and a `docs/x` worktree,
// and a stub in place of `gh` that answers from the test's settings.
const hook = path.join(path.dirname(fileURLToPath(import.meta.url)), "review-gate.mjs");
let root;
let repo;
let mainTree;
let stub;
let head;

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

// Only what git and node need, so a GH_REPO or GH_TOKEN on the developer's machine can't leak in.
function env(gh) {
  const keep = ["PATH", "Path", "SystemRoot", "HOME", "USERPROFILE", "TEMP", "TMP"];
  const base = Object.fromEntries(
    keep.filter((k) => process.env[k]).map((k) => [k, process.env[k]]),
  );
  return {
    ...base,
    REVIEW_GATE_GH_STUB: stub,
    STUB_OPEN_PRS: (gh.openPrs ?? []).join(","),
    STUB_FAIL: gh.fail ? "1" : "",
    STUB_ISSUE_BODY: gh.issueBody ?? "",
  };
}

function gate(command, { cwd = repo, tool = "Bash", stdin, gh = {} } = {}) {
  const input = stdin ?? JSON.stringify({ tool_name: tool, cwd, tool_input: { command } });
  const r = spawnSync(process.execPath, [hook], { input, encoding: "utf8", env: env(gh) });
  return { status: r.status, stderr: r.stderr };
}

const reviewPath = () => path.join(repo, ".reviews", "docs-x.md");

function writeReview({ spec = "Spec: none - a scratch change", mutation = true, reviewed } = {}) {
  writeFileSync(
    reviewPath(),
    [
      "# Review: docs/x",
      spec,
      `First reviewed commit: ${head}`,
      `Reviewed commit: ${reviewed ?? head}`,
      "## Standards",
      "Files read:",
      "- `notes.md`",
      "## Spec",
      "No issue.",
      "## Checks",
      mutation ? "Mutation: none - docs only" : "",
      "## Personal information",
      "Clean.",
    ].join("\n"),
  );
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "review-gate-"));
  repo = path.join(root, "repo");
  mainTree = path.join(root, "main");
  stub = path.join(root, "gh-stub.mjs");
  writeFileSync(
    stub,
    [
      "const [cmd, sub, ...rest] = process.argv.slice(2);",
      "if (process.env.STUB_FAIL) process.exit(1);",
      "const open = process.env.STUB_OPEN_PRS.split(',').filter(Boolean);",
      "if (cmd === 'pr' && sub === 'list') {",
      "  console.log(open.includes(rest[rest.indexOf('--head') + 1]) ? '1' : '0');",
      "} else if (cmd === 'issue' && sub === 'view') console.log(process.env.STUB_ISSUE_BODY);",
      "else process.exit(1);",
    ].join("\n"),
  );
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

beforeEach(() => writeReview());

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("review-gate", { timeout: 30000 }, () => {
  it("lets other commands through", () => {
    expect(gate("git status && pnpm test").status).toBe(0);
  });

  describe("opening a PR", () => {
    it("goes through when the review file is complete", () => {
      expect(gate("gh pr create --fill")).toEqual({ status: 0, stderr: "" });
    });

    it("is refused, naming what the review file is missing", () => {
      writeReview({ mutation: false });
      const { status, stderr } = gate("gh pr create --fill");
      expect(status).toBe(2);
      expect(stderr).toContain('## Checks has no "Mutation:" line');
    });

    it("is refused without a review file", () => {
      rmSync(reviewPath());
      const { status, stderr } = gate("gh pr create --fill");
      expect(status).toBe(2);
      expect(stderr).toContain("no review file at .reviews/docs-x.md");
    });

    it("needs the spec issue's record of what happened", () => {
      writeReview({ spec: "Spec: #7" });
      const gh = { issueBody: "## Plan" };
      expect(gate("gh pr create --fill", { gh }).stderr).toContain(
        'issue #7 has no "## What actually happened" section',
      );
      gh.issueBody = "## Plan\n\n## What actually happened\n\nDone.";
      expect(gate("gh pr create --fill", { gh }).status).toBe(0);
    });

    it("is checked inside bash -c, in the folder a cd names, and when only mentioned", () => {
      writeReview({ mutation: false });
      expect(gate("bash -c 'gh pr create --fill'").status).toBe(2);
      expect(gate(`cd "${repo}" && gh pr create`, { cwd: mainTree }).status).toBe(2);
      const { status, stderr } = gate('cmd /c "gh pr create --fill"');
      expect(status).toBe(2);
      expect(stderr).toContain("checked as if it ran");
    });
  });

  describe("pushing", () => {
    it("goes freely from main, from a branch with no review file, and before the PR opens", () => {
      expect(gate("git push origin main", { cwd: mainTree }).status).toBe(0);
      expect(gate("git push").status).toBe(0);
      rmSync(reviewPath());
      expect(gate("git push", { gh: { openPrs: ["docs/x"] } }).status).toBe(0);
    });

    it("to an open PR needs the review file to name HEAD", () => {
      const gh = { openPrs: ["docs/x"] };
      expect(gate("git push", { gh }).status).toBe(0);
      writeReview({ reviewed: git(repo, "rev-parse", "HEAD~1") });
      const { status, stderr } = gate("git push origin @", { gh });
      expect(status).toBe(2);
      expect(stderr).toContain("isn't ready for a push to docs/x's open PR");
    });

    it("of another branch with an open PR is refused, from any folder", () => {
      const gh = { openPrs: ["docs/x"] };
      const { status, stderr } = gate("git push origin docs/x", { cwd: mainTree, gh });
      expect(status).toBe(2);
      expect(stderr).toContain("Push docs/x from its own worktree");
      expect(gate("git push origin HEAD:docs/y", { gh }).status).toBe(0);
    });

    it("is refused when gh can't say whether a PR is open", () => {
      const { status, stderr } = gate("git push", { gh: { fail: true } });
      expect(status).toBe(2);
      expect(stderr).toContain("`gh pr list` failed");
    });

    it("of every branch, or to a target it can't name, is refused", () => {
      expect(gate("git push --all origin").stderr).toContain("push one at a time");
      expect(gate('git push origin "$BRANCH"').stderr).toContain("isn't a plain branch name");
    });
  });

  it("refuses a PR aimed elsewhere and a command it can't read", () => {
    expect(gate("export GH_REPO=o/r; gh pr create").stderr).toContain("without -R, --repo");
    expect(gate("git commit -m \"it's; git push").stderr).toContain("can't tell what");
    expect(gate("pwsh -enc ZwBpAHQA", { tool: "PowerShell" }).status).toBe(2);
  });

  it("refuses when its input can't be read, rather than letting the command run", () => {
    const { status, stderr } = gate("", { stdin: "not json" });
    expect(status).toBe(2);
    expect(stderr).toContain("couldn't check the review");
  });
});
