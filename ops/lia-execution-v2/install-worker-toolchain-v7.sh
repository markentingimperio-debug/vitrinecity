#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[ "$(id -u)" -eq 0 ] || { echo 'PARADO: execute como root.' >&2; exit 1; }

for cmd in systemctl sudo sed grep cp tr dirname curl; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "PARADO: comando ausente: $cmd" >&2; exit 1; }
done

GENV=/etc/lia-dev-gateway.env
WENV=/etc/lia-codex-worker.env
BENV=/etc/lia-openai-broker.env
SERVICE=lia-codex-worker.service
BACKUP="/var/backups/lia-worker-toolchain-v7-$(date -u +%Y%m%dT%H%M%SZ)"

for f in "$GENV" "$WENV" "$BENV"; do
  [ -f "$f" ] || { echo "PARADO: ambiente ausente: $f" >&2; exit 1; }
done

grep -q '^LIA_GATEWAY_EXECUTION_ENABLED=0$' "$GENV" || { echo 'PARADO: gateway nao esta bloqueado.' >&2; exit 1; }
grep -q '^LIA_CODEX_EXECUTION_ENABLED=0$' "$WENV" || { echo 'PARADO: worker nao esta bloqueado.' >&2; exit 1; }
grep -q '^LIA_BROKER_EXECUTION_ENABLED=0$' "$BENV" || { echo 'PARADO: broker nao esta bloqueado.' >&2; exit 1; }

NODE_BIN="$(sudo -u lia -H bash -c 'cd /; export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24 >/dev/null; command -v node')"
[ -x "$NODE_BIN" ] || { echo 'PARADO: Node 24 da LIA nao encontrado.' >&2; exit 1; }
NODE_DIR="$(dirname "$NODE_BIN")"
[ -x "$NODE_DIR/node" ] || { echo 'PARADO: node ausente no diretório runtime.' >&2; exit 1; }

TOOL_PATH="$NODE_DIR:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

mkdir -p "$BACKUP"
chmod 0700 "$BACKUP"
cp -a "$WENV" "$BACKUP/lia-codex-worker.env"

rollback(){
  set +e
  cp -a "$BACKUP/lia-codex-worker.env" "$WENV"
  systemctl restart "$SERVICE" >/dev/null 2>&1 || true
}
trap 'rc=$?; if [ $rc -ne 0 ]; then rollback; fi; exit $rc' EXIT

if grep -q '^PATH=' "$WENV"; then
  sed -i "s|^PATH=.*|PATH=$TOOL_PATH|" "$WENV"
else
  printf 'PATH=%s\n' "$TOOL_PATH" >>"$WENV"
fi
chmod 0600 "$WENV"
chown root:root "$WENV"

systemctl restart "$SERVICE"

HEALTH=''
for _ in $(seq 1 30); do
  HEALTH="$(curl -fsS http://127.0.0.1:8790/health 2>/dev/null || true)"
  if printf '%s' "$HEALTH" | grep -q '"executionEnabled":false'; then break; fi
  sleep 1
done
printf '%s' "$HEALTH" | grep -q '"executionEnabled":false'   || { echo 'PARADO: Worker nao voltou bloqueado e saudavel.' >&2; exit 1; }

PID="$(systemctl show "$SERVICE" -p MainPID --value)"
[ "$PID" -gt 1 ] 2>/dev/null || { echo 'PARADO: PID do Worker invalido.' >&2; exit 1; }

PROC_PATH="$(tr '\0' '\n' <"/proc/$PID/environ" | sed -n 's/^PATH=//p' | head -n1)"
case ":$PROC_PATH:" in
  *":$NODE_DIR:"*) ;;
  *) echo 'PARADO: processo Worker nao recebeu o PATH do Node.' >&2; exit 1 ;;
esac

PROBE="$(sudo -u lia -H env PATH="$TOOL_PATH" /bin/sh -c 'cd /opt/lia/workspaces/vitrinecity-dev && command -v node && node --version')"
printf '%s' "$PROBE" | grep -q "$NODE_DIR/node" || { echo 'PARADO: node nao foi encontrado pelo PATH de ferramentas.' >&2; exit 1; }
printf '%s' "$PROBE" | grep -Eq 'v24\.' || { echo 'PARADO: Node 24 nao foi confirmado.' >&2; exit 1; }

GH="$(curl -fsS http://127.0.0.1:8787/health)"
BH="$(curl -fsS http://127.0.0.1:8791/health)"
printf '%s' "$GH" | grep -q '"executionEnabled":false' || { echo 'PARADO: Gateway nao esta bloqueado.' >&2; exit 1; }
printf '%s' "$BH" | grep -q '"executionEnabled":false' || { echo 'PARADO: Broker nao esta bloqueado.' >&2; exit 1; }

trap - EXIT

echo
echo '=== LIA WORKER TOOLCHAIN V7 INSTALADO ==='
echo 'Node 24 no PATH do Worker: SIM'
echo 'Node disponivel para o shell do Codex: PREPARADO'
echo 'AF_NETLINK: preservado'
echo 'Codex networkAccessEnabled: continua FALSE'
echo 'Web Search: continua DESATIVADO'
echo 'Gateway: BLOQUEADO'
echo 'Worker: BLOQUEADO'
echo 'Broker: BLOQUEADO'
echo 'Chamadas OpenAI realizadas: ZERO'
echo "Node: $("$NODE_DIR/node" --version)"
echo "Backup: $BACKUP"
echo "Worker health: $HEALTH"
