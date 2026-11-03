import { describe, expect, it } from "vitest";
import { guardedCommands, hasTrailer } from "./workflow-command.mjs";

describe("guardedCommands", () => {
  it("finds a branch created by git switch and git checkout", () => {
    for (const command of [
      "git switch -c chore/x",
      "git switch -C chore/x",
      "git switch --create chore/x main",
      "git switch --force-create=chore/x",
      "git switch -cchore/x",
      "git checkout -b chore/x",
      "git checkout -B chore/x origin/main",
      "git checkout -q -b chore/x",
    ]) {
      expect(guardedCommands(command), command).toEqual([
        { kind: "branch", cwd: null, branch: "chore/x" },
      ]);
    }
  });

  it("ignores switching to an existing branch and commands that only mention a new one", () => {
    for (const command of [
      "git switch main",
      "git checkout -- notes.md",
      "git switch -- -c",
      "git worktree add .claude/worktrees/t1-x -b chore/T1-x main",
      'grep -n "git switch -c" AGENTS.md',
      "echo 'git checkout -b chore/x'",
      "gh issue create --body-file - <<'EOF'\ngit switch -c chore/x\nEOF",
      "# git switch -c chore/x",
    ]) {
      expect(guardedCommands(command), command).toEqual([]);
    }
  });

  it("takes the directory from git -C, a cd, and a shell's command string", () => {
    expect(guardedCommands("git -C ../repo switch -c chore/x")).toEqual([
      { kind: "branch", cwd: "../repo", branch: "chore/x" },
    ]);
    expect(guardedCommands("Set-Location C:\\repo; git checkout -b chore/x", "powershell")).toEqual(
      [{ kind: "branch", cwd: "C:\\repo", branch: "chore/x" }],
    );
    expect(guardedCommands("cd /repo && bash -c 'cd sub && git switch -c chore/x'")).toEqual([
      { kind: "branch", cwd: "/repo/sub", branch: "chore/x" },
    ]);
  });

  it("collects a commit's messages and message files", () => {
    expect(guardedCommands('git commit -m "feat: x" -m "Refs #1"')).toEqual([
      { kind: "commit", cwd: null, messages: ["feat: x", "Refs #1"], files: [] },
    ]);
    expect(
      guardedCommands("git commit -am a -mb --message=c --message d --trailer e -F f --file=g"),
    ).toEqual([
      { kind: "commit", cwd: null, messages: ["a", "b", "c", "d", "e"], files: ["f", "g"] },
    ]);
    expect(guardedCommands("git commit -unormal -Skey -m a")).toEqual([
      { kind: "commit", cwd: null, messages: ["a"], files: [] },
    ]);
    expect(guardedCommands("git -C ../wt commit -C HEAD -s")).toEqual([
      { kind: "commit", cwd: "../wt", messages: [], files: [] },
    ]);
  });

  it("reads a PowerShell here-string message", () => {
    const command = "git commit -m @'\nfeat: x\n\nCo-Authored-By: A <a@example.test>\n'@";
    expect(guardedCommands(command, "powershell")).toEqual([
      {
        kind: "commit",
        cwd: null,
        messages: ["feat: x\n\nCo-Authored-By: A <a@example.test>"],
        files: [],
      },
    ]);
  });

  it("takes the whole command as the message when the message is computed", () => {
    for (const [command, shell] of [
      ["git commit -m \"$(cat <<'EOF'\nfeat: x\n\nCo-Authored-By: A\nEOF\n)\"", "bash"],
      ["git commit -F - <<'EOF'\nfeat: x\n\nCo-Authored-By: A\nEOF", "bash"],
      ['MSG="feat: x"; git commit --file=- -m "$MSG"', "bash"],
      ["$m = @'\nfeat: x\n'@\ngit commit -m $m", "powershell"],
    ]) {
      const [found] = guardedCommands(command, shell);
      expect(found.messages, command).toContain(command);
    }
  });

  it("reads a -h that is an option's value like any other word", () => {
    const [found] = guardedCommands(
      'git commit -m -h --trailer "Co-Authored-By: X <x@example.test>"',
    );
    expect(found).toEqual({
      kind: "commit",
      cwd: null,
      messages: ["-h", "Co-Authored-By: X <x@example.test>"],
      files: [],
    });
    expect(hasTrailer(found.messages.join("\n"))).toBe(true);
    expect(guardedCommands("git switch -c -h")).toEqual([
      { kind: "branch", cwd: null, branch: "-h" },
    ]);
    expect(guardedCommands("git commit -m x\n-h")).toEqual([
      { kind: "commit", cwd: null, messages: ["x"], files: [] },
    ]);
  });

  it("skips a whole-command help call", () => {
    for (const command of ["git commit -h", "git switch --help", "git.exe checkout -h"]) {
      expect(guardedCommands(command), command).toEqual([]);
    }
  });
});

describe("hasTrailer", () => {
  it("finds an attribution trailer in any case", () => {
    expect(hasTrailer("feat: x\n\nCo-Authored-By: A <a@example.test>")).toBe(true);
    expect(hasTrailer("feat: x\n\nco-authored-by: A")).toBe(true);
    expect(hasTrailer("feat: x\n\nRefs #1")).toBe(false);
  });

  it("finds one written with escapes or git's = separator", () => {
    const [found] = guardedCommands('git commit -m "feat: x`n`nCo-Authored-By: A"', "powershell");
    expect(found.messages.some(hasTrailer)).toBe(true);
    expect(hasTrailer("feat: x\\n\\nCo-Authored-By: A")).toBe(true);
    expect(hasTrailer("Co-authored-by=A")).toBe(true);
    expect(hasTrailer("co-authored-by = A")).toBe(true);
  });
});
