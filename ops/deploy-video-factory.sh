#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${VITRINE_APP_DIR:-/opt/vitrinecity}"
TARGET_REF="${VITRINE_REF:-main}"
LOCK_FILE="${VITRINE_DEPLOY_LOCK:-/var/lock/vitrinecity-video-factory.lock}"
HEALTH_ATTEMPTS="${VITRINE_HEALTH_ATTEMPTS:-40}"
HEALTH_SLEEP="${VITRINE_HEALTH_SLEEP:-3}"

log(){ printf '[video-factory-deploy] %s\n' "$*"; }
die(){ log "ERRO: $*"; exit 1; }
dc(){ docker compose "$@"; }

command -v git >/dev/null || die "git não encontrado"
command -v docker >/dev/null || die "docker não encontrado"
docker compose version >/dev/null 2>&1 || die "docker compose v2 não encontrado"
command -v flock >/dev/null || die "flock não encontrado"

mkdir -p "$(dirname "$LOCK_FILE")" 2>/dev/null || true
exec 9>"$LOCK_FILE"
flock -n 9 || die "já existe outra implantação em andamento"

cd "$APP_DIR"
[[ -d .git ]] || die "$APP_DIR não é um repositório Git"
[[ -f .env ]] || die "arquivo .env ausente em $APP_DIR"
[[ -z "$(git status --porcelain)" ]] || die "worktree possui alterações locais; implantação abortada"

env_has_value(){
  local key="$1"
  awk -v key="$key" '
    $0 ~ "^[[:space:]]*" key "[[:space:]]*=" {
      line=$0
      sub("^[[:space:]]*" key "[[:space:]]*=[[:space:]]*", "", line)
      gsub(/^[\"\047]|[\"\047][[:space:]]*$/, "", line)
      if (length(line)>0) ok=1
    }
    END { exit ok?0:1 }
  ' .env
}

for key in SITE_URL OPENROUTER_API_KEY CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_STREAM_API_TOKEN; do
  env_has_value "$key" || die "$key precisa estar preenchido no .env para geração + publicação completa"
done

PREVIOUS_SHA="$(git rev-parse HEAD)"
PREVIOUS_BRANCH="$(git symbolic-ref --short -q HEAD || true)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_NAME="vitrinecity-${STAMP}-pre-video-factory.db"
DEPLOY_STARTED=0
ROLLED_BACK=0

rollback(){
  local status=$?
  trap - ERR
  if [[ "$DEPLOY_STARTED" -eq 1 && "$ROLLED_BACK" -eq 0 ]]; then
    ROLLED_BACK=1
    log "falha detectada; restaurando código ${PREVIOUS_SHA:0:12}"
    if [[ -n "$PREVIOUS_BRANCH" ]]; then
      git switch -q "$PREVIOUS_BRANCH" || true
      git reset --hard "$PREVIOUS_SHA" || true
    else
      git switch --detach -q "$PREVIOUS_SHA" || true
    fi
    dc build app || true
    dc up -d --no-deps app || true
    log "rollback de código concluído. Backup do banco preservado em /data/backups/$BACKUP_NAME"
  fi
  exit "$status"
}
trap rollback ERR

log "validando compose atual"
dc config -q

log "criando backup online consistente do SQLite"
dc exec -T app node --input-type=module -e "
  import fs from 'node:fs';
  import Database from 'better-sqlite3';
  fs.mkdirSync('/data/backups',{recursive:true});
  const db=new Database('/data/vitrinecity.db');
  await db.backup('/data/backups/$BACKUP_NAME');
  db.close();
  console.log('backup-ok');
" >/dev/null

log "atualizando $TARGET_REF a partir de origin"
git fetch --prune origin "$TARGET_REF"
if git show-ref --verify --quiet "refs/heads/$TARGET_REF"; then
  git switch -q "$TARGET_REF"
else
  git switch -q -c "$TARGET_REF" --track "origin/$TARGET_REF"
fi
git merge --ff-only "origin/$TARGET_REF"

log "validando compose da nova revisão"
dc config -q
DEPLOY_STARTED=1

log "construindo imagem do app com FFmpeg"
dc build app

log "subindo somente o serviço app"
dc up -d --no-deps app

log "aguardando healthcheck interno"
healthy=0
for _ in $(seq 1 "$HEALTH_ATTEMPTS"); do
  if dc exec -T app node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep "$HEALTH_SLEEP"
done
[[ "$healthy" -eq 1 ]] || die "app não ficou saudável dentro da janela de verificação"

log "executando verificação específica da Fábrica Viral"
VITRINE_APP_DIR="$APP_DIR" bash ops/verify-video-factory.sh

DEPLOY_STARTED=0
trap - ERR
log "implantação concluída em $(git rev-parse --short=12 HEAD)"
log "backup pré-deploy: volume /data/backups/$BACKUP_NAME"
