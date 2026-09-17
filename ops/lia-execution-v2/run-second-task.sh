#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[ "$(id -u)" -eq 0 ] || { echo 'PARADO: execute como root.' >&2; exit 1; }
for cmd in curl jq git sudo systemctl sed grep install date; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "PARADO: comando ausente: $cmd" >&2; exit 1; }
done

GATEWAY_ENV=/etc/lia-dev-gateway.env
WORKER_ENV=/etc/lia-codex-worker.env
BROKER_ENV=/etc/lia-openai-broker.env
FIRST_MARKER=/opt/lia/data/first-paid-pilot.attempted
SECOND_MARKER=/opt/lia/data/second-paid-pilot.attempted
WORKSPACE_NAME=lia-second-task
WORKSPACE=/opt/lia/workspaces/$WORKSPACE_NAME
BUDGET_USD=0.10
PROFILE=dev

for f in "$GATEWAY_ENV" "$WORKER_ENV" "$BROKER_ENV"; do
  [ -f "$f" ] || { echo "PARADO: ambiente ausente: $f" >&2; exit 1; }
done

# A primeira tentativa precisa existir e ter falhado sem consumo.
[ -f "$FIRST_MARKER" ] || { echo 'PARADO: marcador da primeira tentativa nao existe.' >&2; exit 1; }
[ ! -e "$SECOND_MARKER" ] || { echo "PARADO: segunda tentativa ja foi iniciada. Marcador: $SECOND_MARKER" >&2; exit 1; }

# O sistema deve estar novamente travado antes de qualquer nova tentativa.
for pair in \
  "$GATEWAY_ENV:LIA_GATEWAY_EXECUTION_ENABLED" \
  "$WORKER_ENV:LIA_CODEX_EXECUTION_ENABLED" \
  "$BROKER_ENV:LIA_BROKER_EXECUTION_ENABLED"; do
  file="${pair%%:*}"; key="${pair##*:}"
  grep -q "^${key}=0$" "$file" || { echo "PARADO: $key nao esta em 0; nenhuma mudanca feita." >&2; exit 1; }
done

# Confirma o reparo do Codex CLI antes de liberar gasto.
CODEX_BIN=/opt/lia/app/node_modules/.bin/codex
[ -x "$CODEX_BIN" ] || { echo 'PARADO: Codex CLI nao esta instalado.' >&2; exit 1; }
CODEX_VERSION="$($CODEX_BIN --version 2>/dev/null || true)"
printf '%s' "$CODEX_VERSION" | grep -q '0.154.0' || { echo "PARADO: versao inesperada do Codex CLI: $CODEX_VERSION" >&2; exit 1; }

WORKER_HEALTH="$(curl -fsS http://127.0.0.1:8790/health)"
printf '%s' "$WORKER_HEALTH" | jq -e '.sdkLoaded == true and .executionEnabled == false and .version == "2026-09-17-v2"' >/dev/null \
  || { echo 'PARADO: worker nao esta saudavel e travado.' >&2; printf '%s\n' "$WORKER_HEALTH"; exit 1; }

GATEWAY_TOKEN="$(sed -n 's/^LIA_GATEWAY_TOKEN=//p' "$GATEWAY_ENV")"
[ ${#GATEWAY_TOKEN} -ge 32 ] || { echo 'PARADO: token do gateway invalido.' >&2; exit 1; }

# Confirma pelo historico do gateway que a primeira tentativa terminou sem gasto/reserva.
TASKS="$(curl -fsS http://127.0.0.1:8787/v1/tasks -H "Authorization: Bearer $GATEWAY_TOKEN")"
printf '%s' "$TASKS" | jq -e 'any(.tasks[]; .workspace=="lia-first-task" and .status=="failed" and (.spentUsd // 0)==0 and (.reservedUsd // 0)==0)' >/dev/null \
  || { echo 'PARADO: nao consegui confirmar primeira tentativa falha com US$ 0,00.' >&2; exit 1; }

# Workspace novo e isolado para evitar reaproveitar estado da tentativa anterior.
install -d -o lia -g lia -m 0750 "$WORKSPACE"
if [ -e "$WORKSPACE/.git" ]; then
  if [ -n "$(sudo -u lia -H git -C "$WORKSPACE" status --porcelain --untracked-files=all 2>/dev/null || true)" ]; then
    echo 'PARADO: workspace da segunda tentativa ja possui alteracoes.' >&2
    exit 1
  fi
else
  printf '# LIA Second Task\n\nWorkspace isolado para a segunda tentativa controlada. Nao e producao.\n' >"$WORKSPACE/README.md"
  chown lia:lia "$WORKSPACE/README.md"
  sudo -u lia -H git -C "$WORKSPACE" init -q
  sudo -u lia -H git -C "$WORKSPACE" add README.md
  sudo -u lia -H git -C "$WORKSPACE" -c user.name='LIA Pilot' -c user.email='lia@localhost' commit -qm 'chore: initialize second-task workspace'
fi

BACKUP="/var/backups/lia-second-pilot-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP"; chmod 0700 "$BACKUP"
cp -a "$GATEWAY_ENV" "$BACKUP/gateway.env"
cp -a "$WORKER_ENV" "$BACKUP/worker.env"
cp -a "$BROKER_ENV" "$BACKUP/broker.env"

disable_pilot(){
  set +e
  sed -i 's/^LIA_GATEWAY_EXECUTION_ENABLED=1$/LIA_GATEWAY_EXECUTION_ENABLED=0/' "$GATEWAY_ENV"
  sed -i 's/^LIA_CODEX_EXECUTION_ENABLED=1$/LIA_CODEX_EXECUTION_ENABLED=0/' "$WORKER_ENV"
  sed -i 's/^LIA_BROKER_EXECUTION_ENABLED=1$/LIA_BROKER_EXECUTION_ENABLED=0/' "$BROKER_ENV"
  chmod 0600 "$GATEWAY_ENV" "$WORKER_ENV" "$BROKER_ENV"
  chown root:root "$GATEWAY_ENV" "$WORKER_ENV" "$BROKER_ENV"
  systemctl restart lia-openai-broker.service lia-codex-worker.service lia-dev-gateway.service >/dev/null 2>&1 || true
}
trap 'rc=$?; disable_pilot; exit $rc' EXIT

# Libera apenas durante esta tentativa.
sed -i 's/^LIA_GATEWAY_EXECUTION_ENABLED=0$/LIA_GATEWAY_EXECUTION_ENABLED=1/' "$GATEWAY_ENV"
sed -i 's/^LIA_CODEX_EXECUTION_ENABLED=0$/LIA_CODEX_EXECUTION_ENABLED=1/' "$WORKER_ENV"
sed -i 's/^LIA_BROKER_EXECUTION_ENABLED=0$/LIA_BROKER_EXECUTION_ENABLED=1/' "$BROKER_ENV"
chmod 0600 "$GATEWAY_ENV" "$WORKER_ENV" "$BROKER_ENV"; chown root:root "$GATEWAY_ENV" "$WORKER_ENV" "$BROKER_ENV"
systemctl restart lia-openai-broker.service
systemctl restart lia-codex-worker.service
systemctl restart lia-dev-gateway.service

wait_enabled(){
  local url="$1" name="$2" out
  for _ in $(seq 1 30); do
    out="$(curl -fsS "$url" 2>/dev/null || true)"
    if printf '%s' "$out" | jq -e '.executionEnabled == true' >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo "PARADO: $name nao confirmou executionEnabled=true." >&2
  return 1
}
wait_enabled http://127.0.0.1:8791/health broker
wait_enabled http://127.0.0.1:8790/health worker
wait_enabled http://127.0.0.1:8787/health gateway

# Impede terceira tentativa automatica caso algo falhe depois deste ponto.
printf 'started_at=%s\nworkspace=%s\nprofile=%s\nbudget_usd=%s\ncodex_cli=%s\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$WORKSPACE_NAME" "$PROFILE" "$BUDGET_USD" "$CODEX_VERSION" >"$SECOND_MARKER"
chmod 0600 "$SECOND_MARKER"; chown root:root "$SECOND_MARKER"

INSTRUCTION='Crie uma pagina estatica simples para validar o LIA Codex Worker. Crie somente index.html e styles.css. A pagina deve ter o titulo "LIA Dev Test 2", um texto informando que este e um workspace isolado e um botao visual sem JavaScript. Use HTML sem dependencias externas e CSS responsivo. Nao altere README.md. Nao use rede. Ao final, revise os arquivos criados e informe resumidamente o que fez.'
CREATE_JSON="$(jq -nc --arg instruction "$INSTRUCTION" --arg profile "$PROFILE" --argjson budget "$BUDGET_USD" '{instruction:$instruction,profile:$profile,requestedBudgetUsd:$budget}')"
CREATE_RESP="$(curl -fsS -X POST http://127.0.0.1:8787/v1/tasks -H "Authorization: Bearer $GATEWAY_TOKEN" -H 'Content-Type: application/json' --data "$CREATE_JSON")"
TASK_ID="$(printf '%s' "$CREATE_RESP" | jq -r '.task.id // empty')"
[ -n "$TASK_ID" ] || { echo 'PARADO: gateway nao retornou task id.' >&2; exit 1; }

echo "Tarefa criada: $TASK_ID"
echo "Perfil: $PROFILE (gpt-5.4-mini)"
echo "Teto autorizado: US$ $BUDGET_USD"
echo "Codex CLI: $CODEX_VERSION"

AUTH_RESP="$(curl -fsS -X POST "http://127.0.0.1:8787/v1/tasks/$TASK_ID/authorize" -H "Authorization: Bearer $GATEWAY_TOKEN" -H 'Content-Type: application/json' --data '{"budgetUsd":0.10}')"
printf '%s' "$AUTH_RESP" | jq -e '.task.status == "authorized"' >/dev/null || { echo 'PARADO: tarefa nao foi autorizada.' >&2; exit 1; }

echo 'Executando UMA tentativa. Nao existe repeticao automatica...'
set +e
RUN_RESP="$(curl -sS --max-time 430 -w '\n__HTTP__:%{http_code}' -X POST "http://127.0.0.1:8787/v1/tasks/$TASK_ID/run" -H "Authorization: Bearer $GATEWAY_TOKEN" -H 'Content-Type: application/json' --data "$(jq -nc --arg workspace "$WORKSPACE_NAME" '{workspace:$workspace}')")"
CURL_RC=$?
set -e
HTTP_CODE="$(printf '%s' "$RUN_RESP" | sed -n 's/^__HTTP__://p' | tail -n1)"
BODY="$(printf '%s' "$RUN_RESP" | sed '/^__HTTP__:/d')"

if [ "$CURL_RC" -ne 0 ] || [ "$HTTP_CODE" != '200' ]; then
  echo "SEGUNDA TENTATIVA NAO CONCLUIDA. curl_rc=$CURL_RC http=${HTTP_CODE:-desconhecido}"
  printf '%s\n' "$BODY" | jq . 2>/dev/null || printf '%s\n' "$BODY"
  echo 'Nao havera repeticao automatica. O piloto sera travado agora.'
  exit 1
fi

echo
echo '=== RESULTADO DA SEGUNDA TAREFA LIA ==='
printf '%s\n' "$BODY" | jq '{status:.task.status,profile:.task.profile,spentUsd:.task.spentUsd,reservedUsd:.task.reservedUsd,model:.task.result.model,usage:.task.result.usage,finalResponse:.task.result.finalResponse}'

echo
echo '=== ARQUIVOS NO WORKSPACE ==='
sudo -u lia -H git -C "$WORKSPACE" status --short --untracked-files=all || true

echo
echo '=== DIFF ==='
sudo -u lia -H git -C "$WORKSPACE" diff -- README.md index.html styles.css || true

printf '\ncompleted_at=%s\ntask_id=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$TASK_ID" >>"$SECOND_MARKER"

echo
echo 'SEGUNDO PILOTO CONCLUIDO.'
echo 'Nenhum deploy de producao foi realizado.'
echo 'O piloto sera BLOQUEADO automaticamente ao sair deste script.'
