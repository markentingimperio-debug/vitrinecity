#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

DOMAIN='lia.vitrinecity.com'
EXPECTED_IPV4='2.25.230.134'
GATEWAY='http://127.0.0.1:8787'
CADDYFILE='/etc/caddy/Caddyfile'

fail(){ echo "PARADO: $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail 'execute como root.'
for cmd in curl getent ss systemctl apt-get gpg; do
  command -v "$cmd" >/dev/null 2>&1 || fail "comando ausente: $cmd"
done

# Confirma que o DNS publico ja aponta para esta VPS antes de pedir certificado.
DNS_IPS="$(getent ahostsv4 "$DOMAIN" | awk '{print $1}' | sort -u || true)"
printf '%s\n' "$DNS_IPS" | grep -Fxq "$EXPECTED_IPV4" || fail "DNS de $DOMAIN ainda nao aponta para $EXPECTED_IPV4."

# O backend deve continuar apenas no loopback.
curl -fsS --connect-timeout 3 "$GATEWAY/health" >/tmp/lia-gateway-health-before.json || fail 'gateway local nao respondeu em 127.0.0.1:8787.'

# Nao toma portas 80/443 de outro servico existente.
if ss -ltnp '( sport = :80 or sport = :443 )' 2>/dev/null | tail -n +2 | grep -q .; then
  if ! ss -ltnp '( sport = :80 or sport = :443 )' 2>/dev/null | grep -qi caddy; then
    echo 'Portas 80/443 em uso:' >&2
    ss -ltnp '( sport = :80 or sport = :443 )' >&2 || true
    fail 'ha outro servico nas portas web; nada foi substituido.'
  fi
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl debian-keyring debian-archive-keyring apt-transport-https gpg

KEYRING='/usr/share/keyrings/caddy-stable-archive-keyring.gpg'
SOURCE='/etc/apt/sources.list.d/caddy-stable.list'
if [ ! -s "$KEYRING" ] || [ ! -s "$SOURCE" ]; then
  TMPKEY="$(mktemp)"
  TMPSRC="$(mktemp)"
  trap 'rm -f "$TMPKEY" "$TMPSRC" /tmp/lia-gateway-health-before.json /tmp/lia-gateway-health-public.json /tmp/lia-gateway-unauth-public.json' EXIT
  curl --fail --location --silent --show-error --proto '=https' --proto-redir '=https' \
    --connect-timeout 20 --max-time 120 \
    'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' -o "$TMPKEY"
  gpg --dearmor --yes --output "$KEYRING" "$TMPKEY"
  curl --fail --location --silent --show-error --proto '=https' --proto-redir '=https' \
    --connect-timeout 20 --max-time 120 \
    'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' -o "$TMPSRC"
  install -m 0644 "$TMPSRC" "$SOURCE"
fi
chmod a+r "$KEYRING" "$SOURCE"

apt-get update -y
apt-get install -y caddy

if [ -f "$CADDYFILE" ]; then
  install -d -m 0700 /var/backups/lia-dev-gateway
  cp -a "$CADDYFILE" "/var/backups/lia-dev-gateway/Caddyfile.$(date -u +%Y%m%dT%H%M%SZ).bak"
fi

cat >"$CADDYFILE" <<'CADDY'
lia.vitrinecity.com {
    encode zstd gzip

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "no-referrer"
        -Server
    }

    reverse_proxy 127.0.0.1:8787
}
CADDY
chmod 0644 "$CADDYFILE"

caddy validate --config "$CADDYFILE"
systemctl enable caddy >/dev/null 2>&1 || true
systemctl restart caddy

# Caddy obtem/renova o certificado automaticamente. Aguarda a primeira emissao.
HTTPS_OK=0
for _ in $(seq 1 60); do
  if curl -fsS --connect-timeout 5 --max-time 10 "https://$DOMAIN/health" >/tmp/lia-gateway-health-public.json 2>/dev/null; then
    HTTPS_OK=1
    break
  fi
  sleep 2
done
[ "$HTTPS_OK" -eq 1 ] || {
  systemctl status caddy --no-pager >&2 || true
  journalctl -u caddy -n 80 --no-pager >&2 || true
  fail 'HTTPS nao ficou pronto no prazo; gateway local permanece intacto.'
}

# Confirma que o endpoint protegido continua recusando chamadas sem Bearer token.
UNAUTH_CODE="$(curl -sS -o /tmp/lia-gateway-unauth-public.json -w '%{http_code}' --connect-timeout 5 --max-time 10 "https://$DOMAIN/v1/budget" || true)"
[ "$UNAUTH_CODE" = '401' ] || fail "endpoint protegido via HTTPS retornou $UNAUTH_CODE em vez de 401."

# Confirma que o backend nao ganhou bind publico.
ss -ltnp | grep -E '127\.0\.0\.1:8787' >/dev/null || fail 'bind local do gateway nao foi confirmado.'

rm -f /tmp/lia-gateway-health-before.json /tmp/lia-gateway-health-public.json /tmp/lia-gateway-unauth-public.json

echo
echo '=== HTTPS DA LIA CONFIGURADO ==='
echo "Dominio: https://$DOMAIN"
echo 'TLS: automatico via Caddy'
echo 'Gateway interno: 127.0.0.1:8787'
echo 'Endpoint protegido sem token: 401 CONFIRMADO'
echo 'Execucao de IA: continua BLOQUEADA'
echo 'OPENAI_API_KEY: continua NAO configurada por esta etapa'
echo
echo 'Health publico:'
curl -fsS "https://$DOMAIN/health"
echo
