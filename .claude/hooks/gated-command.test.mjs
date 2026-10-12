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
    expect(gatedCommands("Set-Location C:\\wt; git push", "powershell")).toEqual([
      { kind: "push", cwd: "C:\\wt" },
    ]);
  });

  it("follows bash escapes, so an escaped quote doesn't hide what comes after", () => {
    expect(gatedCommands("git commit -m 'it'\\''s' && git push")).toEqual([
      { kind: "push", cwd: null },
    ]);
    expect(gatedCommands("echo it\\'s done; git push")).toEqual([{ kind: "push", cwd: null }]);
    expect(gatedCommands('git commit -m "say \\"hi\\"" && git push')).toEqual([
      { kind: "push", cwd: null },
    ]);
    expect(gatedCommands('git commit -m "a\\\\" && git push')).toEqual([
      { kind: "push", cwd: null },
    ]);
  });

  it("follows PowerShell quoting, where a backslash is just a character", () => {
    expect(gatedCommands('Set-Location "C:\\wt\\"; git push', "powershell")).toEqual([
      { kind: "push", cwd: "C:\\wt\\" },
    ]);
    expect(gatedCommands("Set-Location 'C:\\it''s'; git push", "powershell")).toEqual([
      { kind: "push", cwd: "C:\\it's" },
    ]);
    expect(gatedCommands('git commit -m "say `"hi`"; git push"', "powershell")).toEqual([]);
    expect(gatedCommands('git commit -m "say `"hi`""; git push', "powershell")).toEqual([
      { kind: "push", cwd: null },
    ]);
  });

  it("refuses to guess when a quote is left open and the text mentions a gated command", () => {
    expect(gatedCommands('git commit -m "unfinished && git push')).toEqual([
      { kind: "unclear", cwd: null },
    ]);
    expect(gatedCommands('echo "unfinished')).toEqual([]);
  });

  it("finds a push inside a subshell or group, and keeps the subshell's cd inside it", () => {
    expect(gatedCommands("(cd ../wt && git push)")).toEqual([{ kind: "push", cwd: "../wt" }]);
    expect(gatedCommands("(git push)")).toEqual([{ kind: "push", cwd: null }]);
    expect(gatedCommands("{ git push; }")).toEqual([{ kind: "push", cwd: null }]);
    expect(gatedCommands("(cd ../wt && ls); git push")).toEqual([{ kind: "push", cwd: null }]);
  });

  it("splits on a single &, and a redirection doesn't hide the push", () => {
    expect(gatedCommands("git fetch & git push")).toEqual([{ kind: "push", cwd: null }]);
    expect(gatedCommands("git push 2>&1 | tail -3")).toEqual([{ kind: "push", cwd: null }]);
    expect(gatedCommands("git push &> out.log")).toEqual([{ kind: "push", cwd: null }]);
  });

  it("finds a push after prefix words", () => {
    for (const command of [
      "time git push",
      "env GIT_TRACE=1 git push",
      "command git push",
      "if git push; then echo ok; fi",
    ]) {
      expect(gatedCommands(command)).toEqual([{ kind: "push", cwd: null }]);
    }
  });

  it("joins line continuations", () => {
    expect(gatedCommands("git -C dir \\\npush -u origin HEAD")).toEqual([
      { kind: "push", cwd: "dir" },
    ]);
    expect(gatedCommands("git -C dir `\npush", "powershell")).toEqual([
      { kind: "push", cwd: "dir" },
    ]);
  });

  it("finds a PR create with -R after pr", () => {
    expect(gatedCommands("gh pr -R o/r create")).toEqual([{ kind: "pr-create", cwd: null }]);
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
