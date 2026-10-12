// Which parts of a Bash or PowerShell command .claude/hooks/review-gate.mjs must check: each
// `git push` and `gh pr create` (or `gh pr new`), with the directory it runs in when the command
// names one (`git -C <dir>`, or an earlier `cd <dir>`). Text that only mentions them, in quotes,
// a heredoc or a here-string, doesn't count. It's a guardrail for the agent's usual commands,
// not a shell parser: aliases, scripts and `$(…)` aren't followed.

const CD = new Set(["cd", "pushd", "chdir", "set-location", "sl"]);
const HELP = new Set(["--help", "-h"]);
// Global options whose value is the next word.
const GIT_VALUE_OPTIONS = new Set([
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--config-env",
]);
const GH_VALUE_OPTIONS = new Set(["-R", "--repo"]);

// Heredoc bodies and PowerShell here-strings are data, never commands.
function dropBodies(command) {
  return command
    .replace(/<<-?[ \t]*(['"]?)([\w-]+)\1([^\n]*)\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\r?\n|$)/g, "$3")
    .replace(/@(['"])\r?\n[\s\S]*?\r?\n\1@/g, "''");
}

// Splits into commands on unquoted newlines, `;`, `|`, `||` and `&&`, and each command into
// words with their quotes removed. Inside double quotes only `\"` is an escape, so Windows paths
// keep their backslashes.
function segments(command) {
  const result = [];
  let words = [];
  let word = null;
  let quote = null;
  const endWord = () => {
    if (word !== null) words.push(word);
    word = null;
  };
  const endSegment = () => {
    endWord();
    if (words.length) result.push(words);
    words = [];
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (quote === '"' && c === "\\" && command[i + 1] === '"') word += command[++i];
      else word += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      word ??= "";
    } else if (c === "\n" || c === ";" || c === "|") {
      endSegment();
    } else if (c === "&" && command[i + 1] === "&") {
      endSegment();
      i++;
    } else if (/\s/.test(c)) {
      endWord();
    } else {
      word = (word ?? "") + c;
    }
  }
  endSegment();
  return result;
}

const isAbsolute = (dir) => /^([/\\~]|[A-Za-z]:)/.test(dir);
const join = (base, dir) => (base === null || isAbsolute(dir) ? dir : `${base}/${dir}`);
const program = (word) => word.split(/[/\\]/).pop().toLowerCase();

// The command a git invocation runs after its global options, and the directory from its -C options.
function gitSubcommand(words, cwd) {
  let i = 1;
  while (words[i]?.startsWith("-")) {
    if (words[i] === "-C") cwd = join(cwd, words[i + 1] ?? "");
    i += words[i] === "-C" || GIT_VALUE_OPTIONS.has(words[i]) ? 2 : 1;
  }
  return { subcommand: words[i], cwd };
}

function isPrCreate(words) {
  let i = 1;
  while (words[i]?.startsWith("-")) i += GH_VALUE_OPTIONS.has(words[i]) ? 2 : 1;
  return words[i] === "pr" && (words[i + 1] === "create" || words[i + 1] === "new");
}

export function gatedCommands(command) {
  const found = [];
  let cwd = null;
  for (const segment of segments(dropBodies(command))) {
    const start = segment.findIndex((w) => w !== "&" && !/^[A-Za-z_]\w*=/.test(w));
    if (start === -1) continue;
    const words = segment.slice(start);
    const name = program(words[0]);
    if (words.some((w) => HELP.has(w))) continue;
    if (CD.has(name) && words[1]) {
      cwd = join(cwd, words[1]);
    } else if (name === "git" || name === "git.exe") {
      const git = gitSubcommand(words, cwd);
      if (git.subcommand === "push") found.push({ kind: "push", cwd: git.cwd });
    } else if ((name === "gh" || name === "gh.exe") && isPrCreate(words)) {
      found.push({ kind: "pr-create", cwd });
    }
  }
  return found;
}
