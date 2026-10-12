// Which parts of a Bash or PowerShell command .claude/hooks/review-gate.mjs must check: each
// `git push` and `gh pr create` (or `gh pr new`), with the directory it runs in when the command
// names one (`git -C <dir>`, or an earlier `cd <dir>`). Text that only mentions them, in quotes,
// a heredoc or a here-string, doesn't count. It's a guardrail for the agent's usual commands,
// not a full shell parser, so where it can't be sure it errs towards checking: a push is found
// after any prefix word (`time`, `env`, `if`, `sudo`…), an unquoted `echo git push` counts, and a
// quote left open makes any mention of the commands "unclear", which the hook refuses.
// `git push --dry-run` is checked too.

const CD = new Set(["cd", "pushd", "chdir", "set-location", "sl"]);
const HELP = new Set(["--help", "-h"]);
// Global options whose value is the next word.
const GIT_VALUE_OPTIONS = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--config-env",
]);
const GH_VALUE_OPTIONS = new Set(["-R", "--repo"]);
const MENTIONS =
  /\bgit(?:\.exe)?\b[\s\S]*\bpush\b|\bgh(?:\.exe)?\b[\s\S]*\bpr\b[\s\S]*\b(?:create|new)\b/i;

// Heredoc bodies and PowerShell here-strings are data, never commands.
function dropBodies(command) {
  return command
    .replace(/<<-?[ \t]*(['"]?)([\w-]+)\1([^\n]*)\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\r?\n|$)/g, "$3")
    .replace(/@(['"])\r?\n[\s\S]*?\r?\n\1@/g, "''");
}

// A backslash (bash) or backtick (PowerShell) before a newline continues the line.
function joinLines(command, shell) {
  return command.replace(shell === "powershell" ? /`\r?\n/g : /\\\r?\n/g, " ");
}

// Splits a command into a list of commands, each a list of words ({ text, quoted }), with "("
// and ")" kept as markers so a `cd` inside a subshell stays inside it. Commands end at unquoted
// newlines, `;`, `|`, `&` (but not the `&` of `2>&1` or `&>`), `(` and `)`. Bash escapes with
// a backslash and PowerShell with a backtick; in PowerShell a backslash is just a character,
// and '' inside single quotes is a quote.
function tokenize(command, shell) {
  const ps = shell === "powershell";
  const items = [];
  let words = [];
  let word = null;
  let quote = null;
  const add = (text, quoted = false) => {
    word ??= { text: "", quoted: false };
    word.text += text;
    if (quoted) word.quoted = true;
  };
  const endWord = () => {
    if (word !== null) words.push(word);
    word = null;
  };
  const endCommand = () => {
    endWord();
    if (words.length) items.push(words);
    words = [];
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    const next = command[i + 1];
    const escapes = ps ? c === "`" : c === "\\";
    if (quote === "'") {
      if (c !== "'") add(c, true);
      else if (ps && next === "'") add(command[++i], true);
      else quote = null;
    } else if (quote === '"') {
      if (c === '"') quote = null;
      else if (escapes && next !== undefined && (ps || '"\\$`'.includes(next))) {
        add(command[++i], true);
      } else add(c, true);
    } else if (c === "'" || c === '"') {
      quote = c;
      add("", true);
    } else if (escapes && next !== undefined) {
      add(command[++i]);
    } else if (c === "\n" || c === ";" || c === "|") {
      endCommand();
    } else if (c === "&") {
      if (command[i - 1] === ">" || next === ">") add(c);
      else {
        endCommand();
        if (next === "&") i++;
      }
    } else if (c === "(" || c === ")") {
      endCommand();
      items.push(c);
    } else if (/\s/.test(c)) {
      endWord();
    } else {
      add(c);
    }
  }
  endCommand();
  return { items, unbalanced: quote !== null };
}

const isAbsolute = (dir) => /^([/\\~]|[A-Za-z]:)/.test(dir);
const join = (base, dir) => (base === null || isAbsolute(dir) ? dir : `${base}/${dir}`);
const program = (word) => word.text.split(/[/\\]/).pop().toLowerCase();

// The subcommand of the git at words[at], after its global options, and the directory its -C
// options name.
function gitSubcommand(words, at, cwd) {
  let i = at + 1;
  while (words[i]?.text.startsWith("-")) {
    if (words[i].text === "-C") cwd = join(cwd, words[i + 1]?.text ?? "");
    i += GIT_VALUE_OPTIONS.has(words[i].text) ? 2 : 1;
  }
  return { subcommand: words[i]?.text, cwd };
}

// Whether the gh at words[at] runs `pr create` or `pr new`, with options before or after `pr`.
function isPrCreate(words, at) {
  let i = at + 1;
  const skipOptions = () => {
    while (words[i]?.text.startsWith("-")) i += GH_VALUE_OPTIONS.has(words[i].text) ? 2 : 1;
  };
  skipOptions();
  if (words[i]?.text !== "pr") return false;
  i++;
  skipOptions();
  return words[i]?.text === "create" || words[i]?.text === "new";
}

export function gatedCommands(command, shell = "bash") {
  const text = joinLines(dropBodies(command), shell);
  const { items, unbalanced } = tokenize(text, shell);
  if (unbalanced) return MENTIONS.test(text) ? [{ kind: "unclear", cwd: null }] : [];

  const found = [];
  let cwd = null;
  const subshells = [];
  for (const item of items) {
    if (item === "(") subshells.push(cwd);
    else if (item === ")") cwd = subshells.length ? subshells.pop() : cwd;
    else {
      const words = item;
      const start = words.findIndex(
        (w) => w.quoted || (w.text !== "&" && !/^[A-Za-z_]\w*=/.test(w.text)),
      );
      if (start === -1 || words.some((w) => !w.quoted && HELP.has(w.text))) continue;
      if (CD.has(program(words[start])) && !words[start].quoted) {
        if (words[start + 1]) cwd = join(cwd, words[start + 1].text);
        continue;
      }
      // The program can follow prefix words; quoted words only count as the first word.
      for (let i = start; i < words.length; i++) {
        if (words[i].quoted && i !== start) continue;
        const name = program(words[i]);
        if (name === "git" || name === "git.exe") {
          const git = gitSubcommand(words, i, cwd);
          if (git.subcommand === "push") {
            found.push({ kind: "push", cwd: git.cwd });
            break;
          }
        } else if ((name === "gh" || name === "gh.exe") && isPrCreate(words, i)) {
          found.push({ kind: "pr-create", cwd });
          break;
        }
      }
    }
  }
  return found;
}
