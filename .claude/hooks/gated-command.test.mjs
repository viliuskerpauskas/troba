import { describe, expect, it } from "vitest";
import { gatedCommands } from "./gated-command.mjs";

describe("gatedCommands", () => {
  it("finds a plain push and a PR create", () => {
    expect(gatedCommands("git push -u origin HEAD")).toEqual([{ kind: "push", cwd: null }]);
    expect(gatedCommands("gh pr create --fill")).toEqual([{ kind: "pr-create", cwd: null }]);
  });

  it("ignores other commands", () => {
    expect(gatedCommands("git status && pnpm test")).toEqual([]);
    expect(gatedCommands("git push-something")).toEqual([]);
    expect(gatedCommands("gh pr view 3")).toEqual([]);
  });

  it("finds a push after git's global options, and takes -C as the directory", () => {
    expect(gatedCommands("git --no-pager -c a=b -C ../wt push")).toEqual([
      { kind: "push", cwd: "../wt" },
    ]);
    expect(gatedCommands("git --git-dir=.git --work-tree=. push")).toEqual([
      { kind: "push", cwd: null },
    ]);
    expect(gatedCommands('git.exe -C "C:\\dev\\my wt" push')).toEqual([
      { kind: "push", cwd: "C:\\dev\\my wt" },
    ]);
  });

  it("joins repeated -C options like git does", () => {
    expect(gatedCommands("git -C /repo -C wt push")).toEqual([{ kind: "push", cwd: "/repo/wt" }]);
    expect(gatedCommands("git -C a -C /abs push")).toEqual([{ kind: "push", cwd: "/abs" }]);
  });

  it("finds gh pr new and a PR create after -R/--repo", () => {
    expect(gatedCommands("gh pr new")).toEqual([{ kind: "pr-create", cwd: null }]);
    expect(gatedCommands("gh -R o/r pr create")).toEqual([{ kind: "pr-create", cwd: null }]);
    expect(gatedCommands("gh --repo=o/r pr create")).toEqual([{ kind: "pr-create", cwd: null }]);
  });

  it("finds each command in a chain, with the directory a cd moved to", () => {
    expect(gatedCommands("cd ../wt && git push; gh pr create --fill | cat")).toEqual([
      { kind: "push", cwd: "../wt" },
      { kind: "pr-create", cwd: "../wt" },
    ]);
    expect(gatedCommands("Set-Location C:\\wt; git push")).toEqual([
      { kind: "push", cwd: "C:\\wt" },
    ]);
  });

  it("ignores the commands when they're only mentioned in quotes or a message", () => {
    expect(gatedCommands('git commit -m "fix: gate git push and gh pr create"')).toEqual([]);
    expect(gatedCommands("echo 'git push'")).toEqual([]);
    expect(gatedCommands('grep -rn "gh pr create" .')).toEqual([]);
  });

  it("ignores a heredoc body and a PowerShell here-string", () => {
    const heredoc = "cat > notes.md <<'EOF'\nthen git push\ngh pr create\nEOF\nls";
    expect(gatedCommands(heredoc)).toEqual([]);
    const hereString = "git commit -m @'\nchore: x\ngit push\n'@";
    expect(gatedCommands(hereString)).toEqual([]);
  });

  it("still finds a push after a heredoc", () => {
    expect(gatedCommands("git commit -F - <<'EOF'\nchore: x\nEOF\ngit push")).toEqual([
      { kind: "push", cwd: null },
    ]);
  });

  it("ignores --help", () => {
    expect(gatedCommands("gh pr create --help")).toEqual([]);
    expect(gatedCommands("git push -h")).toEqual([]);
  });

  it("skips env assignments and the PowerShell call operator before the program", () => {
    expect(gatedCommands("GIT_TRACE=1 git push")).toEqual([{ kind: "push", cwd: null }]);
    expect(gatedCommands('& "git" push')).toEqual([{ kind: "push", cwd: null }]);
  });
});
