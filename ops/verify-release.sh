#!/usr/bin/env bash
# Tests committed source with disposable databases and no public network or host volumes.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
test -f app/server.js && test -f ops/live-studio/worker.py
if test -n "$(git status --porcelain --untracked-files=no)"; then
  echo 'Commit or preserve tracked changes before testing a release.' >&2
  exit 1
fi
app_image=${1:?Usage: bash ops/verify-release.sh APP_IMAGE LIVE_STUDIO_IMAGE}
studio_image=${2:?Specify the live-studio test image}
docker image inspect "$app_image" "$studio_image" >/dev/null
git rev-parse HEAD
git archive HEAD | docker run --rm -i --network none --cpus=2 --memory=1g \
  --entrypoint sh "$app_image" -c '
    set -eu
    mkdir /tmp/release
    tar xf - -C /tmp/release
    ln -s /app/node_modules /tmp/release/app/node_modules
    cd /tmp/release/app
    npm test
    npm run test:release
  '
git archive HEAD ops/live-studio | docker run --rm -i --network none --cpus=2 --memory=1g \
  --entrypoint sh "$studio_image" -c '
    set -eu
    mkdir /tmp/release
    tar xf - -C /tmp/release
    cd /tmp/release/ops/live-studio
    PYTHONDONTWRITEBYTECODE=1 python3 -m unittest test_worker.py test_relay.py
  '
