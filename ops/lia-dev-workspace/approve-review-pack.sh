#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[ "$(id -u)" -eq 0 ] || { echo 'PARADO: execute como root.' >&2; exit 1; }
[ "$#" -eq 2 ] || { echo 'Uso: approve-review-pack.sh <commit> APROVAR_PR' >&2; exit 2; }

COMMIT="$1"
CONFIRM="$2"
[ "$CONFIRM" = 'APROVAR_PR' ] || { echo 'PARADO: confirmacao deve ser exatamente APROVAR_PR.' >&2; exit 1; }
[[ "$COMMIT" =~ ^[0-9a-f]{40}$ ]] || { echo 'PARADO: commit invalido.' >&2; exit 1; }

for cmd in git sudo grep sha256sum jq curl; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "PARADO: comando ausente: $cmd" >&2; exit 1; }
done

GENV=/etc/lia-dev-gateway.env
WENV=/etc/lia-codex-worker.env
BENV=/etc/lia-openai-broker.env
WORKSPACE=/opt/lia/workspaces/vitrinecity-dev
REVIEW_DIR="/opt/lia/reviews/$COMMIT"
APPROVALS=/opt/lia/approvals
APPROVAL="$APPROVALS/$COMMIT.json"

[ -d "$REVIEW_DIR" ] || { echo "PARADO: review pack ausente: $REVIEW_DIR" >&2; exit 1; }
[ -f "$REVIEW_DIR/SHA256SUMS" ] || { echo 'PARADO: checksums ausentes.' >&2; exit 1; }
[ ! -e "$APPROVAL" ] || { echo "PARADO: commit ja aprovado: $APPROVAL" >&2; exit 1; }

grep -q '^LIA_GATEWAY_EXECUTION_ENABLED=0$' "$GENV" || { echo 'PARADO: gateway nao esta bloqueado.' >&2; exit 1; }
grep -q '^LIA_CODEX_EXECUTION_ENABLED=0$' "$WENV" || { echo 'PARADO: worker nao esta bloqueado.' >&2; exit 1; }
grep -q '^LIA_BROKER_EXECUTION_ENABLED=0$' "$BENV" || { echo 'PARADO: broker nao esta bloqueado.' >&2; exit 1; }

HEAD="$(sudo -u lia -H git -C "$WORKSPACE" rev-parse HEAD)"
STATUS="$(sudo -u lia -H git -C "$WORKSPACE" status --porcelain --untracked-files=all)"
PUSH_URL="$(sudo -u lia -H git -C "$WORKSPACE" remote get-url --push origin)"
[ "$HEAD" = "$COMMIT" ] || { echo "PARADO: HEAD atual $HEAD difere do review $COMMIT." >&2; exit 1; }
[ -z "$STATUS" ] || { echo 'PARADO: workspace nao esta limpo.' >&2; exit 1; }
[ "$PUSH_URL" = 'blocked://lia-no-push' ] || { echo 'PARADO: push nao esta bloqueado.' >&2; exit 1; }

(
  cd "$REVIEW_DIR"
  sha256sum -c SHA256SUMS >/dev/null
) || { echo 'PARADO: integridade do review pack falhou.' >&2; exit 1; }

jq -e   --arg commit "$COMMIT"   '.headCommit==$commit and .tests.status=="passed" and .gitPush==false and .productionDeploy==false and .humanApprovalRequired==true'   "$REVIEW_DIR/metadata.json" >/dev/null   || { echo 'PARADO: metadata do review nao atende a politica.' >&2; exit 1; }

install -d -o root -g root -m 0750 "$APPROVALS"
jq -n   --arg commit "$COMMIT"   --arg reviewDir "$REVIEW_DIR"   --arg approvedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)"   '{
    schema:1,
    commit:$commit,
    reviewDir:$reviewDir,
    decision:"approved_for_pr_publication_only",
    mergeApproved:false,
    productionDeployApproved:false,
    approvedAt:$approvedAt
  }' >"$APPROVAL"
chmod 0440 "$APPROVAL"
chown root:root "$APPROVAL"

echo
echo '=== REVIEW DA LIA APROVADO PARA PR ==='
echo "Commit: $COMMIT"
echo "Registro: $APPROVAL"
echo 'Permissao concedida: PUBLICAR BRANCH/ABRIR PR'
echo 'Merge: NAO APROVADO'
echo 'Deploy de producao: NAO APROVADO'
echo 'Git push do Worker: continua BLOQUEADO'
echo 'Chamadas OpenAI realizadas: ZERO'
