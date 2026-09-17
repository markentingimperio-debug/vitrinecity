#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

if [ "$(id -u)" -ne 0 ]; then
  echo 'PARADO: execute como root.' >&2
  exit 1
fi

for cmd in curl systemctl openssl sha256sum sudo git jq; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "PARADO: comando ausente: $cmd" >&2; exit 1; }
done

id lia >/dev/null 2>&1 || { echo 'PARADO: usuario lia nao existe.' >&2; exit 1; }
[ -d /opt/lia/app ] || { echo 'PARADO: /opt/lia/app nao existe.' >&2; exit 1; }

NODE_BIN="$(sudo -u lia -H bash -c 'cd /opt/lia/app; export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24 >/dev/null; command -v node')"
[ -x "$NODE_BIN" ] || { echo 'PARADO: Node 24 do usuario lia nao encontrado.' >&2; exit 1; }

SDK_PACKAGE=/opt/lia/app/node_modules/@openai/codex-sdk/package.json
[ -f "$SDK_PACKAGE" ] || { echo 'PARADO: @openai/codex-sdk nao esta instalado em /opt/lia/app.' >&2; exit 1; }
SDK_VERSION="$(jq -r '.version // empty' "$SDK_PACKAGE")"
[[ "$SDK_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([+-][0-9A-Za-z.-]+)?$ ]] || { echo 'PARADO: versao do Codex SDK nao identificada.' >&2; exit 1; }

BASE=/opt/lia
WORKER_DIR=$BASE/app/codex-worker
WORKSPACE_ROOT=$BASE/workspaces
DATA_DIR=$BASE/codex-data
ENV_FILE=/etc/lia-codex-worker.env
SERVICE_FILE=/etc/systemd/system/lia-codex-worker.service
SERVER_URL='https://raw.githubusercontent.com/markentingimperio-debug/vitrinecity/7db37c589f50a0848371522fec231c692cd7a85a/ops/lia-codex-worker/server.mjs'
SERVER_SHA='5a92f987f3075b82eed383e3275ab0d8612b47a481339601c05d4045bd7cd400'

install -d -o lia -g lia -m 0750 "$WORKER_DIR" "$WORKSPACE_ROOT" "$DATA_DIR"

TMP="$(mktemp --suffix=.mjs /tmp/lia-codex-worker.XXXXXX)"
trap 'rm -f "$TMP" /tmp/lia-codex-health.json /tmp/lia-codex-unauth.json /tmp/lia-codex-cap.json /tmp/lia-codex-lock.json /tmp/lia-codex-dry.json' EXIT

curl --fail --location --silent --show-error --proto '=https' --proto-redir '=https' \
  --connect-timeout 20 --max-time 120 "$SERVER_URL" -o "$TMP"
printf '%s  %s\n' "$SERVER_SHA" "$TMP" | sha256sum -c - >/dev/null
"$NODE_BIN" --check "$TMP"

# Importa o SDK sem credencial e sem iniciar thread/turno.
sudo -u lia -H env -u OPENAI_API_KEY -u CODEX_API_KEY bash -c \
  'cd /opt/lia/app; export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24 >/dev/null; node --input-type=module -e '\''import { Codex } from "@openai/codex-sdk"; if(typeof Codex!=="function") process.exit(2); console.log("CODEX_SDK_IMPORT_OK")'\'''

install -o lia -g lia -m 0640 "$TMP" "$WORKER_DIR/server.mjs"

if [ ! -f "$ENV_FILE" ]; then
  TOKEN="$(openssl rand -hex 32)"
  cat >"$ENV_FILE" <<ENV
LIA_CODEX_HOST=127.0.0.1
LIA_CODEX_PORT=8790
LIA_CODEX_WORKSPACE_ROOT=/opt/lia/workspaces
LIA_CODEX_WORKER_TOKEN=$TOKEN
LIA_CODEX_EXECUTION_ENABLED=0
ENV
  chmod 0600 "$ENV_FILE"
  chown root:root "$ENV_FILE"
else
  grep -q '^LIA_CODEX_WORKER_TOKEN=.' "$ENV_FILE" || { echo 'PARADO: ambiente existente sem token do worker.' >&2; exit 1; }
  grep -q '^LIA_CODEX_EXECUTION_ENABLED=0$' "$ENV_FILE" || { echo 'PARADO: worker existente nao esta travado; nada alterado.' >&2; exit 1; }
  if grep -Eq '^(OPENAI_API_KEY|CODEX_API_KEY)=' "$ENV_FILE"; then
    echo 'PARADO: credencial OpenAI ja existe no ambiente do worker; revise manualmente antes de reinstalar.' >&2
    exit 1
  fi
fi

# Workspace local de smoke test; nenhum clone, rede ou API.
SMOKE="$WORKSPACE_ROOT/smoke"
if [ ! -d "$SMOKE/.git" ]; then
  install -d -o lia -g lia -m 0750 "$SMOKE"
  printf '# LIA Codex smoke workspace\n' > "$SMOKE/README.md"
  chown lia:lia "$SMOKE/README.md"
  sudo -u lia -H git -C "$SMOKE" init -q
  sudo -u lia -H git -C "$SMOKE" add README.md
  sudo -u lia -H git -C "$SMOKE" -c user.name='LIA Smoke' -c user.email='lia@localhost' commit -qm 'chore: initialize smoke workspace'
fi

cat >"$SERVICE_FILE" <<EOF_SERVICE
[Unit]
Description=LIA Codex Worker (locked)
After=network-online.target lia-dev-gateway.service
Wants=network-online.target

[Service]
Type=simple
User=lia
Group=lia
WorkingDirectory=/opt/lia/app
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_BIN $WORKER_DIR/server.mjs
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
ReadOnlyPaths=/opt/lia/app
ReadWritePaths=$WORKSPACE_ROOT $DATA_DIR

[Install]
WantedBy=multi-user.target
EOF_SERVICE
chmod 0644 "$SERVICE_FILE"

systemctl daemon-reload
systemctl enable --now lia-codex-worker.service

for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8790/health >/tmp/lia-codex-health.json; then
    break
  fi
  sleep 1
done

if ! curl -fsS http://127.0.0.1:8790/health >/tmp/lia-codex-health.json; then
  echo 'PARADO: Codex Worker nao respondeu ao health check.' >&2
  systemctl status lia-codex-worker.service --no-pager || true
  exit 1
fi

grep -q '"sdkLoaded":true' /tmp/lia-codex-health.json || { echo 'PARADO: SDK nao confirmado no health.' >&2; exit 1; }
grep -q '"executionEnabled":false' /tmp/lia-codex-health.json || { echo 'PARADO: execucao nao esta bloqueada.' >&2; exit 1; }
grep -q '"openaiConfigured":false' /tmp/lia-codex-health.json || { echo 'PARADO: worker detectou credencial OpenAI inesperada.' >&2; exit 1; }

TOKEN="$(sed -n 's/^LIA_CODEX_WORKER_TOKEN=//p' "$ENV_FILE")"
UNAUTH_CODE="$(curl -sS -o /tmp/lia-codex-unauth.json -w '%{http_code}' http://127.0.0.1:8790/v1/capabilities || true)"
[ "$UNAUTH_CODE" = '401' ] || { echo 'PARADO: endpoint protegido nao recusou acesso sem token.' >&2; exit 1; }

curl -fsS http://127.0.0.1:8790/v1/capabilities \
  -H "Authorization: Bearer $TOKEN" >/tmp/lia-codex-cap.json
grep -q '"executionEnabled":false' /tmp/lia-codex-cap.json || { echo 'PARADO: capabilities nao confirma bloqueio.' >&2; exit 1; }

LOCK_CODE="$(curl -sS -o /tmp/lia-codex-lock.json -w '%{http_code}' \
  -X POST http://127.0.0.1:8790/v1/run -H "Authorization: Bearer $TOKEN" || true)"
[ "$LOCK_CODE" = '423' ] || { echo 'PARADO: endpoint de execucao nao permaneceu travado.' >&2; exit 1; }
grep -q 'execution_locked' /tmp/lia-codex-lock.json || { echo 'PARADO: motivo do bloqueio nao confirmado.' >&2; exit 1; }

curl -fsS -X POST http://127.0.0.1:8790/v1/dry-run \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"workspace":"smoke","instruction":"Liste o arquivo README sem executar nenhuma mudanca."}' \
  >/tmp/lia-codex-dry.json
grep -q '"executionStarted":false' /tmp/lia-codex-dry.json || { echo 'PARADO: dry-run nao confirmou ausencia de execucao.' >&2; exit 1; }

echo
echo '=== LIA CODEX WORKER INSTALADO ==='
echo "Codex SDK: $SDK_VERSION"
echo 'Status: ativo somente em 127.0.0.1:8790'
echo 'Execucao de IA: BLOQUEADA'
echo 'Credencial OpenAI no worker: NAO configurada'
echo 'Workspace de teste: /opt/lia/workspaces/smoke'
echo 'Dry-run: APROVADO, sem iniciar modelo'
echo 'Endpoint /v1/run: 423 execution_locked CONFIRMADO'
echo 'Nenhuma chamada paga de IA foi realizada por este instalador.'
echo
echo 'Health:'
cat /tmp/lia-codex-health.json
echo
