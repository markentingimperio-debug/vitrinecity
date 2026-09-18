#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[ "$(id -u)" -eq 0 ] || { echo 'PARADO: execute como root.' >&2; exit 1; }
for cmd in curl systemctl cp install grep sudo; do command -v "$cmd" >/dev/null 2>&1 || { echo "PARADO: comando ausente: $cmd" >&2; exit 1; }; done

GENV=/etc/lia-dev-gateway.env
WENV=/etc/lia-codex-worker.env
BENV=/etc/lia-openai-broker.env
GATEWAY_DIR=/opt/lia/gateway
BROKER_DIR=/opt/lia-broker/app
BROKER_NODE=/opt/lia-broker/runtime/node
NODE_BIN="$(sudo -u lia -H bash -c 'cd /; export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24 >/dev/null; command -v node')"

for f in "$GENV" "$WENV" "$BENV" "$GATEWAY_DIR/server.mjs" "$BROKER_DIR/server.mjs"; do
  [ -f "$f" ] || { echo "PARADO: arquivo ausente: $f" >&2; exit 1; }
done
[ -x "$NODE_BIN" ] || { echo 'PARADO: Node da LIA ausente.' >&2; exit 1; }
[ -x "$BROKER_NODE" ] || { echo 'PARADO: Node do broker ausente.' >&2; exit 1; }

grep -q '^LIA_GATEWAY_EXECUTION_ENABLED=0$' "$GENV" || { echo 'PARADO: gateway nao esta bloqueado.' >&2; exit 1; }
grep -q '^LIA_CODEX_EXECUTION_ENABLED=0$' "$WENV" || { echo 'PARADO: worker nao esta bloqueado.' >&2; exit 1; }
grep -q '^LIA_BROKER_EXECUTION_ENABLED=0$' "$BENV" || { echo 'PARADO: broker nao esta bloqueado.' >&2; exit 1; }

REV='722114ffb8367e93fbcf77a70855b52e223ef02a'
BASE="https://raw.githubusercontent.com/markentingimperio-debug/vitrinecity/$REV/ops/lia-execution-v2"
TMPDIR="$(mktemp -d /tmp/lia-budget-v3.XXXXXX)"
BACKUP="/var/backups/lia-budget-v3-$(date -u +%Y%m%dT%H%M%SZ)"
trap 'rm -rf "$TMPDIR"' EXIT

curl --fail --location --silent --show-error --proto '=https' --proto-redir '=https' "$BASE/broker-v2.mjs" -o "$TMPDIR/broker-v2.mjs"
curl --fail --location --silent --show-error --proto '=https' --proto-redir '=https' "$BASE/gateway-v2.mjs" -o "$TMPDIR/gateway-v2.mjs"

"$BROKER_NODE" --check "$TMPDIR/broker-v2.mjs"
"$NODE_BIN" --check "$TMPDIR/gateway-v2.mjs"
grep -q "2026-09-18-v3-budget" "$TMPDIR/broker-v2.mjs" || { echo 'PARADO: broker v3 nao confirmado.' >&2; exit 1; }
grep -q "actualUsageAccounting:true" "$TMPDIR/broker-v2.mjs" || { echo 'PARADO: contabilidade real ausente.' >&2; exit 1; }
grep -q "spentMicroUsd" "$TMPDIR/gateway-v2.mjs" || { echo 'PARADO: reconciliacao do gateway ausente.' >&2; exit 1; }

mkdir -p "$BACKUP"; chmod 0700 "$BACKUP"
cp -a "$BROKER_DIR/server.mjs" "$BACKUP/broker-server.mjs"
cp -a "$GATEWAY_DIR/server.mjs" "$BACKUP/gateway-server.mjs"

rollback(){
  set +e
  cp -a "$BACKUP/broker-server.mjs" "$BROKER_DIR/server.mjs"
  cp -a "$BACKUP/gateway-server.mjs" "$GATEWAY_DIR/server.mjs"
  systemctl restart lia-openai-broker.service lia-dev-gateway.service
}
trap 'rc=$?; if [ $rc -ne 0 ]; then rollback; fi; rm -rf "$TMPDIR"; exit $rc' EXIT

install -o root -g root -m 0644 "$TMPDIR/broker-v2.mjs" "$BROKER_DIR/server.mjs"
install -o lia -g lia -m 0640 "$TMPDIR/gateway-v2.mjs" "$GATEWAY_DIR/server.mjs"

systemctl restart lia-openai-broker.service
systemctl restart lia-dev-gateway.service

wait_health(){
  local url="$1" needle="$2" out
  for _ in $(seq 1 30); do
    out="$(curl -fsS "$url" 2>/dev/null || true)"
    if printf '%s' "$out" | grep -q "$needle" && printf '%s' "$out" | grep -q '"executionEnabled":false'; then
      printf '%s' "$out"; return 0
    fi
    sleep 1
  done
  return 1
}

BH="$(wait_health http://127.0.0.1:8791/health '2026-09-18-v3-budget')" || { echo 'PARADO: broker v3 nao ficou saudavel e bloqueado.' >&2; exit 1; }
GH="$(wait_health http://127.0.0.1:8787/health '2026-09-18-v3-budget')" || { echo 'PARADO: gateway v3 nao ficou saudavel e bloqueado.' >&2; exit 1; }
WH="$(curl -fsS http://127.0.0.1:8790/health)"
printf '%s' "$WH" | grep -q '"executionEnabled":false' || { echo 'PARADO: worker deixou de estar bloqueado.' >&2; exit 1; }

trap - EXIT
rm -rf "$TMPDIR"

echo
echo '=== LIA BUDGET V3 INSTALADO ==='
echo 'Broker: uso real por resposta + reserva somente em voo'
echo 'Gateway: custo reconciliado com o Broker'
echo 'Gateway: BLOQUEADO'
echo 'Worker: BLOQUEADO'
echo 'Broker: BLOQUEADO'
echo 'Chamadas OpenAI realizadas nesta instalacao: ZERO'
echo "Backup: $BACKUP"
echo
echo 'Broker health:'
printf '%s\n' "$BH"
echo 'Gateway health:'
printf '%s\n' "$GH"
