#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[ "$(id -u)" -eq 0 ] || { echo 'PARADO: execute como root.' >&2; exit 1; }

for cmd in git sudo grep sed curl dirname; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "PARADO: comando ausente: $cmd" >&2; exit 1; }
done

GENV=/etc/lia-dev-gateway.env
WENV=/etc/lia-codex-worker.env
BENV=/etc/lia-openai-broker.env
WORKSPACE=/opt/lia/workspaces/vitrinecity-dev
BASE_COMMIT='708c2bb294d4dabc08878e32e72b7b5f0af8f037'
LOCAL_BRANCH='lia/dev-worker'
ALLOWED_FILE='app/scripts/test-web-story-cta.mjs'
COMMIT_MESSAGE='test: cover web story CTA mapping'

for f in "$GENV" "$WENV" "$BENV"; do
  [ -f "$f" ] || { echo "PARADO: ambiente ausente: $f" >&2; exit 1; }
done
[ -d "$WORKSPACE/.git" ] || { echo 'PARADO: workspace ausente.' >&2; exit 1; }

grep -q '^LIA_GATEWAY_EXECUTION_ENABLED=0$' "$GENV" || { echo 'PARADO: gateway nao esta bloqueado.' >&2; exit 1; }
grep -q '^LIA_CODEX_EXECUTION_ENABLED=0$' "$WENV" || { echo 'PARADO: worker nao esta bloqueado.' >&2; exit 1; }
grep -q '^LIA_BROKER_EXECUTION_ENABLED=0$' "$BENV" || { echo 'PARADO: broker nao esta bloqueado.' >&2; exit 1; }

HEAD="$(sudo -u lia -H git -C "$WORKSPACE" rev-parse HEAD)"
BRANCH="$(sudo -u lia -H git -C "$WORKSPACE" branch --show-current)"
STATUS="$(sudo -u lia -H git -C "$WORKSPACE" status --porcelain --untracked-files=all)"
PUSH_URL="$(sudo -u lia -H git -C "$WORKSPACE" remote get-url --push origin)"

[ "$HEAD" = "$BASE_COMMIT" ] || { echo "PARADO: HEAD nao esta no commit base esperado: $HEAD" >&2; exit 1; }
[ "$BRANCH" = "$LOCAL_BRANCH" ] || { echo "PARADO: branch inesperada: $BRANCH" >&2; exit 1; }
[ "$STATUS" = "?? $ALLOWED_FILE" ] || { echo 'PARADO: workspace possui estado diferente do unico arquivo validado:' >&2; printf '%s\n' "$STATUS" >&2; exit 1; }
[ "$PUSH_URL" = 'blocked://lia-no-push' ] || { echo 'PARADO: push nao esta bloqueado.' >&2; exit 1; }
[ -f "$WORKSPACE/$ALLOWED_FILE" ] || { echo 'PARADO: arquivo validado ausente.' >&2; exit 1; }

NODE_BIN="$(sudo -u lia -H bash -c 'cd /; export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24 >/dev/null; command -v node')"
[ -x "$NODE_BIN" ] || { echo 'PARADO: Node 24 da LIA nao encontrado.' >&2; exit 1; }
NODE_DIR="$(dirname "$NODE_BIN")"
TOOL_PATH="$NODE_DIR:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

echo 'Executando validacao independente antes do commit...'
(
  cd /
  sudo -u lia -H env PATH="$TOOL_PATH" /bin/sh -c     'cd /opt/lia/workspaces/vitrinecity-dev && node --check app/web-story-cta.js && node --check app/scripts/test-web-story-cta.mjs && node --test app/scripts/test-web-story-cta.mjs'
)

COMMITTED=0
rollback(){
  set +e
  if [ "$COMMITTED" -eq 1 ]; then
    sudo -u lia -H git -C "$WORKSPACE" reset --mixed "$BASE_COMMIT" >/dev/null 2>&1 || true
  else
    sudo -u lia -H git -C "$WORKSPACE" reset --mixed "$BASE_COMMIT" >/dev/null 2>&1 || true
  fi
}
trap 'rc=$?; if [ $rc -ne 0 ]; then rollback; fi; exit $rc' EXIT

sudo -u lia -H git -C "$WORKSPACE" add -- "$ALLOWED_FILE"
STAGED="$(sudo -u lia -H git -C "$WORKSPACE" diff --cached --name-only)"
[ "$STAGED" = "$ALLOWED_FILE" ] || { echo 'PARADO: staging saiu do escopo.' >&2; exit 1; }

sudo -u lia -H git -C "$WORKSPACE" commit -m "$COMMIT_MESSAGE" >/dev/null
COMMITTED=1

NEW_HEAD="$(sudo -u lia -H git -C "$WORKSPACE" rev-parse HEAD)"
PARENT="$(sudo -u lia -H git -C "$WORKSPACE" rev-parse HEAD^)"
FILES="$(sudo -u lia -H git -C "$WORKSPACE" diff-tree --no-commit-id --name-only -r HEAD)"
CLEAN="$(sudo -u lia -H git -C "$WORKSPACE" status --porcelain --untracked-files=all)"

[ "$PARENT" = "$BASE_COMMIT" ] || { echo 'PARADO: parent do commit inesperado.' >&2; exit 1; }
[ "$FILES" = "$ALLOWED_FILE" ] || { echo 'PARADO: commit contem arquivo fora do escopo.' >&2; exit 1; }
[ -z "$CLEAN" ] || { echo 'PARADO: workspace nao ficou limpo apos commit.' >&2; printf '%s\n' "$CLEAN" >&2; exit 1; }

set +e
sudo -u lia -H git -C "$WORKSPACE" push --dry-run origin "$LOCAL_BRANCH" >/dev/null 2>&1
PUSH_RC=$?
set -e
[ "$PUSH_RC" -ne 0 ] || { echo 'PARADO: push dry-run foi permitido inesperadamente.' >&2; exit 1; }

GH="$(curl -fsS http://127.0.0.1:8787/health)"
WH="$(curl -fsS http://127.0.0.1:8790/health)"
BH="$(curl -fsS http://127.0.0.1:8791/health)"
printf '%s' "$GH" | grep -q '"executionEnabled":false' || { echo 'PARADO: gateway nao esta bloqueado.' >&2; exit 1; }
printf '%s' "$WH" | grep -q '"executionEnabled":false' || { echo 'PARADO: worker nao esta bloqueado.' >&2; exit 1; }
printf '%s' "$BH" | grep -q '"executionEnabled":false' || { echo 'PARADO: broker nao esta bloqueado.' >&2; exit 1; }

trap - EXIT

echo
echo '=== PRIMEIRO COMMIT LOCAL DA LIA CRIADO ==='
echo "Commit: $NEW_HEAD"
echo "Branch: $LOCAL_BRANCH"
echo "Arquivo: $ALLOWED_FILE"
echo 'Teste independente: PASSOU'
echo 'Workspace: LIMPO'
echo 'Git push: BLOQUEADO'
echo 'Deploy de producao: BLOQUEADO'
echo 'Chamadas OpenAI realizadas: ZERO'
