#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[ "$(id -u)" -eq 0 ] || { echo 'PARADO: execute como root.' >&2; exit 1; }
for cmd in curl systemctl openssl sha256sum sudo grep sed cp install; do command -v "$cmd" >/dev/null || { echo "PARADO: comando ausente: $cmd" >&2; exit 1; }; done
id lia >/dev/null 2>&1 || { echo 'PARADO: usuario lia ausente.' >&2; exit 1; }
id lia-broker >/dev/null 2>&1 || { echo 'PARADO: usuario lia-broker ausente.' >&2; exit 1; }

GATEWAY_DIR=/opt/lia/gateway
WORKER_DIR=/opt/lia/app/codex-worker
BROKER_DIR=/opt/lia-broker/app
GATEWAY_ENV=/etc/lia-dev-gateway.env
WORKER_ENV=/etc/lia-codex-worker.env
BROKER_ENV=/etc/lia-openai-broker.env
GATEWAY_SERVICE=/etc/systemd/system/lia-dev-gateway.service
WORKER_SERVICE=/etc/systemd/system/lia-codex-worker.service
BROKER_SERVICE=/etc/systemd/system/lia-openai-broker.service
BROKER_DROPIN_DIR=/etc/systemd/system/lia-openai-broker.service.d
BROKER_DROPIN=$BROKER_DROPIN_DIR/v2.conf

for f in "$GATEWAY_DIR/server.mjs" "$WORKER_DIR/server.mjs" "$BROKER_DIR/server.mjs" "$GATEWAY_ENV" "$WORKER_ENV" "$BROKER_ENV" "$GATEWAY_SERVICE" "$WORKER_SERVICE" "$BROKER_SERVICE"; do
  [ -f "$f" ] || { echo "PARADO: arquivo esperado ausente: $f" >&2; exit 1; }
done

grep -q '^OPENAI_API_KEY=.' "$BROKER_ENV" || { echo 'PARADO: chave OpenAI nao esta configurada no broker.' >&2; exit 1; }
WORKER_TOKEN="$(sed -n 's/^LIA_CODEX_WORKER_TOKEN=//p' "$WORKER_ENV")"
BROKER_TOKEN="$(sed -n 's/^LIA_BROKER_ADMIN_TOKEN=//p' "$BROKER_ENV")"
[ ${#WORKER_TOKEN} -ge 32 ] || { echo 'PARADO: token interno do worker invalido.' >&2; exit 1; }
[ ${#BROKER_TOKEN} -ge 32 ] || { echo 'PARADO: token interno do broker invalido.' >&2; exit 1; }

NODE_BIN="$(sudo -u lia -H bash -c 'cd /; export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24 >/dev/null; command -v node')"
[ -x "$NODE_BIN" ] || { echo 'PARADO: Node 24 da LIA nao encontrado.' >&2; exit 1; }
BROKER_NODE=/opt/lia-broker/runtime/node
[ -x "$BROKER_NODE" ] || { echo 'PARADO: runtime Node isolado do broker nao encontrado.' >&2; exit 1; }

REV='3eb81c94d4681c159e249d6e701f8232478c810c'
BASE_URL="https://raw.githubusercontent.com/markentingimperio-debug/vitrinecity/$REV/ops/lia-execution-v2"
TMPDIR="$(mktemp -d /tmp/lia-exec-v2.XXXXXX)"
BACKUP="/var/backups/lia-execution-v2-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP"; chmod 0700 "$BACKUP"
trap 'rm -rf "$TMPDIR"' EXIT

fetch_checked(){
  local name="$1" sha="$2"
  curl --fail --location --silent --show-error --proto '=https' --proto-redir '=https' --connect-timeout 20 --max-time 120 "$BASE_URL/$name" -o "$TMPDIR/$name"
  printf '%s  %s\n' "$sha" "$TMPDIR/$name" | sha256sum -c - >/dev/null
}
fetch_checked model-policy.mjs 0195c19405e12b8f366d9848e0234c1b468599e32d19c040387de18265f3c1eb
fetch_checked gateway-v2.mjs 7a03bebcd5b93ea588ba752a2265d714430c6a4d8b50e20c54f6de912ff64ddd
fetch_checked worker-v2.mjs a4dbfa5b83c2cb117b803c24cd63e32684e63eb37692725bce45ba854505b2a4
fetch_checked broker-v2.mjs 62e1070b508217b557a9b88dee19b1d9161961de48226cfcfc0d16d471da0db4
"$NODE_BIN" --check "$TMPDIR/gateway-v2.mjs"
"$NODE_BIN" --check "$TMPDIR/worker-v2.mjs"
"$BROKER_NODE" --check "$TMPDIR/broker-v2.mjs"
"$NODE_BIN" --check "$TMPDIR/model-policy.mjs"

cp -a "$GATEWAY_DIR/server.mjs" "$BACKUP/gateway-server.mjs"
cp -a "$WORKER_DIR/server.mjs" "$BACKUP/worker-server.mjs"
cp -a "$BROKER_DIR/server.mjs" "$BACKUP/broker-server.mjs"
cp -a "$GATEWAY_ENV" "$BACKUP/gateway.env"
cp -a "$WORKER_ENV" "$BACKUP/worker.env"
cp -a "$BROKER_ENV" "$BACKUP/broker.env"
if [ -f "$BROKER_DROPIN" ]; then cp -a "$BROKER_DROPIN" "$BACKUP/broker-v2.conf"; echo existing >"$BACKUP/dropin-state"; else echo absent >"$BACKUP/dropin-state"; fi

rolled_back=0
rollback(){
  [ "$rolled_back" -eq 0 ] || return 0
  rolled_back=1
  echo 'Falha detectada; restaurando versao anterior...' >&2
  cp -a "$BACKUP/gateway-server.mjs" "$GATEWAY_DIR/server.mjs" || true
  cp -a "$BACKUP/worker-server.mjs" "$WORKER_DIR/server.mjs" || true
  cp -a "$BACKUP/broker-server.mjs" "$BROKER_DIR/server.mjs" || true
  cp -a "$BACKUP/gateway.env" "$GATEWAY_ENV" || true
  cp -a "$BACKUP/worker.env" "$WORKER_ENV" || true
  cp -a "$BACKUP/broker.env" "$BROKER_ENV" || true
  rm -f "$GATEWAY_DIR/model-policy.mjs" "$WORKER_DIR/model-policy.mjs" "$BROKER_DIR/model-policy.mjs"
  if grep -q '^existing$' "$BACKUP/dropin-state" 2>/dev/null; then mkdir -p "$BROKER_DROPIN_DIR"; cp -a "$BACKUP/broker-v2.conf" "$BROKER_DROPIN" || true; else rm -f "$BROKER_DROPIN"; fi
  systemctl daemon-reload || true
  systemctl restart lia-openai-broker.service lia-codex-worker.service lia-dev-gateway.service || true
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

GATEWAY_SECRET="$(sed -n 's/^LIA_LEASE_SECRET=//p' "$GATEWAY_ENV")"
BROKER_SECRET="$(sed -n 's/^LIA_LEASE_SECRET=//p' "$BROKER_ENV")"
if [ -n "$GATEWAY_SECRET" ] && [ -n "$BROKER_SECRET" ] && [ "$GATEWAY_SECRET" != "$BROKER_SECRET" ]; then echo 'PARADO: segredos de lease existentes divergem.' >&2; exit 1; fi
LEASE_SECRET="${GATEWAY_SECRET:-${BROKER_SECRET:-$(openssl rand -hex 32)}}"
[ ${#LEASE_SECRET} -ge 32 ] || { echo 'PARADO: lease secret invalido.' >&2; exit 1; }

set_kv "$GATEWAY_ENV" LIA_GATEWAY_EXECUTION_ENABLED 0
set_kv "$GATEWAY_ENV" LIA_CODEX_WORKER_URL http://127.0.0.1:8790
set_kv "$GATEWAY_ENV" LIA_CODEX_WORKER_TOKEN "$WORKER_TOKEN"
set_kv "$GATEWAY_ENV" LIA_BROKER_URL http://127.0.0.1:8791
set_kv "$GATEWAY_ENV" LIA_BROKER_ADMIN_TOKEN "$BROKER_TOKEN"
set_kv "$GATEWAY_ENV" LIA_LEASE_SECRET "$LEASE_SECRET"
set_kv "$GATEWAY_ENV" LIA_LEASE_TTL_SECONDS 600

set_kv "$WORKER_ENV" LIA_CODEX_EXECUTION_ENABLED 0
set_kv "$WORKER_ENV" LIA_CODEX_DATA_DIR /opt/lia/codex-data
set_kv "$WORKER_ENV" LIA_CODEX_BROKER_BASE_URL http://127.0.0.1:8791/v1
set_kv "$WORKER_ENV" LIA_CODEX_RUN_TIMEOUT_MS 240000

set_kv "$BROKER_ENV" LIA_BROKER_EXECUTION_ENABLED 0
set_kv "$BROKER_ENV" LIA_BROKER_DATA_DIR /var/lib/lia-openai-broker
set_kv "$BROKER_ENV" LIA_BROKER_MAX_REQUESTS_PER_LEASE 12
set_kv "$BROKER_ENV" LIA_LEASE_SECRET "$LEASE_SECRET"
chmod 0600 "$GATEWAY_ENV" "$WORKER_ENV" "$BROKER_ENV"; chown root:root "$GATEWAY_ENV" "$WORKER_ENV" "$BROKER_ENV"

install -o lia -g lia -m 0640 "$TMPDIR/gateway-v2.mjs" "$GATEWAY_DIR/server.mjs"
install -o lia -g lia -m 0640 "$TMPDIR/model-policy.mjs" "$GATEWAY_DIR/model-policy.mjs"
install -o lia -g lia -m 0640 "$TMPDIR/worker-v2.mjs" "$WORKER_DIR/server.mjs"
install -o lia -g lia -m 0640 "$TMPDIR/model-policy.mjs" "$WORKER_DIR/model-policy.mjs"
install -o root -g root -m 0644 "$TMPDIR/broker-v2.mjs" "$BROKER_DIR/server.mjs"
install -o root -g root -m 0644 "$TMPDIR/model-policy.mjs" "$BROKER_DIR/model-policy.mjs"
install -d -o lia-broker -g lia-broker -m 0700 /var/lib/lia-openai-broker
install -d -m 0755 "$BROKER_DROPIN_DIR"
cat >"$BROKER_DROPIN" <<DROPIN
[Service]
ReadWritePaths=/var/lib/lia-openai-broker
DROPIN
chmod 0644 "$BROKER_DROPIN"

systemctl daemon-reload
systemctl restart lia-openai-broker.service
systemctl restart lia-codex-worker.service
systemctl restart lia-dev-gateway.service

wait_health(){ local url="$1" needle="$2"; for _ in $(seq 1 30); do out="$(curl -fsS "$url" 2>/dev/null || true)"; if printf '%s' "$out" | grep -q "$needle"; then printf '%s' "$out"; return 0; fi; sleep 1; done; return 1; }
BROKER_HEALTH="$(wait_health http://127.0.0.1:8791/health '2026-09-17-v2')" || { echo 'PARADO: broker v2 nao respondeu.' >&2; exit 1; }
WORKER_HEALTH="$(wait_health http://127.0.0.1:8790/health '2026-09-17-v2')" || { echo 'PARADO: worker v2 nao respondeu.' >&2; exit 1; }
GATEWAY_HEALTH="$(wait_health http://127.0.0.1:8787/health '2026-09-17-v2')" || { echo 'PARADO: gateway v2 nao respondeu.' >&2; exit 1; }
printf '%s' "$BROKER_HEALTH" | grep -q '"executionEnabled":false' || { echo 'PARADO: broker nao ficou bloqueado.' >&2; exit 1; }
printf '%s' "$WORKER_HEALTH" | grep -q '"executionEnabled":false' || { echo 'PARADO: worker nao ficou bloqueado.' >&2; exit 1; }
printf '%s' "$GATEWAY_HEALTH" | grep -q '"executionEnabled":false' || { echo 'PARADO: gateway nao ficou bloqueado.' >&2; exit 1; }

GATEWAY_TOKEN="$(sed -n 's/^LIA_GATEWAY_TOKEN=//p' "$GATEWAY_ENV")"
MODELS="$(curl -fsS http://127.0.0.1:8787/v1/models -H "Authorization: Bearer $GATEWAY_TOKEN")"
for model in gpt-5.6-luna gpt-5.4-mini gpt-5.3-codex gpt-5.6-terra gpt-5.6-sol gpt-6-astra; do printf '%s' "$MODELS" | grep -q "$model" || { echo "PARADO: modelo ausente no roteador: $model" >&2; exit 1; }; done

WORKER_LOCK="$(curl -sS -o /tmp/lia-v2-worker-lock.json -w '%{http_code}' -X POST http://127.0.0.1:8790/v1/run -H "Authorization: Bearer $WORKER_TOKEN" || true)"
[ "$WORKER_LOCK" = 423 ] || { echo 'PARADO: worker nao recusou execucao bloqueada.' >&2; exit 1; }
BROKER_LOCK="$(curl -sS -o /tmp/lia-v2-broker-lock.json -w '%{http_code}' -X POST http://127.0.0.1:8791/v1/responses -H 'Authorization: Bearer invalido' -H 'Content-Type: application/json' --data '{}' || true)"
[ "$BROKER_LOCK" = 423 ] || { echo 'PARADO: broker nao recusou execucao bloqueada.' >&2; exit 1; }
rm -f /tmp/lia-v2-worker-lock.json /tmp/lia-v2-broker-lock.json

rolled_back=1
trap 'rm -rf "$TMPDIR"' EXIT

echo
echo '=== LIA EXECUTION V2 INSTALADA ==='
echo 'Model Router: PRONTO'
echo 'Budget Lease assinado: PRONTO'
echo 'Codex Worker via broker: PRONTO'
echo 'Modelos: Luna, GPT-5.4 mini, GPT-5.3-Codex, Terra, Sol e Astra'
echo 'Astra: exige aprovacao humana explicita na autorizacao da tarefa'
echo 'Gateway: EXECUCAO BLOQUEADA'
echo 'Worker: EXECUCAO BLOQUEADA'
echo 'Broker/OpenAI: EXECUCAO BLOQUEADA'
echo 'Chamadas pagas realizadas por esta instalacao: ZERO'
echo "Backup: $BACKUP"
echo 'Proxima etapa: habilitar somente o piloto e executar uma tarefa isolada com teto pequeno.'
