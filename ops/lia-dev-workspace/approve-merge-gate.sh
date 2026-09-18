#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[ "$(id -u)" -eq 0 ] || { echo 'PARADO: execute como root.' >&2; exit 1; }
[ "$#" -eq 2 ] || { echo 'Uso: approve-merge-gate.sh <pr-number> APROVAR_MERGE' >&2; exit 2; }

PR="$1"
CONFIRM="$2"
[ "$CONFIRM" = 'APROVAR_MERGE' ] || { echo 'PARADO: confirmacao deve ser exatamente APROVAR_MERGE.' >&2; exit 1; }
[[ "$PR" =~ ^[0-9]+$ ]] || { echo 'PARADO: numero do PR invalido.' >&2; exit 1; }

for cmd in curl jq sha256sum grep git sudo; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "PARADO: comando ausente: $cmd" >&2; exit 1; }
done

REPO='markentingimperio-debug/vitrinecity'
EXPECTED_PR=207
EXPECTED_HEAD='04da947679dc2e7d0ea1985bed541fa180993e30'
EXPECTED_BASE='708c2bb294d4dabc08878e32e72b7b5f0af8f037'
LOCAL_COMMIT='310e107cbc98da5a48f7df68ce5312867072244d'
EXPECTED_BRANCH='lia/review-310e107-web-story-cta'
EXPECTED_FILE='app/scripts/test-web-story-cta.mjs'
WORKSPACE=/opt/lia/workspaces/vitrinecity-dev
REVIEW_DIR="/opt/lia/reviews/$LOCAL_COMMIT"
PR_APPROVAL="/opt/lia/approvals/$LOCAL_COMMIT.json"
MERGE_DIR=/opt/lia/merge-approvals
MERGE_APPROVAL="$MERGE_DIR/pr-$PR.json"

[ "$PR" -eq "$EXPECTED_PR" ] || { echo "PARADO: este gate foi criado para o PR #$EXPECTED_PR." >&2; exit 1; }
[ -f "$PR_APPROVAL" ] || { echo 'PARADO: aprovacao humana de publicacao do PR ausente.' >&2; exit 1; }
[ -d "$REVIEW_DIR" ] || { echo 'PARADO: review pack ausente.' >&2; exit 1; }
[ ! -e "$MERGE_APPROVAL" ] || { echo "PARADO: merge ja possui aprovacao registrada: $MERGE_APPROVAL" >&2; exit 1; }

(
  cd "$REVIEW_DIR"
  sha256sum -c SHA256SUMS >/dev/null
) || { echo 'PARADO: integridade do review pack falhou.' >&2; exit 1; }

jq -e   --arg commit "$LOCAL_COMMIT"   '.commit==$commit
   and .decision=="approved_for_pr_publication_only"
   and .mergeApproved==false
   and .productionDeployApproved==false'   "$PR_APPROVAL" >/dev/null   || { echo 'PARADO: aprovacao anterior nao atende a politica.' >&2; exit 1; }

PR_JSON="$(curl -fsSL --proto '=https' --proto-redir '=https'   -H 'Accept: application/vnd.github+json'   "https://api.github.com/repos/$REPO/pulls/$PR")"

printf '%s' "$PR_JSON" | jq -e   --arg head "$EXPECTED_HEAD"   --arg base "$EXPECTED_BASE"   --arg branch "$EXPECTED_BRANCH"   '.state=="open"
   and .draft==true
   and .merged==false
   and .head.sha==$head
   and .head.ref==$branch
   and .base.ref=="main"
   and .base.sha==$base
   and .changed_files==1
   and .commits==1' >/dev/null   || { echo 'PARADO: PR mudou desde a aprovacao ou nao esta no estado esperado.' >&2; exit 1; }

FILES_JSON="$(curl -fsSL --proto '=https' --proto-redir '=https'   -H 'Accept: application/vnd.github+json'   "https://api.github.com/repos/$REPO/pulls/$PR/files?per_page=100")"

[ "$(printf '%s' "$FILES_JSON" | jq 'length')" -eq 1 ]   || { echo 'PARADO: PR nao possui exatamente um arquivo.' >&2; exit 1; }
printf '%s' "$FILES_JSON" | jq -e --arg f "$EXPECTED_FILE" '.[0].filename==$f and .[0].status=="added"' >/dev/null   || { echo 'PARADO: arquivo do PR difere do review aprovado.' >&2; exit 1; }

RUNS="$(curl -fsSL --proto '=https' --proto-redir '=https'   -H 'Accept: application/vnd.github+json'   "https://api.github.com/repos/$REPO/actions/runs?head_sha=$EXPECTED_HEAD&event=pull_request&per_page=100")"

check_success(){
  local name="$1"
  printf '%s' "$RUNS" | jq -e --arg name "$name"     '[.workflow_runs[] | select(.name==$name)] | length>0
     and all(.[]; .status=="completed" and .conclusion=="success")' >/dev/null
}

check_success 'Security audit' || { echo 'PARADO: Security audit ainda nao esta verde.' >&2; exit 1; }
check_success 'Verify release' || { echo 'PARADO: Verify release ainda nao esta verde.' >&2; exit 1; }

HEAD_LOCAL="$(sudo -u lia -H git -C "$WORKSPACE" rev-parse HEAD)"
STATUS_LOCAL="$(sudo -u lia -H git -C "$WORKSPACE" status --porcelain --untracked-files=all)"
[ "$HEAD_LOCAL" = "$LOCAL_COMMIT" ] || { echo 'PARADO: workspace local nao esta no commit aprovado.' >&2; exit 1; }
[ -z "$STATUS_LOCAL" ] || { echo 'PARADO: workspace local nao esta limpo.' >&2; exit 1; }

install -d -o root -g root -m 0750 "$MERGE_DIR"
jq -n   --argjson pr "$PR"   --arg head "$EXPECTED_HEAD"   --arg localCommit "$LOCAL_COMMIT"   --arg approvedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)"   '{
    schema:1,
    pr:$pr,
    headSha:$head,
    localCommit:$localCommit,
    decision:"approved_for_merge_only",
    checks:{
      securityAudit:"success",
      verifyRelease:"success"
    },
    mergeApproved:true,
    productionDeployApproved:false,
    approvedAt:$approvedAt
  }' >"$MERGE_APPROVAL"
chmod 0440 "$MERGE_APPROVAL"
chown root:root "$MERGE_APPROVAL"

echo
echo '=== MERGE GATE DA LIA APROVADO ==='
echo "PR: #$PR"
echo "Head SHA: $EXPECTED_HEAD"
echo 'Security audit: PASSOU'
echo 'Verify release: PASSOU'
echo "Registro: $MERGE_APPROVAL"
echo 'Merge: APROVADO'
echo 'Deploy de producao: NAO APROVADO'
echo 'Worker Git push: continua BLOQUEADO'
echo 'Chamadas OpenAI realizadas: ZERO'
