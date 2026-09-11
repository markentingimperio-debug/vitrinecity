import {createHash} from 'node:crypto';
import {WHATSAPP_THEMATIC_GROUPS,providerGroups,whatsappGroupPermission} from './whatsapp-group-directory.js';
import {isWhatsAppCommercialGroupAllowed} from './whatsapp-commercial-policy.js';

const API='/api/admin/whatsapp-qr/thematic-plan',PREFIX='thematic-v1:',MINUTE=60000;
const definitions=new Map(WHATSAPP_THEMATIC_GROUPS.map(group=>[group.jid,group]));
const day=now=>new Date(now-3*60*MINUTE).toISOString().slice(0,10);
const hour=now=>new Date(now-3*60*MINUTE).getUTCHours();
export const thematicScheduleId=(jid,date)=>'thematic-'+createHash('sha256').update(`${PREFIX}${jid}|${date}`).digest('hex').slice(0,40);
const safeFailure=(message,status=409)=>Object.assign(Error(message),{status,campaignSafe:true,notSubmitted:true});
const title=value=>String(value||'').replace(/<[^>]*>/g,'').replace(/[\r\n]+/g,' ').trim().slice(0,180);

export function setupWhatsAppThematicGroups({app,db,requireAdmin,sameOriginOnly,siteUrl,whatsappQrRequest,whatsappQrData,getSitemapLinks,canRun=()=>true,now=Date.now,isGroupAllowed=isWhatsAppCommercialGroupAllowed}){
  const origin=new URL(siteUrl).origin;
  db.exec(`CREATE TABLE IF NOT EXISTS whatsapp_thematic_settings (
    id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL DEFAULT 0,groups_json TEXT NOT NULL DEFAULT '[]',
    revision INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_by TEXT NOT NULL DEFAULT ''
  ); INSERT OR IGNORE INTO whatsapp_thematic_settings(id) VALUES(1);`);
  const settings=()=>{const row=db.prepare('SELECT * FROM whatsapp_thematic_settings WHERE id=1').get();let ids=[];try{ids=JSON.parse(row.groups_json)}catch{}return {...row,groups:Array.isArray(ids)?ids.filter(id=>definitions.has(id)):[]};};
  const configured=(jid,revision)=>{const current=settings();return Boolean(canRun()&&current.enabled&&current.groups.includes(jid)&&(revision===undefined||current.revision===revision)&&isGroupAllowed(jid));};
  const campaign=group=>PREFIX+group.id;
  const existing=(group,date)=>db.prepare('SELECT * FROM whatsapp_qr_schedules WHERE id=?').get(thematicScheduleId(group.jid,date));
  const unresolved=group=>Boolean(db.prepare("SELECT 1 FROM whatsapp_qr_schedules WHERE campaign_id=? AND (confirmation_state='unknown' OR status='processing') LIMIT 1").get(campaign(group)));
  const snapshot=async()=>{
    const state=whatsappQrData(await whatsappQrRequest('/session/status'));
    if(!(state.connected||state.Connected)||!(state.loggedIn||state.LoggedIn))throw safeFailure('Conecte o WhatsApp antes de programar os grupos.');
    const groups=providerGroups(whatsappQrData(await whatsappQrRequest('/group/list')));
    return {state,groups:new Map(groups.map(group=>[String(group.JID||group.jid||''),group]))};
  };
  function groupReady(group,connection){
    const actual=connection.groups.get(group.jid);
    return Boolean(actual&&actual.Name===group.name&&whatsappGroupPermission(actual,connection.state).canPost&&isGroupAllowed(group.jid));
  }
  function sources(topic,links){
    const allowed=new Set(links),out=[];
    if(topic==='platform')for(const [pathname,name] of [['/','Conheça a VitrineCity'],['/loja','Produtos das lojas da VitrineCity'],['/centro-educacional.html','Cursos da VitrineCity'],['/servicos-digitais.html','Serviços digitais da VitrineCity'],['/como-funciona.html','Como funciona a VitrineCity']]){
      const url=new URL(pathname,origin).href;if(allowed.has(url))out.push({url,title:name});
    }
    if(topic==='recipes'||topic==='plants'){
      const portal=topic==='recipes'?'receitas':'plantas-e-jardinagem';
      for(const article of db.prepare("SELECT slug,title FROM editorial_articles WHERE status='published' AND portal=? ORDER BY published_at DESC,slug LIMIT 100").all(portal)){
        if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(article.slug)||!title(article.title))continue;
        const url=new URL('/artigo/'+article.slug,origin).href;if(allowed.has(url))out.push({url,title:title(article.title)});
      }
    }
    return out;
  }
  const canonical=url=>{try{const value=new URL(url);return value.origin+value.pathname}catch{return ''}};
  function selectSource(group,links){
    const options=sources(group.topic,links);
    if(firstPlatform(group))return options.find(source=>source.url===origin+'/')||null;
    const history=db.prepare('SELECT sitemap_url,MAX(scheduled_at) lastUsed FROM whatsapp_qr_schedules WHERE campaign_id=? GROUP BY sitemap_url').all(campaign(group));
    const used=new Map(history.map(row=>[canonical(row.sitemap_url),row.lastUsed]));
    return options.map((source,index)=>({...source,index,lastUsed:used.get(source.url)||''})).sort((a,b)=>a.lastUsed.localeCompare(b.lastUsed)||a.index-b.index)[0]||null;
  }
  const firstPlatform=group=>group.topic==='platform'&&!db.prepare("SELECT 1 FROM whatsapp_qr_schedules WHERE campaign_id=? AND status='sent' AND confirmation_state='confirmed' AND provider_message_id IS NOT NULL LIMIT 1").get(campaign(group));
  function body(group,source){
    if(firstPlatform(group))return 'Olá! Este grupo agora reúne novidades e oportunidades da VitrineCity: lojas, cursos e conteúdos da plataforma. Fique à vontade para acompanhar os assuntos que interessam a você. Conheça a cidade pelo link abaixo.';
    return group.topic==='recipes'?`🍲 Receita para compartilhar: ${source.title}\n\nConfira os ingredientes e o preparo na VitrineCity.`:group.topic==='plants'?`🌱 Cuidados com plantas: ${source.title}\n\nLeia o conteúdo completo e siga as orientações do rótulo ao usar produtos.`:`🏙️ ${source.title}\n\nConheça esta área da plataforma e escolha o que faz sentido para você.`;
  }
  const tracked=(url,group)=>{const result=new URL(url);result.searchParams.set('utm_source','whatsapp');result.searchParams.set('utm_medium','group');result.searchParams.set('utm_campaign','thematic-v1');result.searchParams.set('utm_content',group.id);return result.href;};
  async function plan(ids){
    const [connection,links]=await Promise.all([snapshot(),getSitemapLinks()]);
    const date=day(now()),time=now();
    return ids.map(id=>definitions.get(id)).map(group=>{
      const prior=existing(group,date),ready=groupReady(group,connection),source=selectSource(group,links),index=WHATSAPP_THEMATIC_GROUPS.indexOf(group);
      const planned=Date.parse(`${date}T10:${String(index*5).padStart(2,'0')}:00-03:00`),scheduled=Math.max(planned,time+(2+index*5)*MINUTE);
      const reason=prior?'already_scheduled':unresolved(group)?'prior_result_needs_review':!ready?'group_permission_or_name':!source?'no_published_source':hour(time)<10||hour(scheduled)>=18?'outside_window':'';
      return {groupJid:group.jid,groupId:group.id,groupName:group.name,topic:group.topic,day:date,reason,id:thematicScheduleId(group.jid,date),scheduledAt:prior?.scheduled_at||new Date(scheduled).toISOString(),...(prior?{sourceUrl:canonical(prior.sitemap_url),url:prior.sitemap_url,message:prior.message,status:prior.status,confirmationState:prior.confirmation_state}:source?{sourceUrl:source.url,url:tracked(source.url,group),message:body(group,source)}:{})};
    });
  }
  let running=false,nextCheck=0;
  async function scheduleDue(){
    if(running||now()<nextCheck||!canRun())return {scheduled:0};
    const state=settings(),date=day(now());if(!state.enabled||!state.groups.length||hour(now())<10||hour(now())>=18)return {scheduled:0};
    const needed=state.groups.filter(id=>!existing(definitions.get(id),date));if(!needed.length)return {scheduled:0};
    running=true;nextCheck=now()+5*MINUTE;
    try{
      const proposals=await plan(needed),insert=db.prepare(`INSERT OR IGNORE INTO whatsapp_qr_schedules(id,group_jid,group_name,sitemap_url,message,scheduled_at,campaign_id) VALUES(?,?,?,?,?,?,?)`);
      const count=db.transaction(()=>{let added=0;for(const item of proposals){if(item.reason||!configured(item.groupJid,state.revision))continue;added+=insert.run(item.id,item.groupJid,item.groupName,item.url,item.message,item.scheduledAt,PREFIX+item.groupId).changes;}return added;})();
      return {scheduled:count,groups:proposals.map(({groupJid,reason})=>({groupJid,reason}))};
    }finally{running=false;}
  }
  async function prepareScheduledMessage(item){
    if(!String(item.campaign_id||'').startsWith(PREFIX))return null;
    const group=definitions.get(item.group_jid),state=settings();
    if(!group||item.campaign_id!==campaign(group)||!configured(group.jid,state.revision))throw safeFailure('A programação deste grupo está pausada.');
    const localDate=day(now());
    if(item.id!==thematicScheduleId(group.jid,localDate)||hour(now())<10||hour(now())>=18)throw safeFailure('O horário deste envio terminou. Ele não será recuperado em outro dia.');
    const [connection,links]=await Promise.all([snapshot(),getSitemapLinks()]);
    if(!groupReady(group,connection)||!sources(group.topic,links).some(source=>source.url===canonical(item.sitemap_url)))throw safeFailure('O grupo ou o conteúdo mudou. Revise antes de preparar outro envio.');
    const live=()=>db.prepare('SELECT * FROM whatsapp_qr_schedules WHERE id=?').get(item.id);
    const unchanged=()=>{const row=live();return Boolean(row&&row.status==='processing'&&row.group_jid===item.group_jid&&row.campaign_id===item.campaign_id&&row.sitemap_url===item.sitemap_url&&row.message===item.message&&configured(group.jid,state.revision)&&day(now())===localDate&&hour(now())>=10&&hour(now())<18&&sources(group.topic,links).some(source=>source.url===canonical(item.sitemap_url)));};
    if(!unchanged())throw safeFailure('A configuração do envio mudou.');
    return {pathname:'/chat/send/text',body:{Phone:group.jid,Body:`${item.message}\n\n${item.sitemap_url}`.slice(0,4000),Id:item.id.replaceAll('-','').toUpperCase()},beforeSubmit:unchanged};
  }
  function status(){const state=settings();return {enabled:Boolean(state.enabled),groupJids:state.groups,revision:state.revision,timezone:'America/Sao_Paulo',dailyLimitPerGroup:1,window:'10:00–18:00',groups:WHATSAPP_THEMATIC_GROUPS.map(group=>({...group,enabled:Boolean(state.enabled&&state.groups.includes(group.jid)),needsReview:unresolved(group)}))};}
  async function configure(input,actor=''){
    if(typeof input?.enabled!=='boolean'||!Array.isArray(input.groupJids)||input.groupJids.length>4||new Set(input.groupJids).size!==input.groupJids.length||input.groupJids.some(id=>!definitions.has(id)))throw safeFailure('Escolha somente os quatro grupos autorizados.',400);
    if(input.enabled){const connection=await snapshot();if(input.groupJids.some(id=>!groupReady(definitions.get(id),connection)))throw safeFailure('Confira o nome e a permissão de envio dos grupos escolhidos.');}
    db.transaction(()=>{
      db.prepare('UPDATE whatsapp_thematic_settings SET enabled=?,groups_json=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP,updated_by=? WHERE id=1').run(Number(input.enabled),JSON.stringify(input.groupJids),String(actor).slice(0,80));
      for(const group of WHATSAPP_THEMATIC_GROUPS)if(!input.enabled||!input.groupJids.includes(group.jid))db.prepare("UPDATE whatsapp_qr_schedules SET status='cancelled',error='Programação temática pausada.' WHERE campaign_id=? AND status='pending'").run(campaign(group));
    })();nextCheck=0;return status();
  }
  const handle=fn=>async(req,res)=>{try{await fn(req,res)}catch(error){res.status(error.status||502).json({error:error.campaignSafe?error.message:'Não foi possível conferir o WhatsApp ou as fontes publicadas.'})}};
  if(app){app.get(API,requireAdmin,(_req,res)=>res.set('Cache-Control','no-store').json(status()));
    app.get(API+'/preview',requireAdmin,handle(async(_req,res)=>res.set('Cache-Control','no-store').json({settings:status(),groups:await plan(WHATSAPP_THEMATIC_GROUPS.map(group=>group.jid))})));
    app.put(API,requireAdmin,sameOriginOnly,handle(async(req,res)=>res.json(await configure(req.body,String(req.user?.id||'admin')))));
  }
  return {scheduleDue,prepareScheduledMessage,status,configure,preview:()=>plan(WHATSAPP_THEMATIC_GROUPS.map(group=>group.jid))};
}
