@AGENTS.md

## Claude Code

- The stages run on Matt Pocock's skills (the `mattpocock-skills` plugin, enabled in `.claude/settings.json`) plus the project's own `/wrap`. Built-in Claude Code has a `/code-review` of its own; for stage 5, invoke Matt's as `/mattpocock-skills:code-review main`.
- `/implement-spec` starts each ticket's implementer as a fresh session (`start_session`, `cwd` = the ticket worktree) so the owner can watch and steer it; see [docs/agents/skill-overrides.md](docs/agents/skill-overrides.md#implement-spec).
- Use `gh` for GitHub Issues and PRs.
