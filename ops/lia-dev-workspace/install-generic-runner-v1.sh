#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[ "$(id -u)" -eq 0 ] || { echo 'PARADO: execute como root.' >&2; exit 1; }

for cmd in curl jq git sudo systemctl install cp grep bash; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "PARADO: comando ausente: $cmd" >&2; exit 1; }
done

GENV=/etc/lia-dev-gateway.env
WENV=/etc/lia-codex-worker.env
BENV=/etc/lia-openai-broker.env
POLICY=/opt/lia/policies/vitrinecity-dev.json
WORKSPACE=/opt/lia/workspaces/vitrinecity-dev
EXPECTED_BASE='cd48fc7acdab17a5751d9543fa8746b31fbcf091'
REV='36e1ca5ee8a4a0e39a22d94f1930747498f9ba84'
BASE="https://raw.githubusercontent.com/markentingimperio-debug/vitrinecity/$REV/ops/lia-dev-workspace"
BIN_DIR=/opt/lia/bin
TASKS_ROOT=/opt/lia/tasks
EXAMPLES_DIR=$TASKS_ROOT/examples
PENDING_DIR=$TASKS_ROOT/pending
COMPLETED_DIR=$TASKS_ROOT/completed
RUNS_DIR=/opt/lia/task-runs
REVIEWS_DIR=/opt/lia/reviews
BACKUP="/var/backups/lia-generic-runner-v1-$(date -u +%Y%m%dT%H%M%SZ)"
TMPDIR="$(mktemp -d /tmp/lia-generic-v1.XXXXXX)"

cleanup(){ rm -rf "$TMPDIR"; }
trap cleanup EXIT

for f in "$GENV" "$WENV" "$BENV" "$POLICY"; do
  [ -f "$f" ] || { echo "PARADO: arquivo ausente: $f" >&2; exit 1; }
done
[ -d "$WORKSPACE/.git" ] || { echo 'PARADO: workspace ausente.' >&2; exit 1; }

grep -q '^LIA_GATEWAY_EXECUTION_ENABLED=0$' "$GENV" || { echo 'PARADO: gateway nao esta bloqueado.' >&2; exit 1; }
grep -q '^LIA_CODEX_EXECUTION_ENABLED=0$' "$WENV" || { echo 'PARADO: worker nao esta bloqueado.' >&2; exit 1; }
grep -q '^LIA_BROKER_EXECUTION_ENABLED=0$' "$BENV" || { echo 'PARADO: broker nao esta bloqueado.' >&2; exit 1; }

POLICY_BASE="$(jq -r '.baseCommit' "$POLICY")"
HEAD="$(sudo -u lia -H git -C "$WORKSPACE" rev-parse HEAD)"
STATUS="$(sudo -u lia -H git -C "$WORKSPACE" status --porcelain --untracked-files=all)"
PUSH_URL="$(sudo -u lia -H git -C "$WORKSPACE" remote get-url --push origin)"

[ "$POLICY_BASE" = "$EXPECTED_BASE" ] || { echo "PARADO: policy baseCommit inesperada: $POLICY_BASE" >&2; exit 1; }
[ "$HEAD" = "$EXPECTED_BASE" ] || { echo "PARADO: workspace HEAD inesperado: $HEAD" >&2; exit 1; }
[ -z "$STATUS" ] || { echo 'PARADO: workspace nao esta limpo.' >&2; exit 1; }
[ "$PUSH_URL" = 'blocked://lia-no-push' ] || { echo 'PARADO: push do Worker nao esta bloqueado.' >&2; exit 1; }

curl --fail --location --silent --show-error --proto '=https' --proto-redir '=https' "$BASE/lia-task-run.sh" -o "$TMPDIR/lia-task-run"
curl --fail --location --silent --show-error --proto '=https' --proto-redir '=https' "$BASE/approve-review-pack.sh" -o "$TMPDIR/lia-review-approve"
curl --fail --location --silent --show-error --proto '=https' --proto-redir '=https' "$BASE/generic-task-example.json" -o "$TMPDIR/generic-task-example.json"

bash -n "$TMPDIR/lia-task-run"
bash -n "$TMPDIR/lia-review-approve"
jq -e '.schema==1 and .profile=="dev" and .workspace=="vitrinecity-dev"' "$TMPDIR/generic-task-example.json" >/dev/null

grep -q 'MAX_BUDGET_USD=' "$TMPDIR/lia-task-run" || { echo 'PARADO: limite de budget ausente.' >&2; exit 1; }
grep -q 'PrivateNetwork=yes' "$TMPDIR/lia-task-run" || { echo 'PARADO: testes sem rede nao confirmados.' >&2; exit 1; }
grep -q 'blocked://lia-no-push' "$TMPDIR/lia-task-run" || { echo 'PARADO: bloqueio de push ausente.' >&2; exit 1; }
grep -q 'Aprovacao humana para PR: PENDENTE' "$TMPDIR/lia-task-run" || { echo 'PARADO: review humano ausente.' >&2; exit 1; }
grep -q 'testStatus=="passed"' "$TMPDIR/lia-review-approve" || { echo 'PARADO: aprovacao schema 2 ausente.' >&2; exit 1; }

mkdir -p "$BACKUP"
chmod 0700 "$BACKUP"
[ ! -e "$BIN_DIR/lia-task-run" ] || cp -a "$BIN_DIR/lia-task-run" "$BACKUP/lia-task-run"
[ ! -e "$BIN_DIR/lia-review-approve" ] || cp -a "$BIN_DIR/lia-review-approve" "$BACKUP/lia-review-approve"

install -d -o root -g root -m 0750 "$BIN_DIR" "$TASKS_ROOT" "$EXAMPLES_DIR" "$PENDING_DIR" "$COMPLETED_DIR" "$RUNS_DIR" "$REVIEWS_DIR"
install -o root -g root -m 0750 "$TMPDIR/lia-task-run" "$BIN_DIR/lia-task-run"
install -o root -g root -m 0750 "$TMPDIR/lia-review-approve" "$BIN_DIR/lia-review-approve"
install -o root -g root -m 0440 "$TMPDIR/generic-task-example.json" "$EXAMPLES_DIR/generic-task-example.json"

for u in 8787 8790 8791; do
  HEALTH="$(curl -fsS "http://127.0.0.1:$u/health")"
  printf '%s' "$HEALTH" | grep -q '"executionEnabled":false'     || { echo "PARADO: servico $u nao esta bloqueado." >&2; exit 1; }
done

trap - EXIT
cleanup

echo
echo '=== EXECUTOR GENERICO LIA V1 INSTALADO ==='
echo "Base commit: $EXPECTED_BASE"
echo "Runner: $BIN_DIR/lia-task-run"
echo "Aprovacao de review: $BIN_DIR/lia-review-approve"
echo "Manifestos pendentes: $PENDING_DIR"
echo "Exemplo: $EXAMPLES_DIR/generic-task-example.json"
echo 'Escopo V1: somente app/**'
echo 'Perfil V1: dev / gpt-5.4-mini'
echo 'Budget maximo por tarefa: US$ 0,10'
echo 'Testes independentes: SEM REDE'
echo 'Git push do Worker: BLOQUEADO'
echo 'Deploy de producao: BLOQUEADO'
echo 'Chamadas OpenAI realizadas nesta instalacao: ZERO'
echo "Backup: $BACKUP"
