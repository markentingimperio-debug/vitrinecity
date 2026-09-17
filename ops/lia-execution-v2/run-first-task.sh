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
MARKER=/opt/lia/data/first-paid-pilot.attempted
WORKSPACE_NAME=lia-first-task
WORKSPACE=/opt/lia/workspaces/$WORKSPACE_NAME
BUDGET_USD=0.10
PROFILE=dev

for f in "$GATEWAY_ENV" "$WORKER_ENV" "$BROKER_ENV"; do
  [ -f "$f" ] || { echo "PARADO: ambiente ausente: $f" >&2; exit 1; }
done

for pair in \
  "$GATEWAY_ENV:LIA_GATEWAY_EXECUTION_ENABLED" \
  "$WORKER_ENV:LIA_CODEX_EXECUTION_ENABLED" \
  "$BROKER_ENV:LIA_BROKER_EXECUTION_ENABLED"; do
  file="${pair%%:*}"; key="${pair##*:}"
  grep -q "^${key}=1$" "$file" || { echo "PARADO: piloto nao esta ativo ($key != 1)." >&2; exit 1; }
done

[ ! -e "$MARKER" ] || {
  echo "PARADO: o primeiro piloto pago ja foi tentado. Marcador: $MARKER" >&2
  echo 'Nao repita automaticamente. Revise o resultado anterior antes de nova tentativa.' >&2
  exit 1
}

GATEWAY_TOKEN="$(sed -n 's/^LIA_GATEWAY_TOKEN=//p' "$GATEWAY_ENV")"
[ ${#GATEWAY_TOKEN} -ge 32 ] || { echo 'PARADO: token do gateway invalido.' >&2; exit 1; }

# Estado anterior: estes três estavam em 1. Ao final, travamos todos em 0.
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

# Confirma modelo e orçamento antes de marcar a tentativa.
MODELS="$(curl -fsS http://127.0.0.1:8787/v1/models -H "Authorization: Bearer $GATEWAY_TOKEN")"
printf '%s' "$MODELS" | jq -e '.profiles[] | select(.name=="dev" and .model=="gpt-5.4-mini")' >/dev/null \
  || { echo 'PARADO: perfil dev/gpt-5.4-mini nao confirmado.' >&2; exit 1; }
BUDGET_STATE="$(curl -fsS http://127.0.0.1:8787/v1/budget -H "Authorization: Bearer $GATEWAY_TOKEN")"
printf '%s' "$BUDGET_STATE" | jq -e '.executionEnabled == true' >/dev/null \
  || { echo 'PARADO: gateway nao confirma piloto ativo.' >&2; exit 1; }

install -d -o lia -g lia -m 0750 "$WORKSPACE"
if [ ! -d "$WORKSPACE/.git" ]; then
  cat >"$WORKSPACE/README.md" <<'EOF'
# LIA First Task

Workspace isolado para o primeiro teste do Codex Worker. Nao e producao.
EOF
  chown lia:lia "$WORKSPACE/README.md"
  sudo -u lia -H git -C "$WORKSPACE" init -q
  sudo -u lia -H git -C "$WORKSPACE" add README.md
  sudo -u lia -H git -C "$WORKSPACE" -c user.name='LIA Pilot' -c user.email='lia@localhost' commit -qm 'chore: initialize first-task workspace'
fi

# Impede repetição automática, mesmo se a chamada falhar depois deste ponto.
printf 'started_at=%s\nworkspace=%s\nprofile=%s\nbudget_usd=%s\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$WORKSPACE_NAME" "$PROFILE" "$BUDGET_USD" >"$MARKER"
chmod 0600 "$MARKER"
chown root:root "$MARKER"

INSTRUCTION='Crie uma pagina estatica simples para validar o LIA Codex Worker. Crie index.html e styles.css. A pagina deve ter o titulo "LIA Dev Test", um pequeno texto dizendo que este e um workspace isolado e um botao sem JavaScript. Use HTML sem dependencias externas e CSS responsivo. Nao altere README.md. Nao use rede. Ao final, revise os arquivos criados e informe resumidamente o que fez.'

CREATE_JSON="$(jq -nc --arg instruction "$INSTRUCTION" --arg profile "$PROFILE" --argjson budget "$BUDGET_USD" \
  '{instruction:$instruction,profile:$profile,requestedBudgetUsd:$budget}')"
CREATE_RESP="$(curl -fsS -X POST http://127.0.0.1:8787/v1/tasks \
  -H "Authorization: Bearer $GATEWAY_TOKEN" -H 'Content-Type: application/json' --data "$CREATE_JSON")"
TASK_ID="$(printf '%s' "$CREATE_RESP" | jq -r '.task.id // empty')"
[ -n "$TASK_ID" ] || { echo 'PARADO: gateway nao retornou task id.' >&2; printf '%s\n' "$CREATE_RESP"; exit 1; }

echo "Tarefa criada: $TASK_ID"
echo "Perfil: $PROFILE (gpt-5.4-mini)"
echo "Teto autorizado: US$ $BUDGET_USD"

AUTH_RESP="$(curl -fsS -X POST "http://127.0.0.1:8787/v1/tasks/$TASK_ID/authorize" \
  -H "Authorization: Bearer $GATEWAY_TOKEN" -H 'Content-Type: application/json' --data '{"budgetUsd":0.10}')"
printf '%s' "$AUTH_RESP" | jq -e '.task.status == "authorized"' >/dev/null \
  || { echo 'PARADO: tarefa nao foi autorizada.' >&2; printf '%s\n' "$AUTH_RESP" | jq .; exit 1; }

echo 'Executando uma unica tarefa. Nao ha repeticao automatica...'
set +e
RUN_RESP="$(curl -sS --max-time 430 -w '\n__HTTP__:%{http_code}' -X POST "http://127.0.0.1:8787/v1/tasks/$TASK_ID/run" \
  -H "Authorization: Bearer $GATEWAY_TOKEN" -H 'Content-Type: application/json' \
  --data "$(jq -nc --arg workspace "$WORKSPACE_NAME" '{workspace:$workspace}')")"
CURL_RC=$?
set -e
HTTP_CODE="$(printf '%s' "$RUN_RESP" | sed -n 's/^__HTTP__://p' | tail -n1)"
BODY="$(printf '%s' "$RUN_RESP" | sed '/^__HTTP__:/d')"

if [ "$CURL_RC" -ne 0 ] || [ "$HTTP_CODE" != '200' ]; then
  echo "PILOTO NAO CONCLUIDO. curl_rc=$CURL_RC http=${HTTP_CODE:-desconhecido}"
  printf '%s\n' "$BODY" | jq . 2>/dev/null || printf '%s\n' "$BODY"
  echo 'Nao sera feita nova tentativa automatica. O piloto sera travado agora.'
  exit 1
fi

echo
echo '=== RESULTADO DA PRIMEIRA TAREFA LIA ==='
printf '%s\n' "$BODY" | jq '{status:.task.status,profile:.task.profile,spentUsd:.task.spentUsd,reservedUsd:.task.reservedUsd,model:.task.result.model,usage:.task.result.usage,finalResponse:.task.result.finalResponse}'

echo
echo '=== ARQUIVOS NO WORKSPACE ==='
sudo -u lia -H git -C "$WORKSPACE" status --short --untracked-files=all || true

echo
echo '=== DIFF ==='
sudo -u lia -H git -C "$WORKSPACE" diff -- README.md index.html styles.css || true

printf '\ncompleted_at=%s\ntask_id=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$TASK_ID" >>"$MARKER"

echo
echo 'PRIMEIRO PILOTO CONCLUIDO.'
echo 'Nenhum deploy de producao foi realizado.'
echo 'O piloto sera BLOQUEADO automaticamente ao sair deste script.'
