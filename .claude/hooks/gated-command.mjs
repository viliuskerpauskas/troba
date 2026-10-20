// Which parts of a Bash or PowerShell command .claude/hooks/review-gate.mjs must check: each
// `git push` and `gh pr create` (or `gh pr new`), with the directory it runs in when the command
// names one (`git -C <dir>`, or an earlier `cd <dir>`), and for a push the branches it names.
// A PR create aimed at another repository or branch (`-R`, `--repo`, `-H`, `--head`, or a
// `GH_REPO` or `GH_HOST` set anywhere in the command) is reported as "pr-elsewhere", since the
// review file only vouches for the folder's own branch. Text that only mentions them, in quotes,
// a comment, a heredoc or a here-string, doesn't count, but what runs does: a `$(…)` inside
// double quotes, a bash backtick, and the command string of `bash -c`, `sh -c`, `eval`,
// `pwsh -Command` and `Invoke-Expression`. It's a guardrail for the agent's usual commands, not a
// full shell parser, so where it can't be sure it errs towards checking: a push is found after
// any prefix word (`time`, `env`, `if`, `sudo`…), an unquoted `echo git push` counts, and a quote
// left open makes any mention of the commands "unclear", which the hook refuses, as does
// `pwsh -EncodedCommand`. `git push --dry-run` is checked too.

const CD = new Set(["cd", "pushd", "chdir", "set-location", "sl", "push-location"]);
const PUSHD = new Set(["pushd", "push-location"]);
const POPD = new Set(["popd", "pop-location"]);
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
// `git push` options whose value is the next word, and the ones that push every branch.
const PUSH_VALUE_OPTIONS = new Set(["-o", "--push-option", "--repo", "--receive-pack", "--exec"]);
const PUSH_ALL = new Set(["--all", "--mirror", "--branches"]);
// Programs that run a command string.
const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh"]);
const POWERSHELLS = new Set(["pwsh", "powershell"]);
const ELSEWHERE = /^(?:-[RH]|--repo(?:=|$)|--head(?:=|$))/;
const ELSEWHERE_ENV = /^(?:\$env:GH_(?:REPO|HOST)(?:=|$)|GH_(?:REPO|HOST)=)/i;

// Whether the text mentions both commands' words anywhere. Separate linear tests, since one
// regex with `[\s\S]*` between the words backtracks badly on long input.
const mentionsGated = (text) =>
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

// Splits a command into a list of commands, each a list of words ({ text, quoted, bare }, where
// `quoted` means some of the word was quoted and `bare` that it starts unquoted), with "("
// and ")" kept as markers so a `cd` inside a subshell stays inside it. Commands end at unquoted
// newlines, `;`, `|`, `&`, `(` and `)`. Bash escapes with a backslash and PowerShell with a
// backtick; in PowerShell a backslash is just a character, and '' inside single quotes is a
// quote. A `#` that starts a word comments out the rest of the line, as does PowerShell's
// `<# … #>` block. A `$(…)` inside double quotes, and a bash `…` in backticks, quoted or not,
// is tokenized too, as a subshell.
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
    word ??= { text: "", quoted: false, bare: !quoted };
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
  const subshell = (text) => {
    const inner = tokenize(text, shell);
    items.push("(", ...inner.items, ")");
    unbalanced ||= inner.unbalanced;
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
        for (const [, dollar, backtick] of raw.matchAll(substitution)) subshell(dollar ?? backtick);
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
    } else if (!ps && c === "`") {
      const end = command.indexOf("`", i + 1);
      if (end === -1) {
        unbalanced = true;
        break;
      }
      endCommand();
      subshell(command.slice(i + 1, end));
      i = end;
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
const program = (word) =>
  word.text
    .split(/[/\\]/)
    .pop()
    .toLowerCase()
    .replace(/\.exe$/, "");

// The subcommand of the git at words[at], after its global options, where it sits, and the
// directory its -C options name.
function gitSubcommand(words, at, cwd) {
  let i = at + 1;
  while (words[i]?.text.startsWith("-")) {
    if (words[i].text === "-C") cwd = join(cwd, words[i + 1]?.text ?? "");
    i += GIT_VALUE_OPTIONS.has(words[i].text) ? 2 : 1;
  }
  return { subcommand: words[i]?.text, at: i, cwd };
}

// The branches a `git push` whose subcommand is at words[at] names (the destination of each
// refspec after the remote), and whether it pushes every branch.
function pushTargets(words, at) {
  const positional = [];
  let all = false;
  let options = true;
  for (let i = at + 1; i < words.length; i++) {
    const text = words[i].text;
    if (options && text === "--") options = false;
    else if (options && PUSH_ALL.has(text)) all = true;
    else if (options && text.startsWith("-")) i += PUSH_VALUE_OPTIONS.has(text) ? 1 : 0;
    else positional.push(text);
  }
  const branches = positional
    .slice(1)
    .map((ref) =>
      ref
        .replace(/^\+/, "")
        .split(":")
        .pop()
        .replace(/^refs\/heads\//, ""),
    )
    .filter(Boolean);
  return { ...(all && { all }), ...(branches.length && { branches }) };
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

// The command string a shell or `eval` at words[at] runs, with its shell, or "unclear" for an
// encoded PowerShell command; null when it runs none.
function innerCommand(words, at) {
  const name = program(words[at]);
  const rest = words.slice(at + 1);
  if (name === "eval") return { text: rest.map((w) => w.text).join(" "), shell: "bash" };
  if (name === "invoke-expression" || name === "iex") {
    return { text: rest.map((w) => w.text).join(" "), shell: "powershell" };
  }
  if (SHELLS.has(name)) {
    const c = rest.findIndex((w) => !w.quoted && /^-[A-Za-z]*c[A-Za-z]*$/.test(w.text));
    return c === -1 || !rest[c + 1] ? null : { text: rest[c + 1].text, shell: "bash" };
  }
  if (POWERSHELLS.has(name)) {
    if (rest.some((w) => !w.quoted && /^-(?:e|ec|encodedcommand)$/i.test(w.text))) {
      return "unclear";
    }
    const c = rest.findIndex((w) => !w.quoted && /^-(?:c|command)$/i.test(w.text));
    if (c === -1) return null;
    return {
      text: rest
        .slice(c + 1)
        .map((w) => w.text)
        .join(" "),
      shell: "powershell",
    };
  }
  return null;
}

// The gated command in one simple command, if any, given the directory it runs in.
function gatedIn(words, start, cwd) {
  for (let i = start; i < words.length; i++) {
    const name = program(words[i]);
    const inner = innerCommand(words, i);
    if (inner === "unclear") return [{ kind: "unclear", cwd: null }];
    if (inner) {
      return gatedCommands(inner.text, inner.shell).map((found) => ({
        ...found,
        cwd: found.cwd === null ? cwd : join(cwd, found.cwd),
      }));
    }
    if (name === "git") {
      const git = gitSubcommand(words, i, cwd);
      if (git.subcommand === "push") {
        return [{ kind: "push", cwd: git.cwd, ...pushTargets(words, git.at) }];
      }
    } else if (name === "gh" && isPrCreate(words, i)) {
      const elsewhere = words.slice(i + 1).some((w) => !w.quoted && ELSEWHERE.test(w.text));
      return [{ kind: elsewhere ? "pr-elsewhere" : "pr-create", cwd }];
    }
  }
  return [];
}

export function gatedCommands(command, shell = "bash") {
  const text = joinLines(dropBodies(command), shell);
  const { items, unbalanced } = tokenize(text, shell);
  if (unbalanced) return mentionsGated(text) ? [{ kind: "unclear", cwd: null }] : [];

  const found = [];
  let cwd = null;
  const subshells = [];
  const pushed = [];
  for (const item of items) {
    if (item === "(") subshells.push(cwd);
    else if (item === ")") cwd = subshells.length ? subshells.pop() : cwd;
    else {
      const words = item;
      const start = words.findIndex((w) => w.quoted || !/^[A-Za-z_]\w*=/.test(w.text));
      if (start === -1 || words.some((w) => !w.quoted && HELP.has(w.text))) continue;
      let at = start;
      while (at < words.length - 1 && !words[at].quoted && CD_PREFIXES.has(words[at].text)) at++;
      const name = words[at].quoted ? "" : program(words[at]);
      if (POPD.has(name)) {
        if (pushed.length) cwd = pushed.pop();
        continue;
      }
      if (CD.has(name)) {
        let dir = at + 1;
        while (words[dir] && CD_OPTIONS.has(words[dir].text.toLowerCase())) dir++;
        if (PUSHD.has(name)) pushed.push(cwd);
        if (words[dir]) cwd = join(cwd, words[dir].text);
        continue;
      }
      found.push(...gatedIn(words, start, cwd));
    }
  }
  // A GH_REPO or GH_HOST set anywhere, inline or exported, points gh at another repository. Its
  // value may be quoted (`GH_REPO="o/r"`), so the word only has to start unquoted.
  const elsewhere = items.some(
    (item) => Array.isArray(item) && item.some((w) => w.bare && ELSEWHERE_ENV.test(w.text)),
  );
  return elsewhere
    ? found.map((f) => (f.kind === "pr-create" ? { ...f, kind: "pr-elsewhere" } : f))
    : found;
}
