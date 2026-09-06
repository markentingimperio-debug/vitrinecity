#!/usr/bin/env bash
set -Eeuo pipefail
# Explicitly scoped staging resources. Leaves them in place for diagnosis on failure.
image=ghcr.io/ggml-org/llama.cpp@sha256:c363a67c08cb74cc9099590d88cd9948ee0c464cca03db40f9cb5c19d5376da9
test ! -e /opt/vitrinecity-jarvis-stage-20260906
install -d -m 755 /opt/vitrinecity-jarvis-stage-20260906
docker network create --internal vitrinecity-jarvis-stage-20260906
docker run -d --name vitrinecity-jarvis-stage-20260906 --network vitrinecity-jarvis-stage-20260906 --network-alias jarvis-model \
  --user 65534:65534 --read-only --cap-drop ALL --security-opt no-new-privileges --cpus 2 --memory 4g --pids-limit 96 \
  --tmpfs /tmp:size=64m,mode=1777 --mount type=bind,source=/opt/vitrinecity-jarvis-model,target=/models,readonly \
  "$image" -m /models/Qwen3-1.7B-Q8_0.gguf --alias jarvis-local --host 0.0.0.0 --port 8080 -c 4096 -np 1 -t 2 -tb 2 -n 300 --jinja --no-webui
for attempt in $(seq 1 30); do
  if docker exec vitrinecity-jarvis-stage-20260906 curl -fsS http://127.0.0.1:8080/health; then exit 0; fi
  sleep 2
done
exit 1
