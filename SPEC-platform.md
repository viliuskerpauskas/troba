# Spec: platform (v1)

Status: **approved 2026-10-11**. Module id: `platform` ([capability map](SPEC.md)). Depends on: nothing.

## Objective

A deployable skeleton that exercises the full development cycle before any feature exists. A one-page app with a health endpoint and a database connection goes from a PR, through CI, to **staging** automatically, then to **production** after a release and a manual approval. Everything else in v1 is built on top of it.

**User:** the owner as developer (and the agents working in the repo); friends indirectly, through staging.

**Success looks like:** merging a PR updates staging within about 10 minutes with no manual steps, and a release goes to production with one approval click.

### User stories and acceptance criteria

**P1. Local development**
- A fresh clone needs only Node (LTS), pnpm and Docker. `pnpm install && pnpm dev` starts Postgres in Docker plus the Next.js dev server and serves `http://localhost:3000` in under 5 minutes.
- `.env.example` lists every variable with safe local defaults; `.env` is gitignored.
- `pnpm db:migrate` applies migrations. `pnpm db:generate` creates a migration from schema changes.

**P2. Monorepo**
- pnpm workspaces: `apps/web`, `packages/core`, `packages/db` (per [AGENTS.md](AGENTS.md)). No `apps/worker` in v1.
- TypeScript `strict` everywhere. ESLint (flat config) and Prettier run from the root.
- The Node version is pinned in `.nvmrc` and `package.json#engines`, the pnpm version in `packageManager`.

**P3. Health endpoint**
- `GET /api/health` returns `200 {"status":"ok","version":"<git sha>","db":"ok"}`.
- It returns 503 if the database is unreachable.
- It reveals nothing else (no env, no stack traces).

**P4. Container image**
- One multi-stage `Dockerfile` builds the web app as Next.js `standalone` output, running as a non-root user.
- The same image runs migrations through a one-shot command (`node migrate.js`) before the web container starts.
- Images go to GHCR as `ghcr.io/<owner>/troba-web:<sha>`. A release adds the tag `:<version>` to the **same** image; it is never rebuilt.

**P5. VPS runtime**
- One VPS runs three Compose projects:
  - **edge:** Caddy with automatic HTTPS, routing `staging.<domain>` and `<domain>`
  - **troba-staging:** web, migrate and postgres
  - **troba-prod:** web, migrate and postgres
- Staging and prod have separate databases, volumes (postgres data, uploads), secrets and users.
- Env files live only on the VPS (`/srv/troba/<env>/.env`, mode 600). GitHub holds only the SSH deploy secrets.
- Postgres is never exposed publicly. Only Caddy publishes ports 80 and 443.
- Server setup is a documented manual runbook (`docs/ops/vps-setup.md`): Docker, a non-root `deploy` user, SSH-key-only login, firewall allowing 22, 80 and 443, unattended security updates.

**P6. CI (every PR and every push to `main`)**
- Steps: install (cached), lint, typecheck, unit + integration tests (Postgres service container), build, Playwright smoke test against the built app.
- Failing any step blocks merging.
- `main` is protected by a ruleset: PRs only, CI must be green, no force pushes.

**P7. Continuous delivery**
- Merging to `main` builds and pushes the image, then deploys to staging over SSH:
  1. pull the image
  2. run migrate
  3. `docker compose up -d`
  4. poll `/api/health` until `version` equals the new sha (timeout 2 min)
  5. on failure, redeploy the previous sha and fail the job
- Releases use **release-please**. Conventional Commits on `main` keep a release PR open with the next version and `CHANGELOG.md`. Merging that PR creates the tag and GitHub Release.
- The production deploy runs **in the same workflow** once release-please reports a created release (tags pushed by `GITHUB_TOKEN` don't trigger other workflows). It goes through the `production` GitHub Environment, which requires the owner's approval, then repeats steps 1–5 against prod.
- Each environment shows its version (sha) in the page footer.

**P8. Dependency hygiene**
- Dependabot (weekly, grouped) for npm, GitHub Actions and Docker base images.
- GitHub secret scanning and push protection enabled (free on public repos).

## Tech Stack

Node LTS (24.x), pnpm, Next.js, TypeScript, Drizzle + drizzle-kit, PostgreSQL (latest major, official image), Docker + Compose, Caddy 2, GitHub Actions, GHCR, release-please, Dependabot, ESLint, Prettier, Vitest, Playwright. Exact versions are pinned when the repo is scaffolded.

## Commands

```
pnpm install
pnpm dev               # docker compose up -d db && next dev
pnpm lint              # eslint . && prettier --check .
pnpm format            # prettier --write .
pnpm typecheck         # tsc -b
pnpm test              # vitest run (needs db: pnpm db:up)
pnpm test:e2e          # playwright test
pnpm build             # next build (standalone)
pnpm db:up             # docker compose up -d db
pnpm db:generate       # drizzle-kit generate
pnpm db:migrate        # drizzle-kit migrate
```

## Project Structure

```
.github/
  workflows/ci.yml          PR + main checks
  workflows/deliver.yml     main → image → staging; release-please → prod
  dependabot.yml
apps/web/                   Next.js app, Dockerfile, migrate.js
packages/core/  packages/db/
deploy/
  edge/compose.yaml  edge/Caddyfile
  app/compose.yaml          used by both staging and prod (project name + env file differ)
  deploy.sh                 pull → migrate → up → health check → rollback
docs/ops/vps-setup.md       server runbook
compose.yaml                local dev: postgres only
.env.example  .nvmrc  pnpm-workspace.yaml  release-please-config.json
```

## Code Style

Workflows and scripts stay short and readable. Logic that's more than a few lines goes in `deploy/deploy.sh`, not inline YAML.

```sh
# deploy/deploy.sh <env> <sha>
set -euo pipefail
ENV=$1 SHA=$2 DIR=/srv/troba/$ENV
PREV=$(cat "$DIR/current" 2>/dev/null || true)
export IMAGE_TAG=$SHA
compose() { docker compose -p "troba-$ENV" --env-file "$DIR/.env" -f "$DIR/compose.yaml" "$@"; }
compose pull && compose run --rm migrate && compose up -d web
if ./wait-healthy.sh "https://$(host_for "$ENV")/api/health" "$SHA"; then
  echo "$SHA" > "$DIR/current"
else
  [ -n "$PREV" ] && IMAGE_TAG=$PREV compose up -d web   # shortcut: no migration rollback; migrations must stay backward-compatible
  exit 1
fi
```

## Testing Strategy

| Level | Covers |
|---|---|
| Unit (Vitest) | Health handler: ok/503 shape |
| Integration (Vitest + Postgres service) | Migrations apply cleanly to an empty database |
| E2E smoke (Playwright, in CI) | Home page renders; `/api/health` is 200 |
| Deploy check | `deploy.sh` health gate with the version match; a deliberately broken build is rolled back (tested once by hand and noted in the runbook) |

## Boundaries

- **Always:** pin versions, deploy the exact image CI tested, keep migrations backward-compatible with the previous release (so rollback works), keep secrets out of the repo and logs.
- **Ask first:** new CI services or paid add-ons, changing the branch ruleset, exposing a new port, changing the VPS layout, adding a worker or Redis.
- **Never:** deploy to prod without the approval gate, build a different image for prod, `--force` push to `main`, put `.env` files or real data in the repo.

## Success Criteria

1. Fresh clone to a running local app in under 5 minutes using the commands above.
2. A PR with a failing test or a lint error can't be merged.
3. A merge to `main` shows its sha in staging's `/api/health` within 10 minutes, with no manual steps.
4. Merging the release-please PR deploys the same image to prod after one approval. Prod's `/api/health` shows the released sha.
5. A deliberately broken deploy (health check fails) is rolled back to the previous version automatically.
6. Postgres ports are unreachable from the internet (checked with `nmap` from outside).

## Out of Scope (v1)

Backups (a gate before real data goes into prod, see [intent](docs/intent/personal-hub.md)), monitoring/alerting beyond `docker logs`, infrastructure-as-code (Ansible/Terraform), preview environments per PR, the worker, Redis.

## Decisions (resolved 2026-10-11)

1. **Releases:** release-please.
2. **E2E:** the Playwright smoke test runs on every PR, and module E2E suites join as they're written.

## Open Questions

1. **Domain and VPS:** neither exists yet. Local dev and CI don't need them, so build those first; the staging/prod deploy tasks are blocked until both exist.
