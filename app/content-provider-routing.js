// Prepared routing policy only. Importing this module creates no client and performs no I/O.
import {createHash, randomUUID} from 'node:crypto';

export const CONTENT_PROVIDER_IDS=Object.freeze(['openai','google','kling_studio','heygen','abacus']);
const TYPES=new Set(['text','image','video','speech']);
const FINAL=new Set(['completed','failed','policy_refused','exhausted','blocked','cancelled']);
const SCALE=1000000n,MAX=BigInt(Number.MAX_SAFE_INTEGER);
const digest=value=>createHash('sha256').update(value).digest('hex');
const error=code=>Object.assign(Error(code),{code});
const clone=value=>JSON.parse(JSON.stringify(value));
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
function stable(value,depth=0){
  if(depth>20)throw error('routing_payload_invalid');
  if(value===null||typeof value==='string'||typeof value==='boolean')return value;
  if(typeof value==='number'&&Number.isFinite(value))return value;
  if(Array.isArray(value))return value.map(item=>stable(item,depth+1));
  if(!plain(value))throw error('routing_payload_invalid');
  return Object.fromEntries(Object.keys(value).sort().map(key=>{
    if(['__proto__','prototype','constructor'].includes(key))throw error('routing_payload_invalid');
    return [key,stable(value[key],depth+1)];
  }));
}
function json(value,max=32768){const text=JSON.stringify(stable(value));if(Buffer.byteLength(text)>max)throw error('routing_payload_too_large');return text;}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function unitValid(unit){return unit==='USD'||typeof unit==='string'&&CONTENT_PROVIDER_IDS.some(id=>new RegExp(`^${id}:[a-z][a-z0-9_]{0,31}$`).test(unit));}
function atomic(value){
  if(typeof value!=='string'||!/^(?:0|[1-9]\d{0,10})(?:\.\d{1,6})?$/.test(value))throw error('routing_amount_invalid');
  const [whole,fraction='']=value.split('.'),amount=BigInt(whole)*SCALE+BigInt(fraction.padEnd(6,'0'));
  if(amount>MAX)throw error('routing_amount_invalid');return Number(amount);
}
const decimal=value=>`${Math.trunc(value/1e6)}.${String(value%1e6).padStart(6,'0')}`.replace(/\.?0+$/,'')||'0';
function limits(input){
  if(!plain(input)||Object.keys(input).length>20)throw error('routing_limits_invalid');
  return Object.fromEntries(Object.keys(input).sort().map(unit=>{if(!unitValid(unit))throw error('routing_unit_invalid');return [unit,atomic(input[unit])];}));
}
export function normalizeContentQuote(input,providerId,now=Date.now()){
  if(!CONTENT_PROVIDER_IDS.includes(providerId)||!plain(input)||!unitValid(input.unit)||(input.unit!=='USD'&&!input.unit.startsWith(providerId+':')))throw error('routing_quote_unit_invalid');
  if(input.upperBound!==true||!Number.isSafeInteger(input.validUntil)||input.validUntil<=now||input.validUntil>now+600000)throw error('routing_quote_not_guaranteed');
  return Object.freeze({unit:input.unit,amountAtomic:atomic(input.amount),scale:1000000,validUntil:input.validUntil});
}
export function contentRoutingDay(epoch=Date.now()){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(epoch)).map(p=>[p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function identityReference(value){
  if(value===undefined||value===null)return null;
  if(!plain(value)||typeof value.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,159}$/.test(value.id)||!/^[a-f0-9]{64}$/.test(value.sha256||''))throw error('routing_identity_invalid');
  if(Object.keys(value).some(key=>!['id','sha256','source'].includes(key))||(value.source!==undefined&&(typeof value.source!=='string'||!value.source||value.source.length>2048||/[\u0000-\u001f]/.test(value.source))))throw error('routing_identity_invalid');
  return stable(value);
}
function requestInput(input){
  if(!plain(input)||!TYPES.has(input.capability)||!plain(input.content)||!Object.keys(input.content).length||Object.keys(input).some(key=>!['capability','content','referencedAvatar','voice'].includes(key)))throw error('routing_request_invalid');
  const identity={referencedAvatar:identityReference(input.referencedAvatar),voice:identityReference(input.voice)};
  return {request:{capability:input.capability,content:stable(input.content),...identity},identityHash:digest(json(identity))};
}
const receiptValid=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,255}$/.test(value);
function rejectedProof(value){return value?.status==='rejected_before_acceptance'&&value.confirmed===true&&value.notAccepted===true&&!value.receiptId&&!(Number(value.httpStatus)>=500)&&value.transportUnknown!==true;}
function unavailableProof(value,preflight=false){return value?.status==='unavailable'&&value.notSubmitted===true&&!value.receiptId&&(preflight||!(Number(value.httpStatus)>=500)&&value.transportUnknown!==true);}

export function createContentProviderRouting({db,adapters=[],getPolicy=()=>({enabled:false,providers:{},dailyLimits:{}}),now=Date.now,claimTtlMs=120000,pollIntervalMs=60000,retryDelayMs=60000}={}){
  if(!db||!Array.isArray(adapters)||[claimTtlMs,pollIntervalMs,retryDelayMs].some(ms=>!Number.isSafeInteger(ms)||ms<1000||ms>3600000))throw error('routing_configuration_invalid');
  const registry=new Map();
  for(const adapter of adapters){
    if(!CONTENT_PROVIDER_IDS.includes(adapter?.id)||registry.has(adapter.id)||!plain(adapter.capabilities)||!Array.isArray(adapter.capabilities.types)||!adapter.capabilities.types.length||adapter.capabilities.types.some(type=>!TYPES.has(type))||['preflight','submit','reconcile'].some(method=>typeof adapter[method]!=='function'))throw error('routing_adapter_invalid');
    registry.set(adapter.id,{id:adapter.id,capabilities:freeze(clone(adapter.capabilities)),preflight:adapter.preflight.bind(adapter),submit:adapter.submit.bind(adapter),reconcile:adapter.reconcile.bind(adapter)});
  }
  db.exec(`CREATE TABLE IF NOT EXISTS content_routing_jobs(
    id TEXT PRIMARY KEY,request_json TEXT NOT NULL,request_hash TEXT NOT NULL,identity_hash TEXT NOT NULL,budgets_json TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending',active_attempt_id INTEGER,claim_token TEXT,claim_until INTEGER NOT NULL DEFAULT 0,
    next_at INTEGER NOT NULL DEFAULT 0,error_code TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS content_routing_attempts(
    id INTEGER PRIMARY KEY,job_id TEXT NOT NULL REFERENCES content_routing_jobs(id),provider_id TEXT NOT NULL,provider_revision TEXT NOT NULL DEFAULT '',ordinal INTEGER NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,identity_hash TEXT NOT NULL,claim_token TEXT NOT NULL,
    quota_day TEXT NOT NULL,quote_unit TEXT NOT NULL,quote_atomic INTEGER NOT NULL,quote_json TEXT NOT NULL,
    state TEXT NOT NULL,budget_state TEXT NOT NULL DEFAULT 'reserved',receipt_id TEXT,output_json TEXT,error_code TEXT,
    created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,UNIQUE(job_id,ordinal),UNIQUE(job_id,provider_id));
    CREATE INDEX IF NOT EXISTS content_routing_quota ON content_routing_attempts(quota_day,quote_unit,budget_state);
    CREATE TABLE IF NOT EXISTS content_routing_preflights(id INTEGER PRIMARY KEY,job_id TEXT NOT NULL REFERENCES content_routing_jobs(id),provider_id TEXT NOT NULL,state TEXT NOT NULL,created_at INTEGER NOT NULL);`);
  db.transaction(()=>{if(!db.prepare('PRAGMA table_info(content_routing_attempts)').all().some(column=>column.name==='provider_revision'))db.exec("ALTER TABLE content_routing_attempts ADD COLUMN provider_revision TEXT NOT NULL DEFAULT ''");}).immediate();
  const job=id=>db.prepare('SELECT * FROM content_routing_jobs WHERE id=?').get(id);
  const attempt=id=>id?db.prepare('SELECT * FROM content_routing_attempts WHERE id=?').get(id):null;
  function policy(){
    const raw=getPolicy();if(!plain(raw)||!plain(raw.providers||{}))throw error('routing_policy_invalid');
    const providers={};for(const [id,value] of Object.entries(raw.providers||{})){
      if(!CONTENT_PROVIDER_IDS.includes(id)||!plain(value))throw error('routing_policy_invalid');
      const revision=String(value.revision||'');if(value.configured===true&&!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(revision))throw error('routing_provider_revision_invalid');
      providers[id]={enabled:value.enabled===true,configured:value.configured===true,revision};
    }
    const maxAttempts=raw.maxAttempts??2;if(!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>2)throw error('routing_attempt_limit_invalid');
    return {enabled:raw.enabled===true,providers,dailyLimits:limits(raw.dailyLimits||{}),maxAttempts};
  }
  function permitted(config,provider,request){return config.enabled&&config.providers[provider.id]?.enabled&&config.providers[provider.id]?.configured&&provider.capabilities.types.includes(request.capability)&&(!request.referencedAvatar||provider.capabilities.referencedAvatar===true)&&(!request.voice||provider.capabilities.voice===true);}
  function recover(id){
    const current=job(id);if(!current||!current.claim_token||current.claim_until>now())return;
    if(current.state==='preflighting')db.prepare("UPDATE content_routing_jobs SET state='pending',claim_token=NULL,claim_until=0,error_code='routing_preflight_interrupted',updated_at=? WHERE id=? AND claim_token=?").run(now(),id,current.claim_token);
    else if(current.state==='submitting'){
      db.prepare("UPDATE content_routing_attempts SET state='unknown',error_code='routing_submit_interrupted',updated_at=? WHERE id=? AND state='submitting'").run(now(),current.active_attempt_id);
      db.prepare("UPDATE content_routing_jobs SET state='unknown',claim_token=NULL,claim_until=0,error_code='routing_submit_interrupted',updated_at=? WHERE id=? AND claim_token=?").run(now(),id,current.claim_token);
    }else db.prepare('UPDATE content_routing_jobs SET claim_token=NULL,claim_until=0 WHERE id=? AND claim_token=?').run(id,current.claim_token);
  }
  function finishClaim(id,token,state,code=null,delay=retryDelayMs){
    db.prepare('UPDATE content_routing_jobs SET state=?,claim_token=NULL,claim_until=0,next_at=?,error_code=?,updated_at=? WHERE id=? AND claim_token=? AND state<>\'cancelled\'').run(state,now()+delay,code,now(),id,token);
    return getJob(id);
  }
  function createJob({id,request,budgets}){
    if(typeof id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(id))throw error('routing_job_id_invalid');
    const normalized=requestInput(request),requestJson=json(normalized.request),budgetJson=json(limits(budgets)),requestHash=digest(requestJson);
    db.transaction(()=>{
      const prior=job(id);if(prior){if(prior.request_hash!==requestHash||prior.budgets_json!==budgetJson||prior.identity_hash!==normalized.identityHash)throw error('routing_job_conflict');return;}
      db.prepare('INSERT INTO content_routing_jobs(id,request_json,request_hash,identity_hash,budgets_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id,requestJson,requestHash,normalized.identityHash,budgetJson,now(),now());
    }).immediate();return getJob(id);
  }
  function getJob(id){
    const row=job(id);if(!row)return null;
    return {id:row.id,state:row.state,error:row.error_code||null,identityHash:row.identity_hash,requestHash:row.request_hash,nextAt:row.next_at,
      attempts:db.prepare('SELECT provider_id,ordinal,state,budget_state,quote_unit,quote_atomic,receipt_id FROM content_routing_attempts WHERE job_id=? ORDER BY ordinal').all(id).map(a=>({providerId:a.provider_id,number:a.ordinal,state:a.state,budgetState:a.budget_state,unit:a.quote_unit,amount:decimal(a.quote_atomic),hasReceipt:Boolean(a.receipt_id)}))};
  }
  function status(){
    const config=policy(),day=contentRoutingDay(now());
    return {state:config.enabled?'awaiting_preflight':'prepared',enabled:config.enabled,day,maxAttempts:config.maxAttempts,
      providers:[...registry.values()].map(provider=>({id:provider.id,configured:config.providers[provider.id]?.configured===true,permitted:config.providers[provider.id]?.enabled===true,capabilities:clone(provider.capabilities)})),
      budgets:Object.entries(config.dailyLimits).map(([unit,limit])=>{const used=db.prepare("SELECT COALESCE(SUM(quote_atomic),0) n FROM content_routing_attempts WHERE quota_day=? AND quote_unit=? AND budget_state IN ('reserved','spent')").get(day,unit).n;return {unit,limit:decimal(limit),reservedOrSpent:decimal(used),remaining:decimal(Math.max(0,limit-used))};}),
      jobs:db.prepare('SELECT state,COUNT(*) count FROM content_routing_jobs GROUP BY state').all()};
  }
  function saveOutcome(id,attemptId,value,reconcileToken=null){
    if(Number(value?.httpStatus)>=500||value?.transportUnknown===true)value={status:'unknown'};
    db.transaction(()=>{
      const row=job(id),a=attempt(attemptId);if(!row||!a||row.active_attempt_id!==attemptId||['completed','failed','policy_refused','rejected'].includes(a.state))return;
      // Only the current reader owns its lease. Late original submit receipts are
      // different: they may still resolve that exact persisted paid attempt.
      if(reconcileToken&&row.claim_token!==reconcileToken)return;
      let state='unknown',budget=a.budget_state,receipt=a.receipt_id,output=null,code='routing_provider_result_unknown';
      if(value?.status==='policy_refused'){state='policy_refused';code='routing_policy_refused';if(value.confirmed===true&&value.notAccepted===true&&!value.receiptId&&!receipt)budget='released';}
      else if(rejectedProof(value)&&!receipt){state='rejected';budget='released';code='routing_rejected_before_acceptance';}
      else if(unavailableProof(value)&&!receipt){state='rejected';budget='released';code='routing_not_submitted';}
      else if(['accepted','pending','completed','failed'].includes(value?.status)&&receiptValid(value.receiptId)&&value.identityHash===row.identity_hash&&(!receipt||receipt===value.receiptId)){
        receipt=value.receiptId;budget='spent';state=['accepted','pending'].includes(value.status)?'provider_pending':value.status;code=state==='failed'?'routing_provider_failed':null;
        if(state==='completed')try{if(!plain(value.output)||!Object.keys(value.output).length)throw Error();output=json(value.output);}catch{state='unknown';code='routing_output_invalid';}
      }
      db.prepare('UPDATE content_routing_attempts SET state=?,budget_state=?,receipt_id=?,output_json=COALESCE(?,output_json),error_code=?,updated_at=? WHERE id=?').run(state,budget,receipt,output,code,now(),attemptId);
      let jobState=state==='rejected'?'pending':state;if(row.state==='cancelled')jobState='cancelled';
      db.prepare('UPDATE content_routing_jobs SET state=?,claim_token=NULL,claim_until=0,next_at=?,error_code=?,updated_at=? WHERE id=? AND active_attempt_id=?').run(jobState,now()+(state==='rejected'?retryDelayMs:pollIntervalMs),code,now(),id,attemptId);
    }).immediate();return getJob(id);
  }
  async function run(id){
    const initial=job(id);if(!initial)throw error('routing_job_not_found');
    db.transaction(()=>recover(id)).immediate();
    const current=job(id);if(['provider_pending','unknown','submitting'].includes(current.state))return reconcile(id);
    const token=randomUUID();let captured;
    db.transaction(()=>{
      const row=job(id);if(FINAL.has(row.state)||row.next_at>now()||(row.claim_token&&row.claim_until>now()))return;
      captured=row;db.prepare("UPDATE content_routing_jobs SET state='preflighting',claim_token=?,claim_until=?,updated_at=? WHERE id=?").run(token,now()+claimTtlMs,now(),id);
    }).immediate();if(!captured)return getJob(id);
    let request,config;
    try{request=JSON.parse(captured.request_json);if(digest(json(request))!==captured.request_hash||requestInput(request).identityHash!==captured.identity_hash)throw Error();config=policy();}catch{return finishClaim(id,token,'blocked','routing_persisted_request_invalid');}
    if(!config.enabled)return finishClaim(id,token,'pending','routing_paused');
    const used=db.prepare('SELECT provider_id FROM content_routing_attempts WHERE job_id=?').all(id).map(a=>a.provider_id);
    if(used.length>=config.maxAttempts)return finishClaim(id,token,'exhausted','routing_attempt_limit');
    let quotaDenied=false;
    for(const provider of registry.values()){
      if(used.includes(provider.id)||!permitted(config,provider,request))continue;
      let preflight;try{preflight=await provider.preflight(freeze({jobId:id,request:clone(request),identityHash:captured.identity_hash}));}catch(e){preflight=e;}
      if(job(id)?.claim_token!==token||job(id).claim_until<=now())return getJob(id);
      const preflightState=preflight?.status==='policy_refused'?'policy_refused':unavailableProof(preflight,true)?'unavailable':preflight?.status==='ready'?'ready':'invalid';
      db.prepare('INSERT INTO content_routing_preflights(job_id,provider_id,state,created_at) VALUES(?,?,?,?)').run(id,provider.id,preflightState,now());
      if(preflightState==='policy_refused')return finishClaim(id,token,'policy_refused','routing_policy_refused');
      if(preflightState==='unavailable')continue;
      let quote;try{if(preflightState!=='ready'||preflight.configured!==true||preflight.allowed!==true||preflight.identityHash!==captured.identity_hash)throw Error();quote=normalizeContentQuote(preflight.quote,provider.id,now());}catch{return finishClaim(id,token,'blocked','routing_preflight_invalid');}
      let reserved=null,reason=null;
      db.transaction(()=>{
        const row=job(id),latest=policy();if(row.claim_token!==token||row.claim_until<=now()||row.state!=='preflighting'){reason='changed';return;}
        if(!permitted(latest,provider,request)||json(latest)!==json(config)){reason='changed';return;}
        const jobLimits=JSON.parse(row.budgets_json),day=contentRoutingDay(now());
        const jobUsed=db.prepare("SELECT COALESCE(SUM(quote_atomic),0) n FROM content_routing_attempts WHERE job_id=? AND quote_unit=? AND budget_state IN ('reserved','spent')").get(id,quote.unit).n;
        const dayUsed=db.prepare("SELECT COALESCE(SUM(quote_atomic),0) n FROM content_routing_attempts WHERE quota_day=? AND quote_unit=? AND budget_state IN ('reserved','spent')").get(day,quote.unit).n;
        if(quote.validUntil<=now()||!Object.hasOwn(jobLimits,quote.unit)||!Object.hasOwn(latest.dailyLimits,quote.unit)||quote.amountAtomic>jobLimits[quote.unit]-jobUsed||quote.amountAtomic>latest.dailyLimits[quote.unit]-dayUsed){reason='quota';return;}
        const ordinal=used.length+1,key='content-v1-'+digest(`${id}\n${provider.id}\n${captured.request_hash}`);
        const result=db.prepare("INSERT INTO content_routing_attempts(job_id,provider_id,provider_revision,ordinal,idempotency_key,identity_hash,claim_token,quota_day,quote_unit,quote_atomic,quote_json,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'submitting',?,?)").run(id,provider.id,latest.providers[provider.id].revision,ordinal,key,captured.identity_hash,token,day,quote.unit,quote.amountAtomic,json(quote),now(),now());
        const attemptId=Number(result.lastInsertRowid);db.prepare("UPDATE content_routing_jobs SET state='submitting',active_attempt_id=?,updated_at=? WHERE id=? AND claim_token=?").run(attemptId,now(),id,token);reserved=attempt(attemptId);
      }).immediate();
      if(!reserved){if(reason==='quota'){quotaDenied=true;continue;}return finishClaim(id,token,'pending','routing_policy_changed');}
      const beforeSubmit=()=>{try{const row=job(id),latest=policy();return row.state==='submitting'&&row.active_attempt_id===reserved.id&&row.claim_token===token&&row.claim_until>now()&&quote.validUntil>now()&&reserved.quota_day===contentRoutingDay(now())&&permitted(latest,provider,request)&&json(latest)===json(config);}catch{return false;}};
      if(!beforeSubmit())return saveOutcome(id,reserved.id,{status:'unavailable',notSubmitted:true});
      let result;try{result=await provider.submit({jobId:id,request:freeze(clone(request)),identityHash:captured.identity_hash,idempotencyKey:reserved.idempotency_key,quote:freeze(clone(quote)),beforeSubmit});}catch(e){result=unavailableProof(e)||rejectedProof(e)||e?.status==='policy_refused'?e:{status:'unknown'};}
      return saveOutcome(id,reserved.id,result);
    }
    return finishClaim(id,token,quotaDenied?'quota_blocked':'unavailable',quotaDenied?'routing_quota_exceeded':'routing_no_configured_provider');
  }
  async function reconcile(id){
    let captured,token=randomUUID();
    db.transaction(()=>{
      recover(id);const row=job(id),a=attempt(row?.active_attempt_id);
      if(!row||!a||!['submitting','unknown','provider_pending'].includes(a.state)||row.next_at>now()||(row.claim_token&&row.claim_until>now()))return;
      captured={row,a};db.prepare('UPDATE content_routing_jobs SET claim_token=?,claim_until=? WHERE id=?').run(token,now()+claimTtlMs,id);
    }).immediate();if(!captured)return getJob(id);
    const {row,a}=captured,provider=registry.get(a.provider_id),providerPolicy=policy().providers[a.provider_id];
    if(!provider||!providerPolicy?.configured)return finishClaim(id,token,row.state,'routing_reconciliation_unavailable',pollIntervalMs);
    if(!a.provider_revision||providerPolicy.revision!==a.provider_revision)return finishClaim(id,token,row.state,'routing_provider_revision_changed',pollIntervalMs);
    let result;try{result=await provider.reconcile(freeze({jobId:id,receiptId:a.receipt_id||null,idempotencyKey:a.idempotency_key,identityHash:row.identity_hash,configurationRevision:a.provider_revision}));}catch{result={status:'unknown'};}
    return saveOutcome(id,a.id,result,token);
  }
  function cancel(id){db.prepare("UPDATE content_routing_jobs SET state='cancelled',claim_token=NULL,claim_until=0,next_at=0,error_code='routing_cancelled',updated_at=? WHERE id=? AND state<>'completed'").run(now(),id);return getJob(id);}
  function result(id){const row=job(id),a=attempt(row?.active_attempt_id);return row?.state==='completed'&&a?.output_json?JSON.parse(a.output_json):null;}
  return {createJob,run,reconcile,cancel,getJob,status,result};
}
