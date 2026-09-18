#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[ "$(id -u)" -eq 0 ] || { echo 'PARADO: execute como root.' >&2; exit 1; }

for cmd in curl systemctl cp install grep sed sudo; do
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

for f in "$GENV" "$WENV" "$BENV"   "$GATEWAY_DIR/server.mjs" "$GATEWAY_DIR/model-policy.mjs"   "$WORKER_DIR/server.mjs" "$WORKER_DIR/model-policy.mjs"   "$BROKER_DIR/server.mjs" "$BROKER_DIR/model-policy.mjs"; do
  [ -f "$f" ] || { echo "PARADO: arquivo ausente: $f" >&2; exit 1; }
done

[ -x "$NODE_BIN" ] || { echo 'PARADO: Node da LIA ausente.' >&2; exit 1; }
[ -x "$BROKER_NODE" ] || { echo 'PARADO: Node do broker ausente.' >&2; exit 1; }

grep -q '^LIA_GATEWAY_EXECUTION_ENABLED=0$' "$GENV" || { echo 'PARADO: gateway nao esta bloqueado.' >&2; exit 1; }
grep -q '^LIA_CODEX_EXECUTION_ENABLED=0$' "$WENV" || { echo 'PARADO: worker nao esta bloqueado.' >&2; exit 1; }
grep -q '^LIA_BROKER_EXECUTION_ENABLED=0$' "$BENV" || { echo 'PARADO: broker nao esta bloqueado.' >&2; exit 1; }

REV='e8b4e2030c59a7982f3bbe31da6a5a627885486c'
BASE="https://raw.githubusercontent.com/markentingimperio-debug/vitrinecity/$REV/ops/lia-execution-v2"
TMPDIR="$(mktemp -d /tmp/lia-budget-v5.XXXXXX)"
BACKUP="/var/backups/lia-budget-v5-$(date -u +%Y%m%dT%H%M%SZ)"
trap 'rm -rf "$TMPDIR"' EXIT

for name in model-policy.mjs broker-v2.mjs worker-v2.mjs gateway-v2.mjs; do
  curl --fail --location --silent --show-error --proto '=https' --proto-redir '=https'     "$BASE/$name" -o "$TMPDIR/$name"
done

"$NODE_BIN" --check "$TMPDIR/model-policy.mjs"
"$BROKER_NODE" --check "$TMPDIR/broker-v2.mjs"
"$NODE_BIN" --check "$TMPDIR/worker-v2.mjs"
"$NODE_BIN" --check "$TMPDIR/gateway-v2.mjs"

grep -q "maxOutputTokens: 4096" "$TMPDIR/model-policy.mjs" || { echo 'PARADO: perfil dev 4096 nao confirmado.' >&2; exit 1; }
grep -q "2026-09-18-v5-adaptive-budget" "$TMPDIR/broker-v2.mjs" || { echo 'PARADO: Broker V5 nao confirmado.' >&2; exit 1; }
grep -q "adaptive_text_observed_175pct" "$TMPDIR/broker-v2.mjs" || { echo 'PARADO: reserva adaptativa ausente.' >&2; exit 1; }
grep -q "BUDGET_SAFETY_RATIO" "$TMPDIR/broker-v2.mjs" || { echo 'PARADO: margem de seguranca ausente.' >&2; exit 1; }
grep -q "2026-09-18-v4-policy" "$TMPDIR/worker-v2.mjs" || { echo 'PARADO: Worker V4 policy nao confirmado.' >&2; exit 1; }
grep -q "2026-09-18-v5-budget" "$TMPDIR/gateway-v2.mjs" || { echo 'PARADO: Gateway V5 nao confirmado.' >&2; exit 1; }

mkdir -p "$BACKUP"
chmod 0700 "$BACKUP"
cp -a "$GATEWAY_DIR/server.mjs" "$BACKUP/gateway-server.mjs"
cp -a "$GATEWAY_DIR/model-policy.mjs" "$BACKUP/gateway-model-policy.mjs"
cp -a "$WORKER_DIR/server.mjs" "$BACKUP/worker-server.mjs"
cp -a "$WORKER_DIR/model-policy.mjs" "$BACKUP/worker-model-policy.mjs"
cp -a "$BROKER_DIR/server.mjs" "$BACKUP/broker-server.mjs"
cp -a "$BROKER_DIR/model-policy.mjs" "$BACKUP/broker-model-policy.mjs"
cp -a "$BENV" "$BACKUP/broker.env"

rollback(){
  set +e
  cp -a "$BACKUP/gateway-server.mjs" "$GATEWAY_DIR/server.mjs"
  cp -a "$BACKUP/gateway-model-policy.mjs" "$GATEWAY_DIR/model-policy.mjs"
  cp -a "$BACKUP/worker-server.mjs" "$WORKER_DIR/server.mjs"
  cp -a "$BACKUP/worker-model-policy.mjs" "$WORKER_DIR/model-policy.mjs"
  cp -a "$BACKUP/broker-server.mjs" "$BROKER_DIR/server.mjs"
  cp -a "$BACKUP/broker-model-policy.mjs" "$BROKER_DIR/model-policy.mjs"
  cp -a "$BACKUP/broker.env" "$BENV"
  systemctl restart lia-openai-broker.service lia-codex-worker.service lia-dev-gateway.service >/dev/null 2>&1 || true
}
trap 'rc=$?; if [ $rc -ne 0 ]; then rollback; fi; rm -rf "$TMPDIR"; exit $rc' EXIT

set_kv(){
  local file="$1" key="$2" value="$3"
  if grep -q "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >>"$file"
  fi
}

set_kv "$BENV" LIA_BROKER_MAX_REQUESTS_PER_LEASE 20
set_kv "$BENV" LIA_BROKER_BUDGET_SAFETY_RATIO 0.90
chmod 0600 "$BENV"
chown root:root "$BENV"

install -o lia -g lia -m 0640 "$TMPDIR/gateway-v2.mjs" "$GATEWAY_DIR/server.mjs"
install -o lia -g lia -m 0640 "$TMPDIR/model-policy.mjs" "$GATEWAY_DIR/model-policy.mjs"
install -o lia -g lia -m 0640 "$TMPDIR/worker-v2.mjs" "$WORKER_DIR/server.mjs"
install -o lia -g lia -m 0640 "$TMPDIR/model-policy.mjs" "$WORKER_DIR/model-policy.mjs"
install -o root -g root -m 0644 "$TMPDIR/broker-v2.mjs" "$BROKER_DIR/server.mjs"
install -o root -g root -m 0644 "$TMPDIR/model-policy.mjs" "$BROKER_DIR/model-policy.mjs"

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

BH="$(wait_health http://127.0.0.1:8791/health '2026-09-18-v5-adaptive-budget')" || { echo 'PARADO: Broker V5 nao ficou saudavel e bloqueado.' >&2; exit 1; }
WH="$(wait_health http://127.0.0.1:8790/health '2026-09-18-v4-policy')" || { echo 'PARADO: Worker V4 policy nao ficou saudavel e bloqueado.' >&2; exit 1; }
GH="$(wait_health http://127.0.0.1:8787/health '2026-09-18-v5-budget')" || { echo 'PARADO: Gateway V5 nao ficou saudavel e bloqueado.' >&2; exit 1; }

printf '%s' "$BH" | grep -q '"adaptiveBudgetReservation":true' || { echo 'PARADO: Broker nao confirmou reserva adaptativa.' >&2; exit 1; }
printf '%s' "$BH" | grep -q '"budgetSafetyRatio":0.9' || { echo 'PARADO: margem 0.90 nao confirmada.' >&2; exit 1; }

GATEWAY_TOKEN="$(sed -n 's/^LIA_GATEWAY_TOKEN=//p' "$GENV")"
MODELS="$(curl -fsS http://127.0.0.1:8787/v1/models -H "Authorization: Bearer $GATEWAY_TOKEN")"
printf '%s' "$MODELS" | grep -q '"name":"dev","model":"gpt-5.4-mini","reasoning":"medium","premium":false,"maxOutputTokens":4096'   || { echo 'PARADO: Gateway nao confirmou dev/4096.' >&2; exit 1; }

grep -q '^LIA_BROKER_MAX_REQUESTS_PER_LEASE=20$' "$BENV" || { echo 'PARADO: limite de turnos nao ficou em 20.' >&2; exit 1; }
grep -q '^LIA_BROKER_BUDGET_SAFETY_RATIO=0.90$' "$BENV" || { echo 'PARADO: margem de budget nao ficou em 0.90.' >&2; exit 1; }

trap - EXIT
rm -rf "$TMPDIR"

echo
echo '=== LIA BUDGET V5 INSTALADO ==='
echo 'Broker: reserva adaptativa para tarefas textuais'
echo 'Reserva de input: calculada com historico real e precificada como NAO CACHEADA'
echo 'Margem financeira: 10% do budget fica fora da reserva'
echo 'Perfil dev: maxOutputTokens 4096'
echo 'Turnos internos por lease: maximo 20'
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
