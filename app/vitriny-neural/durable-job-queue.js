import {randomUUID} from 'node:crypto';
import {chatId,validateChatScope} from './chat-attachments.js';

export const DURABLE_QUEUE_LANES=Object.freeze(['chat','image','video']);
const OCCUPIED="('leased','dispatched','unknown')";
const PENDING="('queued','leased','dispatched','unknown')";
const DEFAULT_LIMITS=Object.freeze({backlog:300,perScopeBacklog:20,retained:5000,perScopeRetained:500,perScopeConcurrency:3});
function error(code){const result=new Error(code);result.code=code;return result;}
function capacity(value,fallback,max){const result=value===undefined?fallback:value;if(!Number.isSafeInteger(result)||result<0||result>max)throw new TypeError('queue_config_invalid');return result;}
function identifier(value){return typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);}
function thenable(value){if(value&&typeof value.then==='function'){Promise.resolve(value).catch(()=>{});return true;}return false;}

/**
 * Metadata-only, same-database outbox. Admission/limits/providers are exclusively
 * server configuration, not request input. It never invokes a provider itself.
 *
 * queued -> leased -> dispatched -> completed/failed
 *                  \-> unknown (still occupies every capacity constraint)
 * A pre-dispatch lease can expire and be reclaimed. Once dispatched, neither a
 * lease expiry, a restart, a cancel nor a transport error permits replay.
 * settle() is INTERNAL: only a final response or proof of no dispatch releases
 * a dispatched/unknown slot. Tokens are fencing credentials; never expose them.
 */
export function createDurableJobQueue({db,lanes={},providers=()=>[],authorize=()=>true,limits={},now=Date.now,leaseMs=45000}={}){
  if(!db?.transaction||typeof providers!=='function'||typeof authorize!=='function')throw new TypeError('queue_config_invalid');
  const laneConfig=Object.fromEntries(DURABLE_QUEUE_LANES.map(lane=>[lane,{
    concurrency:capacity(lanes[lane]?.concurrency,0,32),
    perScopeConcurrency:capacity(lanes[lane]?.perScopeConcurrency,1,32),
    backlog:capacity(lanes[lane]?.backlog,100,1000)
  }]));
  const configured=Object.fromEntries(Object.entries(DEFAULT_LIMITS).map(([name,fallback])=>[name,capacity(limits[name],fallback,name==='perScopeConcurrency'?64:10000)]));
  const duration=capacity(leaseMs,45000,300000);if(duration<100)throw new TypeError('queue_config_invalid');
  db.exec(`CREATE TABLE IF NOT EXISTS neural_durable_jobs(
    id TEXT PRIMARY KEY,scope TEXT NOT NULL,idempotency_key TEXT NOT NULL,request_hash TEXT NOT NULL,
    lane TEXT NOT NULL CHECK(lane IN ('chat','image','video')),capability TEXT NOT NULL,group_key TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('queued','leased','dispatched','unknown','completed','failed','cancelled')),
    provider_id TEXT,lease_token TEXT,lease_owner TEXT,lease_until INTEGER NOT NULL DEFAULT 0,
    cancel_requested INTEGER NOT NULL DEFAULT 0,unknown_reason TEXT,
    enqueued_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,dispatched_at INTEGER,settled_at INTEGER,
    UNIQUE(scope,idempotency_key));
    CREATE INDEX IF NOT EXISTS idx_neural_durable_jobs_dispatch ON neural_durable_jobs(lane,status,enqueued_at);
    CREATE INDEX IF NOT EXISTS idx_neural_durable_jobs_scope ON neural_durable_jobs(scope,status);
    CREATE INDEX IF NOT EXISTS idx_neural_durable_jobs_provider ON neural_durable_jobs(provider_id,status);
    CREATE TABLE IF NOT EXISTS neural_durable_queue_fairness(lane TEXT NOT NULL,scope TEXT NOT NULL,last_turn INTEGER NOT NULL,PRIMARY KEY(lane,scope));`);
  const read=id=>db.prepare('SELECT * FROM neural_durable_jobs WHERE id=?').get(id);
  // Configuration callbacks must finish synchronously inside the transaction.
  // Consume an accidental async rejection without awaiting or allowing dispatch.
  const permitted=job=>{try{const result=authorize(job);return !thenable(result)&&result===true;}catch{return false;}};
  function registry(){
    try{
      const entries=providers();if(thenable(entries)||!Array.isArray(entries))return [];
      const seen=new Set();
      return entries.filter(provider=>{
        if(!provider||!identifier(provider.id)||seen.has(provider.id)||provider.enabled!==true||
          !Number.isSafeInteger(provider.concurrency)||provider.concurrency<1||provider.concurrency>64||
          !Number.isSafeInteger(provider.perScopeConcurrency)||provider.perScopeConcurrency<1||provider.perScopeConcurrency>64||
          !Array.isArray(provider.lanes)||!Array.isArray(provider.capabilities))return false;
        seen.add(provider.id);return true;
      });
    }catch{return [];}
  }
  const supports=(provider,job)=>provider.lanes.includes(job.lane)&&provider.capabilities.includes(job.capability);
  const get=(scope,id)=>{validateChatScope(scope);chatId(id);const job=db.prepare('SELECT * FROM neural_durable_jobs WHERE scope=? AND id=?').get(scope,id);if(!job)throw error('queue_not_found');return job;};
  const enqueue=db.transaction(input=>{
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['id','scope','idempotencyKey','requestHash','lane','capability','groupKey'].includes(key)))throw error('queue_input_invalid');
    chatId(input.id);validateChatScope(input.scope);
    if(!DURABLE_QUEUE_LANES.includes(input.lane)||!identifier(input.capability)||!identifier(input.groupKey)||
      typeof input.idempotencyKey!=='string'||!/^[A-Za-z0-9_-]{12,100}$/.test(input.idempotencyKey)||
      typeof input.requestHash!=='string'||!/^[a-f0-9]{64}$/.test(input.requestHash))throw error('queue_input_invalid');
    const prior=db.prepare('SELECT * FROM neural_durable_jobs WHERE scope=? AND idempotency_key=?').get(input.scope,input.idempotencyKey);
    if(prior){if(prior.request_hash!==input.requestHash||prior.id!==input.id||prior.lane!==input.lane||prior.capability!==input.capability||prior.group_key!==input.groupKey)throw error('queue_conflict');return {...prior,duplicate:true};}
    if(read(input.id))throw error('queue_conflict');
    const count=(where,args=[])=>db.prepare(`SELECT COUNT(*) n FROM neural_durable_jobs ${where}`).get(...args).n;
    if(count('')>=configured.retained||count('WHERE scope=?',[input.scope])>=configured.perScopeRetained||
      count(`WHERE status IN ${PENDING}`)>=configured.backlog||count(`WHERE status IN ${PENDING} AND scope=?`,[input.scope])>=configured.perScopeBacklog||
      count(`WHERE status IN ${PENDING} AND lane=?`,[input.lane])>=laneConfig[input.lane].backlog)throw error('queue_quota');
    db.prepare("INSERT INTO neural_durable_jobs(id,scope,idempotency_key,request_hash,lane,capability,group_key,status,enqueued_at,updated_at) VALUES(?,?,?,?,?,?,?,'queued',?,?)")
      .run(input.id,input.scope,input.idempotencyKey,input.requestHash,input.lane,input.capability,input.groupKey,now(),now());
    return read(input.id);
  });
  const recover=db.transaction(()=>{
    const expired=db.prepare("SELECT id,status FROM neural_durable_jobs WHERE status IN ('leased','dispatched') AND lease_until<=?").all(now());
    // Only the pre-dispatch fence is reclaimable. Unknown rows are never swept.
    db.prepare("UPDATE neural_durable_jobs SET status='queued',provider_id=NULL,lease_token=NULL,lease_owner=NULL,lease_until=0,updated_at=? WHERE status='leased' AND lease_until<=?").run(now(),now());
    db.prepare("UPDATE neural_durable_jobs SET status='unknown',unknown_reason='lease_expired',updated_at=? WHERE status='dispatched' AND lease_until<=?").run(now(),now());
    return {requeued:expired.filter(job=>job.status==='leased').map(job=>job.id),unknown:expired.filter(job=>job.status==='dispatched').map(job=>job.id)};
  });
  function occupied(){return db.prepare(`SELECT id,scope,lane,provider_id,group_key FROM neural_durable_jobs WHERE status IN ${OCCUPIED}`).all();}
  function available(job,provider,rows,includeSelf=false){
    const use=includeSelf?rows.filter(row=>row.id!==job.id):rows;
    const lane=laneConfig[job.lane];
    return lane.concurrency>0&&lane.perScopeConcurrency>0&&
      use.filter(row=>row.lane===job.lane).length<lane.concurrency&&
      use.filter(row=>row.scope===job.scope&&row.lane===job.lane).length<lane.perScopeConcurrency&&
      use.filter(row=>row.scope===job.scope).length<configured.perScopeConcurrency&&
      !use.some(row=>row.scope===job.scope&&row.group_key===job.group_key)&&
      use.filter(row=>row.provider_id===provider.id||row.provider_id===null).length<provider.concurrency&&
      use.filter(row=>(row.provider_id===provider.id||row.provider_id===null)&&row.scope===job.scope).length<provider.perScopeConcurrency;
  }
  const claim=db.transaction((lane,{workerId='local-worker'}={})=>{
    if(!DURABLE_QUEUE_LANES.includes(lane)||!identifier(workerId))throw error('queue_input_invalid');
    recover();if(!laneConfig[lane].concurrency)return null;
    const rows=occupied(),registered=registry();
    if(rows.filter(row=>row.lane===lane).length>=laneConfig[lane].concurrency||!registered.length)return null;
    const candidates=db.prepare(`SELECT jobs.* FROM neural_durable_jobs jobs LEFT JOIN neural_durable_queue_fairness fair ON fair.lane=jobs.lane AND fair.scope=jobs.scope
      WHERE jobs.status='queued' AND jobs.lane=? ORDER BY COALESCE(fair.last_turn,0),jobs.enqueued_at,jobs.rowid`).all(lane);
    for(const job of candidates){
      if(!permitted(job))continue;
      const provider=registered.find(provider=>supports(provider,job)&&available(job,provider,rows));if(!provider)continue;
      const token=randomUUID();
      db.prepare("UPDATE neural_durable_jobs SET status='leased',provider_id=?,lease_token=?,lease_owner=?,lease_until=?,updated_at=? WHERE id=? AND status='queued'")
        .run(provider.id,token,workerId,now()+duration,now(),job.id);
      const turn=db.prepare('SELECT COALESCE(MAX(last_turn),0)+1 n FROM neural_durable_queue_fairness').get().n;
      db.prepare('INSERT INTO neural_durable_queue_fairness(lane,scope,last_turn) VALUES(?,?,?) ON CONFLICT(lane,scope) DO UPDATE SET last_turn=excluded.last_turn').run(lane,job.scope,turn);
      return read(job.id);
    }
    return null;
  });
  const markDispatched=db.transaction((id,token)=>{
    const job=read(id);
    if(!job||job.status!=='leased'||job.lease_token!==token||job.lease_until<=now()||job.cancel_requested||!permitted(job))return false;
    const provider=registry().find(provider=>provider.id===job.provider_id&&supports(provider,job));
    if(!provider||!available(job,provider,occupied(),true))return false;
    db.prepare("UPDATE neural_durable_jobs SET status='dispatched',dispatched_at=?,lease_until=?,updated_at=? WHERE id=? AND lease_token=?").run(now(),now()+duration,now(),id,token);
    return true;
  });
  const markUnknown=db.transaction((id,token,reason='transport_error')=>{
    if(!['transport_error','timeout','worker_lost','cancelled'].includes(reason))throw error('queue_input_invalid');
    const job=read(id);if(!job||!['dispatched','unknown'].includes(job.status)||job.lease_token!==token)return false;
    db.prepare("UPDATE neural_durable_jobs SET status='unknown',unknown_reason=?,updated_at=? WHERE id=? AND lease_token=?").run(reason,now(),id,token);return true;
  });
  const settle=db.transaction((id,token,{status,proof}={})=>{
    const job=read(id);if(!job||!['leased','dispatched','unknown'].includes(job.status)||job.lease_token!==token||!['completed','failed','cancelled'].includes(status))return false;
    if(!(proof==='not_dispatched'&&job.status==='leased')&&!(proof==='response_received'&&['dispatched','unknown'].includes(job.status)))return false;
    db.prepare('UPDATE neural_durable_jobs SET status=?,settled_at=?,updated_at=?,lease_until=0,lease_token=NULL,lease_owner=NULL WHERE id=? AND lease_token=?')
      .run(job.cancel_requested?'cancelled':status,now(),now(),id,token);return true;
  });
  const cancel=db.transaction((scope,id)=>{
    const job=get(scope,id);
    if(['queued','leased'].includes(job.status))db.prepare("UPDATE neural_durable_jobs SET status='cancelled',cancel_requested=1,settled_at=?,updated_at=?,lease_token=NULL,lease_owner=NULL,lease_until=0 WHERE id=? AND scope=?").run(now(),now(),id,scope);
    else if(['dispatched','unknown'].includes(job.status))db.prepare("UPDATE neural_durable_jobs SET status='unknown',cancel_requested=1,unknown_reason='cancelled',updated_at=? WHERE id=? AND scope=?").run(now(),id,scope);
    return get(scope,id);
  });
  function summary(scope){
    validateChatScope(scope);const counts=db.prepare('SELECT status,COUNT(*) n FROM neural_durable_jobs WHERE scope=? GROUP BY status').all(scope);
    const count=status=>counts.find(row=>row.status===status)?.n||0;
    return {pending:count('queued')+count('leased'),running:count('dispatched'),unresolved:count('unknown'),requiresReview:count('unknown')>0};
  }
  // Upgrade-only import for persisted pre-queue requests which may have been
  // sent. A missing provider identity conservatively occupies every provider
  // pool in that lane. Existing rows/idempotency records are never overwritten.
  const adoptUnknown=db.transaction(input=>{
    chatId(input.id);validateChatScope(input.scope);
    if(!DURABLE_QUEUE_LANES.includes(input.lane)||!identifier(input.capability)||!identifier(input.groupKey)||
      typeof input.idempotencyKey!=='string'||!/^[A-Za-z0-9_-]{12,100}$/.test(input.idempotencyKey)||!/^[a-f0-9]{64}$/.test(input.requestHash))throw error('queue_input_invalid');
    const prior=read(input.id);if(prior)return prior;
    db.prepare("INSERT INTO neural_durable_jobs(id,scope,idempotency_key,request_hash,lane,capability,group_key,status,lease_token,unknown_reason,enqueued_at,updated_at,dispatched_at) VALUES(?,?,?,?,?,?,?,'unknown',?,'legacy_dispatched',?,?,?)")
      .run(input.id,input.scope,input.idempotencyKey,input.requestHash,input.lane,input.capability,input.groupKey,randomUUID(),now(),now(),now());
    return read(input.id);
  });
  return {enqueue:input=>enqueue.immediate(input),claim:(lane,options)=>claim.immediate(lane,options),markDispatched:(id,token)=>markDispatched.immediate(id,token),
    recover:()=>recover.immediate(),markUnknown:(id,token,reason)=>markUnknown.immediate(id,token,reason),settle:(id,token,result)=>settle.immediate(id,token,result),
    cancel:(scope,id)=>cancel.immediate(scope,id),get,summary,adoptUnknown:input=>adoptUnknown.immediate(input)};
}
