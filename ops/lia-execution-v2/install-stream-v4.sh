#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[ "$(id -u)" -eq 0 ] || { echo 'PARADO: execute como root.' >&2; exit 1; }

for cmd in curl systemctl cp install grep sudo; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "PARADO: comando ausente: $cmd" >&2; exit 1; }
done

GENV=/etc/lia-dev-gateway.env
WENV=/etc/lia-codex-worker.env
BENV=/etc/lia-openai-broker.env
GATEWAY_DIR=/opt/lia/gateway
WORKER_DIR=/opt/lia/app/codex-worker
BROKER_DIR=/opt/lia-broker/app
BROKER_NODE=/opt/lia-broker/runtime/node
NODE_BIN="$(sudo -u lia -H bash -c 'cd /; export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24 >/dev/null; command -v node')"

for f in "$GENV" "$WENV" "$BENV" "$GATEWAY_DIR/server.mjs" "$WORKER_DIR/server.mjs" "$BROKER_DIR/server.mjs"; do
  [ -f "$f" ] || { echo "PARADO: arquivo ausente: $f" >&2; exit 1; }
done
[ -x "$NODE_BIN" ] || { echo 'PARADO: Node da LIA ausente.' >&2; exit 1; }
[ -x "$BROKER_NODE" ] || { echo 'PARADO: Node do broker ausente.' >&2; exit 1; }

grep -q '^LIA_GATEWAY_EXECUTION_ENABLED=0$' "$GENV" || { echo 'PARADO: gateway nao esta bloqueado.' >&2; exit 1; }
grep -q '^LIA_CODEX_EXECUTION_ENABLED=0$' "$WENV" || { echo 'PARADO: worker nao esta bloqueado.' >&2; exit 1; }
grep -q '^LIA_BROKER_EXECUTION_ENABLED=0$' "$BENV" || { echo 'PARADO: broker nao esta bloqueado.' >&2; exit 1; }

REV='56dcf82618ad9b9a015fd6c48e3ba9d534069540'
BASE="https://raw.githubusercontent.com/markentingimperio-debug/vitrinecity/$REV/ops/lia-execution-v2"
TMPDIR="$(mktemp -d /tmp/lia-stream-v4.XXXXXX)"
BACKUP="/var/backups/lia-stream-v4-$(date -u +%Y%m%dT%H%M%SZ)"
trap 'rm -rf "$TMPDIR"' EXIT

curl --fail --location --silent --show-error --proto '=https' --proto-redir '=https' "$BASE/broker-v2.mjs" -o "$TMPDIR/broker-v2.mjs"
curl --fail --location --silent --show-error --proto '=https' --proto-redir '=https' "$BASE/worker-v2.mjs" -o "$TMPDIR/worker-v2.mjs"
curl --fail --location --silent --show-error --proto '=https' --proto-redir '=https' "$BASE/gateway-v2.mjs" -o "$TMPDIR/gateway-v2.mjs"

"$BROKER_NODE" --check "$TMPDIR/broker-v2.mjs"
"$NODE_BIN" --check "$TMPDIR/worker-v2.mjs"
"$NODE_BIN" --check "$TMPDIR/gateway-v2.mjs"

grep -q "2026-09-18-v4-stream" "$TMPDIR/broker-v2.mjs" || { echo 'PARADO: broker v4 nao confirmado.' >&2; exit 1; }
grep -q "ssePassthrough:true" "$TMPDIR/broker-v2.mjs" || { echo 'PARADO: SSE passthrough ausente.' >&2; exit 1; }
grep -q "lia_broker_upstream_terminal_event" "$TMPDIR/broker-v2.mjs" || { echo 'PARADO: diagnostico terminal SSE ausente.' >&2; exit 1; }
grep -q "2026-09-18-v3-diagnostics" "$TMPDIR/worker-v2.mjs" || { echo 'PARADO: Worker diagnostico nao confirmado.' >&2; exit 1; }
grep -q "lia_codex_run_failed" "$TMPDIR/worker-v2.mjs" || { echo 'PARADO: log de erro Worker ausente.' >&2; exit 1; }
grep -q "2026-09-18-v4-stream" "$TMPDIR/gateway-v2.mjs" || { echo 'PARADO: Gateway v4 nao confirmado.' >&2; exit 1; }
grep -q "workerDetail" "$TMPDIR/gateway-v2.mjs" || { echo 'PARADO: detalhe Worker nao preservado no Gateway.' >&2; exit 1; }

mkdir -p "$BACKUP"
chmod 0700 "$BACKUP"
cp -a "$BROKER_DIR/server.mjs" "$BACKUP/broker-server.mjs"
cp -a "$WORKER_DIR/server.mjs" "$BACKUP/worker-server.mjs"
cp -a "$GATEWAY_DIR/server.mjs" "$BACKUP/gateway-server.mjs"

rollback(){
  set +e
  cp -a "$BACKUP/broker-server.mjs" "$BROKER_DIR/server.mjs"
  cp -a "$BACKUP/worker-server.mjs" "$WORKER_DIR/server.mjs"
  cp -a "$BACKUP/gateway-server.mjs" "$GATEWAY_DIR/server.mjs"
  systemctl restart lia-openai-broker.service lia-codex-worker.service lia-dev-gateway.service >/dev/null 2>&1 || true
}
trap 'rc=$?; if [ $rc -ne 0 ]; then rollback; fi; rm -rf "$TMPDIR"; exit $rc' EXIT

install -o root -g root -m 0644 "$TMPDIR/broker-v2.mjs" "$BROKER_DIR/server.mjs"
install -o lia -g lia -m 0640 "$TMPDIR/worker-v2.mjs" "$WORKER_DIR/server.mjs"
install -o lia -g lia -m 0640 "$TMPDIR/gateway-v2.mjs" "$GATEWAY_DIR/server.mjs"

systemctl restart lia-openai-broker.service
systemctl restart lia-codex-worker.service
systemctl restart lia-dev-gateway.service

wait_health(){
  local url="$1" needle="$2" out
  for _ in $(seq 1 30); do
    out="$(curl -fsS "$url" 2>/dev/null || true)"
    if printf '%s' "$out" | grep -q "$needle" && printf '%s' "$out" | grep -q '"executionEnabled":false'; then
      printf '%s' "$out"
      return 0
    fi
    sleep 1
  done
  return 1
}

BH="$(wait_health http://127.0.0.1:8791/health '2026-09-18-v4-stream')" || { echo 'PARADO: Broker v4 nao ficou saudavel e bloqueado.' >&2; exit 1; }
WH="$(wait_health http://127.0.0.1:8790/health '2026-09-18-v3-diagnostics')" || { echo 'PARADO: Worker diagnostico nao ficou saudavel e bloqueado.' >&2; exit 1; }
GH="$(wait_health http://127.0.0.1:8787/health '2026-09-18-v4-stream')" || { echo 'PARADO: Gateway v4 nao ficou saudavel e bloqueado.' >&2; exit 1; }

printf '%s' "$BH" | grep -q '"ssePassthrough":true' || { echo 'PARADO: Broker nao confirmou SSE passthrough.' >&2; exit 1; }

trap - EXIT
rm -rf "$TMPDIR"

echo
echo '=== LIA STREAM V4 INSTALADO ==='
echo 'Broker: SSE OpenAI -> Codex em tempo real'
echo 'Broker: evento terminal SSE observavel'
echo 'Worker: detalhe sanitizado de falha preservado'
echo 'Gateway: detalhe do Worker preservado'
echo 'Gateway: BLOQUEADO'
echo 'Worker: BLOQUEADO'
echo 'Broker: BLOQUEADO'
echo 'Chamadas OpenAI realizadas nesta instalacao: ZERO'
echo "Backup: $BACKUP"
echo
echo 'Broker health:'
printf '%s\n' "$BH"
echo 'Worker health:'
printf '%s\n' "$WH"
echo 'Gateway health:'
printf '%s\n' "$GH"
