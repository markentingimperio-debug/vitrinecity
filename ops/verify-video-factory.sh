#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${VITRINE_APP_DIR:-/opt/vitrinecity}"
cd "$APP_DIR"
dc(){ docker compose "$@"; }
fail(){ printf '[video-factory-verify] ERRO: %s\n' "$*" >&2; exit 1; }
ok(){ printf '[video-factory-verify] OK: %s\n' "$*"; }

docker compose version >/dev/null 2>&1 || fail "docker compose v2 indisponível"
dc config -q || fail "docker compose inválido"

dc exec -T app node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1   || fail "API /api/health indisponível"
ok "API saudável"

dc exec -T app ffmpeg -version >/dev/null 2>&1 || fail "FFmpeg não está disponível no container app"
ok "FFmpeg disponível para montagem 9:16"

dc exec -T app node --input-type=module -e "
  const required=['OPENROUTER_API_KEY','CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_STREAM_API_TOKEN'];
  const missing=required.filter(name=>!String(process.env[name]||'').trim());
  if(missing.length){console.error('missing:'+missing.join(','));process.exit(2)}
  const site=String(process.env.SITE_URL||'');
  if(!/^https:\/\//i.test(site)){console.error('site_url_not_https');process.exit(3)}
" >/dev/null || fail "credenciais/URL do pipeline incompletas"
ok "OpenRouter + Cloudflare Stream + SITE_URL HTTPS configurados"

grep -q "setInterval(viralFactoryRun,30\*60\*1000)" app/server.js   || fail "scheduler de pautas não está ligado ao startup"
grep -q "setInterval(viralVideoRun,60000)" app/server.js   || fail "worker de geração/edição não está ligado ao startup"
ok "workers automáticos ligados ao startup"

dc exec -T app node --input-type=module -e "
  import Database from 'better-sqlite3';
  const db=new Database('/data/vitrinecity.db',{readonly:true});
  const exists=t=>!!db.prepare(\"SELECT 1 FROM sqlite_master WHERE type='table' AND name=?\").get(t);
  for(const t of ['viral_factory_settings','admin_viral_quizzes','viral_quiz_scenes','viral_distribution_jobs']){
    if(!exists(t)){console.error('missing_table:'+t);process.exit(4)}
  }
  const settings=db.prepare('SELECT enabled,approval_required,plants_per_day,curiosities_per_day,last_run_day,last_run_at,last_error FROM viral_factory_settings WHERE id=1').get();
  const group=(table)=>db.prepare('SELECT status,COUNT(*) total FROM '+table+' GROUP BY status ORDER BY status').all();
  const out={
    settings:{
      enabled:Boolean(settings?.enabled),
      approvalRequired:Boolean(settings?.approval_required),
      plantsPerDay:Number(settings?.plants_per_day||0),
      curiositiesPerDay:Number(settings?.curiosities_per_day||0),
      lastRunDay:settings?.last_run_day||null,
      lastRunAt:settings?.last_run_at||null,
      hasLastError:Boolean(settings?.last_error)
    },
    quizzes:group('admin_viral_quizzes'),
    scenes:group('viral_quiz_scenes'),
    distribution:group('viral_distribution_jobs')
  };
  console.log(JSON.stringify(out,null,2));
  db.close();
"
ok "schema e filas da Fábrica Viral verificados"
