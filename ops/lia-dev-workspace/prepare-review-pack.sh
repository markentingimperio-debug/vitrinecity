#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[ "$(id -u)" -eq 0 ] || { echo 'PARADO: execute como root.' >&2; exit 1; }

for cmd in git sudo grep sha256sum jq dirname sed curl; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "PARADO: comando ausente: $cmd" >&2; exit 1; }
done

GENV=/etc/lia-dev-gateway.env
WENV=/etc/lia-codex-worker.env
BENV=/etc/lia-openai-broker.env
WORKSPACE=/opt/lia/workspaces/vitrinecity-dev
BASE_COMMIT='708c2bb294d4dabc08878e32e72b7b5f0af8f037'
LOCAL_BRANCH='lia/dev-worker'
EXPECTED_FILE='app/scripts/test-web-story-cta.mjs'
EXPECTED_MESSAGE='test: cover web story CTA mapping'
REVIEWS_ROOT=/opt/lia/reviews

for f in "$GENV" "$WENV" "$BENV"; do
  [ -f "$f" ] || { echo "PARADO: ambiente ausente: $f" >&2; exit 1; }
done
[ -d "$WORKSPACE/.git" ] || { echo 'PARADO: workspace ausente.' >&2; exit 1; }

grep -q '^LIA_GATEWAY_EXECUTION_ENABLED=0$' "$GENV" || { echo 'PARADO: gateway nao esta bloqueado.' >&2; exit 1; }
grep -q '^LIA_CODEX_EXECUTION_ENABLED=0$' "$WENV" || { echo 'PARADO: worker nao esta bloqueado.' >&2; exit 1; }
grep -q '^LIA_BROKER_EXECUTION_ENABLED=0$' "$BENV" || { echo 'PARADO: broker nao esta bloqueado.' >&2; exit 1; }

HEAD="$(sudo -u lia -H git -C "$WORKSPACE" rev-parse HEAD)"
BRANCH="$(sudo -u lia -H git -C "$WORKSPACE" branch --show-current)"
PARENT="$(sudo -u lia -H git -C "$WORKSPACE" rev-parse HEAD^)"
STATUS="$(sudo -u lia -H git -C "$WORKSPACE" status --porcelain --untracked-files=all)"
FILES="$(sudo -u lia -H git -C "$WORKSPACE" diff-tree --no-commit-id --name-only -r HEAD)"
MESSAGE="$(sudo -u lia -H git -C "$WORKSPACE" log -1 --format=%s)"
PUSH_URL="$(sudo -u lia -H git -C "$WORKSPACE" remote get-url --push origin)"

[ "$BRANCH" = "$LOCAL_BRANCH" ] || { echo "PARADO: branch inesperada: $BRANCH" >&2; exit 1; }
[ "$PARENT" = "$BASE_COMMIT" ] || { echo 'PARADO: primeiro review espera exatamente um commit sobre a base.' >&2; exit 1; }
[ -z "$STATUS" ] || { echo 'PARADO: workspace precisa estar limpo.' >&2; printf '%s\n' "$STATUS" >&2; exit 1; }
[ "$FILES" = "$EXPECTED_FILE" ] || { echo 'PARADO: arquivos do commit nao correspondem ao primeiro review.' >&2; printf '%s\n' "$FILES" >&2; exit 1; }
[ "$MESSAGE" = "$EXPECTED_MESSAGE" ] || { echo "PARADO: mensagem inesperada: $MESSAGE" >&2; exit 1; }
[ "$PUSH_URL" = 'blocked://lia-no-push' ] || { echo 'PARADO: push nao esta bloqueado.' >&2; exit 1; }

NODE_BIN="$(sudo -u lia -H bash -c 'cd /; export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24 >/dev/null; command -v node')"
[ -x "$NODE_BIN" ] || { echo 'PARADO: Node 24 ausente.' >&2; exit 1; }
NODE_DIR="$(dirname "$NODE_BIN")"
TOOL_PATH="$NODE_DIR:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

install -d -o root -g root -m 0750 "$REVIEWS_ROOT"
REVIEW_DIR="$REVIEWS_ROOT/$HEAD"
[ ! -e "$REVIEW_DIR" ] || { echo "PARADO: review pack ja existe: $REVIEW_DIR" >&2; exit 1; }
install -d -o root -g root -m 0750 "$REVIEW_DIR"

cleanup(){
  rc=$?
  if [ "$rc" -ne 0 ]; then rm -rf -- "$REVIEW_DIR"; fi
  exit "$rc"
}
trap cleanup EXIT

TEST_OUT="$REVIEW_DIR/test-output.txt"
set +e
sudo -u lia -H env PATH="$TOOL_PATH" /bin/sh -c   'cd /opt/lia/workspaces/vitrinecity-dev && node --check app/web-story-cta.js && node --check app/scripts/test-web-story-cta.mjs && node --test app/scripts/test-web-story-cta.mjs'   >"$TEST_OUT" 2>&1
TEST_RC=$?
set -e
[ "$TEST_RC" -eq 0 ] || { echo 'PARADO: testes do review falharam.' >&2; cat "$TEST_OUT" >&2; exit 1; }

sudo -u lia -H git -C "$WORKSPACE" diff --binary "$BASE_COMMIT..$HEAD" >"$REVIEW_DIR/changes.patch"
sudo -u lia -H git -C "$WORKSPACE" diff --name-status "$BASE_COMMIT..$HEAD" >"$REVIEW_DIR/files.txt"
sudo -u lia -H git -C "$WORKSPACE" show --stat --summary --format=fuller "$HEAD" >"$REVIEW_DIR/commit.txt"

jq -n   --arg repository 'markentingimperio-debug/vitrinecity'   --arg workspace "$WORKSPACE"   --arg branch "$BRANCH"   --arg baseCommit "$BASE_COMMIT"   --arg headCommit "$HEAD"   --arg commitMessage "$MESSAGE"   --arg expectedFile "$EXPECTED_FILE"   --arg createdAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)"   '{
    schema:1,
    repository:$repository,
    workspace:$workspace,
    branch:$branch,
    baseCommit:$baseCommit,
    headCommit:$headCommit,
    commitMessage:$commitMessage,
    files:[$expectedFile],
    tests:{status:"passed",command:"node --test app/scripts/test-web-story-cta.mjs"},
    gitPush:false,
    productionDeploy:false,
    humanApprovalRequired:true,
    createdAt:$createdAt
  }' >"$REVIEW_DIR/metadata.json"

chmod 0640 "$REVIEW_DIR"/*
chown root:root "$REVIEW_DIR"/*
(
  cd "$REVIEW_DIR"
  sha256sum metadata.json changes.patch files.txt commit.txt test-output.txt >SHA256SUMS
)
chmod 0440 "$REVIEW_DIR/SHA256SUMS"
chown root:root "$REVIEW_DIR/SHA256SUMS"

find "$REVIEW_DIR" -type f ! -name SHA256SUMS -exec chmod 0440 {} +
chmod 0550 "$REVIEW_DIR"

trap - EXIT

echo
echo '=== REVIEW PACK DA LIA PRONTO ==='
echo "Commit: $HEAD"
echo "Review: $REVIEW_DIR"
echo 'Testes: PASSARAM'
echo 'Arquivos alterados: 1'
echo "Arquivo: $EXPECTED_FILE"
echo 'Git push: BLOQUEADO'
echo 'Deploy de producao: BLOQUEADO'
echo 'Aprovacao humana: PENDENTE'
echo 'Chamadas OpenAI realizadas: ZERO'
echo
echo 'Para revisar:'
echo "  cat $REVIEW_DIR/metadata.json"
echo "  cat $REVIEW_DIR/test-output.txt"
echo "  sed -n '1,260p' $REVIEW_DIR/changes.patch"
