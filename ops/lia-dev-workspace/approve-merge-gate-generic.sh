#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[ "$(id -u)" -eq 0 ] || { echo 'PARADO: execute como root.' >&2; exit 1; }
[ "$#" -eq 3 ] || { echo 'Uso: lia-merge-approve <pr-number> <local-commit> APROVAR_MERGE' >&2; exit 2; }

PR="$1"
LOCAL_COMMIT="$2"
CONFIRM="$3"

[[ "$PR" =~ ^[0-9]+$ ]] || { echo 'PARADO: numero do PR invalido.' >&2; exit 1; }
[[ "$LOCAL_COMMIT" =~ ^[0-9a-f]{40}$ ]] || { echo 'PARADO: commit local invalido.' >&2; exit 1; }
[ "$CONFIRM" = 'APROVAR_MERGE' ] || { echo 'PARADO: confirmacao deve ser exatamente APROVAR_MERGE.' >&2; exit 1; }

for cmd in curl jq sha256sum grep git sudo sort diff install mktemp sed wc; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "PARADO: comando ausente: $cmd" >&2; exit 1; }
done

REPO='markentingimperio-debug/vitrinecity'
WORKSPACE=/opt/lia/workspaces/vitrinecity-dev
POLICY=/opt/lia/policies/vitrinecity-dev.json
GENV=/etc/lia-dev-gateway.env
WENV=/etc/lia-codex-worker.env
BENV=/etc/lia-openai-broker.env
REVIEW_DIR="/opt/lia/reviews/$LOCAL_COMMIT"
PR_APPROVAL="/opt/lia/approvals/$LOCAL_COMMIT.json"
MERGE_DIR=/opt/lia/merge-approvals
MERGE_APPROVAL="$MERGE_DIR/pr-$PR.json"
TMP_DIR="$(mktemp -d /tmp/lia-merge-gate.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

for f in "$GENV" "$WENV" "$BENV" "$POLICY" "$PR_APPROVAL" "$REVIEW_DIR/metadata.json" "$REVIEW_DIR/SHA256SUMS"; do
  [ -f "$f" ] || { echo "PARADO: arquivo ausente: $f" >&2; exit 1; }
done
[ -d "$WORKSPACE/.git" ] || { echo 'PARADO: workspace ausente.' >&2; exit 1; }
[ ! -e "$MERGE_APPROVAL" ] || { echo "PARADO: PR ja possui aprovacao de merge: $MERGE_APPROVAL" >&2; exit 1; }

grep -q '^LIA_GATEWAY_EXECUTION_ENABLED=0$' "$GENV" || { echo 'PARADO: gateway nao esta bloqueado.' >&2; exit 1; }
grep -q '^LIA_CODEX_EXECUTION_ENABLED=0$' "$WENV" || { echo 'PARADO: worker nao esta bloqueado.' >&2; exit 1; }
grep -q '^LIA_BROKER_EXECUTION_ENABLED=0$' "$BENV" || { echo 'PARADO: broker nao esta bloqueado.' >&2; exit 1; }

(
  cd "$REVIEW_DIR"
  sha256sum -c SHA256SUMS >/dev/null
) || { echo 'PARADO: integridade do Review Pack falhou.' >&2; exit 1; }

jq -e --arg commit "$LOCAL_COMMIT" '
  .headCommit==$commit
  and .repository=="markentingimperio-debug/vitrinecity"
  and .gitPush==false
  and .productionDeploy==false
  and .humanApprovalRequired==true
  and (
    .testStatus=="passed"
    or (((.tests|type)=="object") and .tests.status=="passed")
  )
  and ((.files|type)=="array")
  and (.files|length)>=1
  and (.files|length)<=20
' "$REVIEW_DIR/metadata.json" >/dev/null   || { echo 'PARADO: metadata do Review Pack nao atende a politica.' >&2; exit 1; }

BASE_COMMIT="$(jq -r '.baseCommit' "$REVIEW_DIR/metadata.json")"
TASK_ID="$(jq -r '.taskId // "legacy-task"' "$REVIEW_DIR/metadata.json")"
[[ "$BASE_COMMIT" =~ ^[0-9a-f]{40}$ ]] || { echo 'PARADO: baseCommit do Review Pack invalido.' >&2; exit 1; }

jq -e --arg commit "$LOCAL_COMMIT" '
  .commit==$commit
  and .decision=="approved_for_pr_publication_only"
  and .mergeApproved==false
  and .productionDeployApproved==false
' "$PR_APPROVAL" >/dev/null   || { echo 'PARADO: aprovacao humana anterior nao atende a politica.' >&2; exit 1; }

HEAD_LOCAL="$(sudo -u lia -H git -C "$WORKSPACE" rev-parse HEAD)"
STATUS_LOCAL="$(sudo -u lia -H git -C "$WORKSPACE" status --porcelain --untracked-files=all)"
PUSH_URL="$(sudo -u lia -H git -C "$WORKSPACE" remote get-url --push origin)"
[ "$HEAD_LOCAL" = "$LOCAL_COMMIT" ] || { echo "PARADO: HEAD local $HEAD_LOCAL difere do commit aprovado." >&2; exit 1; }
[ -z "$STATUS_LOCAL" ] || { echo 'PARADO: workspace local nao esta limpo.' >&2; exit 1; }
[ "$PUSH_URL" = 'blocked://lia-no-push' ] || { echo 'PARADO: push do Worker nao esta bloqueado.' >&2; exit 1; }

PR_JSON="$(curl -fsSL --proto '=https' --proto-redir '=https'   -H 'Accept: application/vnd.github+json'   "https://api.github.com/repos/$REPO/pulls/$PR")"

PR_HEAD="$(printf '%s' "$PR_JSON" | jq -r '.head.sha // empty')"
PR_BRANCH="$(printf '%s' "$PR_JSON" | jq -r '.head.ref // empty')"
PR_BASE_SHA="$(printf '%s' "$PR_JSON" | jq -r '.base.sha // empty')"
CHANGED_COUNT="$(printf '%s' "$PR_JSON" | jq -r '.changed_files // -1')"

printf '%s' "$PR_JSON" | jq -e   --arg repo "$REPO"   --arg base "$BASE_COMMIT"   '.state=="open"
   and .draft==true
   and .merged==false
   and .base.ref=="main"
   and .base.sha==$base
   and .head.repo.full_name==$repo
   and (.head.ref|startswith("lia/review-"))' >/dev/null   || { echo 'PARADO: PR nao esta no estado seguro esperado.' >&2; exit 1; }

[[ "$PR_HEAD" =~ ^[0-9a-f]{40}$ ]] || { echo 'PARADO: head SHA do PR invalido.' >&2; exit 1; }
[ "$PR_BASE_SHA" = "$BASE_COMMIT" ] || { echo 'PARADO: base do PR mudou.' >&2; exit 1; }

jq -r '.files[]' "$REVIEW_DIR/metadata.json" | sort -u >"$TMP_DIR/review-files.txt"
REVIEW_COUNT="$(wc -l <"$TMP_DIR/review-files.txt" | tr -d ' ')"
[ "$CHANGED_COUNT" -eq "$REVIEW_COUNT" ] || { echo "PARADO: PR tem $CHANGED_COUNT arquivos; review aprovou $REVIEW_COUNT." >&2; exit 1; }

FILES_JSON="$(curl -fsSL --proto '=https' --proto-redir '=https'   -H 'Accept: application/vnd.github+json'   "https://api.github.com/repos/$REPO/pulls/$PR/files?per_page=100")"
printf '%s' "$FILES_JSON" | jq -r '.[].filename' | sort -u >"$TMP_DIR/pr-files.txt"

diff -u "$TMP_DIR/review-files.txt" "$TMP_DIR/pr-files.txt" >/dev/null   || { echo 'PARADO: arquivos do PR diferem do Review Pack.' >&2; diff -u "$TMP_DIR/review-files.txt" "$TMP_DIR/pr-files.txt" >&2 || true; exit 1; }

# Busca o head publicado sem alterar HEAD local e compara a arvore inteira.
sudo -u lia -H git -C "$WORKSPACE" fetch --quiet --no-tags origin "refs/pull/$PR/head"
FETCHED_HEAD="$(sudo -u lia -H git -C "$WORKSPACE" rev-parse FETCH_HEAD)"
[ "$FETCHED_HEAD" = "$PR_HEAD" ] || { echo 'PARADO: FETCH_HEAD difere do head SHA informado pela API.' >&2; exit 1; }

LOCAL_TREE="$(sudo -u lia -H git -C "$WORKSPACE" rev-parse "$LOCAL_COMMIT^{tree}")"
REMOTE_TREE="$(sudo -u lia -H git -C "$WORKSPACE" rev-parse "$FETCHED_HEAD^{tree}")"
[ "$LOCAL_TREE" = "$REMOTE_TREE" ] || {
  echo 'PARADO: arvore do PR difere do commit local aprovado.' >&2
  sudo -u lia -H git -C "$WORKSPACE" diff --stat "$LOCAL_COMMIT" "$FETCHED_HEAD" >&2 || true
  exit 1
}

RUNS="$(curl -fsSL --proto '=https' --proto-redir '=https'   -H 'Accept: application/vnd.github+json'   "https://api.github.com/repos/$REPO/actions/runs?head_sha=$PR_HEAD&event=pull_request&per_page=100")"

check_success(){
  local name="$1"
  printf '%s' "$RUNS" | jq -e --arg name "$name" '
    [.workflow_runs[] | select(.name==$name)] as $runs
    | ($runs|length)>0
      and all($runs[]; .status=="completed" and .conclusion=="success")
  ' >/dev/null
}

check_success 'Security audit' || { echo 'PARADO: Security audit nao esta verde.' >&2; exit 1; }
check_success 'Verify release' || { echo 'PARADO: Verify release nao esta verde.' >&2; exit 1; }

# Reconsulta o PR imediatamente antes de registrar a aprovacao para reduzir TOCTOU.
PR_FINAL="$(curl -fsSL --proto '=https' --proto-redir '=https'   -H 'Accept: application/vnd.github+json'   "https://api.github.com/repos/$REPO/pulls/$PR")"
printf '%s' "$PR_FINAL" | jq -e   --arg head "$PR_HEAD"   --arg base "$BASE_COMMIT"   '.state=="open" and .draft==true and .merged==false and .head.sha==$head and .base.sha==$base' >/dev/null   || { echo 'PARADO: PR mudou durante a validacao.' >&2; exit 1; }

install -d -o root -g root -m 0750 "$MERGE_DIR"
jq -n   --argjson pr "$PR"   --arg taskId "$TASK_ID"   --arg localCommit "$LOCAL_COMMIT"   --arg baseCommit "$BASE_COMMIT"   --arg headSha "$PR_HEAD"   --arg branch "$PR_BRANCH"   --arg treeSha "$LOCAL_TREE"   --arg reviewDir "$REVIEW_DIR"   --arg approvedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)"   '{
    schema:2,
    pr:$pr,
    taskId:$taskId,
    localCommit:$localCommit,
    baseCommit:$baseCommit,
    headSha:$headSha,
    branch:$branch,
    treeSha:$treeSha,
    reviewDir:$reviewDir,
    checks:{
      securityAudit:"success",
      verifyRelease:"success"
    },
    decision:"approved_for_merge_only",
    mergeApproved:true,
    productionDeployApproved:false,
    approvedAt:$approvedAt
  }' >"$MERGE_APPROVAL"
chmod 0440 "$MERGE_APPROVAL"
chown root:root "$MERGE_APPROVAL"

trap - EXIT
rm -rf "$TMP_DIR"

echo
echo '=== MERGE GATE GENERICO DA LIA APROVADO ==='
echo "PR: #$PR"
echo "Task: $TASK_ID"
echo "Commit local: $LOCAL_COMMIT"
echo "Head publicado: $PR_HEAD"
echo "Tree SHA: $LOCAL_TREE"
echo 'Review Pack: INTEGRO'
echo 'Conteudo PR x commit local: IDENTICO'
echo 'Security audit: PASSOU'
echo 'Verify release: PASSOU'
echo "Registro: $MERGE_APPROVAL"
echo 'Merge: APROVADO'
echo 'Deploy de producao: NAO APROVADO'
echo 'Git push do Worker: continua BLOQUEADO'
echo 'Chamadas OpenAI realizadas: ZERO'
