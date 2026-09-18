#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[ "$(id -u)" -eq 0 ] || { echo 'PARADO: execute como root.' >&2; exit 1; }
for cmd in curl systemctl openssl install cp grep sed sudo; do command -v "$cmd" >/dev/null 2>&1 || { echo "PARADO: comando ausente: $cmd" >&2; exit 1; }; done

GENV=/etc/lia-dev-gateway.env
BROWSER_ENV=/etc/lia-browser-worker.env
MEDIA_ENV=/etc/lia-media-worker.env
OPS_ENV=/etc/lia-operations.env
GATEWAY_DIR=/opt/lia/gateway
DROPIN_DIR=/etc/systemd/system/lia-dev-gateway.service.d
DROPIN=$DROPIN_DIR/operations-v1.conf
NODE_BIN="/home/lia/.nvm/versions/node/v24.21.0/bin/node"
REV='bb4bb96d7fb0d4fddd7e48ad2cae8e194898f475'
BASE="https://raw.githubusercontent.com/markentingimperio-debug/vitrinecity/$REV/ops/lia-execution-v2"
TMP="$(mktemp -d)"
BACKUP="/var/backups/lia-operations-gateway-v1-$(date -u +%Y%m%dT%H%M%SZ)"
trap 'rm -rf "$TMP"' EXIT

for f in "$GENV" "$BROWSER_ENV" "$MEDIA_ENV" "$GATEWAY_DIR/server.mjs" "$GATEWAY_DIR/model-policy.mjs"; do
  [ -f "$f" ] || { echo "PARADO: arquivo ausente: $f" >&2; exit 1; }
done
[ -x "$NODE_BIN" ] || { echo 'PARADO: Node 24 da LIA ausente.' >&2; exit 1; }
grep -q '^LIA_GATEWAY_EXECUTION_ENABLED=0$' "$GENV" || { echo 'PARADO: gateway de codigo deve continuar bloqueado.' >&2; exit 1; }
grep -q '^LIA_BROWSER_EXECUTION_ENABLED=1$' "$BROWSER_ENV" || { echo 'PARADO: Browser Worker nao esta ativado.' >&2; exit 1; }
grep -q '^LIA_MEDIA_EXECUTION_ENABLED=1$' "$MEDIA_ENV" || { echo 'PARADO: Media Worker nao esta ativado.' >&2; exit 1; }

curl -fsSL --proto '=https' --proto-redir '=https' "$BASE/gateway-v2.mjs" -o "$TMP/gateway-v2.mjs"
curl -fsSL --proto '=https' --proto-redir '=https' "$BASE/operations-router.mjs" -o "$TMP/operations-router.mjs"
"$NODE_BIN" --check "$TMP/gateway-v2.mjs"
"$NODE_BIN" --check "$TMP/operations-router.mjs"
grep -q 'createOperationsRouter' "$TMP/gateway-v2.mjs" || { echo 'PARADO: gateway sem Operations Router.' >&2; exit 1; }
grep -q '/v1/operations/quote' "$TMP/operations-router.mjs" || { echo 'PARADO: quote operacional ausente.' >&2; exit 1; }
grep -q '/v1/operations/upload' "$TMP/operations-router.mjs" || { echo 'PARADO: upload operacional ausente.' >&2; exit 1; }

mkdir -p "$BACKUP"; chmod 0700 "$BACKUP"
cp -a "$GATEWAY_DIR/server.mjs" "$BACKUP/server.mjs"
cp -a "$GENV" "$BACKUP/gateway.env"
[ ! -f "$OPS_ENV" ] || cp -a "$OPS_ENV" "$BACKUP/operations.env"
[ ! -f "$DROPIN" ] || cp -a "$DROPIN" "$BACKUP/operations-v1.conf"

BTOKEN="$(sed -n 's/^LIA_BROWSER_CONTROL_TOKEN=//p' "$BROWSER_ENV" | head -n1)"
MTOKEN="$(sed -n 's/^LIA_MEDIA_CONTROL_TOKEN=//p' "$MEDIA_ENV" | head -n1)"
[ ${#BTOKEN} -ge 32 ] || { echo 'PARADO: token do Browser Worker invalido.' >&2; exit 1; }
[ ${#MTOKEN} -ge 32 ] || { echo 'PARADO: token do Media Worker invalido.' >&2; exit 1; }

if [ -f "$OPS_ENV" ]; then
  OTOKEN="$(sed -n 's/^LIA_OPERATIONS_TOKEN=//p' "$OPS_ENV" | head -n1)"
else
  OTOKEN="$(openssl rand -hex 32)"
fi
[ ${#OTOKEN} -ge 32 ] || { echo 'PARADO: token operacional invalido.' >&2; exit 1; }

cat >"$OPS_ENV" <<EOF
LIA_OPERATIONS_ENABLED=1
LIA_OPERATIONS_TOKEN=$OTOKEN
LIA_BROWSER_WORKER_URL=http://127.0.0.1:8792
LIA_BROWSER_CONTROL_TOKEN=$BTOKEN
LIA_MEDIA_SOCKET=/run/lia-media-worker/media.sock
LIA_MEDIA_CONTROL_TOKEN=$MTOKEN
LIA_ARTIFACT_ROOT=/opt/lia/artifacts
EOF
chown root:root "$OPS_ENV"; chmod 0600 "$OPS_ENV"

install -o lia -g lia -m 0640 "$TMP/operations-router.mjs" "$GATEWAY_DIR/operations-router.mjs"
install -o lia -g lia -m 0640 "$TMP/gateway-v2.mjs" "$GATEWAY_DIR/server.mjs"

mkdir -p "$DROPIN_DIR"
cat >"$DROPIN" <<EOF
[Service]
EnvironmentFile=$OPS_ENV
ReadWritePaths=/opt/lia/data /opt/lia/artifacts
EOF
chmod 0644 "$DROPIN"

systemctl daemon-reload
systemctl restart lia-dev-gateway.service

for _ in $(seq 1 30); do
  H="$(curl -fsS http://127.0.0.1:8787/health 2>/dev/null || true)"
  if printf '%s' "$H" | grep -q '"operationsEnabled":true'; then break; fi
  sleep 1
done
printf '%s' "$H" | grep -q '"executionEnabled":false' || { echo 'PARADO: gateway de codigo deixou de estar bloqueado.' >&2; exit 1; }
printf '%s' "$H" | grep -q '"operationsEnabled":true' || { echo 'PARADO: Operations Router nao ativou.' >&2; exit 1; }

Q="$(curl -fsS http://127.0.0.1:8787/v1/operations/quote   -H "Authorization: Bearer $OTOKEN" -H 'Content-Type: application/json'   --data '{"instruction":"Abra https://vitrinecity.com e tire uma captura"}')"
printf '%s' "$Q" | grep -q '"kind":"browser"' || { echo 'PARADO: classificador operacional nao respondeu browser.' >&2; exit 1; }

install -o root -g root -m 0600 /dev/null /root/lia-operations-main-app-token.txt
printf '%s\n' "$OTOKEN" >/root/lia-operations-main-app-token.txt

echo
echo '=== LIA OPERATIONS GATEWAY V1 INSTALADO ==='
echo 'Operations Router: ATIVO'
echo 'Browser Worker: CONECTADO'
echo 'Media Worker: CONECTADO'
echo 'Upload controlado: ATIVO (50 MB)'
echo 'Gateway Codex: CONTINUA BLOQUEADO'
echo 'Worker Codex: NAO ALTERADO'
echo 'Broker/OpenAI: NAO ALTERADO'
echo 'Deploy de producao: NAO ALTERADO'
echo 'Chamadas OpenAI realizadas nesta instalacao: ZERO'
echo "Token para a Vitrine City salvo em: /root/lia-operations-main-app-token.txt"
echo "Backup: $BACKUP"
