#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[ "$(id -u)" -eq 0 ] || { echo 'PARADO: execute como root.' >&2; exit 1; }

for cmd in git sudo grep jq cp install curl; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "PARADO: comando ausente: $cmd" >&2; exit 1; }
done

GENV=/etc/lia-dev-gateway.env
WENV=/etc/lia-codex-worker.env
BENV=/etc/lia-openai-broker.env
WORKSPACE=/opt/lia/workspaces/vitrinecity-dev
POLICY=/opt/lia/policies/vitrinecity-dev.json
LOCAL_BRANCH='lia/dev-worker'
OLD_LOCAL_HEAD='310e107cbc98da5a48f7df68ce5312867072244d'
NEW_MAIN='cd48fc7acdab17a5751d9543fa8746b31fbcf091'
EXPECTED_FILE='app/scripts/test-web-story-cta.mjs'
BACKUP="/var/backups/lia-workspace-sync-pr207-$(date -u +%Y%m%dT%H%M%SZ)"

for f in "$GENV" "$WENV" "$BENV" "$POLICY"; do
  [ -f "$f" ] || { echo "PARADO: arquivo ausente: $f" >&2; exit 1; }
done
[ -d "$WORKSPACE/.git" ] || { echo 'PARADO: workspace ausente.' >&2; exit 1; }

grep -q '^LIA_GATEWAY_EXECUTION_ENABLED=0$' "$GENV" || { echo 'PARADO: gateway nao esta bloqueado.' >&2; exit 1; }
grep -q '^LIA_CODEX_EXECUTION_ENABLED=0$' "$WENV" || { echo 'PARADO: worker nao esta bloqueado.' >&2; exit 1; }
grep -q '^LIA_BROKER_EXECUTION_ENABLED=0$' "$BENV" || { echo 'PARADO: broker nao esta bloqueado.' >&2; exit 1; }

HEAD="$(sudo -u lia -H git -C "$WORKSPACE" rev-parse HEAD)"
BRANCH="$(sudo -u lia -H git -C "$WORKSPACE" branch --show-current)"
STATUS="$(sudo -u lia -H git -C "$WORKSPACE" status --porcelain --untracked-files=all)"
FETCH_URL="$(sudo -u lia -H git -C "$WORKSPACE" remote get-url origin)"
PUSH_URL="$(sudo -u lia -H git -C "$WORKSPACE" remote get-url --push origin)"

[ "$HEAD" = "$OLD_LOCAL_HEAD" ] || { echo "PARADO: HEAD local inesperado: $HEAD" >&2; exit 1; }
[ "$BRANCH" = "$LOCAL_BRANCH" ] || { echo "PARADO: branch inesperada: $BRANCH" >&2; exit 1; }
[ -z "$STATUS" ] || { echo 'PARADO: workspace nao esta limpo.' >&2; printf '%s\n' "$STATUS" >&2; exit 1; }
[ "$FETCH_URL" = 'https://github.com/markentingimperio-debug/vitrinecity.git' ] || { echo "PARADO: fetch URL inesperada: $FETCH_URL" >&2; exit 1; }
[ "$PUSH_URL" = 'blocked://lia-no-push' ] || { echo 'PARADO: push nao esta bloqueado.' >&2; exit 1; }

mkdir -p "$BACKUP"
chmod 0700 "$BACKUP"
cp -a "$POLICY" "$BACKUP/vitrinecity-dev.json"
sudo -u lia -H git -C "$WORKSPACE" rev-parse HEAD >"$BACKUP/old-head.txt"

sudo -u lia -H git -C "$WORKSPACE" fetch --prune origin main

REMOTE_MAIN="$(sudo -u lia -H git -C "$WORKSPACE" rev-parse origin/main)"
[ "$REMOTE_MAIN" = "$NEW_MAIN" ] || { echo "PARADO: origin/main inesperado: $REMOTE_MAIN" >&2; exit 1; }

sudo -u lia -H git -C "$WORKSPACE" cat-file -e "$NEW_MAIN^{commit}"
sudo -u lia -H git -C "$WORKSPACE" ls-tree -r --name-only "$NEW_MAIN" | grep -qxF "$EXPECTED_FILE"   || { echo 'PARADO: commit novo nao contem o teste aprovado.' >&2; exit 1; }

sudo -u lia -H git -C "$WORKSPACE" reset --hard "$NEW_MAIN" >/dev/null

NEW_HEAD="$(sudo -u lia -H git -C "$WORKSPACE" rev-parse HEAD)"
NEW_BRANCH="$(sudo -u lia -H git -C "$WORKSPACE" branch --show-current)"
NEW_STATUS="$(sudo -u lia -H git -C "$WORKSPACE" status --porcelain --untracked-files=all)"
NEW_PUSH_URL="$(sudo -u lia -H git -C "$WORKSPACE" remote get-url --push origin)"

[ "$NEW_HEAD" = "$NEW_MAIN" ] || { echo 'PARADO: reset nao chegou ao novo main.' >&2; exit 1; }
[ "$NEW_BRANCH" = "$LOCAL_BRANCH" ] || { echo 'PARADO: branch local mudou.' >&2; exit 1; }
[ -z "$NEW_STATUS" ] || { echo 'PARADO: workspace nao ficou limpo.' >&2; exit 1; }
[ "$NEW_PUSH_URL" = 'blocked://lia-no-push' ] || { echo 'PARADO: push deixou de estar bloqueado.' >&2; exit 1; }

TMP_POLICY="$(mktemp)"
jq --arg base "$NEW_MAIN" '.baseCommit=$base' "$POLICY" >"$TMP_POLICY"
install -o root -g root -m 0644 "$TMP_POLICY" "$POLICY"
rm -f "$TMP_POLICY"

jq -e --arg base "$NEW_MAIN" '.baseCommit==$base and .gitPush==false and .productionDeploy==false and .networkFromCodexSandbox==false and .credentialsMounted==false' "$POLICY" >/dev/null   || { echo 'PARADO: policy atualizada nao atende as protecoes.' >&2; exit 1; }

set +e
sudo -u lia -H git -C "$WORKSPACE" push --dry-run origin "$LOCAL_BRANCH" >/dev/null 2>&1
PUSH_RC=$?
set -e
[ "$PUSH_RC" -ne 0 ] || { echo 'PARADO: push dry-run foi permitido.' >&2; exit 1; }

echo
echo '=== WORKSPACE LIA SINCRONIZADO COM MAIN ==='
echo "Main commit: $NEW_MAIN"
echo "Branch local: $LOCAL_BRANCH"
echo 'Workspace: LIMPO'
echo 'Policy baseCommit: ATUALIZADA'
echo 'Git fetch: PERMITIDO'
echo 'Git push: BLOQUEADO'
echo 'Deploy de producao: BLOQUEADO'
echo 'Rede do Codex: BLOQUEADA'
echo 'Chamadas OpenAI realizadas: ZERO'
echo "Backup: $BACKUP"
