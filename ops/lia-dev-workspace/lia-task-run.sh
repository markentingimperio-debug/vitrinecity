#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[ "$(id -u)" -eq 0 ] || { echo 'PARADO: execute como root.' >&2; exit 1; }
[ "$#" -eq 1 ] || { echo 'Uso: lia-task-run <manifest.json>' >&2; exit 2; }

MANIFEST="$(readlink -f "$1")"
[ -f "$MANIFEST" ] || { echo "PARADO: manifesto ausente: $MANIFEST" >&2; exit 1; }

for cmd in curl jq git sudo systemctl sed grep date journalctl sha256sum install readlink python3; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "PARADO: comando ausente: $cmd" >&2; exit 1; }
done

GENV=/etc/lia-dev-gateway.env
WENV=/etc/lia-codex-worker.env
BENV=/etc/lia-openai-broker.env
WORKSPACE=/opt/lia/workspaces/vitrinecity-dev
POLICY=/opt/lia/policies/vitrinecity-dev.json
RUNS_ROOT=/opt/lia/task-runs
REVIEWS_ROOT=/opt/lia/reviews
COMPLETED_ROOT=/opt/lia/tasks/completed
LOCAL_BRANCH='lia/dev-worker'
MAX_BUDGET_USD='0.10'
START_TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
GATEWAY_TASK_ID=''

for f in "$GENV" "$WENV" "$BENV" "$POLICY"; do
  [ -f "$f" ] || { echo "PARADO: arquivo ausente: $f" >&2; exit 1; }
done
[ -d "$WORKSPACE/.git" ] || { echo 'PARADO: workspace Vitrine City ausente.' >&2; exit 1; }

# Manifesto: root-owned e nao gravavel pelo Worker.
OWNER_UID="$(stat -c '%u' "$MANIFEST")"
MODE_OCT="$(stat -c '%a' "$MANIFEST")"
[ "$OWNER_UID" -eq 0 ] || { echo 'PARADO: manifesto precisa pertencer ao root.' >&2; exit 1; }
case "$MODE_OCT" in
  400|440|444|600|640|644) ;;
  *) echo "PARADO: permissoes inseguras no manifesto: $MODE_OCT" >&2; exit 1 ;;
esac

jq -e '
  .schema==1
  and (.id|type=="string")
  and (.instruction|type=="string")
  and (.profile=="dev")
  and (.budgetUsd|type=="number")
  and (.baseCommit|type=="string")
  and (.workspace=="vitrinecity-dev")
  and (.commitMessage|type=="string")
  and (.allowedFiles|type=="array" and length>=1 and length<=20)
  and (.tests|type=="array" and length>=1 and length<=8)
' "$MANIFEST" >/dev/null || { echo 'PARADO: manifesto invalido.' >&2; exit 1; }

TASK_ID="$(jq -r '.id' "$MANIFEST")"
INSTRUCTION="$(jq -r '.instruction' "$MANIFEST")"
PROFILE="$(jq -r '.profile' "$MANIFEST")"
BUDGET_USD="$(jq -r '.budgetUsd' "$MANIFEST")"
BASE_COMMIT="$(jq -r '.baseCommit' "$MANIFEST")"
WORKSPACE_NAME="$(jq -r '.workspace' "$MANIFEST")"
COMMIT_MESSAGE="$(jq -r '.commitMessage' "$MANIFEST")"

[[ "$TASK_ID" =~ ^[a-z0-9][a-z0-9._-]{2,63}$ ]] || { echo 'PARADO: id da tarefa invalido.' >&2; exit 1; }
[ ${#INSTRUCTION} -ge 10 ] && [ ${#INSTRUCTION} -le 6000 ] || { echo 'PARADO: instruction deve ter 10..6000 caracteres.' >&2; exit 1; }
[ ${#COMMIT_MESSAGE} -ge 5 ] && [ ${#COMMIT_MESSAGE} -le 120 ] || { echo 'PARADO: commitMessage deve ter 5..120 caracteres.' >&2; exit 1; }

python3 - "$BUDGET_USD" "$MAX_BUDGET_USD" <<'PY'
import sys
v=float(sys.argv[1]); m=float(sys.argv[2])
if not (0 < v <= m):
    raise SystemExit(1)
PY
[ "$?" -eq 0 ] || { echo 'PARADO: budget fora do limite.' >&2; exit 1; }

POLICY_BASE="$(jq -r '.baseCommit' "$POLICY")"
[ "$BASE_COMMIT" = "$POLICY_BASE" ] || { echo "PARADO: baseCommit do manifesto difere da policy ($POLICY_BASE)." >&2; exit 1; }
[[ "$BASE_COMMIT" =~ ^[0-9a-f]{40}$ ]] || { echo 'PARADO: baseCommit invalido.' >&2; exit 1; }

mapfile -t ALLOWED_FILES < <(jq -r '.allowedFiles[]' "$MANIFEST")
for p in "${ALLOWED_FILES[@]}"; do
  [[ "$p" =~ ^app/[A-Za-z0-9._/-]+$ ]] || { echo "PARADO: arquivo fora do escopo app/: $p" >&2; exit 1; }
  [[ "$p" != *'..'* ]] || { echo "PARADO: caminho inseguro: $p" >&2; exit 1; }
  [[ "$p" != app/.git/* ]] || { echo "PARADO: caminho .git proibido: $p" >&2; exit 1; }
done
[ "$(printf '%s\n' "${ALLOWED_FILES[@]}" | sort -u | wc -l)" -eq "${#ALLOWED_FILES[@]}" ] || { echo 'PARADO: allowedFiles contem duplicatas.' >&2; exit 1; }

# Testes sao arrays de argv, sem shell. V1 permite apenas node/npm.
TEST_COUNT="$(jq '.tests|length' "$MANIFEST")"
for ((i=0;i<TEST_COUNT;i++)); do
  jq -e --argjson i "$i" '
    .tests[$i].name|type=="string"
    and (.tests[$i].command|type=="array" and length>=2 and length<=20)
    and all(.tests[$i].command[]; type=="string" and length>0 and length<=300)
  ' "$MANIFEST" >/dev/null || { echo "PARADO: teste #$i invalido." >&2; exit 1; }
  EXE="$(jq -r --argjson i "$i" '.tests[$i].command[0]' "$MANIFEST")"
  case "$EXE" in node|npm) ;; *) echo "PARADO: executavel de teste nao permitido: $EXE" >&2; exit 1 ;; esac
  while IFS= read -r arg; do
    [[ "$arg" != *$'\n'* && "$arg" != *$'\r'* && "$arg" != *$'\0'* ]] || { echo 'PARADO: argumento de teste contem controle.' >&2; exit 1; }
  done < <(jq -r --argjson i "$i" '.tests[$i].command[]' "$MANIFEST")
done

grep -q '^LIA_GATEWAY_EXECUTION_ENABLED=0$' "$GENV" || { echo 'PARADO: gateway nao esta bloqueado.' >&2; exit 1; }
grep -q '^LIA_CODEX_EXECUTION_ENABLED=0$' "$WENV" || { echo 'PARADO: worker nao esta bloqueado.' >&2; exit 1; }
grep -q '^LIA_BROKER_EXECUTION_ENABLED=0$' "$BENV" || { echo 'PARADO: broker nao esta bloqueado.' >&2; exit 1; }

HEAD="$(sudo -u lia -H git -C "$WORKSPACE" rev-parse HEAD)"
BRANCH="$(sudo -u lia -H git -C "$WORKSPACE" branch --show-current)"
STATUS="$(sudo -u lia -H git -C "$WORKSPACE" status --porcelain --untracked-files=all)"
PUSH_URL="$(sudo -u lia -H git -C "$WORKSPACE" remote get-url --push origin)"
[ "$HEAD" = "$BASE_COMMIT" ] || { echo "PARADO: HEAD $HEAD difere do baseCommit $BASE_COMMIT." >&2; exit 1; }
[ "$BRANCH" = "$LOCAL_BRANCH" ] || { echo "PARADO: branch inesperada: $BRANCH" >&2; exit 1; }
[ -z "$STATUS" ] || { echo 'PARADO: workspace precisa estar limpo.' >&2; printf '%s\n' "$STATUS" >&2; exit 1; }
[ "$PUSH_URL" = 'blocked://lia-no-push' ] || { echo 'PARADO: push nao esta bloqueado.' >&2; exit 1; }

RUN_DIR="$RUNS_ROOT/$TASK_ID"
[ ! -e "$RUN_DIR" ] || { echo "PARADO: task id ja utilizado: $TASK_ID" >&2; exit 1; }
install -d -o root -g root -m 0750 "$RUN_DIR"
install -d -o root -g root -m 0750 "$REVIEWS_ROOT" "$COMPLETED_ROOT"
install -o root -g root -m 0440 "$MANIFEST" "$RUN_DIR/manifest.json"
sha256sum "$RUN_DIR/manifest.json" >"$RUN_DIR/manifest.sha256"
chmod 0440 "$RUN_DIR/manifest.sha256"

NODE_BIN="$(sudo -u lia -H bash -c 'cd /; export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24 >/dev/null; command -v node')"
[ -x "$NODE_BIN" ] || { echo 'PARADO: Node 24 da LIA nao encontrado.' >&2; exit 1; }
NODE_DIR="$(dirname "$NODE_BIN")"
TOOL_PATH="$NODE_DIR:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

GATEWAY_TOKEN="$(sed -n 's/^LIA_GATEWAY_TOKEN=//p' "$GENV")"
[ ${#GATEWAY_TOKEN} -ge 32 ] || { echo 'PARADO: token do gateway invalido.' >&2; exit 1; }

disable_all(){
  set +e
  sed -i 's/^LIA_GATEWAY_EXECUTION_ENABLED=1$/LIA_GATEWAY_EXECUTION_ENABLED=0/' "$GENV"
  sed -i 's/^LIA_CODEX_EXECUTION_ENABLED=1$/LIA_CODEX_EXECUTION_ENABLED=0/' "$WENV"
  sed -i 's/^LIA_BROKER_EXECUTION_ENABLED=1$/LIA_BROKER_EXECUTION_ENABLED=0/' "$BENV"
  chmod 0600 "$GENV" "$WENV" "$BENV"
  chown root:root "$GENV" "$WENV" "$BENV"
  systemctl restart lia-openai-broker.service lia-codex-worker.service lia-dev-gateway.service >/dev/null 2>&1 || true
}
show_diagnostics(){
  [ -n "$GATEWAY_TASK_ID" ] || return 0
  echo
  echo '=== DIAGNOSTICO BROKER ==='
  journalctl -u lia-openai-broker.service --since "$START_TS" --no-pager -o cat | grep "$GATEWAY_TASK_ID" || true
  echo
  echo '=== DIAGNOSTICO WORKER ==='
  journalctl -u lia-codex-worker.service --since "$START_TS" --no-pager -o cat | grep -E "$GATEWAY_TASK_ID|lia_codex_run_failed" || true
}
finish(){
  rc=$?
  if [ "$rc" -ne 0 ]; then
    printf 'failed_at=%s\nexit_code=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$rc" >>"$RUN_DIR/state.txt" 2>/dev/null || true
    show_diagnostics
  fi
  disable_all
  exit "$rc"
}
trap finish EXIT

printf 'started_at=%s\nbase_commit=%s\nprofile=%s\nbudget_usd=%s\n' "$START_TS" "$BASE_COMMIT" "$PROFILE" "$BUDGET_USD" >"$RUN_DIR/state.txt"
chmod 0440 "$RUN_DIR/state.txt"

# Instrucao reforcada pelo manifesto.
ALLOWED_TEXT="$(printf '%s, ' "${ALLOWED_FILES[@]}" | sed 's/, $//')"
TEST_TEXT="$(jq -r '.tests[] | (.command|join(" "))' "$MANIFEST" | sed ':a;N;$!ba;s/\n/ ; /g')"
FULL_INSTRUCTION="Trabalhe apenas no workspace atual. Modifique SOMENTE estes arquivos: $ALLOWED_TEXT. Nao execute git add, commit, push ou deploy. Nao use rede. Nao instale dependencias. Execute somente os testes solicitados quando terminar: $TEST_TEXT. Tarefa: $INSTRUCTION"

sed -i 's/^LIA_BROKER_EXECUTION_ENABLED=0$/LIA_BROKER_EXECUTION_ENABLED=1/' "$BENV"
sed -i 's/^LIA_CODEX_EXECUTION_ENABLED=0$/LIA_CODEX_EXECUTION_ENABLED=1/' "$WENV"
sed -i 's/^LIA_GATEWAY_EXECUTION_ENABLED=0$/LIA_GATEWAY_EXECUTION_ENABLED=1/' "$GENV"
systemctl restart lia-openai-broker.service
systemctl restart lia-codex-worker.service
systemctl restart lia-dev-gateway.service

wait_enabled(){
  local url="$1" label="$2" out
  for _ in $(seq 1 30); do
    out="$(curl -fsS "$url" 2>/dev/null || true)"
    if printf '%s' "$out" | jq -e '.executionEnabled==true' >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo "PARADO: $label nao habilitou." >&2
  return 1
}
wait_enabled http://127.0.0.1:8791/health broker
wait_enabled http://127.0.0.1:8790/health worker
wait_enabled http://127.0.0.1:8787/health gateway

CREATE_JSON="$(jq -nc --arg instruction "$FULL_INSTRUCTION" --arg profile "$PROFILE" --argjson budget "$BUDGET_USD" '{instruction:$instruction,profile:$profile,requestedBudgetUsd:$budget}')"
CREATE_RESP="$(curl -fsS -X POST http://127.0.0.1:8787/v1/tasks -H "Authorization: Bearer $GATEWAY_TOKEN" -H 'Content-Type: application/json' --data "$CREATE_JSON")"
GATEWAY_TASK_ID="$(printf '%s' "$CREATE_RESP" | jq -r '.task.id // empty')"
[ -n "$GATEWAY_TASK_ID" ] || { echo 'PARADO: gateway nao retornou task id.' >&2; exit 1; }
printf 'gateway_task_id=%s\n' "$GATEWAY_TASK_ID" >>"$RUN_DIR/state.txt"

curl -fsS -X POST "http://127.0.0.1:8787/v1/tasks/$GATEWAY_TASK_ID/authorize"   -H "Authorization: Bearer $GATEWAY_TOKEN" -H 'Content-Type: application/json'   --data "$(jq -nc --argjson b "$BUDGET_USD" '{budgetUsd:$b}')"   | jq -e '.task.status=="authorized"' >/dev/null || { echo 'PARADO: autorizacao de budget falhou.' >&2; exit 1; }

echo "Tarefa generica: $TASK_ID"
echo "Gateway task: $GATEWAY_TASK_ID"
echo "Base: $BASE_COMMIT"
echo "Perfil: $PROFILE"
echo "Budget: US$ $BUDGET_USD"
echo "Arquivos permitidos: ${#ALLOWED_FILES[@]}"
echo 'Executando uma unica tentativa...'

set +e
RUN_RESP="$(curl -sS --max-time 430 -w '\n__HTTP__:%{http_code}' -X POST "http://127.0.0.1:8787/v1/tasks/$GATEWAY_TASK_ID/run" -H "Authorization: Bearer $GATEWAY_TOKEN" -H 'Content-Type: application/json' --data '{"workspace":"vitrinecity-dev"}')"
CURL_RC=$?
set -e
HTTP_CODE="$(printf '%s\n' "$RUN_RESP" | sed -n 's/^__HTTP__://p' | tail -n1)"
BODY="$(printf '%s\n' "$RUN_RESP" | sed '/^__HTTP__:/d')"
printf '%s\n' "$BODY" >"$RUN_DIR/gateway-result.json"
chmod 0440 "$RUN_DIR/gateway-result.json"

echo
echo '=== RESULTADO LIA GENERICA ==='
echo "curl_rc=$CURL_RC http=${HTTP_CODE:-desconhecido}"
printf '%s\n' "$BODY" | jq . 2>/dev/null || printf '%s\n' "$BODY"

if [ "$CURL_RC" -ne 0 ] || [ "$HTTP_CODE" != '200' ]; then
  echo 'PARADO: tarefa nao concluiu. Nao havera repeticao automatica.' >&2
  exit 1
fi

# Nenhum staging pelo agente.
sudo -u lia -H git -C "$WORKSPACE" diff --cached --quiet || { echo 'PARADO: agente alterou o index Git.' >&2; exit 1; }

mapfile -t CHANGED_FILES < <(
  python3 - "$WORKSPACE" <<'PY'
import os, subprocess, sys
w=sys.argv[1]
paths=set()
for cmd in [
    ['git','-C',w,'diff','--name-only','-z','HEAD'],
    ['git','-C',w,'ls-files','--others','--exclude-standard','-z']
]:
    raw=subprocess.check_output(cmd)
    paths.update(p.decode() for p in raw.split(b'\0') if p)
for p in sorted(paths):
    print(p)
PY
)
[ "${#CHANGED_FILES[@]}" -ge 1 ] || { echo 'PARADO: LIA nao produziu alteracoes.' >&2; exit 1; }

is_allowed(){
  local needle="$1" p
  for p in "${ALLOWED_FILES[@]}"; do [ "$p" = "$needle" ] && return 0; done
  return 1
}
for p in "${CHANGED_FILES[@]}"; do
  is_allowed "$p" || { echo "PARADO: alteracao fora do escopo: $p" >&2; exit 1; }
done

hash_allowed(){
  local p
  for p in "${ALLOWED_FILES[@]}"; do
    if [ -f "$WORKSPACE/$p" ]; then
      printf '%s  %s\n' "$(sha256sum "$WORKSPACE/$p" | awk '{print $1}')" "$p"
    elif [ -e "$WORKSPACE/$p" ]; then
      printf 'NONREGULAR  %s\n' "$p"
    else
      printf 'MISSING  %s\n' "$p"
    fi
  done | sort
}
BEFORE_TEST_HASH="$(hash_allowed)"

echo
echo '=== TESTES INDEPENDENTES ==='
: >"$RUN_DIR/test-output.txt"
for ((i=0;i<TEST_COUNT;i++)); do
  TEST_NAME="$(jq -r --argjson i "$i" '.tests[$i].name' "$MANIFEST")"
  mapfile -t ARGS < <(jq -r --argjson i "$i" '.tests[$i].command[]' "$MANIFEST")
  echo "--- $TEST_NAME ---" | tee -a "$RUN_DIR/test-output.txt"
  set +e
  systemd-run --quiet --wait --collect --pipe     -p User=lia -p Group=lia -p PrivateNetwork=yes -p PrivateTmp=yes     -p NoNewPrivileges=yes -p ProtectHome=read-only     -p WorkingDirectory="$WORKSPACE" -p "Environment=PATH=$TOOL_PATH"     -- "${ARGS[@]}" 2>&1 | tee -a "$RUN_DIR/test-output.txt"
  TEST_RC=${PIPESTATUS[0]}
  set -e
  [ "$TEST_RC" -eq 0 ] || { echo "PARADO: teste falhou: $TEST_NAME" >&2; exit 1; }
done
chmod 0440 "$RUN_DIR/test-output.txt"

AFTER_TEST_HASH="$(hash_allowed)"
[ "$BEFORE_TEST_HASH" = "$AFTER_TEST_HASH" ] || { echo 'PARADO: testes modificaram arquivos permitidos.' >&2; exit 1; }

mapfile -t AFTER_TEST_CHANGED < <(
  python3 - "$WORKSPACE" <<'PY'
import subprocess, sys
w=sys.argv[1]; paths=set()
for cmd in [['git','-C',w,'diff','--name-only','-z','HEAD'],['git','-C',w,'ls-files','--others','--exclude-standard','-z']]:
    raw=subprocess.check_output(cmd); paths.update(p.decode() for p in raw.split(b'\0') if p)
for p in sorted(paths): print(p)
PY
)
for p in "${AFTER_TEST_CHANGED[@]}"; do
  is_allowed "$p" || { echo "PARADO: teste gerou arquivo fora do escopo: $p" >&2; exit 1; }
done

# Commit local seguro.
sudo -u lia -H git -C "$WORKSPACE" add -- "${ALLOWED_FILES[@]}"
mapfile -t STAGED < <(sudo -u lia -H git -C "$WORKSPACE" diff --cached --name-only)
[ "${#STAGED[@]}" -ge 1 ] || { echo 'PARADO: nada para commitar.' >&2; exit 1; }
for p in "${STAGED[@]}"; do is_allowed "$p" || { echo "PARADO: staging fora do escopo: $p" >&2; exit 1; }; done

sudo -u lia -H git -C "$WORKSPACE" commit -m "$COMMIT_MESSAGE" >/dev/null
LOCAL_COMMIT="$(sudo -u lia -H git -C "$WORKSPACE" rev-parse HEAD)"
PARENT="$(sudo -u lia -H git -C "$WORKSPACE" rev-parse HEAD^)"
[ "$PARENT" = "$BASE_COMMIT" ] || { echo 'PARADO: parent do commit inesperado.' >&2; exit 1; }
[ -z "$(sudo -u lia -H git -C "$WORKSPACE" status --porcelain --untracked-files=all)" ] || { echo 'PARADO: workspace nao ficou limpo apos commit.' >&2; exit 1; }

# Review Pack generico.
REVIEW_DIR="$REVIEWS_ROOT/$LOCAL_COMMIT"
[ ! -e "$REVIEW_DIR" ] || { echo 'PARADO: review pack desse commit ja existe.' >&2; exit 1; }
install -d -o root -g root -m 0750 "$REVIEW_DIR"
install -o root -g root -m 0440 "$RUN_DIR/manifest.json" "$REVIEW_DIR/manifest.json"
install -o root -g root -m 0440 "$RUN_DIR/test-output.txt" "$REVIEW_DIR/test-output.txt"
sudo -u lia -H git -C "$WORKSPACE" diff --binary "$BASE_COMMIT..$LOCAL_COMMIT" >"$REVIEW_DIR/changes.patch"
sudo -u lia -H git -C "$WORKSPACE" diff --name-status "$BASE_COMMIT..$LOCAL_COMMIT" >"$REVIEW_DIR/files.txt"
sudo -u lia -H git -C "$WORKSPACE" show --stat --summary --format=fuller "$LOCAL_COMMIT" >"$REVIEW_DIR/commit.txt"

SPENT_USD="$(jq -r '.task.spentUsd // 0' "$RUN_DIR/gateway-result.json")"
jq -n   --arg repository 'markentingimperio-debug/vitrinecity'   --arg workspace "$WORKSPACE"   --arg branch "$LOCAL_BRANCH"   --arg baseCommit "$BASE_COMMIT"   --arg headCommit "$LOCAL_COMMIT"   --arg commitMessage "$COMMIT_MESSAGE"   --arg taskId "$TASK_ID"   --arg gatewayTaskId "$GATEWAY_TASK_ID"   --arg profile "$PROFILE"   --argjson budgetUsd "$BUDGET_USD"   --argjson spentUsd "$SPENT_USD"   --arg createdAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)"   --argjson files "$(printf '%s\n' "${ALLOWED_FILES[@]}" | jq -R . | jq -s .)"   --argjson tests "$(jq '.tests' "$MANIFEST")"   '{
    schema:2,repository:$repository,workspace:$workspace,branch:$branch,
    baseCommit:$baseCommit,headCommit:$headCommit,commitMessage:$commitMessage,
    taskId:$taskId,gatewayTaskId:$gatewayTaskId,profile:$profile,
    budgetUsd:$budgetUsd,spentUsd:$spentUsd,files:$files,tests:$tests,
    testStatus:"passed",gitPush:false,productionDeploy:false,
    humanApprovalRequired:true,createdAt:$createdAt
  }' >"$REVIEW_DIR/metadata.json"

chmod 0440 "$REVIEW_DIR"/*
chown root:root "$REVIEW_DIR"/*
(
  cd "$REVIEW_DIR"
  sha256sum metadata.json manifest.json changes.patch files.txt commit.txt test-output.txt >SHA256SUMS
)
chmod 0440 "$REVIEW_DIR/SHA256SUMS"
chown root:root "$REVIEW_DIR/SHA256SUMS"
chmod 0550 "$REVIEW_DIR"

install -o root -g root -m 0440 "$MANIFEST" "$COMPLETED_ROOT/$TASK_ID.json"
printf 'completed_at=%s\nlocal_commit=%s\nreview_dir=%s\nspent_usd=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$LOCAL_COMMIT" "$REVIEW_DIR" "$SPENT_USD" >>"$RUN_DIR/state.txt"
chmod 0440 "$RUN_DIR/state.txt"

trap - EXIT
disable_all

echo
echo '=== TAREFA GENERICA DA LIA CONCLUIDA ==='
echo "Task: $TASK_ID"
echo "Gateway task: $GATEWAY_TASK_ID"
echo "Commit local: $LOCAL_COMMIT"
echo "Review: $REVIEW_DIR"
echo "Custo: US$ $SPENT_USD"
echo "Arquivos alterados: ${#STAGED[@]}"
echo 'Testes independentes: PASSARAM'
echo 'Workspace: LIMPO'
echo 'Git push: BLOQUEADO'
echo 'Deploy de producao: BLOQUEADO'
echo 'Aprovacao humana para PR: PENDENTE'
