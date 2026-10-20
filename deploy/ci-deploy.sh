#!/usr/bin/env bash
# The forced command of a GitHub deploy key, set in the deploy user's authorized_keys:
#   restrict,command="/srv/troba/deploy/ci-deploy.sh staging" ssh-ed25519 AAAA... troba-ci-staging
# The environment is fixed by the key, and the only thing the client sends is the sha
# (`ssh deploy@<vps> <sha>`), so the key can deploy an image to that one environment and do nothing
# else on the VPS. deploy.sh validates both.
set -euo pipefail

env=${1:?usage: ci-deploy.sh <staging|prod>, as a forced command}
# Passed as one argument and never evaluated, so a sha with spaces or shell syntax is just rejected.
exec "$(dirname "${BASH_SOURCE[0]}")/deploy.sh" "$env" "${SSH_ORIGINAL_COMMAND:-}"
