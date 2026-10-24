// The shell tokenizer both hooks read commands with (`parse`, `simpleCommands` and the helpers
// exported below; workflow-command.mjs uses them too), and which parts of a Bash or PowerShell
// command .claude/hooks/review-gate.mjs must check: each
// `git push` and `gh pr create` (or `gh pr new`), with the directory it runs in when the command
// names one (`git -C <dir>`, or an earlier `cd <dir>`), and for a push the branches it names.
// A PR create aimed at another repository or branch (`-R`, `--repo`, `-H`, `--head`, or a
// `GH_REPO` or `GH_HOST` set anywhere in the command) is reported as "pr-elsewhere", since the
// review file only vouches for the folder's own branch. What runs is read: a `$(…)` inside
// double quotes, a bash backtick, and the command string of `bash -c`, `sh -c`, `eval`,
// `pwsh -Command` and `Invoke-Expression`. It's a guardrail for the agent's usual commands, not a
// full shell parser, so where it can't be sure it errs towards checking. A push is found after
// any prefix word (`time`, `env`, `if`, `sudo`…), and an unquoted `echo git push` counts. A quote
// left open, an encoded PowerShell command, a push whose target isn't a plain branch name
// (`$BRANCH`, `$(…)`), or a `gh` whose `pr` word or subcommand is substituted is "unclear", which
// the hook refuses. And text that names either command
// where the reading above doesn't find it runs (a quoted message, a heredoc, `cmd /c "…"`,
// `node -e "…"`, a pipe into a shell) is still reported, marked `mentioned`, so the hook checks
// it as if it ran: only that keeps every wrapper covered. A mentioned one next to a directory
// change can't be placed in a folder, so it's "pr-elsewhere" or "push-elsewhere", which the
// hook refuses. `git push --dry-run` is checked too.

import process from "node:process";

// PowerShell's directory changes, in any case, and its `cd..` and `cd\` shorthands. Bash's are
// builtins, found only by their exact name: in bash, `CD`, `cd..` or `Set-Location` fails, and
// the folder stays where it was.
const CD = new Set(["cd", "pushd", "chdir", "set-location", "sl", "push-location"]);
const PUSHD = new Set(["pushd", "push-location"]);
const POPD = new Set(["popd", "pop-location"]);
const CD_SHORTHANDS = new Map([
  ["cd..", ".."],
  ["cd\\", "\\"],
]);
const BASH_CD = new Set(["cd", "pushd"]);
const BASH_POPD = new Set(["popd"]);
// Words that can come before a `cd`.
const CD_PREFIXES = new Set([
  "{",
  "!",
  "if",
  "then",
  "else",
  "elif",
  "do",
  "while",
  "until",
  "builtin",
  "command",
]);
// The options each shell's cd takes before its directory: bash's cd, case-sensitive and
// combinable (`-LP`), without `-@`, which bash builds only on systems with extended attributes;
// bash's pushd, only `--`; PowerShell's, in any case, but not `-p` or `-e`, which it finds
// ambiguous. An option a shell rejects fails the cd, so it isn't skipped: read as the folder,
// git fails there.
const BASH_CD_OPTION = /^(?:--|-[LPe]+)$/;
const BASH_PUSHD_OPTIONS = new Set(["--"]);
const PS_CD_OPTIONS = new Set(["--", "-path", "-literalpath"]);
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
// the subcommand, so only flags, each with an optional value (`-R o/r`, `--repo=o/r`), may sit
// between them: `gh pr edit 5 --title "new title"` names no PR create. A full path may be quoted,
// and so may the subcommand (`\"create\"`); a subcommand word with a `$` or backtick in it
// (`$(echo create)`) may hold it within the next 200 characters of the line. That includes a
// substituted `-R` value, which may hide the subcommand (`-R $(echo o/r) create`), so
// `gh pr --repo "$REPO" comment … "new"` is refused too: a rare over-block, accepted. A
// substituted word may sit before `pr` (`gh $EMPTY pr`). A value can't start with `-`, so each
// word has one reading, and the lazy middles are bounded, so long input stays near linear.
const PR_MENTION =
  /\bgh(?:\.exe)?["']?\s+(?:[^\s;&|]*[$`][^\s;&|]*\s+)?pr(?:\s+-[\w-]+(?:=[^\s;&|]+|\s+[^\s;&|-][^\s;&|]*)?)*\s+(?:[\\"'`]*|[^\s;&|-]*[$`][^\n;&|]{0,200}?)(?:create|new)\b/gi;
const PUSH_MENTION = /\bgit(?:\.exe)?["']?\s+(?:[^\n;&|]{0,2000}?\s)?push(?![\w-])/gi;
// A bare help call is the one form that opens or pushes nothing.
const HELP_CALL =
  /^\s*(?:gh(?:\.exe)?\s+pr\s+(?:create|new)|git(?:\.exe)?\s+push)\s+(?:--help|-h)\s*$/i;
// A directory change anywhere, in either shell's spelling and any case (PowerShell's `cd..` and
// `cd\` too), also just inside a quote (`cmd /c "cd ../wt && …"`): a mention next to one can't
// be placed in a folder.
const CD_MENTION = new RegExp(
  String.raw`(?:^|[\s;&|({\`"'])(?:${[...CD, ...POPD].join("|")}|cd\.\.|cd\\)(?:[\s;&|)}\`"']|$)`,
  "i",
);
// Environment variable names are case-insensitive in PowerShell; gh's flags aren't.
const mentionsElsewhere = (text) =>
  /GH_(?:REPO|HOST)\b/i.test(text) || /--repo\b|--head\b|\s-[RH](\s|\S)/.test(text);
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

// A backslash before a newline continues a bash line, and bash drops the pair, even inside a
// word (`git pu\<newline>sh` is `git push`); a backtick before one continues a PowerShell line,
// read as a space. With no shell, as for mentions, both are joined.
function joinLines(command, shell) {
  const joined = shell === "powershell" ? command : command.replace(/\\\r?\n/g, "");
  return shell === "bash" ? joined : joined.replace(/`\r?\n/g, " ");
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

// Whether the gh at words[at] runs `pr create` or `pr new`, with options before or after `pr`,
// or "unclear" when its `pr` word or subcommand is substituted (`$(…)`, a backtick, `${…}`,
// `$sub`, also in double quotes) and could be either.
function isPrCreate(words, at) {
  let i = at + 1;
  const skipOptions = () => {
    while (words[i]?.text.startsWith("-")) i += GH_VALUE_OPTIONS.has(words[i].text) ? 2 : 1;
  };
  const substituted = () => /[$`]/.test(words[i]?.text ?? "");
  skipOptions();
  if (substituted()) return "unclear";
  if (words[i]?.text !== "pr") return false;
  i++;
  skipOptions();
  if (substituted()) return "unclear";
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
    } else if (name === "gh") {
      const pr = isPrCreate(words, i);
      if (pr === "unclear") return [{ kind: "unclear", cwd: null }];
      if (!pr) continue;
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
export function simpleCommands(items, shell) {
  const ps = shell === "powershell";
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
      // A quoted name is the same command (`"cd"` is still bash's builtin).
      const word = words[at];
      const name = ps ? program(word) : word.text;
      const shorthand = ps && CD_SHORTHANDS.get(word.text.toLowerCase());
      if (shorthand) {
        cwd = join(cwd, shorthand);
        continue;
      }
      if ((ps ? POPD : BASH_POPD).has(name)) {
        if (pushed.length) cwd = pushed.pop();
        continue;
      }
      if ((ps ? CD : BASH_CD).has(name)) {
        let dir = at + 1;
        const isOption = (text) => {
          if (ps) return PS_CD_OPTIONS.has(text.toLowerCase());
          return name === "pushd" ? BASH_PUSHD_OPTIONS.has(text) : BASH_CD_OPTION.test(text);
        };
        while (words[dir] && isOption(words[dir].text)) dir++;
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

  const found = simpleCommands(items, shell).flatMap(({ words, start, cwd }) =>
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
  // Mentions are matched with every continuation joined, in either shell's spelling, so a
  // command split across lines is still named. A backslash pair is joined both ways, dropped
  // as bash does and as a space, since in PowerShell (or a quoted string) the backslash is just
  // a character; the reading that names more counts. Joining what isn't a continuation only
  // checks more.
  const mentionTexts = [joinLines(command), command.replace(/[\\`]\r?\n/g, " ")];
  if (mentionTexts.every((text) => HELP_CALL.test(text))) return found;
  if (found.some((f) => f.kind === "unclear")) return found;
  const mentions = (pattern) =>
    Math.max(...mentionTexts.map((text) => [...text.matchAll(pattern)].length));
  const anyText = (test) => mentionTexts.some(test);
  // A mention the reading didn't place: the text names the command more often than the reading
  // found it run, so one sits somewhere it can't read. Counting, rather than asking whether any
  // was found, keeps `git push origin main && cmd /c "git push"` from hiding the second.
  const count = (...kinds) => found.filter((f) => kinds.includes(f.kind)).length;
  const cd = anyText((text) => CD_MENTION.test(text));
  if (mentions(PR_MENTION) > count("pr-create", "pr-elsewhere")) {
    const kind = cd || anyText(mentionsElsewhere) ? "pr-elsewhere" : "pr-create";
    found.push({ kind, cwd: null, mentioned: true });
  }
  if (mentions(PUSH_MENTION) > count("push")) {
    // Next to a cd it may run in another folder, so it can't be checked in the session's.
    found.push({ kind: cd ? "push-elsewhere" : "push", cwd: null, mentioned: true });
  }
  return found;
}
