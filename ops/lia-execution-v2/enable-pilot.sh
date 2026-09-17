#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[ "$(id -u)" -eq 0 ] || { echo 'PARADO: execute como root.' >&2; exit 1; }
for cmd in systemctl curl grep sed cp date; do command -v "$cmd" >/dev/null || { echo "PARADO: comando ausente: $cmd" >&2; exit 1; }; done

GATEWAY_ENV=/etc/lia-dev-gateway.env
WORKER_ENV=/etc/lia-codex-worker.env
BROKER_ENV=/etc/lia-openai-broker.env
for f in "$GATEWAY_ENV" "$WORKER_ENV" "$BROKER_ENV"; do [ -f "$f" ] || { echo "PARADO: ambiente ausente: $f" >&2; exit 1; }; done

# Exige a V2 já instalada e bloqueada antes de liberar o piloto.
for pair in \
  "$GATEWAY_ENV:LIA_GATEWAY_EXECUTION_ENABLED" \
  "$WORKER_ENV:LIA_CODEX_EXECUTION_ENABLED" \
  "$BROKER_ENV:LIA_BROKER_EXECUTION_ENABLED"; do
  file="${pair%%:*}"; key="${pair##*:}"
  grep -q "^${key}=0$" "$file" || { echo "PARADO: $key nao esta em 0; nenhuma mudanca feita." >&2; exit 1; }
done

grep -q '^OPENAI_API_KEY=.' "$BROKER_ENV" || { echo 'PARADO: chave OpenAI ausente no broker.' >&2; exit 1; }
grep -q '^LIA_LEASE_SECRET=.' "$GATEWAY_ENV" || { echo 'PARADO: lease secret ausente no gateway.' >&2; exit 1; }
grep -q '^LIA_LEASE_SECRET=.' "$BROKER_ENV" || { echo 'PARADO: lease secret ausente no broker.' >&2; exit 1; }

BACKUP="/var/backups/lia-pilot-enable-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP"; chmod 0700 "$BACKUP"
cp -a "$GATEWAY_ENV" "$BACKUP/gateway.env"
cp -a "$WORKER_ENV" "$BACKUP/worker.env"
cp -a "$BROKER_ENV" "$BACKUP/broker.env"

rollback(){
  echo 'Restaurando interruptores anteriores...' >&2
  cp -a "$BACKUP/gateway.env" "$GATEWAY_ENV" || true
  cp -a "$BACKUP/worker.env" "$WORKER_ENV" || true
  cp -a "$BACKUP/broker.env" "$BROKER_ENV" || true
  systemctl restart lia-openai-broker.service lia-codex-worker.service lia-dev-gateway.service || true
}
trap 'rc=$?; if [ $rc -ne 0 ]; then rollback; fi; exit $rc' EXIT

sed -i 's/^LIA_GATEWAY_EXECUTION_ENABLED=0$/LIA_GATEWAY_EXECUTION_ENABLED=1/' "$GATEWAY_ENV"
sed -i 's/^LIA_CODEX_EXECUTION_ENABLED=0$/LIA_CODEX_EXECUTION_ENABLED=1/' "$WORKER_ENV"
sed -i 's/^LIA_BROKER_EXECUTION_ENABLED=0$/LIA_BROKER_EXECUTION_ENABLED=1/' "$BROKER_ENV"
chmod 0600 "$GATEWAY_ENV" "$WORKER_ENV" "$BROKER_ENV"; chown root:root "$GATEWAY_ENV" "$WORKER_ENV" "$BROKER_ENV"

systemctl restart lia-openai-broker.service
systemctl restart lia-codex-worker.service
systemctl restart lia-dev-gateway.service

wait_health(){
  local url="$1" service="$2" out
  for _ in $(seq 1 30); do
    out="$(curl -fsS "$url" 2>/dev/null || true)"
    if printf '%s' "$out" | grep -q '"executionEnabled":true'; then
      printf '%s' "$out"
      return 0
    fi
    sleep 1
  done
  echo "PARADO: $service nao confirmou executionEnabled=true." >&2
  return 1
}

BROKER_HEALTH="$(wait_health http://127.0.0.1:8791/health broker)"
WORKER_HEALTH="$(wait_health http://127.0.0.1:8790/health worker)"
GATEWAY_HEALTH="$(wait_health http://127.0.0.1:8787/health gateway)"

# Somente leitura: confirma roteador e orçamento. Nenhum /run ou /responses é chamado.
GATEWAY_TOKEN="$(sed -n 's/^LIA_GATEWAY_TOKEN=//p' "$GATEWAY_ENV")"
[ ${#GATEWAY_TOKEN} -ge 32 ] || { echo 'PARADO: token do gateway invalido.' >&2; exit 1; }
MODELS="$(curl -fsS http://127.0.0.1:8787/v1/models -H "Authorization: Bearer $GATEWAY_TOKEN")"
for profile in economico dev codex avancado forte maximo; do printf '%s' "$MODELS" | grep -q "\"name\":\"$profile\"" || { echo "PARADO: perfil ausente: $profile" >&2; exit 1; }; done
BUDGET="$(curl -fsS http://127.0.0.1:8787/v1/budget -H "Authorization: Bearer $GATEWAY_TOKEN")"
printf '%s' "$BUDGET" | grep -q '"executionEnabled":true' || { echo 'PARADO: gateway nao confirmou piloto ativo.' >&2; exit 1; }

trap - EXIT

echo
echo '=== LIA PILOTO ATIVADO ==='
echo 'Gateway: ATIVO'
echo 'Codex Worker: ATIVO'
echo 'OpenAI Broker: ATIVO'
echo 'Model Router: CONFIRMADO'
echo 'Budget Lease: CONFIRMADO'
echo 'Rede no sandbox Codex: continua DESATIVADA'
echo 'Deploy de producao: NAO habilitado'
echo 'Tarefa paga criada por este script: NAO'
echo 'Chamadas OpenAI feitas por este script: ZERO'
echo "Backup para rollback: $BACKUP"
echo
echo 'Para DESATIVAR o piloto e voltar ao estado bloqueado:'
echo "cp -a '$BACKUP/gateway.env' '$GATEWAY_ENV' && cp -a '$BACKUP/worker.env' '$WORKER_ENV' && cp -a '$BACKUP/broker.env' '$BROKER_ENV' && systemctl restart lia-openai-broker.service lia-codex-worker.service lia-dev-gateway.service"
