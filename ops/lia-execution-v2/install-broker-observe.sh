#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[ "$(id -u)" -eq 0 ] || { echo 'PARADO: execute como root.' >&2; exit 1; }
for cmd in curl systemctl cp install grep; do command -v "$cmd" >/dev/null 2>&1 || { echo "PARADO: comando ausente: $cmd" >&2; exit 1; }; done

GENV=/etc/lia-dev-gateway.env
WENV=/etc/lia-codex-worker.env
BENV=/etc/lia-openai-broker.env
BROKER_DIR=/opt/lia-broker/app
BROKER_NODE=/opt/lia-broker/runtime/node
BROKER_FILE=$BROKER_DIR/server.mjs

for f in "$GENV" "$WENV" "$BENV" "$BROKER_FILE"; do [ -f "$f" ] || { echo "PARADO: arquivo ausente: $f" >&2; exit 1; }; done
[ -x "$BROKER_NODE" ] || { echo 'PARADO: runtime Node do broker ausente.' >&2; exit 1; }

grep -q '^LIA_GATEWAY_EXECUTION_ENABLED=0$' "$GENV" || { echo 'PARADO: gateway nao esta bloqueado.' >&2; exit 1; }
grep -q '^LIA_CODEX_EXECUTION_ENABLED=0$' "$WENV" || { echo 'PARADO: worker nao esta bloqueado.' >&2; exit 1; }
grep -q '^LIA_BROKER_EXECUTION_ENABLED=0$' "$BENV" || { echo 'PARADO: broker nao esta bloqueado.' >&2; exit 1; }

REV='4a635f870b5eaad2ed4badedad72ac04120422e4'
URL="https://raw.githubusercontent.com/markentingimperio-debug/vitrinecity/$REV/ops/lia-execution-v2/broker-v2.mjs"
TMP="$(mktemp --suffix=.mjs /tmp/lia-broker-observe.XXXXXX)"
BACKUP="/var/backups/lia-broker-observe-$(date -u +%Y%m%dT%H%M%SZ)"
trap 'rm -f "$TMP"' EXIT

curl --fail --location --silent --show-error --proto '=https' --proto-redir '=https' --connect-timeout 20 --max-time 120 "$URL" -o "$TMP"
"$BROKER_NODE" --check "$TMP"
grep -q "lia_broker_upstream_error" "$TMP" || { echo 'PARADO: telemetria esperada ausente.' >&2; exit 1; }
grep -q "2026-09-17-v2-observe" "$TMP" || { echo 'PARADO: versao observavel nao confirmada.' >&2; exit 1; }

mkdir -p "$BACKUP"; chmod 0700 "$BACKUP"
cp -a "$BROKER_FILE" "$BACKUP/server.mjs"
install -o root -g root -m 0644 "$TMP" "$BROKER_FILE"

if ! systemctl restart lia-openai-broker.service; then
  cp -a "$BACKUP/server.mjs" "$BROKER_FILE"
  systemctl restart lia-openai-broker.service || true
  echo 'PARADO: broker nao reiniciou; versao anterior restaurada.' >&2
  exit 1
fi

OK=0
for _ in $(seq 1 30); do
  H="$(curl -fsS http://127.0.0.1:8791/health 2>/dev/null || true)"
  if printf '%s' "$H" | grep -q '2026-09-17-v2-observe' && printf '%s' "$H" | grep -q '"executionEnabled":false'; then OK=1; break; fi
  sleep 1
done
[ "$OK" = 1 ] || {
  cp -a "$BACKUP/server.mjs" "$BROKER_FILE"
  systemctl restart lia-openai-broker.service || true
  echo 'PARADO: health observavel nao confirmou estado bloqueado; rollback aplicado.' >&2
  exit 1
}

echo
echo '=== BROKER OBSERVAVEL INSTALADO ==='
echo 'Execucao paga: BLOQUEADA'
echo 'Chave OpenAI: preservada e nao exibida'
echo 'Telemetria: status HTTP + request-id + erro sanitizado'
echo 'Chamadas OpenAI realizadas nesta instalacao: ZERO'
echo "Backup: $BACKUP"
echo 'Health:'
curl -fsS http://127.0.0.1:8791/health
echo
