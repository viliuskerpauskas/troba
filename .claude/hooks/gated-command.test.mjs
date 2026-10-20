import { describe, expect, it } from "vitest";
import { gatedCommands } from "./gated-command.mjs";

describe("gatedCommands", () => {
  it("finds a plain push and a PR create", () => {
    expect(gatedCommands("git push")).toEqual([{ kind: "push", cwd: null }]);
    expect(gatedCommands("git push -u origin HEAD")).toEqual([
      { kind: "push", cwd: null, branches: ["HEAD"] },
    ]);
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

  it("finds gh pr new, and a PR create for another repository or branch", () => {
    expect(gatedCommands("gh pr new")).toEqual([{ kind: "pr-create", cwd: null }]);
    for (const command of [
      "gh -R o/r pr create",
      "gh --repo=o/r pr create",
      "gh pr create --repo o/r",
      "gh pr create -H other",
      "gh pr create --head=other --fill",
      "gh pr create -Ho/r:other",
      "GH_REPO=o/r gh pr create",
      "GH_HOST=example.test gh pr new",
    ]) {
      expect(gatedCommands(command), command).toEqual([{ kind: "pr-elsewhere", cwd: null }]);
    }
  });

  it("doesn't count -R or --head inside a quoted title as a target", () => {
    expect(gatedCommands('gh pr create --title "-R and --head explained"')).toEqual([
      { kind: "pr-create", cwd: null },
    ]);
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

  it("checks a long unparsable command in linear time", () => {
    expect(gatedCommands(`echo "${"gh pr ".repeat(6000)}`)).toEqual([]);
    expect(gatedCommands(`echo "${"git ".repeat(30000)}push`)).toEqual([
      { kind: "unclear", cwd: null },
    ]);
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
      { kind: "push", cwd: "dir", branches: ["HEAD"] },
    ]);
    expect(gatedCommands("git -C dir `\npush", "powershell")).toEqual([
      { kind: "push", cwd: "dir" },
    ]);
  });

  it("skips # comments, so an apostrophe in one doesn't open a quote", () => {
    const twoComments =
      "# Push the branch's commits\ngit push -u origin HEAD\n# Then open the PR's page";
    expect(gatedCommands(twoComments)).toEqual([{ kind: "push", cwd: null, branches: ["HEAD"] }]);
    expect(gatedCommands(twoComments, "powershell")).toEqual([
      { kind: "push", cwd: null, branches: ["HEAD"] },
    ]);
    expect(gatedCommands("# Don't forget\ngit push")).toEqual([{ kind: "push", cwd: null }]);
    expect(gatedCommands("git push # it's done")).toEqual([{ kind: "push", cwd: null }]);
    expect(gatedCommands("<# it's a\nblock #>\ngit push", "powershell")).toEqual([
      { kind: "push", cwd: null },
    ]);
  });

  it("doesn't treat a # inside a word as a comment", () => {
    expect(gatedCommands("git log --format=%h#x; git push")).toEqual([{ kind: "push", cwd: null }]);
    expect(gatedCommands("echo a#b'; git push'")).toEqual([]);
  });

  it("finds a push in a $(…) inside double quotes", () => {
    expect(gatedCommands('out="$(git push 2>&1)"')).toEqual([{ kind: "push", cwd: null }]);
    expect(gatedCommands('out="`gh pr create --fill`"')).toEqual([
      { kind: "pr-create", cwd: null },
    ]);
    expect(gatedCommands('$out = "$(git push)"', "powershell")).toEqual([
      { kind: "push", cwd: null },
    ]);
    expect(gatedCommands("git commit -m \"$(cat <<'EOF'\ngit push\nEOF\n)\"")).toEqual([]);
  });

  it("refuses to guess when quotes inside a $(…) in double quotes cut it short", () => {
    expect(gatedCommands('out="$(git commit -m "msg" && git push)"')).toEqual([
      { kind: "unclear", cwd: null },
    ]);
    expect(gatedCommands('out="`git commit -m "msg" && git push`"')).toEqual([
      { kind: "unclear", cwd: null },
    ]);
    expect(gatedCommands('out="$(git push \'x)"')).toEqual([{ kind: "unclear", cwd: null }]);
  });

  it("reads the directory after Push-Location, -Path, -- and a prefix word", () => {
    expect(gatedCommands("Push-Location ..\\wt; git push", "powershell")).toEqual([
      { kind: "push", cwd: "..\\wt" },
    ]);
    expect(gatedCommands("Set-Location -Path ..\\wt; git push", "powershell")).toEqual([
      { kind: "push", cwd: "..\\wt" },
    ]);
    expect(gatedCommands("Set-Location -LiteralPath ..\\wt; git push", "powershell")).toEqual([
      { kind: "push", cwd: "..\\wt" },
    ]);
    expect(gatedCommands("cd -- ../wt && git push")).toEqual([{ kind: "push", cwd: "../wt" }]);
    expect(gatedCommands("{ cd ../wt && git push; }")).toEqual([{ kind: "push", cwd: "../wt" }]);
    expect(gatedCommands("if cd ../wt; then git push; fi")).toEqual([
      { kind: "push", cwd: "../wt" },
    ]);
  });

  it("finds a PR create with -R after pr, as one for another repository", () => {
    expect(gatedCommands("gh pr -R o/r create")).toEqual([{ kind: "pr-elsewhere", cwd: null }]);
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

  it("names the branches a push sends to, after the remote", () => {
    expect(gatedCommands("git push origin feat/T7-x")).toEqual([
      { kind: "push", cwd: null, branches: ["feat/T7-x"] },
    ]);
    expect(
      gatedCommands("git push -o ci.skip --force origin +HEAD:refs/heads/feat/T7-x b"),
    ).toEqual([{ kind: "push", cwd: null, branches: ["feat/T7-x", "b"] }]);
    expect(gatedCommands("git push origin -- :gone")).toEqual([
      { kind: "push", cwd: null, branches: ["gone"] },
    ]);
    expect(gatedCommands("git push --all origin")).toEqual([
      { kind: "push", cwd: null, all: true },
    ]);
    expect(gatedCommands("git push --mirror")).toEqual([{ kind: "push", cwd: null, all: true }]);
  });

  it("finds the command a shell, eval or Invoke-Expression runs", () => {
    expect(gatedCommands("bash -c 'git push'")).toEqual([{ kind: "push", cwd: null }]);
    expect(gatedCommands('sh -lc "gh pr create --fill"')).toEqual([
      { kind: "pr-create", cwd: null },
    ]);
    expect(gatedCommands("eval 'git push'")).toEqual([{ kind: "push", cwd: null }]);
    expect(gatedCommands('cd wt && bash -c "cd sub && git push"')).toEqual([
      { kind: "push", cwd: "wt/sub" },
    ]);
    expect(gatedCommands('pwsh -Command "git push"', "powershell")).toEqual([
      { kind: "push", cwd: null },
    ]);
    expect(gatedCommands("powershell.exe -NoProfile -c git push", "powershell")).toEqual([
      { kind: "push", cwd: null },
    ]);
    expect(gatedCommands("Invoke-Expression 'git push'", "powershell")).toEqual([
      { kind: "push", cwd: null },
    ]);
    expect(gatedCommands("iex 'gh pr new'", "powershell")).toEqual([
      { kind: "pr-create", cwd: null },
    ]);
    expect(gatedCommands("bash -c 'echo hi'")).toEqual([]);
    expect(gatedCommands("bash ./script.sh")).toEqual([]);
  });

  it("can't read an encoded PowerShell command, so calls it unclear", () => {
    expect(gatedCommands("pwsh -EncodedCommand ZwBpAHQA", "powershell")).toEqual([
      { kind: "unclear", cwd: null },
    ]);
  });

  it("finds a push in unquoted bash backticks", () => {
    expect(gatedCommands("echo `git push`")).toEqual([{ kind: "push", cwd: null }]);
    expect(gatedCommands("x=`gh pr create --fill`")).toEqual([{ kind: "pr-create", cwd: null }]);
    expect(gatedCommands("echo `git push")).toEqual([{ kind: "unclear", cwd: null }]);
  });

  it("finds a quoted program after a prefix word", () => {
    expect(gatedCommands('env "git" push')).toEqual([{ kind: "push", cwd: null }]);
    expect(gatedCommands("time 'gh' pr create")).toEqual([{ kind: "pr-create", cwd: null }]);
  });

  it("follows popd back to the directory before pushd", () => {
    expect(gatedCommands("pushd ../wt; popd; git push")).toEqual([{ kind: "push", cwd: null }]);
    expect(
      gatedCommands("Push-Location a; Push-Location b; Pop-Location; git push", "powershell"),
    ).toEqual([{ kind: "push", cwd: "a" }]);
  });

  it("skips --config-env's value among git's global options", () => {
    expect(gatedCommands("git --config-env core.x=ENV push")).toEqual([
      { kind: "push", cwd: null },
    ]);
  });

  it("refuses a PR create after GH_REPO or GH_HOST is set anywhere in the command", () => {
    expect(gatedCommands("export GH_REPO=o/r; gh pr create --fill")).toEqual([
      { kind: "pr-elsewhere", cwd: null },
    ]);
    expect(gatedCommands('$env:GH_REPO = "o/r"; gh pr create --fill', "powershell")).toEqual([
      { kind: "pr-elsewhere", cwd: null },
    ]);
    expect(gatedCommands('$env:GH_HOST="example.test"; gh pr new', "powershell")).toEqual([
      { kind: "pr-elsewhere", cwd: null },
    ]);
    expect(gatedCommands('git commit -m "GH_REPO=o/r"; gh pr create')).toEqual([
      { kind: "pr-create", cwd: null },
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
