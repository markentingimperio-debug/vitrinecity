import {randomUUID} from 'node:crypto';
import {countWhatsAppSchedules} from './whatsapp-schedule-worker.js';

const API='/api/admin/ecosystem',ZONE='America/Sao_Paulo',LEASE=120000;
const GROUPS=['products','services','news','recipes','sports','trends'];
const labels={products:'Produtos e ofertas',services:'Serviços, cursos e lojas',news:'Notícias',recipes:'Receitas',sports:'Esportes',trends:'Tendências e cidade'};
const fail=(message,status=400)=>Object.assign(Error(message),{status,ecosystemSafe:true});
const local=time=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(time).map(x=>[x.type,x.value]));
const day=time=>{const p=local(time);return `${p.year}-${p.month}-${p.day}`;};
const iso=value=>value?new Date(value).toISOString():null;
const nextDay=value=>new Date(Date.parse(value+'T12:00:00Z')+86400000).toISOString().slice(0,10);
function slot(date,hour){const target=Date.parse(`${date}T${String(hour).padStart(2,'0')}:00:00Z`);let guess=target;for(let i=0;i<4;i++){const p=local(guess),actual=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:00:00Z`),delta=target-actual;if(!delta)break;guess+=delta;}return guess;}
export function ecosystemLocalWindow(time=Date.now()){const date=day(time);return {day:date,hour:Number(local(time).hour),start:new Date(slot(date,0)).toISOString(),end:new Date(slot(nextDay(date),0)).toISOString()};}
export function ecosystemProviderIssue(value){const text=String(value||'');return /zdr|data.policy|data.collection|privacy|no endpoints found matching/i.test(text)?{code:'provider_data_policy',detail:'O provedor bloqueou a geração por política de dados. A configuração precisa ser revisada; nenhuma proteção foi alterada.'}:/insufficient.{0,30}credits|key limit exceeded|\b402\b/i.test(text)?{code:'provider_balance',detail:'O provedor informou limite ou saldo insuficiente. Confira a conta antes de repetir a geração.'}:/unauthorized|invalid.{0,20}key|\b401\b/i.test(text)?{code:'provider_access',detail:'O provedor recusou a autorização. Confira a conexão da conta.'}:/rate.limit|\b429\b/i.test(text)?{code:'provider_rate_limit',detail:'O provedor aplicou um limite temporário de solicitações.'}:{code:'provider_generation_failed',detail:'A geração não foi concluída. Confira a tarefa no estúdio antes de tentar novamente.'};}

/** Coordinates existing processors. It never creates an alternative content
 * generator, resets their quotas, or writes a remote publication itself. */
export function createEcosystemOrchestrator({db,getStories,catalog,runInternalSocial=async()=>({}),getInternalSocial=()=>({}),now=Date.now,schedule=true}){
  db.exec(`CREATE TABLE IF NOT EXISTS ecosystem_policy(
    id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL DEFAULT 1,enabled INTEGER NOT NULL DEFAULT 0,
    paused INTEGER NOT NULL DEFAULT 0,daily_limit INTEGER NOT NULL DEFAULT 6,hour INTEGER NOT NULL DEFAULT 9,
    groups_json TEXT NOT NULL DEFAULT '${JSON.stringify(GROUPS)}',internal_social_enabled INTEGER NOT NULL DEFAULT 0,
    lease_owner TEXT NOT NULL DEFAULT '',lease_until INTEGER NOT NULL DEFAULT 0,last_day TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL DEFAULT 0,updated_by TEXT NOT NULL DEFAULT 'system',publisher_user_id INTEGER);
    INSERT OR IGNORE INTO ecosystem_policy(id) VALUES(1);
    CREATE TABLE IF NOT EXISTS ecosystem_daily_plan(
      id TEXT PRIMARY KEY,day TEXT NOT NULL,item_key TEXT NOT NULL,kind TEXT NOT NULL,label TEXT NOT NULL,status TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',source_key TEXT,story_id TEXT,started_at INTEGER,finished_at INTEGER,url TEXT NOT NULL DEFAULT '',
      UNIQUE(day,item_key));
    CREATE TABLE IF NOT EXISTS ecosystem_events(id INTEGER PRIMARY KEY,event TEXT NOT NULL,title TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',status TEXT NOT NULL,actor TEXT NOT NULL,created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_ecosystem_plan_day ON ecosystem_daily_plan(day);
    CREATE INDEX IF NOT EXISTS idx_ecosystem_events_time ON ecosystem_events(created_at);`);
  if(!db.prepare('PRAGMA table_info(ecosystem_policy)').all().some(x=>x.name==='publisher_user_id'))db.exec('ALTER TABLE ecosystem_policy ADD COLUMN publisher_user_id INTEGER');
  let pending=null,closed=false,timer=null;
  const row=()=>db.prepare('SELECT * FROM ecosystem_policy WHERE id=1').get();
  const policy=()=>{const s=row();return {revision:s.revision,enabled:!!s.enabled,paused:!!s.paused,dailyLimit:s.daily_limit,hour:s.hour,groups:JSON.parse(s.groups_json),internalSocialEnabled:!!s.internal_social_enabled,publisherUserId:s.publisher_user_id,updatedAt:iso(s.updated_at),timeZone:ZONE};};
  const canRun=()=>!closed&&!row().paused;
  const isCurrent=revision=>canRun()&&row().revision===revision;
  const event=(name,title,status='completed',actor='system',detail='')=>db.prepare('INSERT INTO ecosystem_events(event,title,detail,status,actor,created_at) VALUES(?,?,?,?,?,?)').run(name,title,detail,status,String(actor).slice(0,160),now());
  const item=(key,kind,label,status,details={})=>db.prepare(`INSERT INTO ecosystem_daily_plan(id,day,item_key,kind,label,status,reason,source_key,story_id,started_at,finished_at,url)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(day,item_key) DO UPDATE SET label=excluded.label,status=excluded.status,reason=excluded.reason,
    source_key=excluded.source_key,story_id=excluded.story_id,started_at=excluded.started_at,finished_at=excluded.finished_at,url=excluded.url`)
    .run(details.id||randomUUID(),details.date||day(now()),key,kind,label,status,details.reason||'',details.sourceKey||null,details.storyId||null,details.startedAt||null,details.finishedAt||null,details.url||'');
  function harvest(automation){
    for(const job of automation.history||[]){
      if(typeof job.id!=='number'||!/^\d{4}-\d{2}-\d{2}$/.test(job.day))continue;
      item('story:'+job.id,'story',labels[job.sourceGroup]||'Conteúdo e Web Story',job.status,{id:'story-job:'+job.id,date:job.day,reason:String(job.summary||job.reason||'').slice(0,500),sourceKey:job.sourceKey,storyId:job.storyId,startedAt:job.startedAt,finishedAt:job.finishedAt,url:'/admin-web-stories'});
    }
  }
  function snapshot(){
    const p=policy(),automation=getStories().automation.status();
    const inventory=catalog?.snapshot?catalog.snapshot({days:7}):{};
    const exceptions=[];
    if(p.paused)exceptions.push({id:'global-pause',title:'Rotinas pausadas',detail:'Novas gerações, publicações e envios aguardam a retomada. Resultados já enviados são preservados.'});
    if(!automation.configured)exceptions.push({id:'ai-unavailable',title:'IA de conteúdo indisponível',detail:'Configure o provedor de texto e imagem antes de iniciar a rotina.',actionLabel:'Abrir estúdio',actionUrl:'/admin-web-stories'});
    for(const job of (automation.history||[]).filter(x=>x.day===day(now())&&['review','failed','interrupted'].includes(x.status)).slice(0,10))exceptions.push({id:'story:'+job.id,title:job.status==='review'?'Conteúdo aguardando revisão':'Produção não concluída',detail:String(job.summary||job.reason||'Confira a tarefa antes de tentar novamente.').slice(0,500),actionLabel:'Revisar conteúdo',actionUrl:'/admin-web-stories'});
    const items=db.prepare('SELECT id,item_key key,kind,label,status,reason,source_key sourceKey,story_id storyId,started_at startedAt,finished_at finishedAt,url FROM ecosystem_daily_plan WHERE day=? ORDER BY COALESCE(started_at,0),id').all(day(now())).filter(x=>x.kind!=='story').map(x=>({...x,startedAt:iso(x.startedAt),finishedAt:iso(x.finishedAt)}));
    for(const job of (automation.history||[]).filter(x=>x.day===day(now())))items.push({id:'story-job:'+job.id,key:'story:'+job.id,kind:'story',label:labels[job.sourceGroup]||'Conteúdo e Web Story',status:job.status,reason:String(job.summary||job.reason||'').slice(0,500),sourceKey:job.sourceKey,storyId:job.storyId,startedAt:iso(job.startedAt),finishedAt:iso(job.finishedAt),url:'/admin-web-stories'});
    const exists=table=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
    const counts=table=>exists(table)?Object.fromEntries(db.prepare(`SELECT status,count(*) total FROM ${table} GROUP BY status`).all().map(x=>[x.status,x.total])):null;
    const whatsapp=exists('whatsapp_qr_schedules')?countWhatsAppSchedules(db.prepare('SELECT status,confirmation_state,claimed_at,provider_message_id FROM whatsapp_qr_schedules').all(),now()):null;
    const modules={videos:{projects:counts('admin_viral_quizzes'),scenes:counts('viral_quiz_scenes')},books:counts('digital_books'),whatsapp,comments:counts('social_content_comment_events'),gestora:{tasks:counts('admin_agent_tasks'),mode:'controlled_tools',weightTraining:false}};
    if(modules.videos.scenes?.failed){const last=db.prepare("SELECT error_message FROM viral_quiz_scenes WHERE status='failed' ORDER BY updated_at DESC,id DESC LIMIT 1").get();const issue=ecosystemProviderIssue(last?.error_message);modules.videos.issue=issue;exceptions.push({id:'video-production',title:`${modules.videos.scenes.failed} cenas de vídeo não concluídas`,detail:issue.detail,actionLabel:'Abrir vídeos',actionUrl:'/admin-quizzes.html'});}
    if(modules.whatsapp?.failed||modules.whatsapp?.unknown)exceptions.push({id:'whatsapp-failed',title:`${(modules.whatsapp.failed||0)+(modules.whatsapp.unknown||0)} envios de WhatsApp precisam de revisão`,detail:`${modules.whatsapp.unknown||0} sem confirmação; ${modules.whatsapp.failed||0} falhas. Confira as conversas antes de qualquer novo envio; não haverá repetição automática.`,actionLabel:'Abrir campanhas',actionUrl:'/admin-chatbotx.html'});
    const plannedDay=row().last_day>=day(now())?nextDay(day(now())):day(now());
    return {policy:p,automation,modules,distributions:getInternalSocial(),plan:{date:day(now()),items,nextAt:p.enabled&&!p.paused&&(automation.configured||p.internalSocialEnabled)?new Date(Math.max(now(),slot(plannedDay,p.hour))).toISOString():null},
      inventory:inventory.inventory||[],connections:inventory.connections||[],metrics:inventory.metrics||{items:[]},
      agents:[{id:'editorial',name:'Produção editorial e Web Stories',status:p.paused?'paused':automation.running?'running':!automation.configured?'blocked':automation.quota.review&&!automation.quota.published?'review':automation.quota.failed&&!automation.quota.published?'blocked':'ready',detail:'Usa a fila existente, revisão editorial e limite diário. Configuração não garante aprovação do conteúdo.'},{id:'internal-social',name:'Divulgação na Vitrine Social',status:p.paused?'paused':p.internalSocialEnabled?'ready':'disabled',detail:'Distribui conteúdo público aprovado; a confirmação aparece no histórico.'},
        {id:'videos',name:'Estúdio de vídeos',status:p.paused?'paused':modules.videos.scenes?.failed?'blocked':modules.videos.projects?.in_production?'running':'ready',detail:modules.videos.projects?`${modules.videos.projects.in_production||0} projetos em produção; ${modules.videos.scenes?.failed||0} cenas com falha. A central não força novas gerações de vídeo.`:'Estúdio indisponível nesta instalação.'},
        {id:'whatsapp',name:'Campanhas de WhatsApp',status:p.paused?'paused':modules.whatsapp?.failed||modules.whatsapp?.unknown?'review':modules.whatsapp?.pending?'queued':'ready',detail:modules.whatsapp?`${modules.whatsapp.pending||0} agendamentos pendentes; ${modules.whatsapp.sent||0} aceitos pelo serviço; ${modules.whatsapp.unknown||0} sem confirmação; ${modules.whatsapp.failed||0} falhas. Aceito não significa entregue ou lido.`:'Fila indisponível nesta instalação.'},
        {id:'gestora',name:'IA Gestora e Jarvis',status:'ready',detail:`Ferramentas controladas e conhecimento do ecossistema. ${modules.gestora.tasks?.awaiting_approval||0} tarefas aguardam aprovação; ${modules.gestora.tasks?.completed||0} concluídas no histórico. Esta rotina não treina os pesos de um modelo.`}],
      exceptions,events:db.prepare('SELECT id,title,detail,status,created_at at FROM ecosystem_events ORDER BY id DESC LIMIT 30').all().map(x=>({...x,at:iso(x.at)}))};
  }
  function updatePolicy(input={},actor='admin'){
    db.transaction(()=>{
      const previous=policy();if(!Number.isInteger(input.revision)||input.revision!==previous.revision)throw fail('As opções mudaram em outra sessão. Atualize a central.',409);
      for(const key of Object.keys(input))if(!['revision','enabled','paused','dailyLimit','hour','groups','internalSocialEnabled'].includes(key))throw fail('Opção de rotina desconhecida.');
      const next={...previous,...input};
      if(['enabled','paused','internalSocialEnabled'].some(key=>typeof next[key]!=='boolean')||!Number.isInteger(next.dailyLimit)||next.dailyLimit<1||next.dailyLimit>24||!Number.isInteger(next.hour)||next.hour<0||next.hour>23||!Array.isArray(next.groups)||!next.groups.length||next.groups.length>GROUPS.length||new Set(next.groups).size!==next.groups.length||next.groups.some(g=>!GROUPS.includes(g)))throw fail('Confira as opções, o horário e o limite diário de 1 a 24 conteúdos.');
      // Pausing alone never overwrites individual module settings. Disabling the
      // coordinator also leaves their existing enabled settings intact.
      const publisher=previous.publisherUserId??(next.enabled?Number(actor):null);
      if(next.enabled&&(!Number.isSafeInteger(Number(actor))||Number(actor)<=0||!Number.isSafeInteger(publisher)||publisher<=0))throw fail('Administrador autenticado necessário para coordenar a rotina.',403);
      const adjustStories=next.enabled&&(input.enabled===true||['dailyLimit','hour','groups'].some(key=>Object.hasOwn(input,key)));
      if(adjustStories){const automation=getStories().automation,current=automation.status();if(!current.configured)throw fail('Configure a IA de texto e imagem antes de habilitar a rotina diária.',503);automation.updateSettings({revision:current.revision,enabled:true,dailyLimit:next.dailyLimit,hour:next.hour,groups:next.groups},actor);}
      db.prepare('UPDATE ecosystem_policy SET revision=revision+1,enabled=?,paused=?,daily_limit=?,hour=?,groups_json=?,internal_social_enabled=?,publisher_user_id=?,updated_at=?,updated_by=? WHERE id=1').run(Number(next.enabled),Number(next.paused),next.dailyLimit,next.hour,JSON.stringify(GROUPS.filter(g=>next.groups.includes(g))),Number(next.internalSocialEnabled),publisher,now(),String(actor).slice(0,160));
      event(next.paused!==previous.paused?'pause_changed':'policy_changed',next.paused?'Pausa geral ativada':previous.paused?'Rotinas liberadas para retomada':'Rotina diária atualizada','completed',actor);
    }).immediate();return snapshot();
  }
  async function execute(context){
    let heartbeat;
    const current=()=>isCurrent(context.revision)&&row().enabled&&row().lease_owner===context.owner&&row().lease_until>now();
    try{
      heartbeat=setInterval(()=>{if(current())db.prepare('UPDATE ecosystem_policy SET lease_until=? WHERE id=1 AND lease_owner=?').run(now()+LEASE,context.owner);},15000);heartbeat.unref?.();
      const stories=getStories();if(!current())return;
      const before=stories.automation.status(),produce=before.quota.remaining>0&&before.configured&&before.enabled;
      if(produce){
        await stories.sync?.();if(!current())return;
        item('production','content','Produzir conteúdo e Web Stories','running',{startedAt:context.startedAt});
        stories.automation.run({manual:true,actor:context.actor});await stories.automation.awaitIdle();
      }
      const state=stories.automation.status();harvest(state);if(!current()){item('production','content','Produzir conteúdo e Web Stories','interrupted',{startedAt:context.startedAt,finishedAt:now(),reason:'As opções ou a pausa geral mudaram.'});return;}
      const fresh=(state.history||[]).filter(x=>x.startedAt>=context.startedAt),published=fresh.some(x=>x.status==='published'),review=fresh.some(x=>x.status==='review'),failed=fresh.some(x=>['failed','interrupted'].includes(x.status));
      const resultStatus=!produce?'blocked':published?'completed':review?'review':failed?'failed':'blocked';
      const reason=!produce?(before.quota.remaining<=0?'O limite diário de produção foi atingido. A distribuição de conteúdo aprovado continua disponível.':'A geração está indisponível; somente conteúdo já aprovado pode ser distribuído.'):published?'Rodada concluída; confira as publicações individuais.':review?'A rodada terminou com conteúdos em revisão, sem publicação confirmada.':failed?'A rodada terminou sem publicação; confira as falhas individuais.':'Nenhuma fonte elegível encontrada; nenhum conteúdo foi publicado.';
      item('production','content','Produzir conteúdo e Web Stories',resultStatus,{startedAt:context.startedAt,finishedAt:now(),reason});
      if(policy().internalSocialEnabled){
        item('internal-social','distribution','Divulgar na Vitrine Social','running',{startedAt:now()});
        const result=await runInternalSocial({isCurrent:current});
        item('internal-social','distribution','Divulgar na Vitrine Social',!current()?'interrupted':result?.held?'review':'completed',{finishedAt:now(),reason:`${Number(result?.published)||0} publicações confirmadas; ${Number(result?.held)||0} pendências para revisão.`});
        for(const post of result?.items||[])item('distribution:'+post.id,'distribution','Publicação na Vitrine Social',post.status==='held'?'review':post.status,{reason:String(post.reason||'').slice(0,500),url:String(post.url||'').slice(0,2000),finishedAt:now()});
      }
      if(current())event('round_finished','Rodada diária concluída','completed',context.actor);
    }catch{item('production','content','Produzir conteúdo e Web Stories','failed',{startedAt:context.startedAt,finishedAt:now(),reason:'A rotina não terminou. Confira as tarefas existentes antes de repetir.'});event('round_failed','Rodada diária não concluída','failed',context.actor);}
    finally{clearInterval(heartbeat);if(!current())db.prepare("UPDATE ecosystem_daily_plan SET status='interrupted',reason='As opções ou a pausa geral mudaram.',finished_at=? WHERE day=? AND item_key IN ('production','internal-social') AND status IN ('planned','running')").run(now(),day(context.startedAt));db.prepare("UPDATE ecosystem_policy SET lease_owner='',lease_until=0 WHERE id=1 AND lease_owner=?").run(context.owner);}
  }
  function run({manual=true,actor='admin'}={}){
    if(closed)throw fail('A rotina está encerrada.',409);if(pending)return snapshot();
    const context=db.transaction(()=>{
      const s=row(),time=now(),date=day(time),automation=getStories().automation.status();
      if(!s.enabled||s.paused)throw fail(s.paused?'Retome a pausa geral antes de iniciar.':'Ative a coordenação diária antes de iniciar.',409);
      if((!automation.configured||!automation.enabled)&&!s.internal_social_enabled)throw fail('A produção de Web Stories precisa estar configurada e habilitada.',409);
      if(s.lease_owner&&s.lease_until>time)return null;
      if(automation.running){if(manual)throw fail('A fila de Web Stories já está executando. Aguarde a rodada atual.',409);return null;}
      if(s.lease_owner)db.prepare("UPDATE ecosystem_daily_plan SET status='interrupted',reason='A execução anterior foi interrompida. As filas existentes preservam seus resultados.',finished_at=? WHERE status IN ('planned','running') AND kind!='story'").run(time);
      if(!manual&&(s.last_day>=date||Number(local(time).hour)<s.hour))return null;
      if(automation.quota.remaining<=0&&!s.internal_social_enabled){if(manual)throw fail('O limite diário de produção já foi utilizado.',409);return null;}
      const owner=randomUUID();db.prepare('UPDATE ecosystem_policy SET lease_owner=?,lease_until=?,last_day=? WHERE id=1').run(owner,time+LEASE,date);
      item('production','content','Produzir conteúdo e Web Stories','planned',{startedAt:time,reason:'Usa o limite e as verificações do estúdio existente.'});
      event('round_started','Rodada diária iniciada','running',actor);
      return {owner,revision:s.revision,startedAt:time,actor:String(actor).slice(0,160)};
    }).immediate();
    if(context)pending=Promise.resolve().then(()=>execute(context)).finally(()=>{pending=null;});return snapshot();
  }
  function close(){closed=true;clearInterval(timer);}
  if(schedule){timer=setInterval(()=>{try{if(policy().enabled&&!policy().paused)run({manual:false,actor:'scheduler'});}catch{/* A later tick rechecks settings and existing quotas. */}},30000);timer.unref?.();}
  return {snapshot,policy,updatePolicy,run,canRun,isCurrent,close,awaitIdle:async()=>{await pending;return snapshot();},list:options=>catalog.list(options)};
}

export function registerEcosystemRoutes({app,service,requireAdmin,sameOriginOnly}){
  const route=fn=>async(req,res)=>{res.set('Cache-Control','no-store');try{await fn(req,res);}catch(error){res.status(error.ecosystemSafe?error.status:500).json({error:error.ecosystemSafe?error.message:'Não foi possível concluir a rotina. Atualize a central.'});}};
  app.get(API,requireAdmin,route((_req,res)=>res.json(service.snapshot())));
  app.get(API+'/catalog',requireAdmin,route((req,res)=>{const offset=Number(req.query.offset||0),limit=Number(req.query.limit||24),kind=String(req.query.kind||'products');if(!['products','stores','pages','buildings','networks'].includes(kind)||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>200)throw fail('Página de catálogo inválida.');res.json(service.list({kind,q:String(req.query.q||'').slice(0,200),offset,limit}));}));
  app.post(API+'/policy',requireAdmin,sameOriginOnly,route((req,res)=>res.json(service.updatePolicy(req.body,req.user?.id||'admin'))));
  app.post(API+'/run',requireAdmin,sameOriginOnly,route((req,res)=>res.status(202).json(service.run({manual:true,actor:req.user?.id||'admin'}))));
}
