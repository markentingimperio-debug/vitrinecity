import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {getDailyPrayer,prayerDayInBrazil,shiftPrayerDay,validDay} from './prayer-daily.js';
import {generatePrayerMedia,mediaHash} from './prayer-media.js';
import {providerGroups,whatsappGroupPermission} from './whatsapp-group-directory.js';
import {isWhatsAppCommercialGroupAllowed} from './whatsapp-commercial-policy.js';
import {countWhatsAppSchedules} from './whatsapp-schedule-worker.js';
import {loadCredential,createApi,inspectLocalVideo,openJournal,run as runMeta} from './prayer-meta-adapter.js';

export const PRAYER_SCHEDULE=Object.freeze({hour:7,minute:0,timeZone:'America/Sao_Paulo',startDay:'2026-09-12'});
const PREFIX='prayer-v1:',API='/api/admin/prayer-sharing';
// This destination is reserved for prayer, and remains excluded from commerce.
export function isWhatsAppPrayerGroupAllowed(jid){return jid==='34685244692-1501704641@g.us'||isWhatsAppCommercialGroupAllowed(jid);}
const safeError=error=>/^prayer_[a-z0-9_]+$/.test(error?.message)?error.message:'prayer_operation_needs_review';
const fail=message=>Object.assign(Error(message),{campaignSafe:true,notSubmitted:true});
const readJson=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}};
export function prayerLocalHour(date){return Number(new Intl.DateTimeFormat('en-GB',{timeZone:PRAYER_SCHEDULE.timeZone,hour:'2-digit',hourCycle:'h23'}).format(date));}
export function prayerScheduledAt(day){
  if(!validDay(day))throw Error('prayer_day_invalid');
  const desired=Date.parse(day+'T07:00:00Z');let guess=desired;
  for(let i=0;i<3;i++){
    const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:PRAYER_SCHEDULE.timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(guess)).map(p=>[p.type,p.value]));
    guess+=desired-Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
  }
  return new Date(guess).toISOString();
}
export function prayerPublicationWindow(day,date){const start=Date.parse(prayerScheduledAt(day));return date.getTime()>=start&&date.getTime()<start+45*60000;}
export const prayerScheduleId=(day,jid)=>createHash('sha256').update(`${PREFIX}${day}\n${jid}`).digest('hex').slice(0,32);

export function setupPrayerSharing({app,db,dataDir,publicDir,requireAdmin,sameOriginOnly,whatsappQrRequest,whatsappQrData,canRun=()=>true,now=()=>new Date(),generate=generatePrayerMedia,metaFactory=()=>{const credential=loadCredential();return {credential,api:createApi(credential)};}}){
  db.exec(`CREATE TABLE IF NOT EXISTS prayer_sharing_settings(id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL DEFAULT 0,instagram_enabled INTEGER NOT NULL DEFAULT 1,start_day TEXT NOT NULL DEFAULT '2026-09-12',groups_json TEXT NOT NULL DEFAULT '[]',revision INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    INSERT OR IGNORE INTO prayer_sharing_settings(id) VALUES(1);
    CREATE TABLE IF NOT EXISTS prayer_media_jobs(day TEXT NOT NULL,format TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',error TEXT,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(day,format));
    CREATE TABLE IF NOT EXISTS prayer_channel_runs(day TEXT NOT NULL,channel TEXT NOT NULL,state TEXT NOT NULL,error TEXT,permalink TEXT,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(day,channel));`);
  // A crash during a charged operation requires review, never automatic resubmission.
  db.prepare("UPDATE prayer_media_jobs SET state='needs_review',error='prayer_generation_interrupted' WHERE state='generating'").run();
  let ticking=false,generating=false;
  const settings=()=>{const row=db.prepare('SELECT * FROM prayer_sharing_settings WHERE id=1').get();return {...row,groups:JSON.parse(row.groups_json)};};
  const media=(day,format)=>validDay(day)&&['short','tiktok'].includes(format)?readJson(path.join(dataDir,'prayer-media',day,format,'ready.json')):null;
  const verifiedMedia=(day,format)=>{const item=media(day,format),file=path.join(dataDir,'prayer-media',day,format,'video.mp4');if(!item||item.day!==day||item.format!==format||item.videoPath!==file||mediaHash(fs.readFileSync(file))!==item.sha256)throw fail('O vídeo deste dia precisa ser conferido.');return item;};
  async function currentGroups(){
    const state=whatsappQrData(await whatsappQrRequest('/session/status'));
    if(!(state?.connected||state?.Connected)||!(state?.loggedIn||state?.LoggedIn))throw fail('O WhatsApp está desconectado.');
    const data=whatsappQrData(await whatsappQrRequest('/group/list'));
    return providerGroups(data).filter(g=>isWhatsAppPrayerGroupAllowed(g.JID||g.jid)&&whatsappGroupPermission(g,state).canPost).map(g=>({jid:g.JID||g.jid,name:String(g.Name||g.GroupName?.Name||'').trim()})).filter(g=>g.name);
  }
  function eligible(row,day,date=now()){return Boolean(row.enabled&&canRun()&&day>=row.start_day&&prayerPublicationWindow(day,date));}
  function queue(day){
    const row=settings();if(!row.enabled||!canRun()||day<row.start_day||day<prayerDayInBrazil(now())||!media(day,'short'))return;
    const m=verifiedMedia(day,'short');
    db.transaction(()=>{
      row.groups.forEach((g,index)=>{if(!isWhatsAppPrayerGroupAllowed(g.jid))return;
        db.prepare(`INSERT OR IGNORE INTO whatsapp_qr_schedules(id,group_jid,group_name,sitemap_url,message,scheduled_at,campaign_id) VALUES(?,?,?,?,?,?,?)`)
          .run(prayerScheduleId(day,g.jid),g.jid,g.name,`https://vitrinecity.com/oracao-do-dia.html?dia=${day}#oracao`,m.caption,new Date(Date.parse(prayerScheduledAt(day))+index*2000).toISOString(),PREFIX+day);
      });
    })();
  }
  function expire(){
    for(const row of db.prepare("SELECT id,campaign_id FROM whatsapp_qr_schedules WHERE status='pending' AND campaign_id LIKE 'prayer-v1:%'").all()){
      const day=row.campaign_id.slice(PREFIX.length);
      if(!validDay(day)||now().getTime()>=Date.parse(prayerScheduledAt(day))+45*60000)db.prepare("UPDATE whatsapp_qr_schedules SET status='cancelled',confirmation_state='not_submitted',error='O horário desta oração passou. O envio não será recuperado em outro dia.' WHERE id=? AND status='pending'").run(row.id);
    }
  }
  async function prepareScheduledMessage(item){
    const day=String(item.campaign_id||'').slice(PREFIX.length),row=settings();
    if(!validDay(day)||!eligible(row,day))throw fail('A rotina está pausada ou fora do horário desta oração.');
    const group=row.groups.find(g=>g.jid===item.group_jid);
    if(!group||!isWhatsAppPrayerGroupAllowed(group.jid)||!(await currentGroups()).some(g=>g.jid===group.jid))throw fail('A permissão para enviar a este grupo mudou.');
    const m=verifiedMedia(day,'short');
    if(item.id!==prayerScheduleId(day,group.jid)||item.message!==m.caption||item.sitemap_url!==`https://vitrinecity.com/oracao-do-dia.html?dia=${day}#oracao`)throw fail('Este agendamento foi alterado e precisa de conferência.');
    const beforeSubmit=()=>{const current=settings();return current.revision===row.revision&&eligible(current,day)&&current.groups.some(g=>g.jid===group.jid)&&isWhatsAppPrayerGroupAllowed(group.jid);};
    if(!beforeSubmit())throw fail('A rotina mudou durante a preparação.');
    return {pathname:'/chat/send/video',body:{Phone:group.jid,Video:'data:video/mp4;base64,'+fs.readFileSync(m.videoPath).toString('base64'),Caption:m.caption,Id:item.id.toUpperCase()},beforeSubmit};
  }
  async function prepareDay(day){
    if(generating)return;generating=true;
    try{
      for(const format of ['short','tiktok']){
        if(!settings().enabled||!canRun())break;
        db.prepare('INSERT OR IGNORE INTO prayer_media_jobs(day,format) VALUES(?,?)').run(day,format);
        if(!db.prepare("UPDATE prayer_media_jobs SET state='generating',updated_at=CURRENT_TIMESTAMP WHERE day=? AND format=? AND state='pending'").run(day,format).changes)continue;
        try{await generate({day,format,dataDir,publicDir,canRun:()=>Boolean(settings().enabled&&canRun())});db.prepare("UPDATE prayer_media_jobs SET state='ready',error=NULL,updated_at=CURRENT_TIMESTAMP WHERE day=? AND format=?").run(day,format);}
        catch(e){db.prepare("UPDATE prayer_media_jobs SET state='needs_review',error=?,updated_at=CURRENT_TIMESTAMP WHERE day=? AND format=?").run(safeError(e),day,format);}
      }
      queue(day);
    }finally{generating=false;}
  }
  async function publishInstagram(day){
    const row=settings();if(!row.instagram_enabled||!eligible(row,day)||!media(day,'short'))return;
    const previous=db.prepare("SELECT * FROM prayer_channel_runs WHERE day=? AND channel='instagram'").get(day);
    if(previous&&['published_verified','needs_review','failed','held_unknown'].includes(previous.state))return;
    let journal;
    try{
      const m=verifiedMedia(day,'short'),manifest={campaign:'oracao-'+day,videoPath:m.videoPath,publicVideoUrl:m.publicVideoUrl,title:m.script.title,caption:m.caption};
      const {credential,api}=metaFactory(),local=inspectLocalVideo(manifest);
      journal=openJournal(path.join(dataDir,'prayer-publications'),'instagram',manifest.campaign);
      const canPublish=()=>{const latest=settings();return latest.revision===row.revision&&latest.instagram_enabled&&eligible(latest,day);};
      const result=await runMeta({mode:journal.load()?'step':'prepare',channel:'instagram',manifest,credentialVersion:credential.credentialVersion,local,api,journal,canPublish});
      db.prepare("INSERT INTO prayer_channel_runs(day,channel,state,permalink) VALUES(?,'instagram',?,?) ON CONFLICT(day,channel) DO UPDATE SET state=excluded.state,permalink=excluded.permalink,error=NULL,updated_at=CURRENT_TIMESTAMP").run(day,result.phase,result.permalink||null);
    }catch(e){db.prepare("INSERT INTO prayer_channel_runs(day,channel,state,error) VALUES(?,'instagram','needs_review',?) ON CONFLICT(day,channel) DO UPDATE SET state='needs_review',error=excluded.error,updated_at=CURRENT_TIMESTAMP").run(day,safeError(e));}
    finally{journal?.close();}
  }
  async function tick(){
    if(ticking)return;ticking=true;
    try{
      expire();const row=settings();if(!row.enabled||!canRun())return;
      const today=prayerDayInBrazil(now()),next=shiftPrayerDay(today,1);
      // Produce one edition ahead, with no backfill after a restart or pause.
      const day=prayerLocalHour(now())<7&&today>=row.start_day?today:next;
      if(day>=row.start_day&&!generating)void prepareDay(day).catch(()=>{});
      for(const date of [today,next])queue(date);
      await publishInstagram(today);
    }finally{ticking=false;}
  }
  function publicMedia(day){return ['short','tiktok'].map(format=>media(day,format)).filter(Boolean).map(m=>({day:m.day,format:m.format,durationSeconds:m.durationSeconds,title:m.script.title,theme:m.script.theme,url:`/prayer-media/${m.day}/${m.format}.mp4`,caption:m.caption}));}
  function snapshot(){
    const row=settings(),today=prayerDayInBrazil(now()),next=prayerLocalHour(now())<7?today:shiftPrayerDay(today,1);
    return {enabled:Boolean(row.enabled),globalPaused:!canRun(),schedule:PRAYER_SCHEDULE,nextAt:prayerScheduledAt(next<row.start_day?row.start_day:next),groups:row.groups,instagramEnabled:Boolean(row.instagram_enabled),
      channels:[{id:'whatsapp',name:'WhatsApp',state:row.enabled?'scheduled':'paused',detail:`${row.groups.length} grupos selecionados`},{id:'instagram',name:'Instagram',state:row.enabled&&row.instagram_enabled?'scheduled':'paused',detail:'@agrotecniica · permissões reconferidas a cada publicação'},{id:'facebook-groups',name:'Grupos do Facebook',state:'manual',detail:'Baixe o vídeo e use o agendamento do próprio grupo.'},{id:'youtube',name:'YouTube',state:'needs_connection',detail:'A conexão atual consulta métricas. Falta autorizar o envio de vídeos.'},{id:'tiktok',name:'TikTok',state:'needs_configuration',detail:'Versão de 61 segundos preparada. Falta concluir o aplicativo de publicação e as escolhas de privacidade.'}],
      media:db.prepare('SELECT * FROM prayer_media_jobs ORDER BY day DESC,format LIMIT 20').all(),packages:[...new Set(db.prepare("SELECT day FROM prayer_media_jobs WHERE state='ready' ORDER BY day DESC LIMIT 20").all().map(r=>r.day))].map(day=>({day,videos:publicMedia(day)})),
      days:db.prepare("SELECT DISTINCT campaign_id FROM whatsapp_qr_schedules WHERE campaign_id LIKE 'prayer-v1:%' ORDER BY campaign_id DESC LIMIT 10").all().map(r=>({day:r.campaign_id.slice(PREFIX.length),...countWhatsAppSchedules(db.prepare('SELECT status,confirmation_state,claimed_at,provider_message_id FROM whatsapp_qr_schedules WHERE campaign_id=?').all(r.campaign_id))})),runs:db.prepare('SELECT * FROM prayer_channel_runs ORDER BY day DESC LIMIT 20').all()};
  }
  app.get('/api/prayer/media',(req,res)=>{const day=req.query.dia||prayerDayInBrazil(now());if(!validDay(day))return res.status(400).json({error:'Data inválida.'});return res.set('Cache-Control','no-store').json({videos:publicMedia(day)});});
  app.get('/prayer-media/:day/:format.mp4',(req,res)=>{const {day,format}=req.params;if(!validDay(day)||!['short','tiktok'].includes(format)||!media(day,format))return res.sendStatus(404);res.type('video/mp4').set('Cache-Control','public,max-age=86400').sendFile(path.join(dataDir,'prayer-media',day,format,'video.mp4'));});
  app.get(API,requireAdmin,(_req,res)=>res.set('Cache-Control','no-store').json(snapshot()));
  app.get(API+'/groups',requireAdmin,async(_req,res)=>{try{res.json({groups:await currentGroups()});}catch{res.status(503).json({error:'Não foi possível conferir os grupos conectados.'});}});
  app.post(API+'/settings',requireAdmin,sameOriginOnly,async(req,res)=>{
    try{
      if(typeof req.body?.enabled!=='boolean')return res.status(400).json({error:'Informe se a rotina deve ficar ativa.'});
      if(req.body.enabled&&settings().groups.length===0)return res.status(409).json({error:'Selecione os grupos antes de ativar.'});
      db.transaction(()=>{db.prepare('UPDATE prayer_sharing_settings SET enabled=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=1').run(Number(req.body.enabled));if(!req.body.enabled)db.prepare("UPDATE whatsapp_qr_schedules SET status='cancelled',confirmation_state='not_submitted',error='Rotina de oração pausada.' WHERE campaign_id LIKE 'prayer-v1:%' AND status='pending'").run();})();
      // Resuming starts from the next edition, without replaying cancelled rows.
      await tick();res.json(snapshot());
    }catch{res.status(500).json({error:'Não foi possível atualizar a rotina.'});}
  });
  app.get('/admin-oracoes.html',requireAdmin,(_req,res)=>res.sendFile(path.join(publicDir,'admin-oracoes.html')));
  return {tick,snapshot,prepareScheduledMessage,currentGroups,queue,prepareDay};
}
