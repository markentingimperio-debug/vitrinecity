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
POLICY=/opt/lia/policies/vitrinecity-dev.json
WORKSPACE=/opt/lia/workspaces/vitrinecity-dev
RUNNER=/opt/lia/bin/lia-task-run
EXPECTED_BASE='cd48fc7acdab17a5751d9543fa8746b31fbcf091'
REV='d093c18deafe1e5f90455597f7384d50ebbbd412'
URL="https://raw.githubusercontent.com/markentingimperio-debug/vitrinecity/$REV/ops/lia-dev-workspace/lia-task-run.sh"
BACKUP="/var/backups/lia-generic-runner-v1-3-$(date -u +%Y%m%dT%H%M%SZ)"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

for f in "$GENV" "$WENV" "$BENV" "$POLICY" "$RUNNER"; do
  [ -f "$f" ] || { echo "PARADO: arquivo ausente: $f" >&2; exit 1; }
done

grep -q '^LIA_GATEWAY_EXECUTION_ENABLED=0$' "$GENV" || { echo 'PARADO: gateway nao esta bloqueado.' >&2; exit 1; }
grep -q '^LIA_CODEX_EXECUTION_ENABLED=0$' "$WENV" || { echo 'PARADO: worker nao esta bloqueado.' >&2; exit 1; }
grep -q '^LIA_BROKER_EXECUTION_ENABLED=0$' "$BENV" || { echo 'PARADO: broker nao esta bloqueado.' >&2; exit 1; }

[ "$(jq -r '.baseCommit' "$POLICY")" = "$EXPECTED_BASE" ] || { echo 'PARADO: policy baseCommit mudou.' >&2; exit 1; }
[ "$(sudo -u lia -H git -C "$WORKSPACE" rev-parse HEAD)" = "$EXPECTED_BASE" ] || { echo 'PARADO: workspace HEAD mudou.' >&2; exit 1; }

curl --fail --location --silent --show-error --proto '=https' --proto-redir '=https' "$URL" -o "$TMP"
bash -n "$TMP"

grep -q 'mapfile -d .*MODIFIED_FILES.*sudo -u lia -H git -C' "$TMP" || { echo 'PARADO: deteccao de modificados como lia ausente.' >&2; exit 1; }
grep -q 'mapfile -d .*UNTRACKED_FILES.*sudo -u lia -H git -C' "$TMP" || { echo 'PARADO: deteccao de untracked como lia ausente.' >&2; exit 1; }
grep -q 'mapfile -d .*MODIFIED_AFTER_TEST.*sudo -u lia -H git -C' "$TMP" || { echo 'PARADO: deteccao pos-teste como lia ausente.' >&2; exit 1; }
grep -q 'rollback_workspace' "$TMP" || { echo 'PARADO: rollback ausente.' >&2; exit 1; }
grep -q '=== MANIFESTO LIA VALIDADO ===' "$TMP" || { echo 'PARADO: validate-only ausente.' >&2; exit 1; }

mkdir -p "$BACKUP"
chmod 0700 "$BACKUP"
cp -a "$RUNNER" "$BACKUP/lia-task-run"
install -o root -g root -m 0750 "$TMP" "$RUNNER"
bash -n "$RUNNER"

trap - EXIT
rm -f "$TMP"

echo
echo '=== EXECUTOR GENERICO LIA V1.3 ATUALIZADO ==='
echo 'Deteccao Git: executada como usuario lia'
echo 'Modo --validate sem custo: ATIVO'
echo 'Rollback automatico em falha: ATIVO'
echo 'Git push do Worker: BLOQUEADO'
echo 'Deploy de producao: BLOQUEADO'
echo 'Chamadas OpenAI realizadas nesta atualizacao: ZERO'
echo "Backup: $BACKUP"
