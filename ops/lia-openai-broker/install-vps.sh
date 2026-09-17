#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[ "$(id -u)" -eq 0 ] || { echo 'PARADO: execute como root.' >&2; exit 1; }
for cmd in curl systemctl openssl sha256sum sudo grep sed; do command -v "$cmd" >/dev/null || { echo "PARADO: comando ausente: $cmd" >&2; exit 1; }; done
id lia >/dev/null 2>&1 || { echo 'PARADO: usuario lia ausente.' >&2; exit 1; }

NODE_BIN="$(sudo -u lia -H bash -c 'cd /; export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24 >/dev/null; command -v node')"
[ -x "$NODE_BIN" ] || { echo 'PARADO: Node 24 nao encontrado.' >&2; exit 1; }

if ! id lia-broker >/dev/null 2>&1; then
  useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin lia-broker
fi
sudo -u lia-broker "$NODE_BIN" --version >/dev/null || { echo 'PARADO: usuario isolado do broker nao consegue executar Node 24.' >&2; exit 1; }

BROKER_DIR=/opt/lia/broker
ENV_FILE=/etc/lia-openai-broker.env
SERVICE=/etc/systemd/system/lia-openai-broker.service
SERVER_URL='https://raw.githubusercontent.com/markentingimperio-debug/vitrinecity/aa695d924b8f5d625787a8334c77d7524fb224d6/ops/lia-openai-broker/server.mjs'
SERVER_SHA='bd05779fc3cd232b65aa44f74c333d8221b54efd97619b8c60281e94fd224469'

install -d -o root -g root -m 0755 "$BROKER_DIR"
TMP="$(mktemp --suffix=.mjs /tmp/lia-broker.XXXXXX)"
trap 'rm -f "$TMP" /tmp/lia-broker-health.json /tmp/lia-broker-status.json /tmp/lia-worker-health.json' EXIT
curl --fail --location --silent --show-error --proto '=https' --proto-redir '=https' --connect-timeout 20 --max-time 120 "$SERVER_URL" -o "$TMP"
printf '%s  %s\n' "$SERVER_SHA" "$TMP" | sha256sum -c - >/dev/null
"$NODE_BIN" --check "$TMP"
install -o root -g root -m 0644 "$TMP" "$BROKER_DIR/server.mjs"

if [ -e "$ENV_FILE" ]; then
  echo 'PARADO: ambiente do broker ja existe; nao vou sobrescrever credencial existente.' >&2
  exit 1
fi

printf 'Cole a OPENAI_API_KEY diretamente aqui (nao sera exibida) e pressione Enter: ' >&2
IFS= read -r -s OPENAI_KEY
printf '\n' >&2
[ ${#OPENAI_KEY} -ge 20 ] || { unset OPENAI_KEY; echo 'PARADO: chave muito curta.' >&2; exit 1; }
case "$OPENAI_KEY" in *$'\r'*) unset OPENAI_KEY; echo 'PARADO: formato de chave invalido.' >&2; exit 1;; esac
ADMIN_TOKEN="$(openssl rand -hex 32)"
{
  printf 'LIA_BROKER_HOST=127.0.0.1\n'
  printf 'LIA_BROKER_PORT=8791\n'
  printf 'LIA_BROKER_ADMIN_TOKEN=%s\n' "$ADMIN_TOKEN"
  printf 'LIA_BROKER_EXECUTION_ENABLED=0\n'
  printf 'LIA_BROKER_DEFAULT_MODEL=gpt-5.4-mini\n'
  printf 'OPENAI_API_KEY=%s\n' "$OPENAI_KEY"
} >"$ENV_FILE"
unset OPENAI_KEY
chmod 0600 "$ENV_FILE"; chown root:root "$ENV_FILE"

cat >"$SERVICE" <<EOF
[Unit]
Description=LIA OpenAI Broker (locked)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=lia-broker
Group=lia-broker
WorkingDirectory=$BROKER_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_BIN $BROKER_DIR/server.mjs
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
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6

[Install]
WantedBy=multi-user.target
EOF
chmod 0644 "$SERVICE"
systemctl daemon-reload
systemctl enable --now lia-openai-broker.service

for _ in $(seq 1 30); do curl -fsS http://127.0.0.1:8791/health >/tmp/lia-broker-health.json && break; sleep 1; done
curl -fsS http://127.0.0.1:8791/health >/tmp/lia-broker-health.json || { echo 'PARADO: broker nao respondeu.' >&2; systemctl status lia-openai-broker --no-pager || true; exit 1; }
grep -q '"keyConfigured":true' /tmp/lia-broker-health.json || { echo 'PARADO: broker nao confirmou credencial.' >&2; exit 1; }
grep -q '"executionEnabled":false' /tmp/lia-broker-health.json || { echo 'PARADO: broker nao esta bloqueado.' >&2; exit 1; }

TOKEN="$(sed -n 's/^LIA_BROKER_ADMIN_TOKEN=//p' "$ENV_FILE")"
curl -fsS http://127.0.0.1:8791/v1/status -H "Authorization: Bearer $TOKEN" >/tmp/lia-broker-status.json
grep -q '"realKeyExposed":false' /tmp/lia-broker-status.json || { echo 'PARADO: isolamento da chave nao confirmado.' >&2; exit 1; }

# Confirma que o worker Codex continua sem a chave real.
curl -fsS http://127.0.0.1:8790/health >/tmp/lia-worker-health.json || { echo 'PARADO: Codex Worker nao respondeu.' >&2; exit 1; }
grep -q '"openaiConfigured":false' /tmp/lia-worker-health.json || { echo 'PARADO: Codex Worker detectou credencial direta; revise antes de continuar.' >&2; exit 1; }
if grep -Eq '^(OPENAI_API_KEY|CODEX_API_KEY)=' /etc/lia-codex-worker.env; then echo 'PARADO: chave real encontrada no ambiente do worker.' >&2; exit 1; fi

echo
echo '=== BROKER OPENAI DA LIA INSTALADO ==='
echo 'Broker: 127.0.0.1:8791'
echo 'Chave real: isolada no broker, arquivo root:root 0600'
echo 'Codex Worker: continua SEM chave real'
echo 'Modelo inicial planejado: gpt-5.4-mini'
echo 'Execucao paga: BLOQUEADA'
echo 'Chamadas OpenAI realizadas nesta etapa: ZERO'
echo 'Proxima fase: leases de orcamento + primeira tarefa limitada.'
echo
cat /tmp/lia-broker-health.json
echo
