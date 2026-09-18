#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[ "$(id -u)" -eq 0 ] || { echo 'PARADO: execute como root.' >&2; exit 1; }

for cmd in curl jq git sudo systemctl sed grep date journalctl awk; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "PARADO: comando ausente: $cmd" >&2; exit 1; }
done

GENV=/etc/lia-dev-gateway.env
WENV=/etc/lia-codex-worker.env
BENV=/etc/lia-openai-broker.env
WORKSPACE=/opt/lia/workspaces/vitrinecity-dev
POLICY=/opt/lia/policies/vitrinecity-dev.json
MARKER=/opt/lia/data/vitrinecity-first-real-task-v5.attempted
BASE_COMMIT='708c2bb294d4dabc08878e32e72b7b5f0af8f037'
LOCAL_BRANCH='lia/dev-worker'
ALLOWED_FILE='app/scripts/test-web-story-cta.mjs'
PROFILE='dev'
BUDGET_USD=0.10
START_TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
TASK_ID=''

for f in "$GENV" "$WENV" "$BENV" "$POLICY"; do
  [ -f "$f" ] || { echo "PARADO: arquivo ausente: $f" >&2; exit 1; }
done

[ -d "$WORKSPACE/.git" ] || { echo 'PARADO: workspace Vitrine City nao esta instalado.' >&2; exit 1; }
[ ! -e "$MARKER" ] || { echo "PARADO: tentativa V5 ja foi iniciada. Marcador: $MARKER" >&2; exit 1; }

grep -q '^LIA_GATEWAY_EXECUTION_ENABLED=0$' "$GENV" || { echo 'PARADO: gateway nao esta bloqueado.' >&2; exit 1; }
grep -q '^LIA_CODEX_EXECUTION_ENABLED=0$' "$WENV" || { echo 'PARADO: worker nao esta bloqueado.' >&2; exit 1; }
grep -q '^LIA_BROKER_EXECUTION_ENABLED=0$' "$BENV" || { echo 'PARADO: broker nao esta bloqueado.' >&2; exit 1; }
grep -q '^LIA_BROKER_MAX_REQUESTS_PER_LEASE=20$' "$BENV" || { echo 'PARADO: Broker nao esta com 20 turnos.' >&2; exit 1; }
grep -q '^LIA_BROKER_BUDGET_SAFETY_RATIO=0.90$' "$BENV" || { echo 'PARADO: margem de budget V5 ausente.' >&2; exit 1; }

jq -e   --arg base "$BASE_COMMIT"   --arg branch "$LOCAL_BRANCH"   '.workspace=="vitrinecity-dev"
   and .baseCommit==$base
   and .localBranch==$branch
   and .gitPush==false
   and .productionDeploy==false
   and .networkFromCodexSandbox==false
   and .credentialsMounted==false' "$POLICY" >/dev/null   || { echo 'PARADO: politica do workspace nao confere.' >&2; exit 1; }

HEAD="$(sudo -u lia -H git -C "$WORKSPACE" rev-parse HEAD)"
BRANCH="$(sudo -u lia -H git -C "$WORKSPACE" branch --show-current)"
STATUS="$(sudo -u lia -H git -C "$WORKSPACE" status --porcelain --untracked-files=all)"
PUSH_URL="$(sudo -u lia -H git -C "$WORKSPACE" remote get-url --push origin)"

[ "$HEAD" = "$BASE_COMMIT" ] || { echo "PARADO: HEAD inesperado: $HEAD" >&2; exit 1; }
[ "$BRANCH" = "$LOCAL_BRANCH" ] || { echo "PARADO: branch inesperada: $BRANCH" >&2; exit 1; }
[ -z "$STATUS" ] || { echo 'PARADO: workspace precisa estar limpo antes da tarefa V5.' >&2; printf '%s\n' "$STATUS" >&2; exit 1; }
[ "$PUSH_URL" = 'blocked://lia-no-push' ] || { echo 'PARADO: push nao esta bloqueado.' >&2; exit 1; }
[ ! -e "$WORKSPACE/$ALLOWED_FILE" ] || { echo "PARADO: $ALLOWED_FILE ja existe." >&2; exit 1; }

curl -fsS http://127.0.0.1:8787/health   | jq -e '.version=="2026-09-18-v5-budget" and .executionEnabled==false' >/dev/null   || { echo 'PARADO: Gateway V5 nao confirmado.' >&2; exit 1; }

curl -fsS http://127.0.0.1:8791/health   | jq -e '.version=="2026-09-18-v5-adaptive-budget"
           and .adaptiveBudgetReservation==true
           and .budgetSafetyRatio==0.9
           and .ssePassthrough==true
           and .executionEnabled==false' >/dev/null   || { echo 'PARADO: Broker V5 nao confirmado.' >&2; exit 1; }

curl -fsS http://127.0.0.1:8790/health   | jq -e '.version=="2026-09-18-v4-policy" and .sdkLoaded==true and .executionEnabled==false' >/dev/null   || { echo 'PARADO: Worker V4 policy nao confirmado.' >&2; exit 1; }

GATEWAY_TOKEN="$(sed -n 's/^LIA_GATEWAY_TOKEN=//p' "$GENV")"
[ ${#GATEWAY_TOKEN} -ge 32 ] || { echo 'PARADO: token do gateway invalido.' >&2; exit 1; }

MODELS="$(curl -fsS http://127.0.0.1:8787/v1/models -H "Authorization: Bearer $GATEWAY_TOKEN")"
printf '%s' "$MODELS"   | jq -e '.profiles[] | select(.name=="dev" and .model=="gpt-5.4-mini" and .maxOutputTokens==4096)' >/dev/null   || { echo 'PARADO: perfil dev/4096 nao confirmado.' >&2; exit 1; }

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
  [ -n "$TASK_ID" ] || return 0
  echo
  echo '=== DIAGNOSTICO AUTOMATICO BROKER V5 ==='
  journalctl -u lia-openai-broker.service --since "$START_TS" --no-pager -o cat     | grep "$TASK_ID" || true
  echo
  echo '=== DIAGNOSTICO AUTOMATICO WORKER V5 ==='
  journalctl -u lia-codex-worker.service --since "$START_TS" --no-pager -o cat     | grep -E "$TASK_ID|lia_codex_run_failed" || true
}

finish(){
  rc=$?
  if [ "$rc" -ne 0 ]; then show_diagnostics; fi
  disable_all
  exit "$rc"
}
trap finish EXIT

sed -i 's/^LIA_GATEWAY_EXECUTION_ENABLED=0$/LIA_GATEWAY_EXECUTION_ENABLED=1/' "$GENV"
sed -i 's/^LIA_CODEX_EXECUTION_ENABLED=0$/LIA_CODEX_EXECUTION_ENABLED=1/' "$WENV"
sed -i 's/^LIA_BROKER_EXECUTION_ENABLED=0$/LIA_BROKER_EXECUTION_ENABLED=1/' "$BENV"

systemctl restart lia-openai-broker.service
systemctl restart lia-codex-worker.service
systemctl restart lia-dev-gateway.service

wait_enabled(){
  local url="$1" name="$2" out
  for _ in $(seq 1 30); do
    out="$(curl -fsS "$url" 2>/dev/null || true)"
    if printf '%s' "$out" | jq -e '.executionEnabled==true' >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo "PARADO: $name nao confirmou executionEnabled=true." >&2
  return 1
}
wait_enabled http://127.0.0.1:8791/health broker
wait_enabled http://127.0.0.1:8790/health worker
wait_enabled http://127.0.0.1:8787/health gateway

printf 'started_at=%s\nworkspace=vitrinecity-dev\nprofile=%s\nbudget_usd=%s\nallowed_file=%s\n'   "$START_TS" "$PROFILE" "$BUDGET_USD" "$ALLOWED_FILE" >"$MARKER"
chmod 0600 "$MARKER"

INSTRUCTION='Leia app/web-story-cta.js. Crie somente app/scripts/test-web-story-cta.mjs usando node:test e node:assert/strict. Nao altere arquivos existentes. Teste: product e affiliate -> Ver oferta; store -> Visitar loja; course -> Ver curso; service -> Ver serviço; city -> Explorar cidade; sourceKind como fallback; recipe, group recipes, group receitas, portal receitas e category receitas -> Ver modo de preparo; fonte desconhecida e objeto vazio -> Ler matéria completa. Rode node --test app/scripts/test-web-story-cta.mjs. Nao use rede, npm install, git add, commit, push ou deploy. Resposta final em no maximo 3 linhas.'

CREATE_JSON="$(jq -nc   --arg instruction "$INSTRUCTION"   --arg profile "$PROFILE"   --argjson budget "$BUDGET_USD"   '{instruction:$instruction,profile:$profile,requestedBudgetUsd:$budget}')"

CREATE_RESP="$(curl -fsS -X POST http://127.0.0.1:8787/v1/tasks   -H "Authorization: Bearer $GATEWAY_TOKEN"   -H 'Content-Type: application/json'   --data "$CREATE_JSON")"

TASK_ID="$(printf '%s' "$CREATE_RESP" | jq -r '.task.id // empty')"
[ -n "$TASK_ID" ] || { echo 'PARADO: gateway nao retornou task id.' >&2; exit 1; }
printf 'task_id=%s\n' "$TASK_ID" >>"$MARKER"

curl -fsS -X POST "http://127.0.0.1:8787/v1/tasks/$TASK_ID/authorize"   -H "Authorization: Bearer $GATEWAY_TOKEN"   -H 'Content-Type: application/json'   --data '{"budgetUsd":0.10}'   | jq -e '.task.status=="authorized"' >/dev/null   || { echo 'PARADO: tarefa nao foi autorizada.' >&2; exit 1; }

echo "Tarefa V5: $TASK_ID"
echo 'Workspace: vitrinecity-dev'
echo "Arquivo permitido: $ALLOWED_FILE"
echo 'Perfil: dev / gpt-5.4-mini / 4096'
echo 'Teto autorizado: US$ 0,10'
echo 'Margem interna do Broker: 10%'
echo 'Executando uma unica tentativa...'

set +e
RUN_RESP="$(curl -sS --max-time 430 -w '\n__HTTP__:%{http_code}'   -X POST "http://127.0.0.1:8787/v1/tasks/$TASK_ID/run"   -H "Authorization: Bearer $GATEWAY_TOKEN"   -H 'Content-Type: application/json'   --data '{"workspace":"vitrinecity-dev"}')"
CURL_RC=$?
set -e

HTTP_CODE="$(printf '%s\n' "$RUN_RESP" | sed -n 's/^__HTTP__://p' | tail -n1)"
BODY="$(printf '%s\n' "$RUN_RESP" | sed '/^__HTTP__:/d')"

echo
echo '=== RESULTADO LIA V5 / VITRINE CITY ==='
echo "curl_rc=$CURL_RC http=${HTTP_CODE:-desconhecido}"
printf '%s\n' "$BODY" | jq . 2>/dev/null || printf '%s\n' "$BODY"

echo
echo '=== VALIDACAO DE ESCOPO ==='
CHANGED="$(sudo -u lia -H git -C "$WORKSPACE" status --porcelain --untracked-files=all)"
printf '%s\n' "$CHANGED"

BAD="$(printf '%s\n' "$CHANGED" | sed '/^$/d' | awk '{print $NF}' | grep -vxF "$ALLOWED_FILE" || true)"
if [ -n "$BAD" ]; then
  echo 'PARADO: alteracao fora do escopo permitido:' >&2
  printf '%s\n' "$BAD" >&2
  exit 1
fi

if [ "$CURL_RC" -ne 0 ] || [ "$HTTP_CODE" != '200' ]; then
  echo 'TAREFA V5 NAO CONCLUIDA. Nao havera repeticao automatica.'
  exit 1
fi

[ -f "$WORKSPACE/$ALLOWED_FILE" ] || { echo 'PARADO: teste permitido nao foi criado.' >&2; exit 1; }

NODE_CMD='export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24 >/dev/null; cd /opt/lia/workspaces/vitrinecity-dev; node --check app/web-story-cta.js; node --check app/scripts/test-web-story-cta.mjs; node --test app/scripts/test-web-story-cta.mjs'

echo
echo '=== TESTE LOCAL INDEPENDENTE ==='
sudo -u lia -H bash -lc "$NODE_CMD"

echo
echo '=== CONTEUDO DO TESTE CRIADO ==='
sed -n '1,240p' "$WORKSPACE/$ALLOWED_FILE"

echo
echo '=== DIFF ==='
sudo -u lia -H git -C "$WORKSPACE" diff --no-index -- /dev/null "$WORKSPACE/$ALLOWED_FILE" || true

trap - EXIT
disable_all

echo
echo '=== TAREFA REAL V5 CONCLUIDA ==='
echo 'Codigo de producao alterado: NAO'
echo "Novo teste: $ALLOWED_FILE"
echo 'Teste local independente: PASSOU'
echo 'Git push: BLOQUEADO'
echo 'Deploy de producao: BLOQUEADO'
echo 'Gateway/Worker/Broker: BLOQUEADOS'
