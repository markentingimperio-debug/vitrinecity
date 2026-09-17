#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

if [ "$(id -u)" -ne 0 ]; then
  echo 'PARADO: execute como root.' >&2
  exit 1
fi

for cmd in curl systemctl openssl sha256sum sudo; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "PARADO: comando ausente: $cmd" >&2; exit 1; }
done

id lia >/dev/null 2>&1 || { echo 'PARADO: usuario lia nao existe. Execute a etapa anterior primeiro.' >&2; exit 1; }

NODE_BIN="$(sudo -u lia -H bash -lc 'export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24 >/dev/null; command -v node')"
[ -x "$NODE_BIN" ] || { echo 'PARADO: Node 24 do usuario lia nao foi encontrado.' >&2; exit 1; }

BASE=/opt/lia
GATEWAY_DIR="$BASE/gateway"
DATA_DIR="$BASE/data"
ENV_FILE=/etc/lia-dev-gateway.env
SERVICE_FILE=/etc/systemd/system/lia-dev-gateway.service
SERVER_URL='https://raw.githubusercontent.com/markentingimperio-debug/vitrinecity/864eb2b19dfbb1648956c537d2b3a0e8df1e12a3/ops/lia-dev-gateway/server.mjs'
SERVER_SHA='6df27dde9855820e926bd69644006046efbab1418125138087ae6dc8baa8ee29'

install -d -o lia -g lia -m 0750 "$GATEWAY_DIR" "$DATA_DIR"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
curl --fail --location --silent --show-error --proto '=https' --proto-redir '=https' \
  --connect-timeout 20 --max-time 120 "$SERVER_URL" -o "$TMP"
printf '%s  %s\n' "$SERVER_SHA" "$TMP" | sha256sum -c - >/dev/null
"$NODE_BIN" --check "$TMP"
install -o lia -g lia -m 0640 "$TMP" "$GATEWAY_DIR/server.mjs"

if [ ! -f "$ENV_FILE" ]; then
  TOKEN="$(openssl rand -hex 32)"
  cat >"$ENV_FILE" <<ENV
LIA_GATEWAY_HOST=127.0.0.1
LIA_GATEWAY_PORT=8787
LIA_DATA_DIR=/opt/lia/data
LIA_GATEWAY_TOKEN=$TOKEN
LIA_MAX_TASK_BUDGET_USD=1.00
LIA_MAX_DAILY_BUDGET_USD=5.00
ENV
  chmod 0600 "$ENV_FILE"
  chown root:root "$ENV_FILE"
else
  grep -q '^LIA_GATEWAY_TOKEN=.' "$ENV_FILE" || { echo 'PARADO: arquivo de ambiente existente sem token.' >&2; exit 1; }
fi

cat >"$SERVICE_FILE" <<EOF_SERVICE
[Unit]
Description=LIA Dev Gateway
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=lia
Group=lia
WorkingDirectory=$GATEWAY_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_BIN $GATEWAY_DIR/server.mjs
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=read-only
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
ReadWritePaths=$DATA_DIR
ReadOnlyPaths=$GATEWAY_DIR

[Install]
WantedBy=multi-user.target
EOF_SERVICE
chmod 0644 "$SERVICE_FILE"

systemctl daemon-reload
systemctl enable --now lia-dev-gateway.service

for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8787/health >/tmp/lia-gateway-health.json; then
    break
  fi
  sleep 1
done

if ! curl -fsS http://127.0.0.1:8787/health >/tmp/lia-gateway-health.json; then
  echo 'PARADO: gateway nao respondeu ao health check.' >&2
  systemctl status lia-dev-gateway.service --no-pager || true
  exit 1
fi

TOKEN="$(sed -n 's/^LIA_GATEWAY_TOKEN=//p' "$ENV_FILE")"
UNAUTH_CODE="$(curl -sS -o /tmp/lia-gateway-unauth.json -w '%{http_code}' http://127.0.0.1:8787/v1/budget || true)"
[ "$UNAUTH_CODE" = '401' ] || { echo 'PARADO: endpoint protegido nao recusou acesso sem token.' >&2; exit 1; }

BUDGET_JSON="$(curl -fsS http://127.0.0.1:8787/v1/budget -H "Authorization: Bearer $TOKEN")"
printf '%s' "$BUDGET_JSON" | grep -q '"executionEnabled":false' || { echo 'PARADO: bloqueio de execucao nao confirmado.' >&2; exit 1; }

rm -f /tmp/lia-gateway-health.json /tmp/lia-gateway-unauth.json

echo
echo '=== LIA DEV GATEWAY INSTALADO ==='
echo 'Status: ativo somente em 127.0.0.1:8787'
echo 'Execucao de IA: BLOQUEADA nesta fase'
echo 'OPENAI_API_KEY: NAO configurada por este instalador'
echo 'Limite por tarefa: US$ 1,00'
echo 'Limite diario: US$ 5,00'
echo "Token interno: armazenado em $ENV_FILE (nao exibido)"
echo
echo 'Health:'
curl -fsS http://127.0.0.1:8787/health
echo
