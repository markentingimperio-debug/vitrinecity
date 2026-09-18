#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[ "$(id -u)" -eq 0 ] || { echo 'PARADO: execute como root.' >&2; exit 1; }

for cmd in curl jq systemctl sed grep date; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "PARADO: comando ausente: $cmd" >&2; exit 1; }
done

GENV=/etc/lia-dev-gateway.env
WENV=/etc/lia-codex-worker.env
BENV=/etc/lia-openai-broker.env
BROKER_NODE=/opt/lia-broker/runtime/node
BROKER_URL=http://127.0.0.1:8791
BUDGET_MICRO_USD=20000
TASK_ID="upstream-diagnostic-$(date -u +%Y%m%dT%H%M%SZ)"
START_TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

for f in "$GENV" "$WENV" "$BENV"; do
  [ -f "$f" ] || { echo "PARADO: ambiente ausente: $f" >&2; exit 1; }
done
[ -x "$BROKER_NODE" ] || { echo 'PARADO: runtime Node do broker ausente.' >&2; exit 1; }

grep -q '^LIA_GATEWAY_EXECUTION_ENABLED=0$' "$GENV" || { echo 'PARADO: gateway deve permanecer bloqueado.' >&2; exit 1; }
grep -q '^LIA_CODEX_EXECUTION_ENABLED=0$' "$WENV" || { echo 'PARADO: worker deve permanecer bloqueado.' >&2; exit 1; }
grep -q '^LIA_BROKER_EXECUTION_ENABLED=0$' "$BENV" || { echo 'PARADO: broker deve iniciar bloqueado.' >&2; exit 1; }
grep -q '^OPENAI_API_KEY=.' "$BENV" || { echo 'PARADO: chave OpenAI ausente.' >&2; exit 1; }
grep -q '^LIA_LEASE_SECRET=.' "$BENV" || { echo 'PARADO: lease secret ausente.' >&2; exit 1; }

disable_broker(){
  set +e
  sed -i 's/^LIA_BROKER_EXECUTION_ENABLED=1$/LIA_BROKER_EXECUTION_ENABLED=0/' "$BENV"
  chmod 0600 "$BENV"
  chown root:root "$BENV"
  systemctl restart lia-openai-broker.service >/dev/null 2>&1 || true
}
trap 'rc=$?; disable_broker; exit $rc' EXIT

LEASE="$("$BROKER_NODE" --input-type=module <<NODE
import fs from 'node:fs';
import { createHmac, randomUUID } from 'node:crypto';

const lines = fs.readFileSync('$BENV','utf8').split(/\r?\n/);
const values = {};
for (const line of lines) {
  const i = line.indexOf('=');
  if (i > 0) values[line.slice(0,i)] = line.slice(i+1);
}
const secret = String(values.LIA_LEASE_SECRET || '');
if (secret.length < 32) process.exit(2);
const now = Math.floor(Date.now()/1000);
const payload = {
  v:1,
  jti:randomUUID(),
  taskId:'$TASK_ID',
  profile:'dev',
  model:'gpt-5.4-mini',
  reasoning:'medium',
  maxOutputTokens:2048,
  budgetMicroUsd:$BUDGET_MICRO_USD,
  iat:now,
  exp:now+300
};
const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
const sig = createHmac('sha256', secret).update(body).digest('base64url');
process.stdout.write('lia1.' + body + '.' + sig);
NODE
)"

case "$LEASE" in
  lia1.*.*) ;;
  *) echo 'PARADO: lease de diagnostico nao foi gerado.' >&2; exit 1 ;;
esac

sed -i 's/^LIA_BROKER_EXECUTION_ENABLED=0$/LIA_BROKER_EXECUTION_ENABLED=1/' "$BENV"
chmod 0600 "$BENV"
chown root:root "$BENV"
systemctl restart lia-openai-broker.service

OK=0
for _ in $(seq 1 30); do
  H="$(curl -fsS "$BROKER_URL/health" 2>/dev/null || true)"
  if printf '%s' "$H" | jq -e '.executionEnabled == true and .leaseEnforced == true' >/dev/null 2>&1; then
    OK=1
    break
  fi
  sleep 1
done
[ "$OK" = 1 ] || { echo 'PARADO: broker nao confirmou modo temporario.' >&2; exit 1; }

REQ="$(jq -nc '{
  model:"gpt-5.4-mini",
  input:"Reply only with OK.",
  max_output_tokens:16,
  reasoning:{effort:"medium"}
}')"

HDR="$(mktemp /tmp/lia-upstream-hdr.XXXXXX)"
BODY="$(mktemp /tmp/lia-upstream-body.XXXXXX)"
trap 'rc=$?; rm -f "$HDR" "$BODY"; disable_broker; exit $rc' EXIT

echo "=== DIAGNOSTICO OPENAI VIA BROKER ==="
echo "Gateway: BLOQUEADO"
echo "Worker: BLOQUEADO"
echo "Broker: temporariamente ATIVO apenas para 1 requisicao"
echo "Modelo: gpt-5.4-mini"
echo "Budget Lease: US$ 0,02"
echo "Task ID: $TASK_ID"
echo

set +e
HTTP_CODE="$(curl -sS   --connect-timeout 20   --max-time 120   --dump-header "$HDR"   --output "$BODY"   --write-out '%{http_code}'   -X POST "$BROKER_URL/v1/responses"   -H "Authorization: Bearer $LEASE"   -H 'Content-Type: application/json'   --data "$REQ")"
CURL_RC=$?
set -e

echo "curl_rc=$CURL_RC"
echo "http=$HTTP_CODE"
echo "request-id=$(awk 'BEGIN{IGNORECASE=1} /^openai-request-id:|^x-request-id:/ {gsub(/\r/,""); print $2; exit}' "$HDR")"
echo
echo "=== RESPOSTA SANITIZADA ==="
if jq -e . "$BODY" >/dev/null 2>&1; then
  jq 'if .error then {error:.error} else {id,model,status,output_text,usage} end' "$BODY"
else
  head -c 4000 "$BODY"
  echo
fi

echo
echo "=== TELEMETRIA DO BROKER ==="
journalctl -u lia-openai-broker.service --since "$START_TS" --no-pager -o cat   | grep -E 'lia_broker_upstream_(response|error|transport)' || true

rm -f "$HDR" "$BODY"
disable_broker
trap - EXIT

echo
echo "=== ESTADO FINAL ==="
curl -fsS "$BROKER_URL/health"
echo
echo "Gateway e Worker permaneceram bloqueados durante todo o teste."
