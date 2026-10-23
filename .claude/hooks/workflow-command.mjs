// Which parts of a Bash or PowerShell command .claude/hooks/workflow-guard.mjs must check: each
// branch created by `git switch` or `git checkout`, and each `git commit`, with the directory it
// runs in when the command names one. It reads commands with gated-command.mjs's tokenizer, so
// text that only mentions them (a quoted message, a grep pattern, a heredoc body) isn't a command.

import {
  gitSubcommand,
  innerCommand,
  join,
  parse,
  program,
  RUNS_COMMAND,
  simpleCommands,
} from "./gated-command.mjs";

// The short and long options that create a branch, per subcommand.
const CREATE = {
  switch: { short: "cC", long: new Set(["--create", "--force-create", "--orphan"]) },
  checkout: { short: "bB", long: new Set(["--orphan"]) },
};

// The branch a `git switch` or `git checkout` whose subcommand is at words[at] creates, if any.
function createdBranch(words, at, options) {
  for (let i = at + 1; i < words.length; i++) {
    const text = words[i].text;
    if (text === "--") return null;
    const [name, value] = text.split(/=(.*)/s);
    if (options.long.has(name)) return value ?? words[i + 1]?.text ?? null;
    if (/^-[^-]/.test(text)) {
      const letter = [...text.slice(1)].findIndex((c) => options.short.includes(c));
      if (letter !== -1) return text.slice(letter + 2) || (words[i + 1]?.text ?? null);
    }
  }
  return null;
}

// Short options whose value is the next word (or the rest of the word), and the long options
// that carry message text.
const COMMIT_VALUE_SHORT = "mFCct";
const COMMIT_MESSAGE_LONG = new Set(["--message", "--trailer"]);
// A `$` (a variable, a `$(…)`, or a bash backtick, which the tokenizer turns into one) or `-`
// for stdin: the text it ends up as isn't in the word.
const COMPUTED = /\$|^-$/;

// The messages and message files of a `git commit` whose subcommand is at words[at], with the
// whole command as one more message when one of them is computed: the guard can't run a `$(…)`,
// so it reads every heredoc and variable in the command instead. A command that commits that
// way and mentions a trailer elsewhere (an issue body in the same command) is refused too.
function commitMessages(words, at, command, restore) {
  const messages = [];
  const files = [];
  for (let i = at + 1; i < words.length; i++) {
    const text = words[i].text;
    if (text === "--") break;
    const [name, value] = text.split(/=(.*)/s);
    if (COMMIT_MESSAGE_LONG.has(name) || name === "--file") {
      const found = value ?? words[++i]?.text;
      if (found !== undefined) (name === "--file" ? files : messages).push(restore(found));
    } else if (/^-[^-]/.test(text)) {
      const letter = [...text.slice(1)].findIndex((c) => COMMIT_VALUE_SHORT.includes(c));
      if (letter === -1) continue;
      const found = text.slice(letter + 2) || words[++i]?.text;
      const kind = text[letter + 1];
      if (found !== undefined && kind === "m") messages.push(restore(found));
      if (found !== undefined && kind === "F") files.push(restore(found));
    }
  }
  if (messages.some((m) => COMPUTED.test(m)) || files.includes("-")) messages.push(command);
  return { messages, files: files.filter((file) => file !== "-") };
}

function guardedIn(words, start, cwd, command, restore) {
  for (let i = start; i < words.length; i++) {
    const name = program(words[i]);
    const inner = RUNS_COMMAND.has(name) ? innerCommand(words, i) : null;
    if (inner && inner !== "unclear") {
      return guardedCommands(inner.text, inner.shell).map((found) => ({
        ...found,
        cwd: found.cwd === null ? cwd : join(cwd, found.cwd),
      }));
    }
    if (name === "git") {
      const git = gitSubcommand(words, i, cwd);
      if (git.subcommand === "commit") {
        return [
          { kind: "commit", cwd: git.cwd, ...commitMessages(words, git.at, command, restore) },
        ];
      }
      const options = CREATE[git.subcommand];
      const branch = options && createdBranch(words, git.at, options);
      return branch ? [{ kind: "branch", cwd: git.cwd, branch }] : [];
    }
  }
  return [];
}

// An attribution trailer, as git reads one (case-insensitive). It doesn't need to start a line:
// PowerShell's `n escape reaches here as a plain "n".
const TRAILER = /\bCo-Authored-By:/i;
export const hasTrailer = (text) => TRAILER.test(text);

export function guardedCommands(command, shell = "bash") {
  // The tokenizer drops PowerShell here-strings as data, but one can be a commit message, so
  // each is kept as a quoted placeholder and put back when a message is read.
  const bodies = [];
  const kept = command.replace(/@(['"])\r?\n([\s\S]*?)\r?\n\1@/g, (_, quote, body) => {
    bodies.push(body);
    return `'${bodies.length - 1}'`;
  });
  const restore = (text) => text.replace(/(\d+)/g, (_, n) => bodies[Number(n)]);
  const { items } = parse(kept, shell);
  return simpleCommands(items).flatMap(({ words, start, cwd }) =>
    guardedIn(words, start, cwd, command, restore),
  );
}
