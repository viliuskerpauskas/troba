#!/usr/bin/env bash
# Waits until an environment's web container reports healthy and running the given sha.
# Usage: wait-healthy.sh <staging|prod> <sha> [timeout seconds, default 120]
# Polls /api/health from inside the container, so it needs no published port and doesn't depend on
# DNS or certificates. Exits 0 once the body is {"status":"ok","version":"<sha>"}, 1 on timeout.
set -euo pipefail

env=${1:?usage: wait-healthy.sh <staging|prod> <sha> [timeout seconds]}
sha=${2:?usage: wait-healthy.sh <staging|prod> <sha> [timeout seconds]}
timeout=${3:-120}

# Checks one response; prints why it isn't healthy yet. JavaScript, so the shell must not expand it.
# shellcheck disable=SC2016
check='
fetch("http://127.0.0.1:3000/api/health")
  .then((res) => res.json())
  .then((body) => {
    if (body.status === "ok" && body.version === process.argv[1]) process.exit(0);
    console.log(`status ${body.status}, version ${body.version}`);
    process.exit(1);
  })
  .catch((error) => {
    console.log(error.cause?.code ?? error.message);
    process.exit(1);
  });
'

deadline=$((SECONDS + timeout))
next_report=$((SECONDS + 10))
last=""
echo "waiting up to ${timeout}s for troba-$env to report $sha"
while ((SECONDS < deadline)); do
  # The web container of this Compose project, found by its labels; empty while it's being replaced.
  container=$(docker ps -q \
    --filter "label=com.docker.compose.project=troba-$env" \
    --filter "label=com.docker.compose.service=web" | head -n 1)
  if [[ -z $container ]]; then
    last="no running web container"
  elif [[ $(docker inspect -f '{{.State.Restarting}}' "$container" 2>/dev/null) == true ]]; then
    last="web keeps exiting and restarting (see: docker logs $container)"
  elif last=$(docker exec "$container" node -e "$check" "$sha" 2>&1); then
    echo "troba-$env is healthy on $sha"
    exit 0
  fi
  # A line every 10 seconds, so a slow start doesn't look like a hang.
  if ((SECONDS >= next_report)); then
    echo "  ${SECONDS}s: $last"
    next_report=$((SECONDS + 10))
  fi
  sleep 2
done

echo "troba-$env not healthy on $sha after ${timeout}s: $last" >&2
exit 1
