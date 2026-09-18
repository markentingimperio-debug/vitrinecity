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
TARGET=/opt/lia/bin/lia-merge-approve
EXPECTED_HEAD='bc1d6a99809dbe781d9e88cc8cba42ec92494672'
REV='0494961fcf0f50a83292aa1d2e800d877204928f'
URL="https://raw.githubusercontent.com/markentingimperio-debug/vitrinecity/$REV/ops/lia-dev-workspace/approve-merge-gate-generic.sh"
BACKUP="/var/backups/lia-generic-merge-gate-v1-$(date -u +%Y%m%dT%H%M%SZ)"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

for f in "$GENV" "$WENV" "$BENV" "$POLICY"; do
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

grep -q 'Uso: lia-merge-approve <pr-number> <local-commit> APROVAR_MERGE' "$TMP" || { echo 'PARADO: interface do gate generico ausente.' >&2; exit 1; }
grep -q 'refs/pull/\$PR/head' "$TMP" || { echo 'PARADO: fetch do head do PR ausente.' >&2; exit 1; }
grep -q 'LOCAL_TREE' "$TMP" || { echo 'PARADO: comparacao de tree SHA ausente.' >&2; exit 1; }
grep -q 'Security audit' "$TMP" || { echo 'PARADO: Security audit ausente.' >&2; exit 1; }
grep -q 'Verify release' "$TMP" || { echo 'PARADO: Verify release ausente.' >&2; exit 1; }
grep -q 'productionDeployApproved:false' "$TMP" || { echo 'PARADO: deploy gate ausente.' >&2; exit 1; }
grep -q 'Git push do Worker: continua BLOQUEADO' "$TMP" || { echo 'PARADO: push guard ausente.' >&2; exit 1; }

mkdir -p "$BACKUP"
chmod 0700 "$BACKUP"
[ ! -e "$TARGET" ] || cp -a "$TARGET" "$BACKUP/lia-merge-approve"
install -d -o root -g root -m 0750 /opt/lia/bin /opt/lia/merge-approvals
install -o root -g root -m 0750 "$TMP" "$TARGET"
bash -n "$TARGET"

trap - EXIT
rm -f "$TMP"

echo
echo '=== MERGE GATE GENERICO LIA V1 INSTALADO ==='
echo "Binario: $TARGET"
echo 'Compara PR x commit local por tree SHA: ATIVO'
echo 'Security audit obrigatorio: ATIVO'
echo 'Verify release obrigatorio: ATIVO'
echo 'Aprovacao humana APROVAR_MERGE: OBRIGATORIA'
echo 'Deploy de producao: BLOQUEADO'
echo 'Git push do Worker: BLOQUEADO'
echo 'Chamadas OpenAI realizadas nesta instalacao: ZERO'
echo "Backup: $BACKUP"
