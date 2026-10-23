// Which parts of a Bash or PowerShell command .claude/hooks/review-gate.mjs must check: each
// `git push` and `gh pr create` (or `gh pr new`), with the directory it runs in when the command
// names one (`git -C <dir>`, or an earlier `cd <dir>`), and for a push the branches it names.
// A PR create aimed at another repository or branch (`-R`, `--repo`, `-H`, `--head`, or a
// `GH_REPO` or `GH_HOST` set anywhere in the command) is reported as "pr-elsewhere", since the
// review file only vouches for the folder's own branch. What runs is read: a `$(…)` inside
// double quotes, a bash backtick, and the command string of `bash -c`, `sh -c`, `eval`,
// `pwsh -Command` and `Invoke-Expression`. It's a guardrail for the agent's usual commands, not a
// full shell parser, so where it can't be sure it errs towards checking. A push is found after
// any prefix word (`time`, `env`, `if`, `sudo`…), and an unquoted `echo git push` counts. A quote
// left open, an encoded PowerShell command, or a push whose target isn't a plain branch name
// (`$BRANCH`, `$(…)`) is "unclear", which the hook refuses. And text that names either command
// where the reading above doesn't find it runs (a quoted message, a heredoc, `cmd /c "…"`,
// `node -e "…"`, a pipe into a shell) is still reported, marked `mentioned`, so the hook checks
// it as if it ran: only that keeps every wrapper covered. A mentioned one next to a directory
// change can't be placed in a folder, so it's "pr-elsewhere" or "push-elsewhere", which the
// hook refuses. `git push --dry-run` is checked too.

import process from "node:process";

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
export const RUNS_COMMAND = new Set([
  ...SHELLS,
  ...POWERSHELLS,
  "eval",
  "invoke-expression",
  "iex",
]);
const ELSEWHERE = /^(?:-[RH]|--repo(?:=|$)|--head(?:=|$))/;
// `GH_REPO=…`, `$env:GH_REPO = …`, `${env:GH_REPO}`, `Set-Item env:GH_REPO …`.
const ELSEWHERE_ENV = /env:GH_(?:REPO|HOST)\b|^GH_(?:REPO|HOST)=/i;
// A destination branch the gate can name; anything else (a variable, a `$(…)`) is unclear.
const PLAIN_REF = /^[\w./-]+$/;
// Main's gate before this parser: any mention, wherever it sits. gh takes flags between `pr` and
// the subcommand, and a full path may be quoted, so anything up to the next ; & | or line break
// may sit between the words. The lazy middle is bounded by the line, so it stays near linear.
const PR_MENTION = /\bgh(?:\.exe)?["']?\s+pr\b[^\n;&|]*?\b(?:create|new)\b/gi;
const PUSH_MENTION = /\bgit(?:\.exe)?["']?\s+(?:[^\n;&|]*?\s)?push(?![\w-])/gi;
// A bare help call is the one form that opens or pushes nothing.
const HELP_CALL =
  /^\s*(?:gh(?:\.exe)?\s+pr\s+(?:create|new)|git(?:\.exe)?\s+push)\s+(?:--help|-h)\s*$/i;
// A directory change anywhere, in either shell's spelling, also just inside a quote
// (`cmd /c "cd ../wt && …"`): a mention next to one can't be placed in a folder.
const CD_MENTION = new RegExp(
  String.raw`(?:^|[\s;&|({\`"'])(?:${[...CD, ...POPD].join("|")})(?:[\s;&|)}\`"']|$)`,
  "i",
);
const ELSEWHERE_MENTION = /GH_(REPO|HOST)\b|--repo\b|--head\b|\s-[RH](\s|\S)/;
// A redirection (`2>&1`, `>&2`, `&>log`, `>| log`, `> log`, `*>&1`) is no branch. A bare one
// (`>`, `2>`, `>|`) takes the next word as its target.
const REDIRECT = /^[\d*&]*[<>]/;
const BARE_REDIRECT = /^[\d*&]*[<>]+[&|]?$/;

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
// newlines, `;`, `|`, `&`, `(` and `)`, except the `&` and `|` of `>&`, `<&`, `>|` and `&>`,
// which stay in their redirection word. Bash escapes with a backslash and PowerShell with a
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
      // Like an unquoted `$(…)`: a `$` holds its place in the word, and it runs as a subshell.
      add("$");
      endCommand();
      subshell(command.slice(i + 1, end));
      i = end;
    } else if ((c === "&" || c === "|") && /[<>]/.test(command[i - 1] ?? "")) {
      // `>&`, `<&` and `>|` belong to a redirection word, not between two commands: splitting
      // there would cut the rest of a push off, so its later targets went unread.
      add(c);
    } else if (c === "&" && next === ">") {
      add(c); // `&>log` redirects; it doesn't end the command.
    } else if (c === "\n" || c === ";" || c === "|" || c === "&") {
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

// Git Bash writes C:\dev as /c/dev, which Node on Windows would read as C:\c\dev.
export function nativePath(dir) {
  return process.platform === "win32" ? dir.replace(/^\/([A-Za-z])(?=\/|$)/, "$1:") : dir;
}

const isAbsolute = (dir) => /^([/\\~]|[A-Za-z]:)/.test(dir);
export const join = (base, dir) => (base === null || isAbsolute(dir) ? dir : `${base}/${dir}`);
export const program = (word) =>
  word.text
    .split(/[/\\]/)
    .pop()
    .toLowerCase()
    .replace(/\.exe$/, "");

// The subcommand of the git at words[at], after its global options, where it sits, and the
// directory its -C options name.
export function gitSubcommand(words, at, cwd) {
  let i = at + 1;
  while (words[i]?.text.startsWith("-")) {
    if (words[i].text === "-C") cwd = join(cwd, words[i + 1]?.text ?? "");
    i += GIT_VALUE_OPTIONS.has(words[i].text) ? 2 : 1;
  }
  return { subcommand: words[i]?.text, at: i, cwd };
}

// The branches a `git push` whose subcommand is at words[at] names (the destination of each
// refspec after the remote, `@` read as HEAD), whether it pushes every branch, and whether a
// destination can't be named. Without a refspec it pushes the checked-out branch; a
// `push.default=matching` or `remote.<name>.push` setting could push more, which isn't read.
function pushTargets(words, at) {
  const positional = [];
  let all = false;
  let options = true;
  for (let i = at + 1; i < words.length; i++) {
    const text = words[i].text;
    if (!words[i].quoted && REDIRECT.test(text)) i += BARE_REDIRECT.test(text) ? 1 : 0;
    else if (options && text === "--") options = false;
    else if (options && PUSH_ALL.has(text)) all = true;
    else if (options && text.startsWith("-")) i += PUSH_VALUE_OPTIONS.has(text) ? 1 : 0;
    else positional.push(text);
  }
  const branches = positional
    .slice(1)
    .map((ref) => {
      const branch = ref
        .replace(/^\+/, "")
        .split(":")
        .pop()
        .replace(/^refs\/heads\//, "");
      return branch === "@" ? "HEAD" : branch;
    })
    .filter(Boolean);
  if (branches.some((branch) => !PLAIN_REF.test(branch))) return { unclear: true };
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

const joined = (words) => words.map((w) => w.text).join(" ");

// The command string a shell or `eval` at words[at] runs, with its shell, or "unclear" for an
// encoded PowerShell command; null when it runs none. PowerShell takes any prefix of a parameter
// name: every `-e…` but `-ex…` (ExecutionPolicy) is EncodedCommand, and `-c` to `-command` is
// Command.
export function innerCommand(words, at) {
  const name = program(words[at]);
  const rest = words.slice(at + 1);
  if (name === "eval") return { text: joined(rest), shell: "bash" };
  if (name === "invoke-expression" || name === "iex") {
    return { text: joined(rest), shell: "powershell" };
  }
  if (SHELLS.has(name)) {
    const c = rest.findIndex((w) => !w.quoted && /^-[A-Za-z]*c[A-Za-z]*$/.test(w.text));
    return c === -1 || !rest[c + 1] ? null : { text: rest[c + 1].text, shell: "bash" };
  }
  if (POWERSHELLS.has(name)) {
    if (rest.some((w) => !w.quoted && /^-e(?!x)[a-z]*$/i.test(w.text))) return "unclear";
    const c = rest.findIndex(
      (w) => !w.quoted && /^-c[a-z]*$/i.test(w.text) && "-command".startsWith(w.text.toLowerCase()),
    );
    return c === -1 ? null : { text: joined(rest.slice(c + 1)), shell: "powershell" };
  }
  return null;
}

// The gated command in one simple command, if any, given the directory it runs in.
function gatedIn(words, start, cwd) {
  for (let i = start; i < words.length; i++) {
    const name = program(words[i]);
    const inner = RUNS_COMMAND.has(name) ? innerCommand(words, i) : null;
    if (inner === "unclear") return [{ kind: "unclear", cwd: null }];
    if (inner) {
      return read(inner.text, inner.shell).map((found) => ({
        ...found,
        cwd: found.cwd === null ? cwd : join(cwd, found.cwd),
      }));
    }
    if (name === "git") {
      const git = gitSubcommand(words, i, cwd);
      if (git.subcommand === "push") {
        const targets = pushTargets(words, git.at);
        if (targets.unclear) return [{ kind: "unclear", cwd: null }];
        return [{ kind: "push", cwd: git.cwd, ...targets }];
      }
    } else if (name === "gh" && isPrCreate(words, i)) {
      const elsewhere = words.slice(i + 1).some((w) => !w.quoted && ELSEWHERE.test(w.text));
      return [{ kind: elsewhere ? "pr-elsewhere" : "pr-create", cwd }];
    }
  }
  return [];
}

// A command as text without heredoc bodies and line continuations, and its tokens.
export function parse(command, shell) {
  const text = joinLines(dropBodies(command), shell);
  return { text, ...tokenize(text, shell) };
}

// Each simple command in tokenized items, other than a directory change or a help call: its
// words, where the program starts (after any `NAME=value`), and the directory a cd moved to.
export function simpleCommands(items) {
  const commands = [];
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
      commands.push({ words, start, cwd });
    }
  }
  return commands;
}

function read(command, shell) {
  const { text, items, unbalanced } = parse(command, shell);
  if (unbalanced) return mentionsGated(text) ? [{ kind: "unclear", cwd: null }] : [];

  const found = simpleCommands(items).flatMap(({ words, start, cwd }) =>
    gatedIn(words, start, cwd),
  );
  // A GH_REPO or GH_HOST set anywhere, inline or exported, points gh at another repository. Its
  // value may be quoted (`GH_REPO="o/r"`), so the word only has to start unquoted.
  const elsewhere = items.some(
    (item) => Array.isArray(item) && item.some((w) => w.bare && ELSEWHERE_ENV.test(w.text)),
  );
  return elsewhere
    ? found.map((f) => (f.kind === "pr-create" ? { ...f, kind: "pr-elsewhere" } : f))
    : found;
}

export function gatedCommands(command, shell = "bash") {
  const found = read(command, shell);
  if (HELP_CALL.test(command) || found.some((f) => f.kind === "unclear")) return found;
  // A mention the reading didn't place: the text names the command more often than the reading
  // found it run, so one sits somewhere it can't read. Counting, rather than asking whether any
  // was found, keeps `git push origin main && cmd /c "git push"` from hiding the second.
  const count = (...kinds) => found.filter((f) => kinds.includes(f.kind)).length;
  const cd = CD_MENTION.test(command);
  if ([...command.matchAll(PR_MENTION)].length > count("pr-create", "pr-elsewhere")) {
    const kind = cd || ELSEWHERE_MENTION.test(command) ? "pr-elsewhere" : "pr-create";
    found.push({ kind, cwd: null, mentioned: true });
  }
  if ([...command.matchAll(PUSH_MENTION)].length > count("push")) {
    // Next to a cd it may run in another folder, so it can't be checked in the session's.
    found.push({ kind: cd ? "push-elsewhere" : "push", cwd: null, mentioned: true });
  }
  return found;
}
