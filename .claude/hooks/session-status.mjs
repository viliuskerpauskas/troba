// SessionStart hook: puts the workflow state (branch, PR, CI, next issues) into
// the session's context so the agent can say where the owner is in the slice loop.
// Every lookup fails soft: a missing gh login or network just drops that line.
import { execFileSync } from "node:child_process";
import process from "node:process";

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, {
      encoding: "utf8",
      timeout: 8000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

const lines = [];

const branch = run("git", ["branch", "--show-current"]) || "(detached)";
const dirty = (run("git", ["status", "--porcelain"]) ?? "").split("\n").filter(Boolean).length;
const counts = run("git", ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]);
const [ahead, behind] = counts ? counts.split(/\s+/) : [];
lines.push(
  `Branch: ${branch}` +
    (counts ? ` (ahead ${ahead}, behind ${behind} of upstream)` : " (no upstream)") +
    `, ${dirty} uncommitted change${dirty === 1 ? "" : "s"}`,
);

const pr = run("gh", ["pr", "view", "--json", "number,title,state,isDraft,statusCheckRollup"]);
if (pr) {
  const p = JSON.parse(pr);
  const checks = p.statusCheckRollup ?? [];
  const failed = checks.filter((c) =>
    ["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT"].includes(c.conclusion ?? c.state),
  );
  const pending = checks.filter(
    (c) => (c.status && c.status !== "COMPLETED") || c.state === "PENDING",
  );
  const ci = !checks.length
    ? "no checks"
    : failed.length
      ? `failing: ${failed.map((c) => c.name ?? c.context).join(", ")}`
      : pending.length
        ? "running"
        : "green";
  lines.push(
    `PR #${p.number} (${p.isDraft ? "draft" : p.state.toLowerCase()}): ${p.title}; CI ${ci}`,
  );
} else if (branch !== "main") {
  lines.push("No PR for this branch yet.");
}

const issues = run("gh", [
  "api",
  "graphql",
  "-f",
  'query=query{repository(owner:"viliuskerpauskas",name:"troba"){issues(states:OPEN,first:100,orderBy:{field:CREATED_AT,direction:ASC}){nodes{number title labels(first:10){nodes{name}} issueDependenciesSummary{blockedBy}}}}}',
]);
if (issues) {
  const ready = JSON.parse(issues)
    .data.repository.issues.nodes.filter(
      (i) =>
        i.issueDependenciesSummary.blockedBy === 0 &&
        !i.labels.nodes.some((l) => l.name === "blocked-external"),
    )
    .map((i) => `  - ${i.title}`);
  lines.push(ready.length ? `Unblocked issues:\n${ready.join("\n")}` : "No unblocked issues.");
}

const status = lines.join("\n");
process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: `troba workflow status at session start (see "Guide the owner through it" in AGENTS.md):\n${status}`,
    },
  }),
);
