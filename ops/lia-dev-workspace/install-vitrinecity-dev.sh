#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[ "$(id -u)" -eq 0 ] || { echo 'PARADO: execute como root.' >&2; exit 1; }

for cmd in git sudo grep install sha256sum systemctl; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "PARADO: comando ausente: $cmd" >&2; exit 1; }
done

id lia >/dev/null 2>&1 || { echo 'PARADO: usuario lia nao existe.' >&2; exit 1; }

GENV=/etc/lia-dev-gateway.env
WENV=/etc/lia-codex-worker.env
BENV=/etc/lia-openai-broker.env
for f in "$GENV" "$WENV" "$BENV"; do
  [ -f "$f" ] || { echo "PARADO: ambiente ausente: $f" >&2; exit 1; }
done

# Fail closed: nenhum componente de execução pode estar liberado durante o preparo.
grep -q '^LIA_GATEWAY_EXECUTION_ENABLED=0$' "$GENV" || { echo 'PARADO: gateway nao esta bloqueado.' >&2; exit 1; }
grep -q '^LIA_CODEX_EXECUTION_ENABLED=0$' "$WENV" || { echo 'PARADO: worker nao esta bloqueado.' >&2; exit 1; }
grep -q '^LIA_BROKER_EXECUTION_ENABLED=0$' "$BENV" || { echo 'PARADO: broker nao esta bloqueado.' >&2; exit 1; }

REPO_URL='https://github.com/markentingimperio-debug/vitrinecity.git'
BASE_COMMIT='708c2bb294d4dabc08878e32e72b7b5f0af8f037'
WORKSPACE_ROOT=/opt/lia/workspaces
WORKSPACE=$WORKSPACE_ROOT/vitrinecity-dev
LOCAL_BRANCH='lia/dev-worker'
POLICY_DIR=/opt/lia/policies
POLICY_FILE=$POLICY_DIR/vitrinecity-dev.json

install -d -o lia -g lia -m 0750 "$WORKSPACE_ROOT"
install -d -o root -g root -m 0755 "$POLICY_DIR"

if [ -e "$WORKSPACE" ]; then
  echo "PARADO: $WORKSPACE ja existe. Nao vou sobrescrever um workspace existente." >&2
  exit 1
fi

cleanup_on_error(){
  rc=$?
  if [ $rc -ne 0 ] && [ -d "$WORKSPACE" ]; then
    rm -rf -- "$WORKSPACE"
  fi
  exit $rc
}
trap cleanup_on_error EXIT

echo 'Clonando a copia de desenvolvimento da Vitrine City...'
sudo -u lia -H git clone --no-tags --single-branch --branch main "$REPO_URL" "$WORKSPACE" >/dev/null 2>&1

sudo -u lia -H git -C "$WORKSPACE" cat-file -e "${BASE_COMMIT}^{commit}" || { echo 'PARADO: commit base nao existe no clone.' >&2; exit 1; }

# Branch local fixa no commit validado.
sudo -u lia -H git -C "$WORKSPACE" checkout -q -B "$LOCAL_BRANCH" "$BASE_COMMIT"

# Identidade local. Nenhum token, deploy ou credencial externa.
sudo -u lia -H git -C "$WORKSPACE" config user.name 'LIA Dev Worker'
sudo -u lia -H git -C "$WORKSPACE" config user.email 'lia-worker@localhost'
sudo -u lia -H git -C "$WORKSPACE" config fetch.prune true
sudo -u lia -H git -C "$WORKSPACE" config gc.auto 0

# Bloqueio explícito de push.
sudo -u lia -H git -C "$WORKSPACE" remote set-url --push origin 'blocked://lia-no-push'

cat > "$WORKSPACE/.git/hooks/pre-push" <<'HOOK'
#!/usr/bin/env bash
echo 'BLOQUEADO: este workspace da LIA nao possui permissao de push.' >&2
exit 1
HOOK
chown root:root "$WORKSPACE/.git/hooks/pre-push"
chmod 0555 "$WORKSPACE/.git/hooks/pre-push"

# Impede o usuario lia de alterar o remote/pushurl e o hook.
chown root:root "$WORKSPACE/.git/config"
chmod 0444 "$WORKSPACE/.git/config"
chown root:root "$WORKSPACE/.git/hooks"
chmod 0555 "$WORKSPACE/.git/hooks"

# Registro root-owned da política do workspace.
cat > "$POLICY_FILE" <<EOF
{
  "workspace": "vitrinecity-dev",
  "repository": "markentingimperio-debug/vitrinecity",
  "fetchUrl": "$REPO_URL",
  "baseBranch": "main",
  "baseCommit": "$BASE_COMMIT",
  "localBranch": "$LOCAL_BRANCH",
  "gitPush": false,
  "productionDeploy": false,
  "networkFromCodexSandbox": false,
  "credentialsMounted": false
}
EOF
chown root:root "$POLICY_FILE"
chmod 0644 "$POLICY_FILE"

# Validações finais sem IA paga.
HEAD="$(sudo -u lia -H git -C "$WORKSPACE" rev-parse HEAD)"
BRANCH="$(sudo -u lia -H git -C "$WORKSPACE" branch --show-current)"
STATUS="$(sudo -u lia -H git -C "$WORKSPACE" status --porcelain --untracked-files=all)"
FETCH_URL="$(sudo -u lia -H git -C "$WORKSPACE" remote get-url origin)"
PUSH_URL="$(sudo -u lia -H git -C "$WORKSPACE" remote get-url --push origin)"

[ "$HEAD" = "$BASE_COMMIT" ] || { echo "PARADO: HEAD inesperado: $HEAD" >&2; exit 1; }
[ "$BRANCH" = "$LOCAL_BRANCH" ] || { echo "PARADO: branch inesperada: $BRANCH" >&2; exit 1; }
[ -z "$STATUS" ] || { echo 'PARADO: workspace nao ficou limpo.' >&2; exit 1; }
[ "$FETCH_URL" = "$REPO_URL" ] || { echo 'PARADO: fetch URL inesperada.' >&2; exit 1; }
[ "$PUSH_URL" = 'blocked://lia-no-push' ] || { echo 'PARADO: push nao ficou bloqueado.' >&2; exit 1; }

set +e
sudo -u lia -H git -C "$WORKSPACE" push --dry-run origin "$LOCAL_BRANCH" >/tmp/lia-push-test.out 2>/tmp/lia-push-test.err
PUSH_RC=$?
set -e
rm -f /tmp/lia-push-test.out /tmp/lia-push-test.err
[ "$PUSH_RC" -ne 0 ] || { echo 'PARADO: push dry-run foi permitido inesperadamente.' >&2; exit 1; }

trap - EXIT

echo
echo '=== VITRINE CITY DEV WORKSPACE PRONTO ==='
echo "Workspace: $WORKSPACE"
echo "Repositorio: markentingimperio-debug/vitrinecity"
echo "Base commit: $BASE_COMMIT"
echo "Branch local: $LOCAL_BRANCH"
echo 'Git fetch: PERMITIDO'
echo 'Git push: BLOQUEADO'
echo 'Deploy de producao: BLOQUEADO'
echo 'Credenciais GitHub no workspace: NAO'
echo 'Codex sandbox network: continua DESATIVADA'
echo 'Chamadas OpenAI realizadas nesta instalacao: ZERO'
echo
echo 'Status:'
sudo -u lia -H git -C "$WORKSPACE" status --short --branch
