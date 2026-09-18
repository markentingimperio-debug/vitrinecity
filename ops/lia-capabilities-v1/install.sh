#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[ "$(id -u)" -eq 0 ] || { echo 'PARADO: execute como root.' >&2; exit 1; }

for cmd in curl docker systemctl openssl install cp grep sed getent id ffmpeg ffprobe jq; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "PARADO: comando ausente: $cmd" >&2; exit 1; }
done
docker compose version >/dev/null 2>&1 || { echo 'PARADO: Docker Compose nao disponivel.' >&2; exit 1; }

GENV=/etc/lia-dev-gateway.env
WENV=/etc/lia-codex-worker.env
BENV=/etc/lia-openai-broker.env
for f in "$GENV" "$WENV" "$BENV"; do
  [ -f "$f" ] || { echo "PARADO: arquivo ausente: $f" >&2; exit 1; }
done
grep -q '^LIA_GATEWAY_EXECUTION_ENABLED=0$' "$GENV" || { echo 'PARADO: gateway precisa estar bloqueado durante a instalacao.' >&2; exit 1; }
grep -q '^LIA_CODEX_EXECUTION_ENABLED=0$' "$WENV" || { echo 'PARADO: Codex Worker precisa estar bloqueado durante a instalacao.' >&2; exit 1; }
grep -q '^LIA_BROKER_EXECUTION_ENABLED=0$' "$BENV" || { echo 'PARADO: OpenAI Broker precisa estar bloqueado durante a instalacao.' >&2; exit 1; }

id lia >/dev/null 2>&1 || { echo 'PARADO: usuario lia ausente.' >&2; exit 1; }
LIA_UID="$(id -u lia)"
LIA_GID="$(id -g lia)"
NODE_SOURCE='/home/lia/.nvm/versions/node/v24.21.0/bin/node'
[ -x "$NODE_SOURCE" ] || { echo "PARADO: Node 24 esperado ausente: $NODE_SOURCE" >&2; exit 1; }

SOURCE_REV='f54f477c7e14d8c4bc9284a6eb73c34eab596cbe'
RAW_BASE="https://raw.githubusercontent.com/markentingimperio-debug/vitrinecity/$SOURCE_REV/ops/lia-capabilities-v1"
BROWSER_DIR=/opt/lia/browser-worker
MEDIA_DIR=/opt/lia/media-worker
ARTIFACT_DIR=/opt/lia/artifacts
BROWSER_ENV=/etc/lia-browser-worker.env
MEDIA_ENV=/etc/lia-media-worker.env
BACKUP="/var/backups/lia-capabilities-v1-$(date -u +%Y%m%dT%H%M%SZ)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$BACKUP"
chmod 0700 "$BACKUP"
for p in "$BROWSER_DIR" "$MEDIA_DIR" "$BROWSER_ENV" "$MEDIA_ENV"   /etc/systemd/system/lia-browser-worker.service   /etc/systemd/system/lia-media-worker.service   /opt/lia/bin/lia-browser-run   /opt/lia/bin/lia-media-run   /opt/lia/bin/lia-capabilities-set   /opt/lia/bin/lia-capabilities-status
do
  if [ -e "$p" ]; then
    cp -a "$p" "$BACKUP/" 2>/dev/null || true
  fi
done

if ! id lia-media >/dev/null 2>&1; then
  useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin --gid "$LIA_GID" lia-media
fi

install -d -o root -g root -m 0755 /opt/lia
install -d -o root -g root -m 0755 "$BROWSER_DIR" "$MEDIA_DIR"
install -d -o root -g lia -m 0770 "$ARTIFACT_DIR"
install -d -o lia -g lia -m 0770   "$ARTIFACT_DIR/incoming"   "$ARTIFACT_DIR/browser"   "$ARTIFACT_DIR/media"   "$ARTIFACT_DIR/completed"
install -d -o root -g root -m 0750 /opt/lia/bin
install -d -o root -g root -m 0755 /opt/lia/tasks/examples

curl -fsSL --proto '=https' --proto-redir '=https' "$RAW_BASE/browser-worker/server.mjs" -o "$TMP/browser-server.mjs"
curl -fsSL --proto '=https' --proto-redir '=https' "$RAW_BASE/browser-worker/package.json" -o "$TMP/browser-package.json"
curl -fsSL --proto '=https' --proto-redir '=https' "$RAW_BASE/browser-worker/Dockerfile" -o "$TMP/browser-Dockerfile"
curl -fsSL --proto '=https' --proto-redir '=https' "$RAW_BASE/media-worker/server.mjs" -o "$TMP/media-server.mjs"

grep -q "action === 'goto'" "$TMP/browser-server.mjs" || { echo 'PARADO: browser source invalido.' >&2; exit 1; }
grep -q "LIA_BROWSER_ALLOWED_DOMAINS" "$TMP/browser-server.mjs" || { echo 'PARADO: allowlist do browser ausente.' >&2; exit 1; }
grep -q "action === 'videoResize'" "$TMP/media-server.mjs" || { echo 'PARADO: media source invalido.' >&2; exit 1; }
grep -q "spawn(bin, args" "$TMP/media-server.mjs" || { echo 'PARADO: execucao segura do media worker ausente.' >&2; exit 1; }
jq -e '.dependencies.playwright=="1.55.0"' "$TMP/browser-package.json" >/dev/null || { echo 'PARADO: versao Playwright inesperada.' >&2; exit 1; }

install -o root -g root -m 0644 "$TMP/browser-server.mjs" "$BROWSER_DIR/server.mjs"
install -o root -g root -m 0644 "$TMP/browser-package.json" "$BROWSER_DIR/package.json"
install -o root -g root -m 0644 "$TMP/browser-Dockerfile" "$BROWSER_DIR/Dockerfile"
install -o root -g root -m 0644 "$TMP/media-server.mjs" "$MEDIA_DIR/server.mjs"
install -d -o root -g root -m 0755 "$MEDIA_DIR/runtime"
install -o root -g root -m 0755 "$NODE_SOURCE" "$MEDIA_DIR/runtime/node"

if [ ! -f "$BROWSER_ENV" ]; then
  BROWSER_TOKEN="$(openssl rand -hex 32)"
  cat >"$BROWSER_ENV" <<EOF
LIA_BROWSER_EXECUTION_ENABLED=0
LIA_BROWSER_HOST=0.0.0.0
LIA_BROWSER_PORT=8792
LIA_BROWSER_CONTROL_TOKEN=$BROWSER_TOKEN
LIA_BROWSER_ALLOWED_DOMAINS=vitrinecity.com,github.com,raw.githubusercontent.com
LIA_BROWSER_ARTIFACT_DIR=/artifacts/browser
LIA_BROWSER_MAX_STEPS=20
LIA_BROWSER_TIMEOUT_MS=30000
LIA_BROWSER_UID=$LIA_UID
LIA_BROWSER_GID=$LIA_GID
EOF
fi
chown root:root "$BROWSER_ENV"
chmod 0600 "$BROWSER_ENV"

if [ ! -f "$MEDIA_ENV" ]; then
  MEDIA_TOKEN="$(openssl rand -hex 32)"
  cat >"$MEDIA_ENV" <<EOF
LIA_MEDIA_EXECUTION_ENABLED=0
LIA_MEDIA_CONTROL_TOKEN=$MEDIA_TOKEN
LIA_MEDIA_SOCKET=/run/lia-media-worker/media.sock
LIA_MEDIA_ARTIFACT_ROOT=$ARTIFACT_DIR
LIA_MEDIA_FFMPEG=/usr/bin/ffmpeg
LIA_MEDIA_FFPROBE=/usr/bin/ffprobe
LIA_MEDIA_TIMEOUT_MS=600000
EOF
fi
chown root:root "$MEDIA_ENV"
chmod 0600 "$MEDIA_ENV"

grep -Eq '^LIA_BROWSER_CONTROL_TOKEN=[0-9a-f]{64}$' "$BROWSER_ENV" || { echo 'PARADO: token do browser invalido.' >&2; exit 1; }
grep -Eq '^LIA_MEDIA_CONTROL_TOKEN=[0-9a-f]{64}$' "$MEDIA_ENV" || { echo 'PARADO: token do media worker invalido.' >&2; exit 1; }

cat >"$BROWSER_DIR/compose.yml" <<'YAML'
services:
  browser:
    build:
      context: /opt/lia/browser-worker
      dockerfile: Dockerfile
    image: lia-browser-worker:v1
    env_file:
      - /etc/lia-browser-worker.env
    user: "${LIA_BROWSER_UID}:${LIA_BROWSER_GID}"
    environment:
      HOME: /tmp/lia-browser
      XDG_CACHE_HOME: /tmp/lia-browser/cache
    ports:
      - "127.0.0.1:8792:8792"
    volumes:
      - /opt/lia/artifacts/browser:/artifacts/browser:rw
    read_only: true
    tmpfs:
      - /tmp:rw,noexec,nosuid,nodev,size=536870912
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    pids_limit: 256
    mem_limit: 1536m
    cpus: 1.5
    restart: "no"
YAML
chown root:root "$BROWSER_DIR/compose.yml"
chmod 0644 "$BROWSER_DIR/compose.yml"

cat >/etc/systemd/system/lia-browser-worker.service <<'UNIT'
[Unit]
Description=LIA Browser Worker
After=docker.service network-online.target
Requires=docker.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/lia/browser-worker
EnvironmentFile=/etc/lia-browser-worker.env
ExecStart=/usr/bin/docker compose --env-file /etc/lia-browser-worker.env -f /opt/lia/browser-worker/compose.yml up --no-build
ExecStop=/usr/bin/docker compose --env-file /etc/lia-browser-worker.env -f /opt/lia/browser-worker/compose.yml down --remove-orphans
Restart=always
RestartSec=3
TimeoutStartSec=120
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
UNIT

cat >/etc/systemd/system/lia-media-worker.service <<'UNIT'
[Unit]
Description=LIA Media Worker
After=local-fs.target

[Service]
Type=simple
User=lia-media
Group=lia
UMask=0007
EnvironmentFile=/etc/lia-media-worker.env
ExecStart=/opt/lia/media-worker/runtime/node /opt/lia/media-worker/server.mjs
Restart=on-failure
RestartSec=2
RuntimeDirectory=lia-media-worker
RuntimeDirectoryMode=0750
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
PrivateNetwork=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/lia/artifacts /run/lia-media-worker
RestrictAddressFamilies=AF_UNIX
RestrictSUIDSGID=true
LockPersonality=true
CapabilityBoundingSet=
AmbientCapabilities=
SystemCallArchitectures=native

[Install]
WantedBy=multi-user.target
UNIT

cat >/opt/lia/bin/lia-browser-run <<'SH'
#!/usr/bin/env bash
set -Eeuo pipefail
[ "$(id -u)" -eq 0 ] || { echo 'PARADO: execute como root.' >&2; exit 1; }
[ "$#" -eq 1 ] || { echo 'Uso: lia-browser-run <task.json>' >&2; exit 2; }
TASK="$1"
[ -f "$TASK" ] || { echo "PARADO: arquivo nao encontrado: $TASK" >&2; exit 1; }
jq -e '(.steps|type)=="array" and (.steps|length)>0' "$TASK" >/dev/null || { echo 'PARADO: manifesto browser invalido.' >&2; exit 1; }
TOKEN="$(sed -n 's/^LIA_BROWSER_CONTROL_TOKEN=//p' /etc/lia-browser-worker.env | head -n1)"
curl --fail --silent --show-error   -H "Authorization: Bearer $TOKEN"   -H 'Content-Type: application/json'   --data-binary "@$TASK"   http://127.0.0.1:8792/v1/browser/run
echo
SH

cat >/opt/lia/bin/lia-media-run <<'SH'
#!/usr/bin/env bash
set -Eeuo pipefail
[ "$(id -u)" -eq 0 ] || { echo 'PARADO: execute como root.' >&2; exit 1; }
[ "$#" -eq 1 ] || { echo 'Uso: lia-media-run <task.json>' >&2; exit 2; }
TASK="$1"
[ -f "$TASK" ] || { echo "PARADO: arquivo nao encontrado: $TASK" >&2; exit 1; }
jq -e '(.action|type)=="string" and (.input|type)=="string"' "$TASK" >/dev/null || { echo 'PARADO: manifesto media invalido.' >&2; exit 1; }
TOKEN="$(sed -n 's/^LIA_MEDIA_CONTROL_TOKEN=//p' /etc/lia-media-worker.env | head -n1)"
curl --fail --silent --show-error   --unix-socket /run/lia-media-worker/media.sock   -H "Authorization: Bearer $TOKEN"   -H 'Content-Type: application/json'   --data-binary "@$TASK"   http://localhost/v1/media/run
echo
SH

cat >/opt/lia/bin/lia-capabilities-set <<'SH'
#!/usr/bin/env bash
set -Eeuo pipefail
[ "$(id -u)" -eq 0 ] || { echo 'PARADO: execute como root.' >&2; exit 1; }
[ "$#" -eq 2 ] || { echo 'Uso: lia-capabilities-set <browser|media|all> <on|off>' >&2; exit 2; }
TARGET="$1"
MODE="$2"
case "$TARGET" in browser|media|all) ;; *) echo 'PARADO: capability invalida.' >&2; exit 1;; esac
case "$MODE" in on) VALUE=1;; off) VALUE=0;; *) echo 'PARADO: use on ou off.' >&2; exit 1;; esac

set_flag(){
  local file="$1" key="$2"
  grep -q "^$key=" "$file" || { echo "PARADO: $key ausente em $file" >&2; exit 1; }
  sed -i "s/^$key=.*/$key=$VALUE/" "$file"
  chown root:root "$file"
  chmod 0600 "$file"
}
if [ "$TARGET" = browser ] || [ "$TARGET" = all ]; then
  set_flag /etc/lia-browser-worker.env LIA_BROWSER_EXECUTION_ENABLED
  systemctl restart lia-browser-worker.service
fi
if [ "$TARGET" = media ] || [ "$TARGET" = all ]; then
  set_flag /etc/lia-media-worker.env LIA_MEDIA_EXECUTION_ENABLED
  systemctl restart lia-media-worker.service
fi

echo "Capability: $TARGET"
echo "Estado: $MODE"
echo 'Codex Worker: NAO ALTERADO'
echo 'Git push: NAO ALTERADO'
echo 'Deploy de producao: NAO ALTERADO'
SH

cat >/opt/lia/bin/lia-capabilities-status <<'SH'
#!/usr/bin/env bash
set -Eeuo pipefail
echo '=== LIA CAPABILITIES ==='
echo "Browser flag: $(sed -n 's/^LIA_BROWSER_EXECUTION_ENABLED=//p' /etc/lia-browser-worker.env)"
echo "Media flag: $(sed -n 's/^LIA_MEDIA_EXECUTION_ENABLED=//p' /etc/lia-media-worker.env)"
echo "Browser service: $(systemctl is-active lia-browser-worker.service || true)"
echo "Media service: $(systemctl is-active lia-media-worker.service || true)"
echo
echo '--- Browser health ---'
curl -fsS http://127.0.0.1:8792/health || true
echo
echo
echo '--- Media health ---'
curl -fsS --unix-socket /run/lia-media-worker/media.sock http://localhost/health || true
echo
SH

chmod 0750 /opt/lia/bin/lia-browser-run /opt/lia/bin/lia-media-run /opt/lia/bin/lia-capabilities-set /opt/lia/bin/lia-capabilities-status
chown root:root /opt/lia/bin/lia-browser-run /opt/lia/bin/lia-media-run /opt/lia/bin/lia-capabilities-set /opt/lia/bin/lia-capabilities-status

cat >/opt/lia/tasks/examples/browser-vitrine-home.json <<'JSON'
{
  "steps": [
    { "action": "goto", "url": "https://vitrinecity.com" },
    { "action": "text", "selector": "body" },
    { "action": "screenshot", "output": "vitrine-home.png", "fullPage": true }
  ]
}
JSON

cat >/opt/lia/tasks/examples/media-probe.json <<'JSON'
{
  "action": "probe",
  "input": "incoming/video.mp4"
}
JSON
chmod 0644 /opt/lia/tasks/examples/browser-vitrine-home.json /opt/lia/tasks/examples/media-probe.json
chown root:root /opt/lia/tasks/examples/browser-vitrine-home.json /opt/lia/tasks/examples/media-probe.json

systemctl daemon-reload

# Build ocorre com a capability ainda bloqueada.
docker compose --env-file "$BROWSER_ENV" -f "$BROWSER_DIR/compose.yml" build --pull

systemctl enable --now lia-browser-worker.service lia-media-worker.service

for _ in $(seq 1 40); do
  if curl -fsS http://127.0.0.1:8792/health >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS http://127.0.0.1:8792/health >/dev/null || { echo 'PARADO: browser worker nao respondeu health.' >&2; exit 1; }

for _ in $(seq 1 20); do
  if curl -fsS --unix-socket /run/lia-media-worker/media.sock http://localhost/health >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS --unix-socket /run/lia-media-worker/media.sock http://localhost/health >/dev/null || { echo 'PARADO: media worker nao respondeu health.' >&2; exit 1; }

grep -q '^LIA_BROWSER_EXECUTION_ENABLED=0$' "$BROWSER_ENV" || { echo 'PARADO: browser deveria iniciar bloqueado.' >&2; exit 1; }
grep -q '^LIA_MEDIA_EXECUTION_ENABLED=0$' "$MEDIA_ENV" || { echo 'PARADO: media deveria iniciar bloqueado.' >&2; exit 1; }
grep -q '^LIA_CODEX_EXECUTION_ENABLED=0$' "$WENV" || { echo 'PARADO: Codex Worker foi alterado indevidamente.' >&2; exit 1; }

trap - EXIT
rm -rf "$TMP"

echo
echo '=== LIA CAPABILITIES V1 INSTALADAS ==='
echo 'Browser Worker: INSTALADO / BLOQUEADO'
echo 'Media Worker: INSTALADO / BLOQUEADO'
echo 'Browser allowlist: vitrinecity.com, github.com, raw.githubusercontent.com'
echo 'Media Worker rede externa: BLOQUEADA'
echo "Artifact Store: $ARTIFACT_DIR"
echo 'Codex Worker: NAO ALTERADO'
echo 'Git push: BLOQUEADO'
echo 'Deploy de producao: BLOQUEADO'
echo 'Chamadas OpenAI realizadas nesta instalacao: ZERO'
echo "Backup: $BACKUP"
echo
echo 'Para consultar: /opt/lia/bin/lia-capabilities-status'
echo 'Para ativar:   /opt/lia/bin/lia-capabilities-set all on'
