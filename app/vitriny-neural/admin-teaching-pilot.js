import {createHash,randomUUID} from 'node:crypto';
import {createAiCreditPricing} from './ai-credit-pricing.js';
import {createDeepSeekPaidChatAdapter,hashDeepSeekPaidChatRequest,DEEPSEEK_TARIFF_SCHEDULE} from './providers/deepseek-paid-chat.js';
import {createOpenAiPaidChatAdapter,hashOpenAiPaidChatRequest} from './providers/openai-paid-chat.js';

const MODELS=Object.freeze({deepseek:'deepseek-flash',openai:'gpt-5.6-luna'});
const MAX_BUDGET=20000000,MAX_INPUT=60*1024,SCOPE='admin:teaching-pilot';
const TABLES=new Set(['admin_teaching_pilot_meta','admin_teaching_pilot_runs']);
const fail=code=>{throw Object.assign(new Error(code),{code});};
const hash=value=>createHash('sha256').update(value).digest('hex');
const copy=value=>JSON.parse(JSON.stringify(value));
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
function fields(value,allowed){if(!plain(value)||Object.keys(value).some(key=>!allowed.includes(key)))fail('teaching_input_invalid');}
function integer(value,min,max){if(!Number.isSafeInteger(value)||value<min||value>max)fail('teaching_config_invalid');return value;}
function decimal(value){if(typeof value!=='string'||!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value)||value.length>40)fail('teaching_tariff_invalid');const [whole,fraction='']=value.split('.');return BigInt(whole+fraction.padEnd(18,'0'));}
const microCeil=fraction=>{const n=BigInt(fraction.numerator)*1000000n,d=BigInt(fraction.denominator);const value=(n+d-1n)/d;if(value>BigInt(Number.MAX_SAFE_INTEGER))fail('teaching_price_invalid');return Number(value);};

/** Explicit administrative lesson transport. Pass a dedicated, private SQLite
 * ledger and server-owned configuration/keys. Construction never calls a model.
 * This does not ingest knowledge, approve lessons, qualify models or train weights.
 * Interrupted/uncertain operations retain their full ceiling and are never replayed.
 */
export function createAdminTeachingPilot({db,config,providerKeys={},fetchImpl=globalThis.fetch,now=Date.now}={}){
  if(!db?.prepare||!db?.transaction||!db?.exec||typeof fetchImpl!=='function'||typeof now!=='function')fail('teaching_config_invalid');
  fields(config,['budgetMicroBrl','dailyBudgetMicroBrl','maxOutputTokens','fx','tariffs','openAiRequestProfile']);fields(providerKeys,['deepseek','openai']);
  const cfg=copy(config),keys={...providerKeys};
  if(cfg.openAiRequestProfile!==undefined&&cfg.openAiRequestProfile!=='plain-text-v1')fail('teaching_config_invalid');
  const openAiProfile=cfg.openAiRequestProfile?{requestProfile:cfg.openAiRequestProfile}:{};
  if(typeof cfg.budgetMicroBrl!=='string'||!/^(?:0|[1-9]\d{0,7})$/.test(cfg.budgetMicroBrl))fail('teaching_config_invalid');
  const budget=integer(Number(cfg.budgetMicroBrl),0,MAX_BUDGET),maxOutputTokens=integer(cfg.maxOutputTokens,1,8192);
  const dailyBudget=cfg.dailyBudgetMicroBrl===undefined?budget:integer(Number(cfg.dailyBudgetMicroBrl),0,100000000);
  const localDay=time=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(time));
  const clock=()=>integer(now(),1,Number.MAX_SAFE_INTEGER-120000);
  fields(cfg.tariffs,['deepseek','openai']);fields(cfg.tariffs.deepseek,['peak','offPeak']);fields(cfg.tariffs.openai,['actual','ceiling']);
  const all=[...Object.values(cfg.tariffs.deepseek),...Object.values(cfg.tariffs.openai)];
  const pricing=createAiCreditPricing({tariffs:all,fxSnapshots:[cfg.fx]});
  for(const [provider,bands] of Object.entries(cfg.tariffs))for(const tariff of Object.values(bands)){
    if(tariff.providerId!==provider||tariff.modelId!==MODELS[provider])fail('teaching_tariff_invalid');
    for(const key of ['inputUsdPerMillion','cachedInputUsdPerMillion','outputUsdPerMillion'])if(decimal(tariff[key])<=0n)fail('teaching_tariff_invalid');
  }
  for(const [band,input] of [['actual','0.2'],['ceiling','0.25']]){
    const tariff=cfg.tariffs.openai[band];
    if(decimal(tariff.inputUsdPerMillion)!==decimal(input)||decimal(tariff.cachedInputUsdPerMillion)!==decimal('0.02')||decimal(tariff.outputUsdPerMillion)!==decimal('1.2'))fail('teaching_tariff_invalid');
  }
  for(const key of ['inputUsdPerMillion','cachedInputUsdPerMillion','outputUsdPerMillion'])if(decimal(cfg.tariffs.deepseek.peak[key])<decimal(cfg.tariffs.deepseek.offPeak[key]))fail('teaching_tariff_invalid');
  if(decimal(cfg.tariffs.deepseek.peak.inputUsdPerMillion)<decimal(cfg.tariffs.deepseek.peak.cachedInputUsdPerMillion))fail('teaching_tariff_invalid');
  for(const key of Object.values(keys))if(typeof key!=='string'||key&&!/^[\x21-\x7e]{1,512}$/.test(key))fail('teaching_config_invalid');
  // Fail closed if mistakenly given the application's operational database.
  if(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().some(row=>!TABLES.has(row.name)))fail('teaching_dedicated_ledger_required');
  db.exec(`CREATE TABLE IF NOT EXISTS admin_teaching_pilot_meta(id INTEGER PRIMARY KEY CHECK(id=1),budget_micro INTEGER NOT NULL CHECK(budget_micro BETWEEN 0 AND 20000000));
    CREATE TABLE IF NOT EXISTS admin_teaching_pilot_runs(id TEXT PRIMARY KEY,operation_hash TEXT NOT NULL,request_hash TEXT NOT NULL,provider TEXT NOT NULL,model TEXT NOT NULL,role TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('reserved','dispatching','completed','held','not_dispatched')),claim_token TEXT NOT NULL,maximum_micro INTEGER NOT NULL,charged_micro INTEGER NOT NULL,
      actual_micro INTEGER,actual_usd_micro INTEGER,receipt_id TEXT UNIQUE,input_json TEXT NOT NULL,pricing_json TEXT NOT NULL,result_json TEXT,code TEXT,created_at INTEGER NOT NULL,finished_at INTEGER);`);
  db.prepare('INSERT OR IGNORE INTO admin_teaching_pilot_meta(id,budget_micro) VALUES(1,?)').run(budget);
  const limit=Math.min(budget,db.prepare('SELECT budget_micro FROM admin_teaching_pilot_meta WHERE id=1').get().budget_micro);
  if(db.prepare('SELECT COALESCE(SUM(charged_micro),0) used FROM admin_teaching_pilot_runs').get().used>limit)fail('teaching_budget_below_existing_usage');
  const row=id=>db.prepare('SELECT * FROM admin_teaching_pilot_runs WHERE id=?').get(id);
  const dto=r=>r?{id:r.id,providerId:r.provider,model:r.model,role:r.role,state:['reserved','dispatching'].includes(r.state)?'held':r.state,
    requestHash:r.request_hash,maximumMicroBrl:String(r.maximum_micro),chargedMicroBrl:String(r.charged_micro),actualMicroBrl:r.actual_micro===null?null:String(r.actual_micro),
    actualMicroUsd:r.actual_usd_micro===null?null:String(r.actual_usd_micro),receiptId:r.receipt_id,code:r.code||(['reserved','dispatching'].includes(r.state)?'teaching_in_progress_or_interrupted':null),
    result:r.result_json?JSON.parse(r.result_json):null,createdAt:new Date(r.created_at).toISOString(),finishedAt:r.finished_at?new Date(r.finished_at).toISOString():null,retryAllowed:false}:null;
  function status(){
    const s=db.prepare("SELECT COUNT(*) count,COALESCE(SUM(charged_micro),0) used,COALESCE(SUM(CASE WHEN state='completed' THEN charged_micro ELSE 0 END),0) spent,COALESCE(SUM(CASE WHEN state='completed' THEN actual_usd_micro ELSE 0 END),0) usd FROM admin_teaching_pilot_runs").get();
    const held=s.used-s.spent,day=localDay(clock());
    const today=db.prepare('SELECT charged_micro,created_at FROM admin_teaching_pilot_runs WHERE created_at>=?').all(clock()-26*3600000)
      .filter(row=>localDay(row.created_at)===day).reduce((sum,row)=>sum+row.charged_micro,0);
    return{budgetMicroBrl:String(limit),usedMicroBrl:String(s.used),spentMicroBrl:String(s.spent),knownSpentMicroUsd:String(s.usd),actualMicroBrl:held?null:String(s.spent),heldMicroBrl:String(held),remainingMicroBrl:String(Math.max(0,limit-s.used)),
      dailyBudgetMicroBrl:String(dailyBudget),day,usedTodayMicroBrl:String(today),remainingTodayMicroBrl:String(Math.max(0,dailyBudget-today)),actualMicroUsd:held?null:String(s.usd),count:s.count};
  }
  function price(tariff,usage,at){
    const p=pricing.priceChat({providerId:tariff.providerId,modelId:tariff.modelId,tariffVersion:tariff.version,fxVersion:cfg.fx.version,pricedAt:new Date(at).toISOString(),usage:{inputTokens:usage.inputTokens,cachedInputTokens:usage.cachedInputTokens,outputTokens:usage.outputTokens}});
    // Administrative provider cost, not the calculator's customer/credit amount.
    return{microBrl:microCeil(p.costBrlExact),microUsd:microCeil(p.costUsdExact),exactBrl:p.costBrlExact,exactUsd:p.costUsdExact};
  }
  async function executeLesson(input){
    fields(input,['id','providerId','model','role','messages']);
    const {id,providerId,model,role}=input;
    if(typeof id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,119}$/.test(id)||!Object.hasOwn(MODELS,providerId)||model!==MODELS[providerId]||!['teacher','reviewer'].includes(role))fail('teaching_input_invalid');
    if(!Array.isArray(input.messages))fail('teaching_input_invalid');
    const messages=copy(input.messages),bytes=Buffer.byteLength(JSON.stringify(messages),'utf8');
    if(bytes>MAX_INPUT)fail('teaching_input_limit');
    const request={model,messages,maxOutputTokens,...(providerId==='openai'?{reasoningEffort:'none',...openAiProfile}:{})};
    const requestHash=(providerId==='deepseek'?hashDeepSeekPaidChatRequest:hashOpenAiPaidChatRequest)(request),operationHash=hash(JSON.stringify({role,providerId,requestHash}));
    const prior=row(id);if(prior){if(prior.operation_hash!==operationHash)fail('teaching_id_conflict');return dto(prior);}
    const at=clock(),fxAt=Date.parse(cfg.fx.observedAt);
    if(fxAt>at||at-fxAt>7*86400000)fail('teaching_fx_stale');
    const ceiling=cfg.tariffs[providerId][providerId==='deepseek'?'peak':'ceiling'],inputBound=bytes+2048;
    const maximum=Math.max(1,price(ceiling,{inputTokens:inputBound,cachedInputTokens:0,outputTokens:maxOutputTokens},at).microBrl),owner=randomUUID();
    // Validate both settlement tariffs before spending, not after a response.
    for(const tariff of Object.values(cfg.tariffs[providerId]))price(tariff,{inputTokens:1,cachedInputTokens:0,outputTokens:1},at);
    const won=db.transaction(()=>{
      const existing=row(id);if(existing){if(existing.operation_hash!==operationHash)fail('teaching_id_conflict');return false;}
      const current=status();
      if(Number(current.usedMicroBrl)+maximum>limit||Number(current.usedTodayMicroBrl)+maximum>dailyBudget)fail('teaching_budget_exhausted');
      db.prepare("INSERT INTO admin_teaching_pilot_runs(id,operation_hash,request_hash,provider,model,role,state,claim_token,maximum_micro,charged_micro,input_json,pricing_json,created_at) VALUES(?,?,?,?,?,?,'reserved',?,?,?,?,?,?)")
        .run(id,operationHash,requestHash,providerId,model,role,owner,maximum,maximum,JSON.stringify({messages,maxOutputTokens,inputBound,...(providerId==='openai'?openAiProfile:{})}),JSON.stringify({fx:cfg.fx,tariffs:cfg.tariffs[providerId],tariffSchedule:providerId==='deepseek'?DEEPSEEK_TARIFF_SCHEDULE:null}),at);
      return true;
    }).immediate();
    if(!won)return dto(row(id));
    const permit={authorized:true,scope:SCOPE,requestId:id,requestHash,model,maxOutputTokens,reservationId:'teaching-'+id,maximumMicroBrl:String(maximum),expiresAt:clock()+120000,...(providerId==='deepseek'?{providerId}: {})};
    const assertAuthorized=p=>db.transaction(()=>{
      if(JSON.stringify(p)!==JSON.stringify(permit)||p.expiresAt<=clock()||Number(status().usedMicroBrl)>limit||Number(status().usedTodayMicroBrl)>dailyBudget)return false;
      return db.prepare("UPDATE admin_teaching_pilot_runs SET state='dispatching' WHERE id=? AND operation_hash=? AND request_hash=? AND state='reserved' AND claim_token=? AND maximum_micro=? AND charged_micro=?")
        .run(id,operationHash,requestHash,owner,maximum,maximum).changes===1;
    }).immediate();
    let result;
    try{
      const factory=providerId==='deepseek'?createDeepSeekPaidChatAdapter:createOpenAiPaidChatAdapter;
      const adapter=factory({enabled:true,apiKey:keys[providerId]||'',model,maxOutputTokens,now:clock,fetchImpl,assertAuthorized,maxInputBytes:65536,maxResponseBytes:262144,
        acceptedResponseModels:providerId==='deepseek'?['deepseek-flash','deepseek-v4-flash']:[model],...(providerId==='openai'?{reasoningEffort:'none',...openAiProfile}:{})});
      result=await adapter.invoke({requestId:id,messages,maxOutputTokens,permit});
    }catch{result={ok:false,transportStarted:row(id).state==='dispatching',code:'teaching_dispatch_uncertain',usage:{known:false}};}
    let state='held',cost=null,code=result.code||null,receiptId=null;
    if(result.transportStarted===false){state='not_dispatched';}
    else if(result.ok===true&&result.billingDisposition==='reconcile'&&result.usage?.known===true){
      try{
        if(result.usage.inputTokens>inputBound||result.usage.outputTokens>maxOutputTokens)fail('teaching_usage_limit');
        const band=providerId==='deepseek'?result.pricingWindow?.scheduleVersion===DEEPSEEK_TARIFF_SCHEDULE&&result.pricingWindow.band:'actual';
        const tariff=cfg.tariffs[providerId][band];if(!tariff)fail('teaching_tariff_unknown');
        cost=price(tariff,result.usage,at);if(cost.microBrl>maximum)fail('teaching_usage_limit');
        if(!result.receiptId)fail('teaching_receipt_missing');
        state='completed';receiptId=result.receiptId;
      }catch(error){cost=null;code=/^teaching_[a-z_]+$/.test(error.code)?error.code:'teaching_price_unknown';}
    }
    db.transaction(()=>{
      if(receiptId&&db.prepare('SELECT id FROM admin_teaching_pilot_runs WHERE receipt_id=? AND id<>?').get(receiptId,id)){state='held';cost=null;receiptId=null;code='teaching_receipt_reused';}
      const safeResult={...result,ok:state==='completed'&&result.ok===true,text:state==='completed'?result.text:null,...(cost?{cost}: {})};
      db.prepare("UPDATE admin_teaching_pilot_runs SET state=?,charged_micro=?,actual_micro=?,actual_usd_micro=?,receipt_id=?,result_json=?,code=?,finished_at=? WHERE id=? AND claim_token=? AND state IN ('reserved','dispatching')")
        .run(state,state==='not_dispatched'?0:cost?.microBrl??maximum,cost?.microBrl??null,cost?.microUsd??null,receiptId,JSON.stringify(safeResult),code,clock(),id,owner);
    }).immediate();
    return dto(row(id));
  }
  return Object.freeze({executeLesson,get:id=>dto(row(id)),status});
}
