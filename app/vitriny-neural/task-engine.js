import {createHash, randomUUID} from 'node:crypto';
import {DRAFT_TASK_PROTOCOL as CONTRACT} from './task-protocol.js';

const TOOLS = Object.freeze(['route', 'files.list', 'files.read', 'files.write', 'finish']);
const TERMINAL = new Set(['draft_ready', 'failed', 'cancelled', 'interrupted', 'blocked']);
const SECRET = /-----BEGIN [^-]*PRIVATE KEY-----|\b(?:sk-proj-|ghp_|github_pat_|AKIA)[A-Za-z0-9_-]{10,}|\bBearer\s+[A-Za-z0-9._-]{16,}/i;
const fail = (code, status=400) => {throw Object.assign(new Error(code), {code, status});};
const truthy = value => ['1','true','yes','on'].includes(String(value||'').toLowerCase());
const bounded = (value, fallback, min, max) => value == null || value === '' ? fallback : Number.isInteger(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
function text(value, max, min=1) {
  if(typeof value !== 'string' || value.trim().length < min || Buffer.byteLength(value) > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) || SECRET.test(value)) fail('task_input_invalid');
  return value;
}
function filePath(value) {
  if(typeof value !== 'string' || value.length > 180 || !/^[a-zA-Z0-9][a-zA-Z0-9._/-]*\.(?:html|css|js|mjs|ts|tsx|jsx|json|md|txt|csv)$/.test(value) || value.split('/').some(part => !part || part.startsWith('.') || part.length > 80)) fail('task_file_invalid');
  return value;
}
function command(value) {
  let raw=text(value, 48*1024).trim();
  if(raw.startsWith('```')) raw=raw.replace(/^```(?:json)?\s*\n/, '').replace(/\n```$/, '');
  let data; try{data=JSON.parse(raw);}catch{fail('task_protocol_invalid');}
  if(!data || typeof data !== 'object' || Array.isArray(data) || !TOOLS.includes(data.tool)) fail('task_tool_unavailable');
  const keys={route:['tool','kind','message'], 'files.list':['tool'], 'files.read':['tool','path'], 'files.write':['tool','path','content'], finish:['tool','message']}[data.tool];
  if(Object.keys(data).some(key=>!keys.includes(key))) fail('task_protocol_invalid');
  return data;
}
function taskUsage(item,attempts) {
  const valid=value=>Number.isSafeInteger(value)&&value>=0;
  let input=0n,output=0n,complete=attempts.length>0;
  for(const attempt of attempts){
    const known=attempt.known===1&&attempt.state!=='started'&&valid(attempt.inputTokens)&&valid(attempt.outputTokens);
    if(known){input+=BigInt(attempt.inputTokens);output+=BigInt(attempt.outputTokens);}
    else complete=false;
  }
  // Legacy rows without attempt receipts retain their safe recorded subtotal,
  // but cannot become complete evidence. Never expose rounded SQL/Number sums.
  if(!attempts.length){
    const overflow=!valid(item.input_tokens)||!valid(item.output_tokens);
    return {inputTokens:valid(item.input_tokens)?item.input_tokens:null,outputTokens:valid(item.output_tokens)?item.output_tokens:null,complete:false,overflow};
  }
  const safe=value=>value<=BigInt(Number.MAX_SAFE_INTEGER),overflow=!safe(input)||!safe(output);
  return {inputTokens:safe(input)?Number(input):null,outputTokens:safe(output)?Number(output):null,complete:complete&&!overflow,overflow};
}
/** A bounded draft workbench, NOT an OS/container sandbox. Artifacts are inert
 * SQLite text rows and never evaluated, served as HTML, or written to the host. */
export function createNeuralTaskEngine({db, skills, qualifications, config, billing=null, env=process.env, now=Date.now}={}) {
  if(!db || !skills?.invoke || !qualifications?.latest || !config) throw new TypeError('Task engine requires Neural service.');
  const enabled=truthy(env.VITRINY_NEURAL_TASKS_ENABLED);
  const stores=new Set(String(env.VITRINY_NEURAL_TASKS_STORES||'').split(',').map(x=>x.trim()).filter(Boolean));
  const limits=Object.freeze({dailyTasks:bounded(env.VITRINY_NEURAL_TASKS_DAILY,10,0,100), globalDailyTasks:100,
    retainedTasks:200, globalRetainedTasks:2000, maxSteps:8, maxFiles:10, maxFileBytes:32*1024, maxTaskBytes:256*1024,
    concurrent:2, timeoutMs:bounded(env.VITRINY_NEURAL_TASKS_TIMEOUT_MS,120000,1000,300000), modelTimeoutMs:30000});
  const inflight=new Map(), modelCalls=new Map(), controllers=new Map();
  db.exec(`CREATE TABLE IF NOT EXISTS neural_tasks (
    id TEXT PRIMARY KEY, scope TEXT NOT NULL, idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL,
    instruction TEXT NOT NULL, kind TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'queued',
    step_count INTEGER NOT NULL DEFAULT 0, result_text TEXT NOT NULL DEFAULT '', error_code TEXT NOT NULL DEFAULT '',
    lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, started_at INTEGER,
    input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
    UNIQUE(scope,idempotency_key));
    CREATE INDEX IF NOT EXISTS idx_neural_tasks_scope_date ON neural_tasks(scope,created_at);
    CREATE INDEX IF NOT EXISTS idx_neural_tasks_state ON neural_tasks(status,lease_until);
    CREATE TABLE IF NOT EXISTS neural_task_files (
      task_id TEXT NOT NULL, path TEXT NOT NULL, revision INTEGER NOT NULL, content TEXT NOT NULL, bytes INTEGER NOT NULL,
      PRIMARY KEY(task_id,path,revision));
    CREATE TABLE IF NOT EXISTS neural_task_steps (
      task_id TEXT NOT NULL, step INTEGER NOT NULL, provider TEXT NOT NULL, tool TEXT NOT NULL,
      outcome TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(task_id,step));
    CREATE TABLE IF NOT EXISTS neural_task_attempts (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL, provider TEXT NOT NULL, model_name TEXT NOT NULL,
      state TEXT NOT NULL, input_tokens INTEGER, output_tokens INTEGER, known INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_neural_task_attempts_task ON neural_task_attempts(task_id);`);
  db.transaction(()=>{
    if(!db.prepare('PRAGMA table_info(neural_tasks)').all().some(column=>column.name==='started_at')){
      db.exec('ALTER TABLE neural_tasks ADD COLUMN started_at INTEGER');
      // Legacy runs have no exact start timestamp. Conservatively retain quota on
      // their last recorded activity date instead of treating them as never run.
      db.exec("UPDATE neural_tasks SET started_at=updated_at WHERE status<>'queued'");
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_neural_tasks_scope_started ON neural_tasks(scope,started_at);
      CREATE INDEX IF NOT EXISTS idx_neural_tasks_started ON neural_tasks(started_at);`);
  }).immediate();
  const dayStart=()=>Date.parse(new Date(now()).toISOString().slice(0,10)+'T00:00:00Z');
  const billable=scope=>billing?.enabled===true&&scope!=='admin';
  function scopeCheck(scope) {
    if(scope !== 'admin' && (typeof scope !== 'string' || !/^store:[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(scope) || (!billing?.enabled&&!stores.has(scope.slice(6))))) fail('task_scope_denied',403);
  }
  function featureCheck(scope) {
    scopeCheck(scope);
    if(!enabled || !config.enabled || !['advisory','low_risk_auto'].includes(config.mode)) fail('task_disabled',503);
    if(billable(scope))billing.assertActive(scope);
  }
  function settleCredits(scope,id){if(billable(scope)&&billing.report(scope,id))return billing.settle(scope,id);}
  function reap() {
    // Never replay an uncertain model call following a restart or lease expiry.
    const expired=db.prepare("SELECT id,scope FROM neural_tasks WHERE status='running' AND lease_until<=?").all(now());
    db.prepare("UPDATE neural_tasks SET status='interrupted', error_code='task_interrupted', lease_token=NULL, updated_at=? WHERE status='running' AND lease_until<=?").run(now(),now());
    for(const item of expired)settleCredits(item.scope,item.id);
  }
  function row(scope,id) {
    scopeCheck(scope);
    if(typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) fail('task_not_found',404);
    const item=db.prepare('SELECT * FROM neural_tasks WHERE id=? AND scope=?').get(id,scope);
    if(!item) fail('task_not_found',404);
    return item;
  }
  function files(id) {
    return db.prepare('SELECT path, MAX(revision) revision FROM neural_task_files WHERE task_id=? GROUP BY path ORDER BY path').all(id)
      .map(file=>({...file,bytes:db.prepare('SELECT bytes FROM neural_task_files WHERE task_id=? AND path=? AND revision=?').get(id,file.path,file.revision).bytes}));
  }
  function view(item) {
    const attempts=db.prepare('SELECT id,provider,model_name modelName,state,input_tokens inputTokens,output_tokens outputTokens,known,duration_ms durationMs FROM neural_task_attempts WHERE task_id=? ORDER BY created_at,id').all(item.id);
    return {id:item.id,status:item.status,kind:item.kind||null,instruction:item.instruction,stepCount:item.step_count,
      resultText:item.result_text,errorCode:item.error_code||null,createdAt:item.created_at,updatedAt:item.updated_at,
      draftOnly:true,requiresReview:true,files:files(item.id),usage:taskUsage(item,attempts),
      billing:billable(item.scope)?billing.report(item.scope,item.id):null,
      attempts:attempts.map(attempt=>({...attempt,known:attempt.known===1})),
      events:db.prepare('SELECT step,provider,tool,outcome,created_at createdAt FROM neural_task_steps WHERE task_id=? ORDER BY step').all(item.id)};
  }
  function get(scope,id) {reap(); return view(row(scope,id));}
  function list(scope) {scopeCheck(scope);reap();return db.prepare('SELECT * FROM neural_tasks WHERE scope=? ORDER BY created_at DESC,id DESC LIMIT 50').all(scope).map(view);}
  function status(scope,{reapExpired=true}={}) {
    scopeCheck(scope);if(reapExpired)reap();
    const today=dayStart();
    const used=db.prepare('SELECT COUNT(*) n FROM neural_tasks WHERE scope=? AND created_at>=?').get(scope,today).n;
    const runs=db.prepare('SELECT COUNT(*) n FROM neural_tasks WHERE scope=? AND started_at>=?').get(scope,today).n;
    return {enabled:enabled&&config.enabled&&['advisory','low_risk_auto'].includes(config.mode),localOnly:true,draftOnly:true,
      tools:TOOLS,kinds:['website','content'],unavailable:['browser','shell','image.generate','video.generate','social.publish'],limits,
      usage:{dailyTasks:used,remaining:Math.max(0,limits.dailyTasks-used),dailyRuns:runs,remainingRuns:Math.max(0,limits.dailyTasks-runs)},
      billing:billable(scope)?billing.periodStatus(scope):{enabled:false}};
  }
  const submit=db.transaction((scope,input={})=>{
    featureCheck(scope);
    if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(k=>!['instruction','idempotencyKey'].includes(k))) fail('task_input_invalid');
    const instruction=text(input.instruction,24*1024,3).trim();
    if(instruction.length>6000 || typeof input.idempotencyKey!=='string' || !/^[A-Za-z0-9_-]{12,100}$/.test(input.idempotencyKey)) fail('task_input_invalid');
    const hash=createHash('sha256').update(instruction).digest('hex');
    const prior=db.prepare('SELECT * FROM neural_tasks WHERE scope=? AND idempotency_key=?').get(scope,input.idempotencyKey);
    if(prior){if(prior.request_hash!==hash)fail('task_conflict',409);return {...view(prior),duplicate:true};}
    const daily=db.prepare('SELECT COUNT(*) n FROM neural_tasks WHERE scope=? AND created_at>=?').get(scope,dayStart()).n;
    const globalDaily=db.prepare('SELECT COUNT(*) n FROM neural_tasks WHERE created_at>=?').get(dayStart()).n;
    if(daily>=limits.dailyTasks || globalDaily>=limits.globalDailyTasks) fail('task_quota_exhausted',429);
    if(db.prepare('SELECT COUNT(*) n FROM neural_tasks WHERE scope=?').get(scope).n>=limits.retainedTasks || db.prepare('SELECT COUNT(*) n FROM neural_tasks').get().n>=limits.globalRetainedTasks) fail('task_capacity_exhausted',429);
    const id=randomUUID();
    db.prepare('INSERT INTO neural_tasks(id,scope,idempotency_key,request_hash,instruction,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id,scope,input.idempotencyKey,hash,instruction,now(),now());
    return view(row(scope,id));
  });
  function qualified(capability) {
    return skills.status().providers.filter(provider=>{
      const record=qualifications.latest(provider.id);
      return provider.local===true && provider.policy?.enabled===true && provider.modelName && record?.modelName===provider.modelName &&
        record.qualification?.productionEligible===true && record.qualification.allowedCapabilities?.includes(capability) &&
        provider.capabilities.includes(capability) && (!provider.policy.allowedCapabilities || provider.policy.allowedCapabilities.includes(capability));
    }).map(provider=>provider.id);
  }
  function readFile(scope,id,path) {
    row(scope,id);path=filePath(path);
    const item=db.prepare('SELECT path,content,revision FROM neural_task_files WHERE task_id=? AND path=? ORDER BY revision DESC LIMIT 1').get(id,path);
    if(!item)fail('task_file_not_found',404);
    return item;
  }
  function live(scope,id,lease) {
    const item=row(scope,id);
    if(item.status!=='running' || item.lease_token!==lease || item.lease_until<=now())fail('task_interrupted',409);
    featureCheck(scope);
    return item;
  }
  function cancel(scope,id) {
    const item=row(scope,id);
    if(!TERMINAL.has(item.status)) {
      // Keep the reservation until the in-flight inference acknowledges cancellation.
      db.prepare("UPDATE neural_tasks SET status='cancelled',updated_at=? WHERE id=? AND scope=?").run(now(),id,scope);
      controllers.get(id)?.abort(Object.assign(new Error('task_cancelled'),{code:'task_cancelled'}));
      settleCredits(scope,id);
    }
    return get(scope,id);
  }
  function releaseLease(scope,id,lease) {
    if(!modelCalls.has(id))db.prepare('UPDATE neural_tasks SET lease_token=NULL WHERE id=? AND scope=? AND lease_token=?').run(id,scope,lease);
  }
  function recordAttempt(scope,id,event){
    db.transaction(()=>{
      row(scope,id);
      if(billable(scope))billing.recordAttempt(scope,id,event);
      if(event.type==='started'){
        db.prepare("INSERT INTO neural_task_attempts(id,task_id,provider,model_name,state,created_at,updated_at) VALUES(?,?,?,?,'started',?,?)").run(event.attemptId,id,event.provider,event.modelName||'',now(),now());
      }else{
        const changed=db.prepare("UPDATE neural_task_attempts SET state=?,input_tokens=?,output_tokens=?,known=?,duration_ms=?,updated_at=? WHERE id=? AND task_id=? AND state='started'")
          .run(event.type,event.inputTokens,event.outputTokens,event.known?1:0,event.durationMs,now(),event.attemptId,id).changes;
        if(changed&&event.known)db.prepare('UPDATE neural_tasks SET input_tokens=input_tokens+?,output_tokens=output_tokens+? WHERE id=? AND scope=?').run(event.inputTokens,event.outputTokens,id,scope);
      }
    }).immediate();
  }
  async function drive(scope,id,lease,controller) {
    const history=[];
    try{
      for(let step=1;step<=limits.maxSteps;step++){
        const item=live(scope,id,lease),capability=item.kind==='content'?'growth.content-plan':'code.plan',allowedProviders=qualified(capability);
        if(!allowedProviders.length)fail('task_provider_unqualified',503);
        if(billable(scope))billing.assertRunnable(scope,id);
        const timeout=Math.min(limits.modelTimeoutMs,item.lease_until-now());
        let timer;
        const pending=skills.invoke(capability,{task:item.instruction,contract:CONTRACT,kind:item.kind||'route_required',draftFiles:files(id),history:history.slice(-3)},
          // Task deadline fires first, preventing per-attempt timeout from starting another inference.
          {localOnly:true,allowedProviders,timeoutMs:timeout+1000,evaluation:false,maxTokens:1200,signal:controller.signal,taskProtocol:'draft-v1',onAttempt:event=>{
            if(event.type==='started'){
              live(scope,id,lease);
              // A new qualification can revoke a fallback while an earlier
              // attempt is pending, even if the configured model name is stable.
              if(!qualified(capability).includes(event.provider))fail('task_provider_unqualified',503);
            }
            recordAttempt(scope,id,event);
          }});
        modelCalls.set(id,{scope,pending});
        pending.finally(()=>{
          modelCalls.delete(id);
          if(row(scope,id).status!=='running'){releaseLease(scope,id,lease);settleCredits(scope,id);}
        }).catch(()=>{});
        const result=await Promise.race([pending,
          new Promise((_,reject)=>{timer=setTimeout(()=>{
            const error=Object.assign(new Error('task_timeout'),{code:'task_timeout'});
            controller.abort(error);reject(error);
          },timeout);})
        ]).finally(()=>clearTimeout(timer));
        live(scope,id,lease);
        // Unknown usage is not zero, and cannot silently spend another inference.
        if(billable(scope)&&billing.report(scope,id)?.state==='review_required')fail('billing_usage_review_required',409);
        const provider=skills.status().providers.find(candidate=>candidate.id===result.provider);
        // Receipts are recorded before rejecting an unidentified/different
        // response. Its tool commands must never create artifacts or continue.
        if(!provider?.modelName||result.output?.model!==provider.modelName)fail('task_provider_unqualified',503);
        const action=command(result.output?.text);
        const observation=db.transaction(()=>{
          const current=live(scope,id,lease);
          if(!current.kind && action.tool!=='route')fail('task_protocol_invalid');
          if(current.kind && action.tool==='route')fail('task_protocol_invalid');
          let output={};
          if(action.tool==='route'){
            if(!['website','content','unsupported'].includes(action.kind))fail('task_protocol_invalid');
            const message=text(action.message,2000);
            db.prepare('UPDATE neural_tasks SET kind=? WHERE id=?').run(action.kind,id);
            if(action.kind==='unsupported') db.prepare("UPDATE neural_tasks SET status='blocked',error_code='task_tool_unavailable',result_text=?,lease_token=NULL WHERE id=?").run(message,id);
            output={kind:action.kind};
          }else if(action.tool==='files.list') output={files:files(id)};
          else if(action.tool==='files.read') output=readFile(scope,id,action.path);
          else if(action.tool==='files.write'){
            const path=filePath(action.path),content=text(action.content,limits.maxFileBytes),bytes=Buffer.byteLength(content),manifest=files(id);
            if(!manifest.some(file=>file.path===path)&&manifest.length>=limits.maxFiles)fail('task_artifact_limit');
            const total=db.prepare('SELECT COALESCE(SUM(bytes),0) n FROM neural_task_files WHERE task_id=?').get(id).n;
            if(total+bytes>limits.maxTaskBytes)fail('task_artifact_limit');
            const revision=(manifest.find(file=>file.path===path)?.revision||0)+1;
            db.prepare('INSERT INTO neural_task_files(task_id,path,revision,content,bytes) VALUES(?,?,?,?,?)').run(id,path,revision,content,bytes);
            output={path,revision,bytes,draft:true};
          }else if(action.tool==='finish'){
            const message=text(action.message,8000);
            if(current.kind==='website'&&!files(id).some(file=>file.path==='index.html'))fail('task_artifact_missing');
            db.prepare("UPDATE neural_tasks SET status='draft_ready',result_text=?,lease_token=NULL WHERE id=?").run(message,id);
            output={draftOnly:true,requiresReview:true};
          }
          db.prepare('INSERT INTO neural_task_steps(task_id,step,provider,tool,outcome,created_at) VALUES(?,?,?,?,?,?)').run(id,step,result.provider,action.tool,action.kind==='unsupported'?'blocked':'ok',now());
          db.prepare('UPDATE neural_tasks SET step_count=?,updated_at=? WHERE id=?').run(step,now(),id);
          return output;
        }).immediate();
        history.push({tool:action.tool,...(action.path?{path:action.path}:{}),observation});
        if(TERMINAL.has(row(scope,id).status))return;
      }
      fail('task_step_limit');
    }catch(error){
      const known=new Set(['task_protocol_invalid','task_input_invalid','task_tool_unavailable','task_file_invalid','task_file_not_found','task_artifact_limit','task_artifact_missing','task_provider_unqualified','task_interrupted','task_timeout','task_step_limit','task_disabled','task_scope_denied']);
      const billingCodes=['billing_subscription_required','billing_usage_review_required','billing_task_budget_exhausted','billing_insufficient_credits','billing_disabled'];
      const code=known.has(error?.code)||billingCodes.includes(error?.code)?error.code:'task_provider_failed';
      db.prepare("UPDATE neural_tasks SET status='failed',error_code=?,updated_at=? WHERE id=? AND scope=? AND status='running' AND lease_token=?").run(code,now(),id,scope,lease);
    }finally{
      controllers.delete(id);
      releaseLease(scope,id,lease);
      settleCredits(scope,id);
    }
  }
  function start(scope,id) {
    featureCheck(scope);reap();
    const claim=db.transaction(()=>{
      const item=row(scope,id);
      if(item.status!=='queued')return null; // Idempotent start; failed/cancelled work is never auto-resubmitted.
      if(!qualified('code.plan').length)fail('task_provider_unqualified',503);
      const today=dayStart();
      const dailyRuns=db.prepare('SELECT COUNT(*) n FROM neural_tasks WHERE scope=? AND started_at>=?').get(scope,today).n;
      const globalDailyRuns=db.prepare('SELECT COUNT(*) n FROM neural_tasks WHERE started_at>=?').get(today).n;
      if(dailyRuns>=limits.dailyTasks || globalDailyRuns>=limits.globalDailyTasks)fail('task_quota_exhausted',429);
      if(modelCalls.size>=limits.concurrent || [...modelCalls.values()].some(call=>call.scope===scope) ||
        db.prepare('SELECT COUNT(*) n FROM neural_tasks WHERE lease_token IS NOT NULL AND lease_until>?').get(now()).n>=limits.concurrent ||
        db.prepare('SELECT 1 FROM neural_tasks WHERE lease_token IS NOT NULL AND lease_until>? AND scope=?').get(now(),scope))fail('task_busy',429);
      const lease=randomUUID();
      const startedAt=now();
      if(billable(scope))billing.reserve(scope,id);
      db.prepare("UPDATE neural_tasks SET status='running',lease_token=?,lease_until=?,updated_at=?,started_at=? WHERE id=? AND scope=? AND status='queued'").run(lease,startedAt+limits.timeoutMs,startedAt,startedAt,id,scope);
      return lease;
    }).immediate();
    if(claim){
      // Schedule only after the durable claim. One process owns the lease; no replay worker.
      const controller=new AbortController();controllers.set(id,controller);
      const pending=Promise.resolve().then(()=>drive(scope,id,claim,controller));
      inflight.set(id,pending);
      pending.finally(()=>inflight.delete(id)).catch(()=>{});
    }
    return get(scope,id);
  }
  function billingCanResolve(scope,id){
    let item;try{item=row(scope,id);}catch(error){if(error?.code==='task_not_found')return false;throw error;}
    return TERMINAL.has(item.status)&&!modelCalls.has(id)&&!inflight.has(id)&&
      (!db.prepare("SELECT 1 FROM neural_task_attempts WHERE task_id=? AND state='started'").get(id)||item.lease_until<=now());
  }
  async function waitForInference(id){
    // A terminal task deadline requests abort but does not prove the transport
    // settled. Keep diagnostics/shutdown from closing SQLite while a late usage
    // receipt is still able to arrive. Deliberately no second timeout here:
    // a provider that ignores cancellation must settle before resources close.
    await inflight.get(id)?.catch(()=>{});
    await modelCalls.get(id)?.pending.catch(()=>{});
  }
  return {status,submit:(scope,input)=>submit.immediate(scope,input),list,get,start,cancel,readFile,billingCanResolve,
    wait:async(id)=>{await inflight.get(id);},waitForInference,limits};
}
