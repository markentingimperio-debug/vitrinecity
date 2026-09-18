#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[ "$(id -u)" -eq 0 ] || { echo 'PARADO: execute como root.' >&2; exit 1; }

for cmd in curl bash install cp grep jq git sudo; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "PARADO: comando ausente: $cmd" >&2; exit 1; }
done

GENV=/etc/lia-dev-gateway.env
WENV=/etc/lia-codex-worker.env
BENV=/etc/lia-openai-broker.env
WORKSPACE=/opt/lia/workspaces/vitrinecity-dev
TARGET=/opt/lia/bin/lia-sync-main
EXPECTED_HEAD='bc1d6a99809dbe781d9e88cc8cba42ec92494672'
REV='6901b6d2e84908840370b9eb4dfaf43317435ee7'
URL="https://raw.githubusercontent.com/markentingimperio-debug/vitrinecity/$REV/ops/lia-dev-workspace/sync-main-generic.sh"
BACKUP="/var/backups/lia-generic-sync-main-v1-$(date -u +%Y%m%dT%H%M%SZ)"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

for f in "$GENV" "$WENV" "$BENV"; do
  [ -f "$f" ] || { echo "PARADO: arquivo ausente: $f" >&2; exit 1; }
done
[ -d "$WORKSPACE/.git" ] || { echo 'PARADO: workspace ausente.' >&2; exit 1; }

grep -q '^LIA_GATEWAY_EXECUTION_ENABLED=0$' "$GENV" || { echo 'PARADO: gateway nao esta bloqueado.' >&2; exit 1; }
grep -q '^LIA_CODEX_EXECUTION_ENABLED=0$' "$WENV" || { echo 'PARADO: worker nao esta bloqueado.' >&2; exit 1; }
grep -q '^LIA_BROKER_EXECUTION_ENABLED=0$' "$BENV" || { echo 'PARADO: broker nao esta bloqueado.' >&2; exit 1; }

HEAD="$(sudo -u lia -H git -C "$WORKSPACE" rev-parse HEAD)"
STATUS="$(sudo -u lia -H git -C "$WORKSPACE" status --porcelain --untracked-files=all)"
PUSH_URL="$(sudo -u lia -H git -C "$WORKSPACE" remote get-url --push origin)"

[ "$HEAD" = "$EXPECTED_HEAD" ] || { echo "PARADO: workspace HEAD inesperado: $HEAD" >&2; exit 1; }
[ -z "$STATUS" ] || { echo 'PARADO: workspace nao esta limpo.' >&2; exit 1; }
[ "$PUSH_URL" = 'blocked://lia-no-push' ] || { echo 'PARADO: push do Worker nao esta bloqueado.' >&2; exit 1; }

curl --fail --location --silent --show-error --proto '=https' --proto-redir '=https' "$URL" -o "$TMP"
bash -n "$TMP"

grep -q 'Uso: lia-sync-main <pr-number> <merge-commit-sha>' "$TMP" || { echo 'PARADO: interface generica ausente.' >&2; exit 1; }
grep -q 'approved_for_merge_only' "$TMP" || { echo 'PARADO: verificacao do merge gate ausente.' >&2; exit 1; }
grep -q 'origin/main' "$TMP" || { echo 'PARADO: verificacao de origin/main ausente.' >&2; exit 1; }
grep -q 'reset --hard "$MERGE_COMMIT"' "$TMP" || { echo 'PARADO: reset generico ausente.' >&2; exit 1; }
grep -q '.baseCommit=$base' "$TMP" || { echo 'PARADO: atualizacao da policy ausente.' >&2; exit 1; }
grep -q 'Git push: BLOQUEADO' "$TMP" || { echo 'PARADO: push guard ausente.' >&2; exit 1; }

mkdir -p "$BACKUP"
chmod 0700 "$BACKUP"
[ ! -e "$TARGET" ] || cp -a "$TARGET" "$BACKUP/lia-sync-main"
install -d -o root -g root -m 0750 /opt/lia/bin
install -o root -g root -m 0750 "$TMP" "$TARGET"
bash -n "$TARGET"

trap - EXIT
rm -f "$TMP"

echo
echo '=== SINCRONIZADOR GENERICO LIA V1 INSTALADO ==='
echo "Binario: $TARGET"
echo 'Valida merge approval antes de sincronizar: ATIVO'
echo 'Valida origin/main contra merge commit: ATIVO'
echo 'Atualiza policy baseCommit: ATIVO'
echo 'Git push do Worker: BLOQUEADO'
echo 'Deploy de producao: BLOQUEADO'
echo 'Chamadas OpenAI realizadas nesta instalacao: ZERO'
echo "Backup: $BACKUP"
