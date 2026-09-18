#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[ "$(id -u)" -eq 0 ] || { echo 'PARADO: execute como root.' >&2; exit 1; }
[ "$#" -eq 2 ] || { echo 'Uso: lia-sync-main <pr-number> <merge-commit-sha>' >&2; exit 2; }

PR="$1"
MERGE_COMMIT="$2"

[[ "$PR" =~ ^[0-9]+$ ]] || { echo 'PARADO: numero do PR invalido.' >&2; exit 1; }
[[ "$MERGE_COMMIT" =~ ^[0-9a-f]{40}$ ]] || { echo 'PARADO: merge commit invalido.' >&2; exit 1; }

for cmd in curl jq git sudo grep cp install mktemp; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "PARADO: comando ausente: $cmd" >&2; exit 1; }
done

REPO='markentingimperio-debug/vitrinecity'
WORKSPACE=/opt/lia/workspaces/vitrinecity-dev
POLICY=/opt/lia/policies/vitrinecity-dev.json
GENV=/etc/lia-dev-gateway.env
WENV=/etc/lia-codex-worker.env
BENV=/etc/lia-openai-broker.env
LOCAL_BRANCH='lia/dev-worker'
MERGE_APPROVAL="/opt/lia/merge-approvals/pr-$PR.json"
BACKUP="/var/backups/lia-sync-main-pr-$PR-$(date -u +%Y%m%dT%H%M%SZ)"
TMP_POLICY="$(mktemp)"
trap 'rm -f "$TMP_POLICY"' EXIT

for f in "$GENV" "$WENV" "$BENV" "$POLICY" "$MERGE_APPROVAL"; do
  [ -f "$f" ] || { echo "PARADO: arquivo ausente: $f" >&2; exit 1; }
done
[ -d "$WORKSPACE/.git" ] || { echo 'PARADO: workspace ausente.' >&2; exit 1; }

grep -q '^LIA_GATEWAY_EXECUTION_ENABLED=0$' "$GENV" || { echo 'PARADO: gateway nao esta bloqueado.' >&2; exit 1; }
grep -q '^LIA_CODEX_EXECUTION_ENABLED=0$' "$WENV" || { echo 'PARADO: worker nao esta bloqueado.' >&2; exit 1; }
grep -q '^LIA_BROKER_EXECUTION_ENABLED=0$' "$BENV" || { echo 'PARADO: broker nao esta bloqueado.' >&2; exit 1; }

jq -e   --argjson pr "$PR"   '.pr==$pr
   and .decision=="approved_for_merge_only"
   and .mergeApproved==true
   and .productionDeployApproved==false'   "$MERGE_APPROVAL" >/dev/null   || { echo 'PARADO: merge approval nao atende a politica.' >&2; exit 1; }

APPROVED_HEAD="$(jq -r '.headSha' "$MERGE_APPROVAL")"
APPROVED_BASE="$(jq -r '.baseCommit' "$MERGE_APPROVAL")"
LOCAL_COMMIT="$(jq -r '.localCommit' "$MERGE_APPROVAL")"
[[ "$APPROVED_HEAD" =~ ^[0-9a-f]{40}$ ]] || { echo 'PARADO: head aprovado invalido.' >&2; exit 1; }
[[ "$APPROVED_BASE" =~ ^[0-9a-f]{40}$ ]] || { echo 'PARADO: base aprovada invalida.' >&2; exit 1; }
[[ "$LOCAL_COMMIT" =~ ^[0-9a-f]{40}$ ]] || { echo 'PARADO: commit local aprovado invalido.' >&2; exit 1; }

PR_JSON="$(curl -fsSL --proto '=https' --proto-redir '=https'   -H 'Accept: application/vnd.github+json'   "https://api.github.com/repos/$REPO/pulls/$PR")"

printf '%s' "$PR_JSON" | jq -e   --arg head "$APPROVED_HEAD"   --arg merge "$MERGE_COMMIT"   '.state=="closed"
   and .merged==true
   and .head.sha==$head
   and .merge_commit_sha==$merge
   and .base.ref=="main"' >/dev/null   || { echo 'PARADO: PR nao corresponde ao merge aprovado.' >&2; exit 1; }

CURRENT_HEAD="$(sudo -u lia -H git -C "$WORKSPACE" rev-parse HEAD)"
CURRENT_BRANCH="$(sudo -u lia -H git -C "$WORKSPACE" branch --show-current)"
CURRENT_STATUS="$(sudo -u lia -H git -C "$WORKSPACE" status --porcelain --untracked-files=all)"
PUSH_URL="$(sudo -u lia -H git -C "$WORKSPACE" remote get-url --push origin)"

[ "$CURRENT_HEAD" = "$LOCAL_COMMIT" ] || { echo "PARADO: HEAD local inesperado: $CURRENT_HEAD" >&2; exit 1; }
[ "$CURRENT_BRANCH" = "$LOCAL_BRANCH" ] || { echo "PARADO: branch local inesperada: $CURRENT_BRANCH" >&2; exit 1; }
[ -z "$CURRENT_STATUS" ] || { echo 'PARADO: workspace nao esta limpo.' >&2; exit 1; }
[ "$PUSH_URL" = 'blocked://lia-no-push' ] || { echo 'PARADO: push do Worker nao esta bloqueado.' >&2; exit 1; }

mkdir -p "$BACKUP"
chmod 0700 "$BACKUP"
cp -a "$POLICY" "$BACKUP/vitrinecity-dev.json"
printf '%s\n' "$CURRENT_HEAD" >"$BACKUP/old-head.txt"
cp -a "$MERGE_APPROVAL" "$BACKUP/merge-approval.json"

sudo -u lia -H git -C "$WORKSPACE" fetch --prune origin main
REMOTE_MAIN="$(sudo -u lia -H git -C "$WORKSPACE" rev-parse origin/main)"
[ "$REMOTE_MAIN" = "$MERGE_COMMIT" ] || { echo "PARADO: origin/main $REMOTE_MAIN difere do merge esperado $MERGE_COMMIT." >&2; exit 1; }

sudo -u lia -H git -C "$WORKSPACE" cat-file -e "$MERGE_COMMIT^{commit}"
sudo -u lia -H git -C "$WORKSPACE" merge-base --is-ancestor "$APPROVED_BASE" "$MERGE_COMMIT"   || { echo 'PARADO: novo main nao descende da base aprovada.' >&2; exit 1; }

sudo -u lia -H git -C "$WORKSPACE" reset --hard "$MERGE_COMMIT" >/dev/null

NEW_HEAD="$(sudo -u lia -H git -C "$WORKSPACE" rev-parse HEAD)"
NEW_BRANCH="$(sudo -u lia -H git -C "$WORKSPACE" branch --show-current)"
NEW_STATUS="$(sudo -u lia -H git -C "$WORKSPACE" status --porcelain --untracked-files=all)"
NEW_PUSH_URL="$(sudo -u lia -H git -C "$WORKSPACE" remote get-url --push origin)"

[ "$NEW_HEAD" = "$MERGE_COMMIT" ] || { echo 'PARADO: workspace nao chegou ao novo main.' >&2; exit 1; }
[ "$NEW_BRANCH" = "$LOCAL_BRANCH" ] || { echo 'PARADO: branch local mudou.' >&2; exit 1; }
[ -z "$NEW_STATUS" ] || { echo 'PARADO: workspace nao ficou limpo.' >&2; exit 1; }
[ "$NEW_PUSH_URL" = 'blocked://lia-no-push' ] || { echo 'PARADO: push deixou de estar bloqueado.' >&2; exit 1; }

jq --arg base "$MERGE_COMMIT" '.baseCommit=$base' "$POLICY" >"$TMP_POLICY"
install -o root -g root -m 0644 "$TMP_POLICY" "$POLICY"

jq -e --arg base "$MERGE_COMMIT" '
  .baseCommit==$base
  and .gitPush==false
  and .productionDeploy==false
  and .networkFromCodexSandbox==false
  and .credentialsMounted==false
' "$POLICY" >/dev/null   || { echo 'PARADO: policy pos-merge nao atende as protecoes.' >&2; exit 1; }

set +e
sudo -u lia -H git -C "$WORKSPACE" push --dry-run origin "$LOCAL_BRANCH" >/dev/null 2>&1
PUSH_RC=$?
set -e
[ "$PUSH_RC" -ne 0 ] || { echo 'PARADO: push dry-run foi permitido.' >&2; exit 1; }

trap - EXIT
rm -f "$TMP_POLICY"

echo
echo '=== WORKSPACE LIA SINCRONIZADO GENERICAMENTE ==='
echo "PR: #$PR"
echo "Main commit: $MERGE_COMMIT"
echo "Branch local: $LOCAL_BRANCH"
echo 'Workspace: LIMPO'
echo 'Policy baseCommit: ATUALIZADA'
echo 'Git fetch: PERMITIDO'
echo 'Git push: BLOQUEADO'
echo 'Deploy de producao: BLOQUEADO'
echo 'Rede do Codex: BLOQUEADA'
echo 'Chamadas OpenAI realizadas: ZERO'
echo "Backup: $BACKUP"
