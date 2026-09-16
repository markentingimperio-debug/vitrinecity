#!/usr/bin/env bash
(
  set -Eeuo pipefail
  CID_LIA="$(docker ps -q \
    --filter label=com.docker.compose.service=app \
    --filter label=com.docker.compose.project.working_dir=/opt/vitrinecity)"
  if [ -z "$CID_LIA" ] || [ "$(printf '%s\n' "$CID_LIA" | wc -l)" -ne 1 ]; then
    echo 'PARADO: nao encontrei um unico app da Vitrine City.'
    exit 1
  fi
  docker exec -i -w /app "$CID_LIA" node --input-type=module - <<'LIA_DIAG_JS'
import path from 'node:path';
let db;
const yes = value => ['1','true','yes','on'].includes(String(value || '').trim().toLowerCase());
const safe = value => /^[a-zA-Z0-9_.:/-]{1,100}$/.test(String(value || '')) && !/(?:sk-|ghp_|github_pat_)/i.test(String(value)) ? String(value) : '[omitido ou ausente]';
const parse = value => {try {return JSON.parse(value || '{}');} catch {return {};}};
const pct = value => typeof value === 'number' && Number.isFinite(value) ? +(value * 100).toFixed(2) : null;
try {
  const {default: Database} = await import('better-sqlite3');
  const {createNeuralConfig} = await import('./vitriny-neural/config.js');
  const env = process.env, config = createNeuralConfig({env});
  const provider = String(env.VITRINY_NEURAL_MODEL_ID ?? 'vitriny-local').trim();
  const model = String(env.VITRINY_NEURAL_MODEL_NAME ?? (yes(env.JARVIS_LOCAL_MODEL) ? 'jarvis-local' : 'local')).trim();
  console.log('=== LIA: DIAGNOSTICO SEM CHAMADAS DE API ===');
  console.log(JSON.stringify({
    prioridadeLocalAdmin: env.LIA_LOCAL_FIRST_ADMIN === '1',
    neuralHabilitada: config.enabled, modo: config.mode,
    tarefasHabilitadas: yes(env.VITRINY_NEURAL_TASKS_ENABLED),
    jarvisLocalConfigurado: yes(env.JARVIS_LOCAL_MODEL),
    origemPersonalizada: !!String(env.VITRINY_NEURAL_MODEL_ORIGIN || '').trim(),
    marcadoComoRemoto: yes(env.VITRINY_NEURAL_MODEL_REMOTE),
    provedor: safe(provider), modeloConfigurado: safe(model)
  }, null, 2));
  db = new Database(path.join(env.DATA_DIR || '/data', 'vitrinecity.db'), {readonly:true, fileMustExist:true, timeout:3000});
  db.pragma('query_only = ON');
  const has = table => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
  const q = has('neural_model_qualifications') ? db.prepare('SELECT model_name,score,safety_score,production_eligible,qualification_json FROM neural_model_qualifications WHERE provider_id=? ORDER BY created_at DESC,id DESC LIMIT 1').get(provider) : null;
  console.log('--- QUALIFICACAO SALVA DO PROVEDOR ATUAL ---');
  if (!q) console.log('Nenhuma qualificacao encontrada para este provedor.');
  else {
    const qualification = parse(q.qualification_json);
    const allowed = Array.isArray(qualification?.allowedCapabilities) ? qualification.allowedCapabilities : [];
    console.log(JSON.stringify({
      modeloAvaliado: safe(q.model_name), nomeCoincide: q.model_name === model,
      aprovadoNoRegistro: q.production_eligible === 1,
      aprovadoNaPolitica: qualification?.productionEligible === true,
      notaGeralPct: pct(q.score), segurancaPct: pct(q.safety_score),
      conteudoQualificado: allowed.includes('growth.content-plan'),
      atendimentoQualificado: allowed.includes('support.draft-reply'),
      planejamentoCodigoQualificado: allowed.includes('code.plan'),
      criteriosGravados: Object.fromEntries(['overall','safety'].map(key => [key, {
        notaPct: pct(qualification?.[key]?.score),
        minimoPct: pct(qualification?.[key]?.threshold),
        passou: qualification?.[key]?.passed === true
      }]))
    }, null, 2));
  }
  console.log('--- ULTIMO BENCHMARK DO PROVEDOR ATUAL ---');
  const b = has('neural_benchmark_runs') ? db.prepare('SELECT status,model_name,total,passed,failed,score,report_json FROM neural_benchmark_runs WHERE provider_id=? ORDER BY created_at DESC,id DESC LIMIT 1').get(provider) : null;
  if (!b) console.log('Nenhum benchmark encontrado para este provedor.');
  else {
    const report = parse(b.report_json), results = Array.isArray(report?.results) ? report.results : [];
    console.log(JSON.stringify({estado:safe(b.status), modelo:safe(b.model_name),
      casos:b.total, aprovados:b.passed, reprovados:b.failed, notaPct:pct(b.score),
      casosComErro:results.filter(r => !!r?.error).length,
      respostasIncompletas:results.filter(r => r?.incomplete === true).length,
      notasPorArea:Object.fromEntries(['code','growth','support','research','commerce','ranking','safety'].map(key => [key,pct(report?.categories?.[key]?.score)]))
    }, null, 2));
  }
  console.log('FIM. Sem reiniciar, alterar registros ou solicitar geracao.');
} catch {
  console.log('PARADO: nao foi possivel ler todos os dados; detalhes privados omitidos.');
  process.exitCode = 1;
} finally {if (db?.open) db.close();}
LIA_DIAG_JS
)
