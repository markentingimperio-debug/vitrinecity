#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[ "$(id -u)" -eq 0 ] || { echo 'PARADO: execute como root.' >&2; exit 1; }

for cmd in systemctl grep install cp sudo sed; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "PARADO: comando ausente: $cmd" >&2; exit 1; }
done

GENV=/etc/lia-dev-gateway.env
WENV=/etc/lia-codex-worker.env
BENV=/etc/lia-openai-broker.env
SERVICE=lia-codex-worker.service
DROPIN_DIR=/etc/systemd/system/lia-codex-worker.service.d
DROPIN=$DROPIN_DIR/30-netlink-sandbox.conf
BACKUP="/var/backups/lia-worker-netlink-v6-$(date -u +%Y%m%dT%H%M%SZ)"

for f in "$GENV" "$WENV" "$BENV"; do
  [ -f "$f" ] || { echo "PARADO: ambiente ausente: $f" >&2; exit 1; }
done

grep -q '^LIA_GATEWAY_EXECUTION_ENABLED=0$' "$GENV" || { echo 'PARADO: gateway nao esta bloqueado.' >&2; exit 1; }
grep -q '^LIA_CODEX_EXECUTION_ENABLED=0$' "$WENV" || { echo 'PARADO: worker nao esta bloqueado.' >&2; exit 1; }
grep -q '^LIA_BROKER_EXECUTION_ENABLED=0$' "$BENV" || { echo 'PARADO: broker nao esta bloqueado.' >&2; exit 1; }

UNIT="$(systemctl cat "$SERVICE" --no-pager)"
printf '%s\n' "$UNIT" | grep -q 'RestrictAddressFamilies=.*AF_UNIX'   || { echo 'PARADO: protecao RestrictAddressFamilies esperada nao foi encontrada no Worker.' >&2; exit 1; }

mkdir -p "$BACKUP"
chmod 0700 "$BACKUP"
if [ -f "$DROPIN" ]; then
  cp -a "$DROPIN" "$BACKUP/30-netlink-sandbox.conf"
  printf 'existing\n' >"$BACKUP/dropin-state"
else
  printf 'absent\n' >"$BACKUP/dropin-state"
fi

rollback(){
  set +e
  if grep -q '^existing$' "$BACKUP/dropin-state" 2>/dev/null; then
    install -d -m 0755 "$DROPIN_DIR"
    cp -a "$BACKUP/30-netlink-sandbox.conf" "$DROPIN"
  else
    rm -f "$DROPIN"
  fi
  systemctl daemon-reload >/dev/null 2>&1 || true
  systemctl restart "$SERVICE" >/dev/null 2>&1 || true
}
trap 'rc=$?; if [ $rc -ne 0 ]; then rollback; fi; exit $rc' EXIT

install -d -m 0755 "$DROPIN_DIR"
cat >"$DROPIN" <<'DROPIN'
[Service]
RestrictAddressFamilies=
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK
DROPIN
chmod 0644 "$DROPIN"
chown root:root "$DROPIN"

systemctl daemon-reload
systemctl restart "$SERVICE"

for _ in $(seq 1 30); do
  HEALTH="$(curl -fsS http://127.0.0.1:8790/health 2>/dev/null || true)"
  if printf '%s' "$HEALTH" | grep -q '"executionEnabled":false'; then break; fi
  sleep 1
done
printf '%s' "$HEALTH" | grep -q '"executionEnabled":false'   || { echo 'PARADO: Worker nao voltou bloqueado e saudavel.' >&2; exit 1; }

AF="$(systemctl show "$SERVICE" -p RestrictAddressFamilies --value)"
printf '%s' "$AF" | grep -qw 'AF_NETLINK'   || { echo "PARADO: AF_NETLINK nao ficou ativo no Worker: $AF" >&2; exit 1; }

# Probe sem API paga: roda uma operacao NETLINK_ROUTE com as mesmas familias permitidas.
PROBE_JS="$(mktemp /tmp/lia-netlink-probe.XXXXXX.js)"
trap 'rm -f "$PROBE_JS"' RETURN
cat >"$PROBE_JS" <<'NODE'
const { spawnSync } = require('node:child_process');
const candidates=['/usr/bin/bwrap','/bin/bwrap'];
const fs=require('node:fs');
const bwrap=candidates.find(p=>fs.existsSync(p));
if(!bwrap){ console.log('BWRAP_NOT_IN_STANDARD_PATH'); process.exit(0); }
const r=spawnSync(bwrap,['--unshare-net','--ro-bind','/','/','--proc','/proc','--dev','/dev','/bin/true'],{encoding:'utf8'});
if(r.status!==0){
  process.stderr.write((r.stderr||r.stdout||'bwrap probe failed').slice(0,2000));
  process.exit(r.status||1);
}
console.log('BWRAP_NETLINK_PROBE_OK');
NODE

NODE_BIN="$(sudo -u lia -H bash -c 'export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24 >/dev/null; command -v node')"
[ -x "$NODE_BIN" ] || { echo 'PARADO: Node da LIA nao encontrado.' >&2; exit 1; }

set +e
PROBE_OUT="$(systemd-run --quiet --wait --collect --pipe   -p User=lia   -p Group=lia   -p NoNewPrivileges=yes   -p PrivateTmp=yes   -p PrivateDevices=yes   -p ProtectSystem=strict   -p ProtectHome=read-only   -p RestrictSUIDSGID=yes   -p LockPersonality=yes   -p 'RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK'   -p "ReadOnlyPaths=$PROBE_JS"   "$NODE_BIN" "$PROBE_JS" 2>&1)"
PROBE_RC=$?
set -e
rm -f "$PROBE_JS"

if [ "$PROBE_RC" -ne 0 ]; then
  echo 'PARADO: probe local do sandbox falhou:' >&2
  printf '%s\n' "$PROBE_OUT" >&2
  exit 1
fi

GH="$(curl -fsS http://127.0.0.1:8787/health)"
BH="$(curl -fsS http://127.0.0.1:8791/health)"
printf '%s' "$GH" | grep -q '"executionEnabled":false' || { echo 'PARADO: Gateway nao esta bloqueado.' >&2; exit 1; }
printf '%s' "$BH" | grep -q '"executionEnabled":false' || { echo 'PARADO: Broker nao esta bloqueado.' >&2; exit 1; }

trap - EXIT

echo
echo '=== LIA WORKER SANDBOX V6 INSTALADO ==='
echo 'AF_NETLINK: PERMITIDO somente no Worker'
echo 'AF_UNIX/AF_INET/AF_INET6: preservados'
echo 'Codex networkAccessEnabled: continua FALSE'
echo 'Web Search: continua DESATIVADO'
echo 'Gateway: BLOQUEADO'
echo 'Worker: BLOQUEADO'
echo 'Broker: BLOQUEADO'
echo 'Chamadas OpenAI realizadas: ZERO'
echo "Probe local: $PROBE_OUT"
echo "Backup: $BACKUP"
echo
echo "RestrictAddressFamilies: $AF"
echo "Worker health: $HEALTH"
