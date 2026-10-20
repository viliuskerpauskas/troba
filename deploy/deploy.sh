#!/usr/bin/env bash
# Deploys one image sha to one environment on the VPS: pull, migrate, up, wait for /api/health to
# report that sha, and roll web back to the previous sha if it doesn't.
# Usage: deploy.sh <staging|prod> <40-character git sha>
# Layout (docs/ops/vps-setup.md): this repo's deploy/ folder at $TROBA_ROOT/deploy, the
# environment's env file at $TROBA_ROOT/<env>/.env. The last good sha is kept in
# $TROBA_ROOT/<env>/deployed-sha.
set -euo pipefail

usage="usage: deploy.sh <staging|prod> <40-character git sha>"
env=${1:?$usage}
sha=${2:?$usage}
[[ $env == staging || $env == prod ]] || { echo "$usage" >&2; exit 2; }
[[ $sha =~ ^[0-9a-f]{40}$ ]] || { echo "$usage" >&2; exit 2; }

root=${TROBA_ROOT:-/srv/troba}
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
dir=$root/$env
state=$dir/deployed-sha
[[ -f $dir/.env ]] || { echo "missing $dir/.env" >&2; exit 1; }

# One deploy per environment at a time. mkdir is atomic; a lock left by a killed run is removed by
# hand (the runbook says how).
lock=$dir/.deploy.lock
mkdir "$lock" 2>/dev/null || { echo "another deploy to $env is running ($lock exists)" >&2; exit 1; }
trap 'rmdir "$lock"' EXIT

# Runs docker compose for this environment with the given image sha. TROBA_ENV is set here so the
# Caddy alias always matches the environment being deployed.
compose() {
  local tag=$1
  shift
  TROBA_ENV=$env TROBA_SHA=$tag docker compose -p "troba-$env" \
    -f "$root/deploy/app/compose.yaml" --env-file "$dir/.env" "$@"
}

previous=$(cat "$state" 2>/dev/null || true)
echo "deploying $sha to $env (previous: ${previous:-none})"

# Nothing has changed yet if these fail, so there's nothing to roll back. A sha tag never moves, so
# an image already on the VPS isn't pulled again (and a locally built one can be deployed).
compose "$sha" pull --policy missing web
compose "$sha" up -d --wait postgres
# Migrations are forward-only and must keep working with the previous image, which is what a
# rollback runs against (ADR-0008).
compose "$sha" run --rm migrate

# Puts web back on the previous sha and exits 1. Runs to the end even if a command in it fails.
rollback() {
  set +e
  # A second Ctrl+C stops the rollback itself.
  trap - INT TERM HUP
  trap '' PIPE
  compose "$sha" logs --tail 50 web >&2
  if [[ -z $previous ]]; then
    echo "no previous sha to roll back to; $env is left on $sha" >&2
    exit 1
  fi
  echo "rolling $env back to $previous" >&2
  compose "$previous" up -d web
  if "$here/wait-healthy.sh" "$env" "$previous"; then
    echo "rolled $env back to $previous" >&2
  else
    echo "rollback to $previous is not healthy either; $env needs attention" >&2
  fi
  exit 1
}

# From here on web may be on the new image, so every way out except success rolls back: a failed
# health check, Ctrl+C, or the SSH session going away (a dropped connection, a cancelled CI job).
# In the last case nobody can read the output any more, so it goes to a log on the VPS.
trap 'echo "interrupted" >&2; rollback' INT
trap 'exec >>"$dir/deploy.log" 2>&1; echo "$(date -Is) deploy of $sha lost its session"; rollback' TERM HUP PIPE

# Compose removes the old container before starting the new one, so a failed `up` rolls back too.
compose "$sha" up -d --remove-orphans web || { echo "starting $sha failed on $env" >&2; rollback; }
if "$here/wait-healthy.sh" "$env" "$sha"; then
  trap - INT TERM HUP PIPE
  echo "$sha" > "$state"
  echo "deployed $sha to $env"
  exit 0
fi

echo "$sha failed its health check on $env" >&2
rollback
