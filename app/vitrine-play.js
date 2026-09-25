import {randomUUID, createHash, timingSafeEqual} from 'node:crypto';

export const STAGES = ['script', 'scenes', 'voices', 'video', 'lipsync', 'edit', 'clips', 'social'];
const LABELS = {script:'Roteiro', scenes:'Cenas', voices:'Vozes ElevenLabs', video:'Vídeo Kling', lipsync:'Sincronização labial HeyGen', edit:'Edição', clips:'Clipes', social:'Redes sociais'};
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const json = value => JSON.stringify(value).replace(/</g, '\\u003c');
const fail = (message, status=400) => { throw Object.assign(new Error(message), {status}); };
const text = (v, max=1000) => typeof v === 'string' ? v.trim().slice(0,max) : '';
const integer = (v, min, max, label) => { const n=Number(v); if(!Number.isInteger(n)||n<min||n>max)fail(label); return n; };
const timestamp = v => { if(!v)return null; if(typeof v!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(v)||!Number.isFinite(Date.parse(v)))fail('Data inválida: informe fuso horário.'); return new Date(v).toISOString(); };
const amount = v => { const n=Number(v??0); if(!Number.isFinite(n)||n<0||n>10000)fail('Orçamento inválido.'); return Math.round(n*100); };

/** Public media is never fetched by this module. Only explicit HTTPS hosts or
 * existing local generated-media paths are accepted; no arbitrary embeds. */
export function mediaUrl(value, siteUrl, extraHosts=[]) {
  const raw=text(value,2048); if(!raw)return '';
  if(/[\\\x00-\x20\x7f]/.test(raw))fail('Endereço de mídia inválido.');
  const origin=new URL(siteUrl); let u; try { u=new URL(raw,origin); } catch { fail('Endereço de mídia inválido.'); }
  if(u.username||u.password||u.hash)fail('Endereço de mídia inválido.');
  if(u.origin===origin.origin) {
    if(!/^\/uploads\/(generated-videos|social-media)\/[A-Za-z0-9_./-]+$/.test(u.pathname)||raw.includes('..')||u.search)fail('Use uma mídia local gerada ou um CDN autorizado.');
    return u.pathname;
  }
  if(u.protocol!=='https:'||u.port||!extraHosts.includes(u.hostname.toLowerCase()))fail('Host de mídia não autorizado. Configure VITRINE_PLAY_MEDIA_HOSTS na VPS.');
  return u.href;
}
export function publicEpisode(e) {
  return {id:e.id,number:e.number,title:e.title,summary:e.summary,mediaUrl:e.mediaUrl,captionUrl:e.captionUrl,duration:e.duration,releaseAt:e.releaseAt};
}
export function productionBrief(s,e,stage,siteUrl) {
  return {schema:1,stage,stageLabel:LABELS[stage],episodeId:e.id,revision:e.revision,
    series:{title:s.title,synopsis:s.synopsis,bible:s.bible,characters:s.characters},
    episode:{number:e.number,title:e.title,summary:e.summary,targetSeconds:e.targetSeconds,script:e.script,scenes:e.scenes,outputs:e.outputs},
    rules:{language:'pt-BR',minSeconds:60,maxSeconds:90,aspectRatio:'9:16',originalStory:true,
      fixedCharacterReferences:true,fixedElementIds:true,fixedVoices:true,briefNarrator:true,instrumentalMusic:true,directProvidersOnly:true,providers:{speech:'elevenlabs',video:'kling',lipsync:'heygen',edit:'heygen_ffmpeg'},
      licensedAssetsOnly:true,aiDisclosure:true,approvedCostsOnly:true,noAdSpend:true},
    destination:new URL('/series/'+s.slug+'/'+e.number,siteUrl).href};
}
export function buildAdDraft(s,e,siteUrl) {
  const u=new URL('/series/'+s.slug+'/'+e.number,siteUrl);
  u.search=new URLSearchParams({utm_source:'meta',utm_medium:'paid_social',utm_campaign:s.slug,utm_content:'capitulo-'+e.number}).toString();
  return {status:'draft_only',enabled:false,budgetCents:0,destination:u.href,
    suggestedGoal:'Visitas à página de destino; testar engajamento separadamente.',
    copy:`${e.title}. O segredo continua em ${s.title}. Assista gratuitamente na Vitrine Play.`,
    warning:'Não cria campanhas, não consome saldo e não promete retorno. Exige conta, criativo e orçamento aprovados.'};
}

export function createPlayStore({db,siteUrl,mediaHosts=[],now=()=>Date.now()}) {
  db.exec(`CREATE TABLE IF NOT EXISTS vp_series(id TEXT PRIMARY KEY,slug TEXT NOT NULL UNIQUE,data_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS vp_episodes(id TEXT PRIMARY KEY,series_id TEXT NOT NULL REFERENCES vp_series(id),number INTEGER NOT NULL,data_json TEXT NOT NULL,UNIQUE(series_id,number));
    CREATE TABLE IF NOT EXISTS vp_jobs(id TEXT PRIMARY KEY,episode_id TEXT NOT NULL REFERENCES vp_episodes(id),revision INTEGER NOT NULL,stage TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'queued',due_at TEXT NOT NULL,lease_token TEXT,lease_until TEXT,reserved_cents INTEGER NOT NULL DEFAULT 0,result_json TEXT,error TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,UNIQUE(episode_id,revision,stage));
    CREATE INDEX IF NOT EXISTS vp_jobs_queue ON vp_jobs(status,due_at);
    CREATE TABLE IF NOT EXISTS vp_audit(id INTEGER PRIMARY KEY,kind TEXT NOT NULL,entity_id TEXT NOT NULL,created_at TEXT NOT NULL);`);
  const iso=()=>new Date(now()).toISOString(), parse=row=>row?JSON.parse(row.data_json):null;
  const series=id=>parse(db.prepare('SELECT data_json FROM vp_series WHERE id=? OR slug=?').get(id,id));
  const episode=id=>parse(db.prepare('SELECT data_json FROM vp_episodes WHERE id=?').get(id));
  const episodes=id=>db.prepare('SELECT data_json FROM vp_episodes WHERE series_id=? ORDER BY number').all(id).map(parse);
  const audit=(kind,id)=>db.prepare('INSERT INTO vp_audit(kind,entity_id,created_at) VALUES(?,?,?)').run(kind,id,iso());
  const putEpisode=e=>db.prepare('UPDATE vp_episodes SET data_json=? WHERE id=?').run(JSON.stringify(e),e.id);
  const url=v=>mediaUrl(v,siteUrl,mediaHosts);
  const allSeries=()=>db.prepare('SELECT data_json FROM vp_series ORDER BY rowid DESC LIMIT 500').all().map(parse);
  const jobs=id=>db.prepare('SELECT * FROM vp_jobs WHERE episode_id=? ORDER BY created_at,rowid').all(id).map(({lease_token,result_json,...j})=>({...j,result:result_json?JSON.parse(result_json):null}));
  function saveSeries(input,id) {
    const old=id?series(id):null;if(id&&!old)fail('Série não encontrada.',404);
    const title=text(input.title,120),slug=text(input.slug||old?.slug,80).toLowerCase();
    if(!title||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))fail('Informe título e identificador sem acentos.');
    const characters=Array.isArray(input.characters)?input.characters:[];
    if(characters.length>12)fail('Limite de 12 personagens.');
    const ids=new Set(); const cast=characters.map(c=>{
      const cid=text(c.id,40);if(!/^[a-z0-9_-]+$/.test(cid)||ids.has(cid))fail('Identificadores dos personagens devem ser únicos.');ids.add(cid);
      return {id:cid,name:text(c.name,80),description:text(c.description,800),elementId:text(c.elementId,120),voiceId:text(c.voiceId,120),referenceUrl:url(c.referenceUrl),continuity:text(c.continuity,2400)};
    });
    const s={id:old?.id||randomUUID(),slug,title,synopsis:text(input.synopsis,2000),genre:text(input.genre,60)||'Drama',bible:text(input.bible,12000),characters:cast,
      plannedEpisodes:integer(input.plannedEpisodes??old?.plannedEpisodes??12,1,100,'Use de 1 a 100 capítulos.'),
      posterUrl:url(input.posterUrl),compilationUrl:url(input.compilationUrl),status:input.status==='live'?'live':'draft',access:'free',updatedAt:iso()};
    if(old&&old.slug!==s.slug)fail('O identificador da série não pode mudar; preserve os links divulgados.');
    if(old&&episodes(old.id).some(e=>e.status!=='draft')&&JSON.stringify([old.bible,old.characters])!==JSON.stringify([s.bible,s.characters]))fail('Bíblia e elenco estão em uso. Revise os capítulos antes de alterar as referências.',409);
    try{db.prepare('INSERT INTO vp_series(id,slug,data_json) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json').run(s.id,s.slug,JSON.stringify(s));}
    catch(err){if(String(err.message).includes('UNIQUE'))fail('Já existe uma série com esse identificador.',409);throw err;}
    audit('series_saved',s.id);return s;
  }
  function saveEpisode(input,id) {
    return db.transaction(()=>{
      const old=id?episode(id):null;if(id&&!old)fail('Capítulo não encontrado.',404);
      if(old&&jobs(id).some(j=>['leased','uncertain'].includes(j.status)))fail('Há uma execução em andamento ou incerta; reconcilie o resultado antes de editar.',409);
      if(old&&Number(input.revision)!==old.revision)fail('O capítulo foi atualizado. Recarregue antes de salvar.',409);
      const s=series(old?.seriesId||input.seriesId);if(!s)fail('Série não encontrada.',404);
      const number=integer(input.number??old?.number,1,s.plannedEpisodes,'Número de capítulo inválido.');
      if(old&&number!==old.number)fail('Não altere o número de um capítulo já cadastrado.');
      const targetSeconds=integer(input.targetSeconds??80,60,90,'Os capítulos devem durar entre 60 e 90 segundos.');
      const title=text(input.title,140);if(!title)fail('Informe o título do capítulo.');
      const scenes=Array.isArray(input.scenes)?input.scenes:[];
      if(scenes.length>30||JSON.stringify(scenes).length>24000)fail('Plano de cenas muito grande.');
      const e={id:old?.id||randomUUID(),seriesId:s.id,number,title,summary:text(input.summary,2000),targetSeconds,script:text(input.script,18000),scenes,
        mediaUrl:url(input.mediaUrl),captionUrl:url(input.captionUrl),clipUrl:url(input.clipUrl),duration:input.duration?integer(input.duration,60,90,'Informe a duração real de 60 a 90 segundos.'):0,
        releaseAt:timestamp(input.releaseAt),revision:(old?.revision||0)+1,approvedRevision:0,rightsConfirmed:false,socialApproved:false,
        budgetCents:amount(input.budgetBrl),status:'draft',outputs:{},updatedAt:iso()};
      try{db.prepare('INSERT INTO vp_episodes(id,series_id,number,data_json) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json').run(e.id,s.id,number,JSON.stringify(e));}
      catch(err){if(String(err.message).includes('UNIQUE'))fail('Número de capítulo já cadastrado.',409);throw err;}
      if(old)db.prepare("UPDATE vp_jobs SET status='cancelled' WHERE episode_id=? AND status IN ('queued','blocked')").run(id);
      audit('episode_saved',e.id);return e;
    })();
  }
  function plan(id) {
    return db.transaction(()=>{
      const e=episode(id);if(!e)fail('Capítulo não encontrado.',404);if(!e.releaseAt)fail('Defina a data de lançamento.');
      const s=series(e.seriesId);if(!s)fail('Série não encontrada.',404);
      const visualCharacters=s.characters.filter(c=>c.id!=='narrador');
      if(visualCharacters.some(c=>!c.elementId))fail('Cadastre o Element permanente de todos os personagens antes de produzir.',409);
      if(s.characters.some(c=>!c.voiceId))fail('Cadastre uma voz ElevenLabs fixa para cada personagem e para o narrador antes de produzir.',409);
      const voiceIds=s.characters.map(c=>c.voiceId);
      if(new Set(voiceIds).size!==voiceIds.length)fail('Cada personagem deve ter uma voz fixa distinta para preservar a identidade sonora da série.',409);
      if(e.status==='published')fail('Este capítulo já foi publicado.',409);
      for(const stage of STAGES)db.prepare(`INSERT OR IGNORE INTO vp_jobs(id,episode_id,revision,stage,status,due_at,created_at) VALUES(?,?,?,?,'queued',?,?)`).run(randomUUID(),id,e.revision,stage,iso(),iso());
      if(e.status==='draft'){e.status='producing';putEpisode(e);}audit('pipeline_planned',id);return jobs(id);
    })();
  }
  function approve(id,input) {
    return db.transaction(()=>{
      const e=episode(id);if(!e)fail('Capítulo não encontrado.',404);
      if(Number(input.revision)!==e.revision)fail('Revisão desatualizada.',409);
      if(jobs(id).some(j=>j.revision===e.revision&&['leased','uncertain'].includes(j.status)))fail('Aguarde ou reconcilie as execuções pendentes.',409);
      if(!e.mediaUrl||e.duration<60||e.duration>90||!e.releaseAt)fail('Adicione o vídeo final, a duração real e a data.');
      if(input.rightsConfirmed!==true||input.reviewed!==true)fail('Confirme os direitos e a revisão do vídeo completo.');
      e.rightsConfirmed=true;e.approvedRevision=e.revision;e.socialApproved=false;
      e.status='approved';putEpisode(e);
      // A manually delivered master supersedes unstarted production tasks only.
      db.prepare("UPDATE vp_jobs SET status='completed',result_json=? WHERE episode_id=? AND revision=? AND stage IN ('script','scenes','voices','video','lipsync','edit') AND status IN ('queued','blocked')").run(JSON.stringify({manualMaster:true}),id,e.revision);
      audit('episode_approved',id);return e;
    })();
  }
  function approveSocial(id,input) {
    return db.transaction(()=>{
      const e=episode(id);if(!e)fail('Capítulo não encontrado.',404);
      if(Number(input.revision)!==e.revision||input.clipUrl!==e.clipUrl)fail('O clipe mudou. Recarregue e revise novamente.',409);
      if(!e.clipUrl||!e.rightsConfirmed||e.approvedRevision!==e.revision||input.reviewed!==true)fail('Revise o vídeo principal e o clipe primeiro.');
      e.socialApproved=true;putEpisode(e);audit('social_approved',id);return e;
    })();
  }
  const canPublish=e=>!!(e&&e.mediaUrl&&e.duration>=60&&e.duration<=90&&e.rightsConfirmed&&e.approvedRevision===e.revision&&e.releaseAt&&Date.parse(e.releaseAt)<=now());
  function release() {
    return db.transaction(()=>{
      let count=0;
      for(const row of db.prepare('SELECT data_json FROM vp_episodes').all()){
        const e=parse(row);if(e.status!=='approved'||!canPublish(e)||series(e.seriesId)?.status!=='live')continue;
        e.status='published';putEpisode(e);audit('episode_published',e.id);count++;
      }return count;
    })();
  }
  function catalog(slug) {
    const items=(slug?[series(slug)]:allSeries()).filter(s=>s?.status==='live');
    return items.map(s=>{
      const eps=episodes(s.id).filter(e=>e.status==='published'&&canPublish(e)).map(publicEpisode);
      return {id:s.id,slug:s.slug,title:s.title,synopsis:s.synopsis,genre:s.genre,posterUrl:s.posterUrl,access:'free',plannedEpisodes:s.plannedEpisodes,
        compilationUrl:eps.length===s.plannedEpisodes?s.compilationUrl:'',episodes:eps};
    });
  }
  function claim(stage,maxCostBrl) {
    if(!STAGES.includes(stage))fail('Etapa inválida.');const reserve=amount(maxCostBrl);
    return db.transaction(()=>{
      // Never retry uncertain paid calls automatically after a crash/timeout.
      db.prepare("UPDATE vp_jobs SET status='uncertain',error='Prazo expirou; reconciliar antes de repetir.' WHERE status='leased' AND lease_until<?").run(iso());
      const rows=db.prepare("SELECT * FROM vp_jobs WHERE status='queued' AND stage=? AND due_at<=? ORDER BY created_at,rowid LIMIT 100").all(stage,iso());
      for(const j of rows){
        const e=episode(j.episode_id);if(!e||e.revision!==j.revision)continue;
        const predecessors=STAGES.slice(0,STAGES.indexOf(stage));
        const history=jobs(e.id).filter(x=>x.revision===e.revision);
        if(predecessors.some(p=>!history.some(x=>x.stage===p&&x.status==='completed')))continue;
        if(stage==='social'&&(!e.socialApproved||e.status!=='published'||!e.clipUrl))continue;
        if(['script','scenes','voices','video','edit'].includes(stage)&&['approved','published'].includes(e.status))continue;
        const spent=Number(db.prepare("SELECT COALESCE(SUM(reserved_cents),0) n FROM vp_jobs WHERE episode_id=? AND status IN ('leased','completed','uncertain','blocked')").get(e.id).n);
        if(spent+reserve>e.budgetCents)continue;
        const token=randomUUID(),leaseUntil=new Date(now()+30*60*1000).toISOString();
        const changed=db.prepare("UPDATE vp_jobs SET status='leased',lease_token=?,lease_until=?,reserved_cents=? WHERE id=? AND status='queued'").run(token,leaseUntil,reserve,j.id);
        if(!changed.changes)continue;audit('job_claimed',j.id);
        return {id:j.id,leaseToken:token,leaseUntil,maxCostCents:reserve,brief:productionBrief(series(e.seriesId),e,stage,siteUrl)};
      }return null;
    })();
  }
  function complete(id,input) {
    return db.transaction(()=>{
      const j=db.prepare('SELECT * FROM vp_jobs WHERE id=?').get(id);if(!j)fail('Tarefa não encontrada.',404);
      if(!input.leaseToken||input.leaseToken!==j.lease_token)fail('Reserva inválida.',409);
      if(j.status==='completed')return {duplicate:true};
      if(!['leased','uncertain'].includes(j.status))fail('Tarefa não aceita resultado.',409);
      const e=episode(j.episode_id);if(e.revision!==j.revision)fail('Revisão antiga.',409);
      const actual=amount(input.actualCostBrl);if(actual>j.reserved_cents)fail('Custo excede o limite reservado; reconciliação necessária.',409);
      const r=input.result;if(!r||typeof r!=='object'||Array.isArray(r)||JSON.stringify(r).length>60000)fail('Resultado inválido.');
      const result={};
      if(j.stage==='script'){result.script=text(r.script,18000);if(result.script.length<80)fail('Roteiro incompleto.');e.script=result.script;}
      if(j.stage==='scenes'){
        if(!Array.isArray(r.scenes)||!r.scenes.length||r.scenes.length>30)fail('Plano de cenas inválido.');
        result.scenes=r.scenes.map((s,i)=>({number:i+1,description:text(s.description,1200),seconds:integer(s.seconds,1,90,'Duração de cena inválida.'),dialogue:text(s.dialogue,1000)}));
        const total=result.scenes.reduce((n,s)=>n+s.seconds,0);if(total<60||total>90)fail('As cenas devem somar 60 a 90 segundos.');e.scenes=result.scenes;
      }
      if(['voices','video','lipsync'].includes(j.stage)){
        if(!Array.isArray(r.assets)||!r.assets.length||r.assets.length>60)fail('Informe os arquivos realmente gerados.');
        result.assets=r.assets.map(a=>({url:url(a.url),label:text(a.label,100)}));if(result.assets.some(a=>!a.url))fail('Arquivo ausente.');
      }
      if(j.stage==='edit'){result.mediaUrl=url(r.mediaUrl);result.captionUrl=url(r.captionUrl);result.duration=integer(r.duration,60,90,'A edição deve durar 60 a 90 segundos.');if(!result.mediaUrl)fail('Vídeo final ausente.');e.mediaUrl=result.mediaUrl;e.captionUrl=result.captionUrl;e.duration=result.duration;e.status='review';}
      if(j.stage==='clips'){result.clipUrl=url(r.clipUrl);if(!result.clipUrl)fail('Clipe ausente.');e.clipUrl=result.clipUrl;e.socialApproved=false;}
      if(j.stage==='social'){
        if(!Array.isArray(r.posts)||!r.posts.length||r.posts.length>10)fail('Informe os comprovantes das publicações.');
        result.posts=r.posts.map(p=>({platform:text(p.platform,30),postId:text(p.postId,150)}));if(result.posts.some(p=>!p.platform||!p.postId))fail('Comprovante de publicação incompleto.');
      }
      e.outputs[j.stage]=result;putEpisode(e);
      db.prepare("UPDATE vp_jobs SET status='completed',reserved_cents=?,result_json=?,error='' WHERE id=?").run(actual,JSON.stringify(result),id);audit('job_completed',id);return {duplicate:false};
    })();
  }
  function block(id,input) {
    const j=db.prepare('SELECT * FROM vp_jobs WHERE id=?').get(id);
    if(!j||!input.leaseToken||input.leaseToken!==j.lease_token||j.status!=='leased')fail('Reserva inválida.',409);
    db.prepare("UPDATE vp_jobs SET status='uncertain',error=? WHERE id=?").run(text(input.error,300)||'Execução precisa de revisão.',id);audit('job_uncertain',id);return {ok:true};
  }
  function reconcile(id,input) {
    return db.transaction(()=>{
      const j=db.prepare('SELECT * FROM vp_jobs WHERE id=?').get(id);if(!j||!['uncertain','blocked'].includes(j.status))fail('Tarefa não requer reconciliação.',409);
      if(input.confirmNotExecuted!==true)fail('Confirme no provedor que não houve execução/cobrança antes de repetir.');
      db.prepare("UPDATE vp_jobs SET status='queued',lease_token=NULL,lease_until=NULL,reserved_cents=0,error='' WHERE id=?").run(id);audit('job_reconciled_no_charge',id);return {ok:true};
    })();
  }
  return {series,episode,episodes,allSeries,jobs,saveSeries,saveEpisode,plan,approve,approveSocial,release,catalog,claim,complete,block,reconcile,
    dashboard:()=>({series:allSeries(),episodes:db.prepare('SELECT data_json FROM vp_episodes ORDER BY rowid DESC LIMIT 1000').all().map(parse),jobs:db.prepare('SELECT id,episode_id,revision,stage,status,due_at,reserved_cents,error FROM vp_jobs ORDER BY rowid DESC LIMIT 1000').all(),mode:'free',adExecutionEnabled:false}),
    sitemapPaths:()=>['/series',...catalog().flatMap(s=>['/series/'+s.slug,...s.episodes.map(e=>'/series/'+s.slug+'/'+e.number)])]};
}

function document(title,description,body,{admin=false,canonical='',bootstrap=null}={}) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} | Vitrine Play</title><meta name="description" content="${esc(description)}">${admin?'<meta name="robots" content="noindex,nofollow">':''}${canonical?`<link rel="canonical" href="${esc(canonical)}"><meta property="og:url" content="${esc(canonical)}">`:''}<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:type" content="website"><link rel="stylesheet" href="/vitrine-play.css"><script defer src="/vitrine-play-client.js"></script></head><body data-play-mode="${admin?'admin':'public'}"><header class="topbar"><a class="brand" href="/series">VITRINE <b>PLAY</b></a><nav aria-label="Navegação"><a href="/">Vitrine City</a><a href="/series">Séries</a>${admin?'<a href="/admin.html">Administração</a>':''}</nav></header><main>${body}</main><footer>Vitrine Play · Histórias originais da Vitrine City.<br>Conteúdo de ficção produzido com recursos de inteligência artificial.</footer>${bootstrap?`<script type="application/json" id="play-data">${json(bootstrap)}</script>`:''}</body></html>`;
}
function catalogHtml(items,siteUrl) {
  const cards=items.map(s=>`<article class="series-card">${s.posterUrl?`<img loading="lazy" src="${esc(s.posterUrl)}" alt="Capa de ${esc(s.title)}">`:`<div class="poster-art" aria-hidden="true"><span>VITRINE PLAY ORIGINAL</span><strong>${esc(s.title)}</strong></div>`}<div class="card-body"><small>${esc(s.genre)} · ${s.episodes.length?'GRÁTIS':'EM PRODUÇÃO'}</small><h2><a href="/series/${esc(s.slug)}">${esc(s.title)}</a></h2><p>${esc(s.synopsis)}</p><a class="button" href="/series/${esc(s.slug)}">${s.episodes.length?'Assistir agora':'Conhecer a série'}</a></div></article>`).join('');
  return document('Histórias curtas. Grandes segredos.','Minisséries originais com capítulos de 60 a 90 segundos. Assista gratuitamente na Vitrine Play.',`<section class="hero"><span class="eyebrow">VITRINE CITY APRESENTA</span><h1>Histórias curtas.<br><em>Grandes segredos.</em></h1><p>Romance, escolhas e reviravoltas. Capítulos de 1 a 1 minuto e meio para assistir no seu ritmo.</p><span class="badge">Acesso gratuito nesta fase de lançamento</span></section><section><h2>Escolha sua próxima história</h2><div class="series-grid">${cards||'<div class="empty"><h3>As primeiras histórias estão em produção.</h3><p>Os capítulos aparecerão aqui depois da revisão e do lançamento.</p></div>'}</div></section>`,{canonical:new URL('/series',siteUrl).href});
}
function seriesHtml(s,chapter,siteUrl) {
  const selected=s.episodes.find(e=>e.number===Number(chapter))||s.episodes[0];
  const list=s.episodes.map(e=>`<a class="episode-link${e.id===selected?.id?' active':''}" href="/series/${esc(s.slug)}/${e.number}" data-episode="${e.number}"><span>${String(e.number).padStart(2,'0')}</span><div><strong>${esc(e.title)}</strong><small>${e.duration}s · Capítulo completo</small></div><span>▶</span></a>`).join('');
  return document(s.title,s.synopsis,`<a class="back" href="/series">← Todas as séries</a><section class="series-heading"><span class="eyebrow">${esc(s.genre)} · ORIGINAL VITRINE PLAY</span><h1>${esc(s.title)}</h1><p>${esc(s.synopsis)}</p><span class="badge">Grátis · ${s.episodes.length} de ${s.plannedEpisodes} capítulos disponíveis</span></section><section class="watch-layout"><div><div class="player-wrap">${selected?`<video id="play-video" controls playsinline preload="metadata" src="${esc(selected.mediaUrl)}">${selected.captionUrl?`<track kind="captions" srclang="pt-BR" label="Português" src="${esc(selected.captionUrl)}" default>`:''}Seu navegador não suporta vídeo.</video>`:'<div class="empty"><h2>Em produção</h2><p>A estreia aparecerá aqui quando o primeiro capítulo estiver aprovado.</p></div>'}</div><h2 id="episode-title">${esc(selected?.title||'A história está chegando')}</h2><p id="episode-summary">${esc(selected?.summary||'')}</p><p id="play-status" role="status"></p>${selected?'<div class="actions"><button id="resume-play" class="secondary" hidden>Continuar de onde parei</button><button id="marathon" class="button">Maratonar capítulos disponíveis</button><button id="share-play" class="secondary">Compartilhar</button></div>':''}${s.compilationUrl?`<p><a class="button" href="${esc(s.compilationUrl)}">Assistir à temporada em vídeo único</a></p>`:''}</div><aside><h2>Capítulos completos</h2><div class="episode-list">${list||'<p>Nenhum capítulo lançado.</p>'}</div><a class="shop-link" href="/?utm_source=vitrine_play&amp;utm_medium=internal&amp;utm_campaign=${esc(s.slug)}">Explore também a Vitrine City →</a></aside></section>`,{canonical:new URL('/series/'+s.slug+(chapter?'/'+chapter:''),siteUrl).href,bootstrap:{series:s,selected:selected?.number||null}});
}

export function setupVitrinePlay({app,db,requireAdmin,sameOriginOnly,siteUrl,env=process.env,now}) {
  if(!app||!db||typeof requireAdmin!=='function'||typeof sameOriginOnly!=='function')throw new TypeError('Vitrine Play requer banco e autenticação administrativa.');
  const origin=new URL(siteUrl).origin,mediaHosts=String(env.VITRINE_PLAY_MEDIA_HOSTS||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
  const store=createPlayStore({db,siteUrl:origin,mediaHosts,now});
  const workerToken=String(env.VITRINE_PLAY_WORKER_TOKEN||'');const configured=workerToken.length>=32;
  const handle=fn=>(req,res)=>{try{res.set('Cache-Control','no-store');return fn(req,res);}catch(e){return res.status(e.status||500).json({error:e.status?e.message:'Não foi possível concluir esta operação.'});}};
  const jsonOnly=(req,res,next)=>req.is?.('application/json')?next():res.status(415).json({error:'Envie application/json.'});
  const mutate=[requireAdmin,sameOriginOnly,jsonOnly];
  const workerAuth=(req,res,next)=>{
    const supplied=String(req.get('authorization')||'').replace(/^Bearer /,'');
    const digest=v=>createHash('sha256').update(v).digest();
    if(!configured||!timingSafeEqual(digest(supplied),digest(workerToken)))return res.status(401).json({error:'Worker não autorizado.'});return next();
  };
  app.get('/vitrine-play',(_req,res)=>res.redirect(302,'/series'));
  app.get('/series',handle((_req,res)=>res.type('html').send(catalogHtml(store.catalog(),origin))));
  const show=(req,res)=>{const s=store.catalog(req.params.slug)[0];const n=req.params.chapter;if(!s||(n&&!s.episodes.some(e=>String(e.number)===n)))return res.status(404).type('html').send(document('Capítulo indisponível','Este capítulo ainda não está disponível.','<h1>Capítulo indisponível</h1><a href="/series">Voltar às séries</a>'));return res.type('html').send(seriesHtml(s,n,origin));};
  app.get('/series/:slug',handle(show));app.get('/series/:slug/:chapter',handle(show));
  app.get('/api/series',handle((_req,res)=>res.json({items:store.catalog()})));
  app.get('/admin-series.html',requireAdmin,handle((_req,res)=>res.type('html').send(document('Estúdio de minisséries','Produção, revisão e cronograma da Vitrine Play.',`<section class="series-heading"><span class="eyebrow">PAINEL ADMINISTRATIVO</span><h1>Estúdio de minisséries</h1><p>Roteiro → cenas → vozes → vídeo → edição → revisão → site → clipes → redes.</p></section><div class="notice">Lançamento gratuito. Anúncios desativados. Geração exige um worker conectado e limite de custo aprovado por capítulo.</div><div id="admin-status" role="status">Carregando…</div><div id="play-admin"></div>`,{admin:true}))));
  app.get('/api/admin/series',requireAdmin,handle((_req,res)=>res.json({...store.dashboard(),worker:{credentialsConfigured:configured,executionAdapter:'external-worker-required'},mediaHosts})));
  app.post('/api/admin/series',...mutate,handle((req,res)=>res.status(201).json(store.saveSeries(req.body))));
  app.put('/api/admin/series/:id',...mutate,handle((req,res)=>res.json(store.saveSeries(req.body,req.params.id))));
  app.post('/api/admin/series/episodes',...mutate,handle((req,res)=>res.status(201).json(store.saveEpisode(req.body))));
  app.put('/api/admin/series/episodes/:id',...mutate,handle((req,res)=>res.json(store.saveEpisode(req.body,req.params.id))));
  app.post('/api/admin/series/episodes/:id/plan',...mutate,handle((req,res)=>res.json({jobs:store.plan(req.params.id)})));
  app.post('/api/admin/series/episodes/:id/approve',...mutate,handle((req,res)=>res.json(store.approve(req.params.id,req.body))));
  app.post('/api/admin/series/episodes/:id/approve-social',...mutate,handle((req,res)=>res.json(store.approveSocial(req.params.id,req.body))));
  app.post('/api/admin/series/release',...mutate,handle((_req,res)=>res.json({published:store.release()})));
  app.post('/api/admin/series/jobs/:id/reconcile',...mutate,handle((req,res)=>res.json(store.reconcile(req.params.id,req.body))));
  app.get('/api/admin/series/episodes/:id/packet',requireAdmin,handle((req,res)=>{const e=store.episode(req.params.id);if(!e)fail('Capítulo não encontrado.',404);res.json({brief:productionBrief(store.series(e.seriesId),e,'script',origin),jobs:store.jobs(e.id),adDraft:buildAdDraft(store.series(e.seriesId),e,origin)});}));
  app.post('/api/worker/vitrine-play/claim',workerAuth,jsonOnly,handle((req,res)=>res.json({job:store.claim(req.body.stage,req.body.maxCostBrl)})));
  app.post('/api/worker/vitrine-play/jobs/:id/complete',workerAuth,jsonOnly,handle((req,res)=>res.json(store.complete(req.params.id,req.body))));
  app.post('/api/worker/vitrine-play/jobs/:id/fail',workerAuth,jsonOnly,handle((req,res)=>res.json(store.block(req.params.id,req.body))));
  // This timer publishes ONLY reviewed local masters. It never calls AI/ad APIs.
  const timer=env.VITRINE_PLAY_SCHEDULER==='off'?null:setInterval(()=>{try{store.release();}catch(err){console.error('[vitrine-play] release_failed',err.code||'unknown');}},30000);timer?.unref();
  return {...store,close:()=>timer&&clearInterval(timer)};
}
