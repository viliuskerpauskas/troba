// Which parts of a Bash or PowerShell command .claude/hooks/review-gate.mjs must check: each
// `git push` and `gh pr create` (or `gh pr new`), with the directory it runs in when the command
// names one (`git -C <dir>`, or an earlier `cd <dir>`). Text that only mentions them, in quotes,
// a comment, a heredoc or a here-string, doesn't count, but a `$(…)` inside double quotes runs
// and is checked. It's a guardrail for the agent's usual commands,
// not a full shell parser, so where it can't be sure it errs towards checking: a push is found
// after any prefix word (`time`, `env`, `if`, `sudo`…), an unquoted `echo git push` counts, and a
// quote left open makes any mention of the commands "unclear", which the hook refuses.
// `git push --dry-run` is checked too.

const CD = new Set(["cd", "pushd", "chdir", "set-location", "sl", "push-location"]);
// Words that can come before a `cd`, and the options a `cd` can take before its directory.
const CD_PREFIXES = new Set(["{", "!", "if", "then", "else", "elif", "do", "while", "until"]);
const CD_OPTIONS = new Set(["--", "-path", "-literalpath"]);
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
// Whether the text mentions both commands' words anywhere. Separate linear tests, since one
// regex with `[\s\S]*` between the words backtracks badly on long input.
const mentions = (text) =>
  (/\bgit(?:\.exe)?\b/i.test(text) && /\bpush\b/i.test(text)) ||
  (/\bgh(?:\.exe)?\b/i.test(text) && /\bpr\b/i.test(text) && /\b(?:create|new)\b/i.test(text));

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
// newlines, `;`, `|`, `&`, `(` and `)`. Bash escapes with
// a backslash and PowerShell with a backtick; in PowerShell a backslash is just a character,
// and '' inside single quotes is a quote. A `#` that starts a word comments out the rest of the
// line, as does PowerShell's `<# … #>` block. A `$(…)` (or a bash `…` in backticks) inside
// double quotes is tokenized too, as a subshell.
function tokenize(command, shell) {
  const ps = shell === "powershell";
  const substitution = ps ? /\$\(([\s\S]*)\)/g : /\$\(([\s\S]*)\)|`([^`]*)`/g;
  const items = [];
  let words = [];
  let word = null;
  let quote = null;
  let quoteStart = 0;
  let unbalanced = false;
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
      if (c === '"') {
        quote = null;
        // Quotes nested inside a `$(…)` end this string early in a reading this simple, which
        // leaves a `$(` unclosed or a bash backtick unpaired: then the command can't be read.
        const raw = command.slice(quoteStart, i);
        const count = (char) => raw.split(char).length - 1;
        if ((raw.includes("$(") && count("(") > count(")")) || (!ps && count("`") % 2)) {
          unbalanced = true;
        }
        for (const [, dollar, backtick] of raw.matchAll(substitution)) {
          const inner = tokenize(dollar ?? backtick, shell);
          items.push("(", ...inner.items, ")");
          unbalanced ||= inner.unbalanced;
        }
      } else if (escapes && next !== undefined && (ps || '"\\$`'.includes(next))) {
        add(command[++i], true);
      } else add(c, true);
    } else if (c === "'" || c === '"') {
      quote = c;
      quoteStart = i + 1;
      add("", true);
    } else if (word === null && c === "#") {
      while (command[i + 1] !== undefined && command[i + 1] !== "\n") i++;
    } else if (ps && word === null && c === "<" && next === "#") {
      const end = command.indexOf("#>", i + 2);
      i = end === -1 ? command.length : end + 1;
    } else if (escapes && next !== undefined) {
      add(command[++i]);
    } else if (c === "\n" || c === ";" || c === "|") {
      endCommand();
    } else if (c === "&") {
      // Also splits `2>&1` and `&>`, which only cuts a redirection's target off the command.
      endCommand();
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
  return { items, unbalanced: unbalanced || quote !== null };
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
  if (unbalanced) return mentions(text) ? [{ kind: "unclear", cwd: null }] : [];

  const found = [];
  let cwd = null;
  const subshells = [];
  for (const item of items) {
    if (item === "(") subshells.push(cwd);
    else if (item === ")") cwd = subshells.length ? subshells.pop() : cwd;
    else {
      const words = item;
      const start = words.findIndex((w) => w.quoted || !/^[A-Za-z_]\w*=/.test(w.text));
      if (start === -1 || words.some((w) => !w.quoted && HELP.has(w.text))) continue;
      let at = start;
      while (at < words.length - 1 && !words[at].quoted && CD_PREFIXES.has(words[at].text)) at++;
      if (CD.has(program(words[at])) && !words[at].quoted) {
        let dir = at + 1;
        while (words[dir] && CD_OPTIONS.has(words[dir].text.toLowerCase())) dir++;
        if (words[dir]) cwd = join(cwd, words[dir].text);
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
