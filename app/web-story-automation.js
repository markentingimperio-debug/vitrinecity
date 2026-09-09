import {createHash,randomUUID} from 'node:crypto';

export const STORY_AUTOMATION_GROUPS=Object.freeze(['products','services','news','recipes','sports','trends']);
const ZONE='America/Sao_Paulo',DAY=86400000,LEASE=120000,HEARTBEAT=15000,JOB_TIMEOUT=10*60000,PAGE=200,MAX_PAGES=20;
const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
const digest=value=>createHash('sha256').update(value).digest('hex');
function local(time){const parts=Object.fromEntries(formatter.formatToParts(time).map(p=>[p.type,p.value]));return {day:`${parts.year}-${parts.month}-${parts.day}`,hour:Number(parts.hour),minute:Number(parts.minute),second:Number(parts.second)};}
function slot(day,hour){const target=Date.parse(`${day}T${String(hour).padStart(2,'0')}:00:00Z`);let guess=target;for(let n=0;n<4;n++){const p=local(guess),actual=Date.parse(`${p.day}T${String(p.hour).padStart(2,'0')}:${String(p.minute).padStart(2,'0')}:${String(p.second).padStart(2,'0')}Z`);const delta=target-actual;if(!delta)break;guess+=delta;}return guess;}
const nextDay=day=>new Date(Date.parse(day+'T12:00:00Z')+DAY).toISOString().slice(0,10);
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));return value;}
const safeSummary=value=>typeof value==='string'?value.replace(/[\x00-\x1f]/g,' ').trim().slice(0,280):'';

/** Durable local scheduler. processSource must obey signal and check synchronous
 * isCurrent() immediately before its publication transaction. Publication itself
 * must also be idempotent by source key, including recovery after a process crash. */
export function createStoryAutomation({db,getCandidates,processSource,isConfigured=()=>true,canRun=()=>true,autoRunAllowed=()=>true,now=Date.now,schedule=false}){
  if(typeof getCandidates!=='function'||typeof processSource!=='function')throw TypeError('Candidate and source processors are required.');
  db.exec(`CREATE TABLE IF NOT EXISTS web_story_automation_settings(
    id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL DEFAULT 0,daily_limit INTEGER NOT NULL DEFAULT 6,
    hour INTEGER NOT NULL DEFAULT 9,revision INTEGER NOT NULL DEFAULT 1,next_group INTEGER NOT NULL DEFAULT 0,
    lease_owner TEXT NOT NULL DEFAULT '',lease_until INTEGER NOT NULL DEFAULT 0,max_day TEXT NOT NULL DEFAULT '',
    last_auto_day TEXT NOT NULL DEFAULT '',last_reason TEXT NOT NULL DEFAULT 'disabled',updated_by TEXT NOT NULL DEFAULT '',updated_at INTEGER NOT NULL DEFAULT 0);
    INSERT OR IGNORE INTO web_story_automation_settings(id) VALUES(1);
    CREATE TABLE IF NOT EXISTS web_story_automation_cursors(group_name TEXT PRIMARY KEY,source_offset INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS web_story_automation_jobs(
      id INTEGER PRIMARY KEY,source_key TEXT NOT NULL,fingerprint TEXT NOT NULL,group_name TEXT NOT NULL,day TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('running','published','review','failed','interrupted')),reason TEXT NOT NULL DEFAULT '',
      story_id TEXT,summary TEXT NOT NULL DEFAULT '',owner TEXT NOT NULL,settings_revision INTEGER NOT NULL,
      actor TEXT NOT NULL,started_at INTEGER NOT NULL,finished_at INTEGER);
    CREATE INDEX IF NOT EXISTS idx_story_automation_jobs_source ON web_story_automation_jobs(source_key,fingerprint,status,started_at);
    CREATE INDEX IF NOT EXISTS idx_story_automation_jobs_day ON web_story_automation_jobs(day,status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_story_automation_running_source ON web_story_automation_jobs(source_key) WHERE status='running';
    CREATE TABLE IF NOT EXISTS web_story_automation_events(id INTEGER PRIMARY KEY,event TEXT NOT NULL,actor TEXT NOT NULL,revision INTEGER NOT NULL,created_at INTEGER NOT NULL);`);
  db.transaction(()=>{
    if(!db.prepare('PRAGMA table_info(web_story_automation_settings)').all().some(column=>column.name==='groups_json'))
      db.exec(`ALTER TABLE web_story_automation_settings ADD COLUMN groups_json TEXT NOT NULL DEFAULT '${JSON.stringify(STORY_AUTOMATION_GROUPS)}'`);
  }).immediate();
  for(const group of STORY_AUTOMATION_GROUPS)db.prepare('INSERT OR IGNORE INTO web_story_automation_cursors(group_name) VALUES(?)').run(group);
  const settings=()=>db.prepare('SELECT * FROM web_story_automation_settings WHERE id=1').get();
  const selectedGroups=s=>JSON.parse(s.groups_json);
  const configured=()=>{try{return isConfigured()===true;}catch{return false;}};
  const quota=day=>{const counts=Object.fromEntries(db.prepare('SELECT status,count(*) total FROM web_story_automation_jobs WHERE day=? GROUP BY status').all(day).map(row=>[row.status,row.total]));return {...counts,attempted:Object.values(counts).reduce((a,b)=>a+b,0)};};
  let closed=false,pending=null,active=null,scheduleTimer=null;
  function status(){
    const time=now(),p=local(time),s=settings(),q=quota(p.day),ok=configured(),running=!!s.lease_owner&&s.lease_until>time;
    let nextAt=null;
    if(!closed&&s.enabled&&ok){let day=p.day;if(p.day<s.max_day){day=s.max_day;if(quota(day).attempted>=s.daily_limit||s.last_auto_day>=day)day=nextDay(day);}else if(q.attempted>=s.daily_limit||s.last_auto_day>=p.day)day=nextDay(p.day);nextAt=new Date(Math.max(time,slot(day,s.hour))).toISOString();}
    return {enabled:!!s.enabled,configured:ok,dailyLimit:s.daily_limit,hour:s.hour,timeZone:ZONE,revision:s.revision,groups:selectedGroups(s),running,closed,nextAt,
      quota:{date:p.day,attempted:q.attempted,remaining:Math.max(0,s.daily_limit-q.attempted),published:q.published||0,review:q.review||0,failed:q.failed||0,interrupted:q.interrupted||0,running:q.running||0},
      reason:closed?'closed':!s.enabled?'disabled':!ok?'not_configured':s.last_reason,
      history:db.prepare('SELECT id,source_key sourceKey,group_name sourceGroup,day,status,reason,story_id storyId,summary,started_at startedAt,finished_at finishedAt FROM web_story_automation_jobs ORDER BY id DESC LIMIT 30').all()};
  }
  function isCurrent(context){
    if(closed||context.controller.signal.aborted||!configured()||!canRun())return false;
    const s=settings(),time=now();return !!s.enabled&&s.revision===context.revision&&s.lease_owner===context.owner&&s.lease_until>time&&local(time).day===context.day;
  }
  function updateSettings(input={},actor='admin'){
    if(closed)throw Error('Automation is closed.');
    db.transaction(()=>{
      const previous=settings();
      if(!Number.isInteger(input?.revision)||input.revision!==previous.revision)throw Object.assign(Error('As configurações mudaram em outra aba. Atualize o painel antes de salvar.'),{status:409,code:'settings_revision_conflict'});
      const enabled=input.enabled===undefined?!!previous.enabled:input.enabled,dailyLimit=input.dailyLimit===undefined?previous.daily_limit:input.dailyLimit,hour=input.hour===undefined?previous.hour:input.hour;
      const groups=input.groups===undefined?selectedGroups(previous):input.groups;
      if(typeof enabled!=='boolean'||!Number.isInteger(dailyLimit)||dailyLimit<1||dailyLimit>24||!Number.isInteger(hour)||hour<0||hour>23||!Array.isArray(groups)||groups.length<1||groups.length>STORY_AUTOMATION_GROUPS.length||new Set(groups).size!==groups.length||groups.some(group=>!STORY_AUTOMATION_GROUPS.includes(group)))
        throw Object.assign(Error('Informe um limite de 1 a 24, horário de 0 a 23 e pelo menos uma categoria válida, sem repetições.'),{status:400,code:'invalid_automation_settings'});
      const groupsJson=JSON.stringify(STORY_AUTOMATION_GROUPS.filter(group=>groups.includes(group))),nextGroup=groupsJson===previous.groups_json?previous.next_group:0;
      db.prepare("UPDATE web_story_automation_settings SET enabled=?,daily_limit=?,hour=?,groups_json=?,next_group=?,revision=revision+1,last_reason=?,updated_by=?,updated_at=? WHERE id=1")
        .run(Number(enabled),dailyLimit,hour,groupsJson,nextGroup,enabled?'settings_changed':'disabled',String(actor).slice(0,160),now());
      db.prepare("INSERT INTO web_story_automation_events(event,actor,revision,created_at) VALUES ('settings_changed',?,?,?)").run(String(actor).slice(0,160),settings().revision,now());
    }).immediate();
    active?.controller.abort();return status();
  }
  function normalize(source,group){
    if(!source||typeof source.key!=='string'||!source.key.trim()||source.key.length>300||source.group!==group)return null;
    let fingerprint;try{fingerprint=typeof source.fingerprint==='string'&&source.fingerprint?digest(source.fingerprint):digest(JSON.stringify(canonical(source)));}catch{return null;}
    return {key:source.key,fingerprint,group};
  }
  function eligible(item,time){
    if(db.prepare("SELECT 1 FROM web_story_automation_jobs WHERE source_key=? AND status='running' LIMIT 1").get(item.key))return false;
    const published=db.prepare("SELECT fingerprint FROM web_story_automation_jobs WHERE source_key=? AND status='published' ORDER BY id DESC LIMIT 1").get(item.key);
    if(published?.fingerprint===item.fingerprint)return false;
    if(db.prepare("SELECT 1 FROM web_story_automation_jobs WHERE source_key=? AND fingerprint=? AND status='review' LIMIT 1").get(item.key,item.fingerprint))return false;
    // Failures and abandoned attempts have a full 24-hour cost cooldown, even across midnight.
    return !db.prepare("SELECT 1 FROM web_story_automation_jobs WHERE source_key=? AND fingerprint=? AND status IN ('failed','interrupted') AND COALESCE(finished_at,started_at)>? LIMIT 1").get(item.key,item.fingerprint,time-DAY);
  }
  function choose(context){
    const s=settings(),groups=selectedGroups(s),start=s.next_group;
    // New sources receive capacity before updates to an already published story.
    for(const updates of [false,true]){
    for(let g=0;g<groups.length;g++){
      const index=(start+g)%groups.length,group=groups[index];
      let offset=db.prepare('SELECT source_offset FROM web_story_automation_cursors WHERE group_name=?').get(group).source_offset,wrapped=false;
      for(let page=0;page<MAX_PAGES&&isCurrent(context);page++){
        let candidates;try{candidates=getCandidates({group,limit:PAGE,offset});}catch{context.candidateError=true;break;}
        if(!Array.isArray(candidates)){context.candidateError=true;break;}
        candidates=candidates.slice(0,PAGE);
        if(!candidates.length){if(offset&&!wrapped){offset=0;wrapped=true;continue;}break;}
        for(let i=0;i<candidates.length;i++){
          const normalized=normalize(candidates[i],group);
          if(normalized&&eligible(normalized,now())){
            const published=db.prepare("SELECT story_id FROM web_story_automation_jobs WHERE source_key=? AND status='published' ORDER BY id DESC LIMIT 1").get(normalized.key);
            if(!!published===updates)return {source:candidates[i],normalized,nextGroup:(index+1)%groups.length,offset:offset+i+1,existingStoryId:published?.story_id||null};
          }
        }
        offset+=candidates.length;
        if(candidates.length<PAGE){if(wrapped){offset=0;break;}offset=0;wrapped=true;}
      }
      if(isCurrent(context))db.prepare('UPDATE web_story_automation_cursors SET source_offset=? WHERE group_name=?').run(offset,group);
    }
    }
    return null;
  }
  function claimJob(context,pick){
    return db.transaction(()=>{
      if(!isCurrent(context)||quota(context.day).attempted>=settings().daily_limit||!eligible(pick.normalized,now()))return null;
      const item=pick.normalized,result=db.prepare("INSERT INTO web_story_automation_jobs(source_key,fingerprint,group_name,day,status,owner,settings_revision,actor,started_at) VALUES (?,?,?,?,'running',?,?,?,?)")
        .run(item.key,item.fingerprint,item.group,context.day,context.owner,context.revision,context.actor,now());
      db.prepare('UPDATE web_story_automation_settings SET next_group=? WHERE id=1').run(pick.nextGroup);
      db.prepare('UPDATE web_story_automation_cursors SET source_offset=? WHERE group_name=?').run(pick.offset,item.group);
      return Number(result.lastInsertRowid);
    }).immediate();
  }
  function finish(context,id,state,reason,result={}){
    const s=settings();
    if(s.lease_owner!==context.owner)return;
    db.prepare("UPDATE web_story_automation_jobs SET status=?,reason=?,story_id=?,summary=?,finished_at=? WHERE id=? AND owner=? AND status='running'")
      .run(state,reason,typeof result.storyId==='string'?result.storyId.slice(0,200):null,safeSummary(result.summary),now(),id,context.owner);
  }
  async function work(context){
    active=context;let reason='completed',heartbeat;
    try{
      heartbeat=setInterval(()=>{
        if(!isCurrent(context)){context.controller.abort();return;}
        db.prepare('UPDATE web_story_automation_settings SET lease_until=? WHERE id=1 AND lease_owner=? AND revision=? AND lease_until>?').run(now()+LEASE,context.owner,context.revision,now());
      },HEARTBEAT);heartbeat.unref?.();
      for(let count=0;count<context.cap&&isCurrent(context);count++){
        if(quota(context.day).attempted>=settings().daily_limit){reason='daily_limit';break;}
        const pick=choose(context);if(!pick){reason=context.candidateError?'candidate_error':'no_candidates';break;}
        const id=claimJob(context,pick);if(!id){reason='interrupted';break;}
        const jobController=new AbortController(),abort=()=>jobController.abort();context.controller.signal.addEventListener('abort',abort,{once:true});
        const current=()=>isCurrent(context)&&!jobController.signal.aborted;
        let timeout,abortListener;
        try{
          const cancelled=new Promise((_,reject)=>{abortListener=()=>reject(Error('interrupted'));jobController.signal.addEventListener('abort',abortListener,{once:true});});
          timeout=setTimeout(()=>jobController.abort(),JOB_TIMEOUT);timeout.unref?.();
          const result=await Promise.race([Promise.resolve().then(()=>{if(!current())throw Error('interrupted');return processSource(pick.source,{signal:jobController.signal,isCurrent:current});}),cancelled]);
          if(!current()){finish(context,id,'interrupted','lease_or_settings_changed');reason='interrupted';break;}
          if(!result||!['published','review'].includes(result.status))throw Error('invalid_result');
          if(result.status==='published'&&(typeof result.storyId!=='string'||!result.storyId.trim()||(pick.existingStoryId&&result.storyId!==pick.existingStoryId)))throw Error('invalid_story_identity');
          finish(context,id,result.status,result.status==='review'?'needs_review':'published',result);
        }catch{
          const interrupted=!isCurrent(context);finish(context,id,interrupted?'interrupted':'failed',interrupted?'lease_or_settings_changed':jobController.signal.aborted?'processor_timeout':'processor_failed');
          if(interrupted){reason='interrupted';break;}
        }finally{clearTimeout(timeout);jobController.signal.removeEventListener('abort',abortListener);context.controller.signal.removeEventListener('abort',abort);}
      }
      if(!isCurrent(context))reason='interrupted';else if(quota(context.day).attempted>=settings().daily_limit)reason='daily_limit';
    }catch{reason='worker_error';}
    finally{
      clearInterval(heartbeat);
      db.transaction(()=>{
        const s=settings();if(s.lease_owner!==context.owner)return;
        db.prepare("UPDATE web_story_automation_jobs SET status='interrupted',reason='worker_stopped',finished_at=? WHERE owner=? AND status='running'").run(now(),context.owner);
        const autoDay=!context.manual&&['completed','daily_limit','no_candidates','candidate_error'].includes(reason)?context.day:s.last_auto_day;
        db.prepare("UPDATE web_story_automation_settings SET lease_owner='',lease_until=0,last_reason=?,last_auto_day=? WHERE id=1 AND lease_owner=?").run(reason,autoDay,context.owner);
      }).immediate();
      if(active===context)active=null;
    }
  }
  function run({manual=false,actor='system'}={}){
    if(closed||pending)return status();
    const context=db.transaction(()=>{
      const s=settings(),time=now(),p=local(time);let reason='';
      if(s.lease_until<=time)db.prepare("UPDATE web_story_automation_jobs SET status='interrupted',reason='lease_expired',finished_at=? WHERE status='running'").run(time);
      if(!s.enabled)reason='disabled';else if(!canRun())reason='global_paused';else if(!manual&&!autoRunAllowed())reason='centrally_coordinated';else if(!configured())reason='not_configured';else if(p.day<s.max_day)reason='clock_behind';
      else if(s.lease_owner&&s.lease_until>time)reason='running';else if(quota(p.day).attempted>=s.daily_limit)reason='daily_limit';
      else if(!manual&&p.hour<s.hour)reason='before_schedule';else if(!manual&&s.last_auto_day>=p.day)reason='already_scheduled';
      if(reason){if(reason!=='running')db.prepare('UPDATE web_story_automation_settings SET last_reason=? WHERE id=1').run(reason);return null;}
      const owner=randomUUID();
      db.prepare("UPDATE web_story_automation_jobs SET status='interrupted',reason='lease_expired',finished_at=? WHERE status='running'").run(time);
      db.prepare("UPDATE web_story_automation_settings SET lease_owner=?,lease_until=?,max_day=?,last_reason='running' WHERE id=1")
        .run(owner,time+LEASE,p.day);
      return {owner,revision:s.revision,day:p.day,cap:s.daily_limit,manual,actor:String(actor).slice(0,160),controller:new AbortController()};
    }).immediate();
    if(context){pending=Promise.resolve().then(()=>work(context)).finally(()=>{pending=null;});}
    return status();
  }
  function close(){
    if(closed)return;closed=true;clearInterval(scheduleTimer);active?.controller.abort();
    // The current worker releases its own lease in finally; another instance's lease is untouched.
  }
  if(schedule){scheduleTimer=setInterval(()=>{try{run();}catch{/* A later tick can retry an unavailable database. */}},30000);scheduleTimer.unref?.();}
  return {status,updateSettings,run,awaitIdle:async()=>{await pending;return status();},close};
}
