#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[ "$(id -u)" -eq 0 ] || { echo 'PARADO: execute como root.' >&2; exit 1; }
for cmd in curl jq git sudo systemctl sed grep install date; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "PARADO: comando ausente: $cmd" >&2; exit 1; }
done

GENV=/etc/lia-dev-gateway.env
WENV=/etc/lia-codex-worker.env
BENV=/etc/lia-openai-broker.env
MARKER=/opt/lia/data/third-paid-pilot.attempted
WORKSPACE_NAME=lia-third-task
WORKSPACE=/opt/lia/workspaces/$WORKSPACE_NAME
BUDGET_USD=0.10
PROFILE=dev

for f in "$GENV" "$WENV" "$BENV"; do
  [ -f "$f" ] || { echo "PARADO: ambiente ausente: $f" >&2; exit 1; }
done
[ ! -e "$MARKER" ] || { echo "PARADO: terceira tentativa ja foi iniciada. Marcador: $MARKER" >&2; exit 1; }

for pair in   "$GENV:LIA_GATEWAY_EXECUTION_ENABLED"   "$WENV:LIA_CODEX_EXECUTION_ENABLED"   "$BENV:LIA_BROKER_EXECUTION_ENABLED"; do
  file="${pair%%:*}"; key="${pair##*:}"
  grep -q "^${key}=0$" "$file" || { echo "PARADO: $key nao esta em 0." >&2; exit 1; }
done

curl -fsS http://127.0.0.1:8787/health | jq -e '.version=="2026-09-18-v3-budget" and .executionEnabled==false' >/dev/null   || { echo 'PARADO: gateway v3 nao confirmado.' >&2; exit 1; }
curl -fsS http://127.0.0.1:8791/health | jq -e '.version=="2026-09-18-v3-budget" and .actualUsageAccounting==true and .executionEnabled==false' >/dev/null   || { echo 'PARADO: broker v3 nao confirmado.' >&2; exit 1; }
curl -fsS http://127.0.0.1:8790/health | jq -e '.sdkLoaded==true and .executionEnabled==false' >/dev/null   || { echo 'PARADO: worker nao esta saudavel e bloqueado.' >&2; exit 1; }

GATEWAY_TOKEN="$(sed -n 's/^LIA_GATEWAY_TOKEN=//p' "$GENV")"
[ ${#GATEWAY_TOKEN} -ge 32 ] || { echo 'PARADO: token do gateway invalido.' >&2; exit 1; }

install -d -o lia -g lia -m 0750 "$WORKSPACE"
if [ -d "$WORKSPACE/.git" ]; then
  if [ -n "$(sudo -u lia -H git -C "$WORKSPACE" status --porcelain --untracked-files=all 2>/dev/null || true)" ]; then
    echo 'PARADO: workspace da terceira tentativa ja possui alteracoes.' >&2
    exit 1
  fi
else
  cat >"$WORKSPACE/README.md" <<'EOF'
# LIA Third Task

Workspace isolado para validar o Worker apos Budget V3. Nao e producao.
EOF
  chown lia:lia "$WORKSPACE/README.md"
  sudo -u lia -H git -C "$WORKSPACE" init -q
  sudo -u lia -H git -C "$WORKSPACE" add README.md
  sudo -u lia -H git -C "$WORKSPACE" -c user.name='LIA Pilot' -c user.email='lia@localhost' commit -qm 'chore: initialize third-task workspace'
fi

disable_all(){
  set +e
  sed -i 's/^LIA_GATEWAY_EXECUTION_ENABLED=1$/LIA_GATEWAY_EXECUTION_ENABLED=0/' "$GENV"
  sed -i 's/^LIA_CODEX_EXECUTION_ENABLED=1$/LIA_CODEX_EXECUTION_ENABLED=0/' "$WENV"
  sed -i 's/^LIA_BROKER_EXECUTION_ENABLED=1$/LIA_BROKER_EXECUTION_ENABLED=0/' "$BENV"
  chmod 0600 "$GENV" "$WENV" "$BENV"
  chown root:root "$GENV" "$WENV" "$BENV"
  systemctl restart lia-openai-broker.service lia-codex-worker.service lia-dev-gateway.service >/dev/null 2>&1 || true
}
trap 'rc=$?; disable_all; exit $rc' EXIT

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

printf 'started_at=%s\nworkspace=%s\nprofile=%s\nbudget_usd=%s\n'   "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$WORKSPACE_NAME" "$PROFILE" "$BUDGET_USD" >"$MARKER"
chmod 0600 "$MARKER"

INSTRUCTION='Crie somente index.html e styles.css neste workspace. A pagina deve exibir o titulo "LIA Worker V3 OK", um paragrafo informando que o teste foi executado em workspace isolado e um botao visual sem JavaScript. Use HTML sem dependencias externas e CSS responsivo. Nao altere README.md. Nao use rede. Ao final, revise os arquivos criados e responda resumidamente o que fez.'

CREATE_JSON="$(jq -nc --arg instruction "$INSTRUCTION" --arg profile "$PROFILE" --argjson budget "$BUDGET_USD" '{instruction:$instruction,profile:$profile,requestedBudgetUsd:$budget}')"
CREATE_RESP="$(curl -fsS -X POST http://127.0.0.1:8787/v1/tasks   -H "Authorization: Bearer $GATEWAY_TOKEN" -H 'Content-Type: application/json' --data "$CREATE_JSON")"
TASK_ID="$(printf '%s' "$CREATE_RESP" | jq -r '.task.id // empty')"
[ -n "$TASK_ID" ] || { echo 'PARADO: gateway nao retornou task id.' >&2; exit 1; }

curl -fsS -X POST "http://127.0.0.1:8787/v1/tasks/$TASK_ID/authorize"   -H "Authorization: Bearer $GATEWAY_TOKEN" -H 'Content-Type: application/json'   --data '{"budgetUsd":0.10}' | jq -e '.task.status=="authorized"' >/dev/null   || { echo 'PARADO: tarefa nao foi autorizada.' >&2; exit 1; }

echo "Tarefa criada: $TASK_ID"
echo "Perfil: dev (gpt-5.4-mini)"
echo "Teto: US$ 0,10"
echo "Executando UMA tentativa..."

set +e
RUN_RESP="$(curl -sS --max-time 430 -w '\n__HTTP__:%{http_code}' -X POST "http://127.0.0.1:8787/v1/tasks/$TASK_ID/run"   -H "Authorization: Bearer $GATEWAY_TOKEN" -H 'Content-Type: application/json'   --data "$(jq -nc --arg workspace "$WORKSPACE_NAME" '{workspace:$workspace}')")"
CURL_RC=$?
set -e

HTTP_CODE="$(printf '%s' "$RUN_RESP" | sed -n 's/^__HTTP__://p' | tail -n1)"
BODY="$(printf '%s' "$RUN_RESP" | sed '/^__HTTP__:/d')"

echo
echo "=== RESULTADO DA TERCEIRA TAREFA LIA ==="
echo "curl_rc=$CURL_RC http=${HTTP_CODE:-desconhecido}"
printf '%s\n' "$BODY" | jq . 2>/dev/null || printf '%s\n' "$BODY"

echo
echo "=== ARQUIVOS ==="
sudo -u lia -H git -C "$WORKSPACE" status --short --untracked-files=all || true

echo
echo "=== DIFF ==="
sudo -u lia -H git -C "$WORKSPACE" diff -- README.md index.html styles.css || true

printf '\nfinished_at=%s\ntask_id=%s\nhttp=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$TASK_ID" "${HTTP_CODE:-}" >>"$MARKER"

if [ "$CURL_RC" -ne 0 ] || [ "$HTTP_CODE" != '200' ]; then
  echo
  echo 'TERCEIRA TENTATIVA NAO CONCLUIDA. Nao havera repeticao automatica.'
  exit 1
fi

echo
echo 'TERCEIRO PILOTO CONCLUIDO.'
echo 'Nenhum deploy de producao foi realizado.'
echo 'Os tres servicos serao BLOQUEADOS automaticamente agora.'
