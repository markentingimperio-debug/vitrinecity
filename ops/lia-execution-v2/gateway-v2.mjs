import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { MODEL_PROFILES, profileNames, resolveProfile, actualCostMicroUsd } from './model-policy.mjs';

const HOST = process.env.LIA_GATEWAY_HOST || '127.0.0.1';
const PORT = Number(process.env.LIA_GATEWAY_PORT || 8787);
const DATA_DIR = path.resolve(process.env.LIA_DATA_DIR || '/opt/lia/data');
const TASKS_FILE = path.join(DATA_DIR, 'dev-tasks.json');
const TOKEN = String(process.env.LIA_GATEWAY_TOKEN || '');
const EXECUTION_ENABLED = process.env.LIA_GATEWAY_EXECUTION_ENABLED === '1';
const WORKER_URL = String(process.env.LIA_CODEX_WORKER_URL || 'http://127.0.0.1:8790').replace(/\/+$/,'');
const WORKER_TOKEN = String(process.env.LIA_CODEX_WORKER_TOKEN || '');
const BROKER_URL = String(process.env.LIA_BROKER_URL || 'http://127.0.0.1:8791').replace(/\/+$/,'');
const BROKER_ADMIN_TOKEN = String(process.env.LIA_BROKER_ADMIN_TOKEN || '');
const LEASE_SECRET = String(process.env.LIA_LEASE_SECRET || '');
const LEASE_TTL_SECONDS = Math.max(60, Math.min(1800, Number(process.env.LIA_LEASE_TTL_SECONDS || 600)));
const MAX_BODY_BYTES = 64 * 1024;
const MAX_INSTRUCTION_CHARS = 8000;
const MAX_TASK_BUDGET_USD = Number(process.env.LIA_MAX_TASK_BUDGET_USD || 1.00);
const MAX_DAILY_BUDGET_USD = Number(process.env.LIA_MAX_DAILY_BUDGET_USD || 5.00);
const MAX_TASKS_RETAINED = 500;

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('invalid_port');
if (!Number.isFinite(MAX_TASK_BUDGET_USD) || MAX_TASK_BUDGET_USD <= 0) throw new Error('invalid_task_budget');
if (!Number.isFinite(MAX_DAILY_BUDGET_USD) || MAX_DAILY_BUDGET_USD <= 0) throw new Error('invalid_daily_budget');
if (TOKEN.length < 32) throw new Error('gateway_token_too_short');
if (LEASE_SECRET.length < 32) throw new Error('lease_secret_too_short');
if (WORKER_TOKEN.length < 32) throw new Error('worker_token_too_short');
if (BROKER_ADMIN_TOKEN.length < 32) throw new Error('broker_token_too_short');

await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o750 });
let tasks = [];
try {
  const parsed = JSON.parse(await fs.readFile(TASKS_FILE, 'utf8'));
  if (Array.isArray(parsed)) tasks = parsed;
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}
for (const task of tasks) {
  if (!task.profile) task.profile = 'dev';
  if (!task.modelPolicy || task.modelPolicy === 'blocked_until_executor_phase') task.modelPolicy = task.profile;
  if (task.reservedUsd === undefined) task.reservedUsd = 0;
}

function isoNow(){ return new Date().toISOString(); }
function dayKey(value = new Date()){ return value.toISOString().slice(0,10); }
function sha256(value){ return createHash('sha256').update(String(value)).digest('hex'); }
function safeEqual(a,b){ return timingSafeEqual(Buffer.from(sha256(a)), Buffer.from(sha256(b))); }
function authorized(req){
  const bearer=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  const header=String(req.headers['x-lia-gateway-token']||'');
  return (bearer&&safeEqual(bearer,TOKEN))||(header&&safeEqual(header,TOKEN));
}
function send(res,status,payload){
  const raw=JSON.stringify(payload);
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','content-length':Buffer.byteLength(raw)});
  res.end(raw);
}
async function readJson(req){
  let size=0; const chunks=[];
  for await(const chunk of req){ size+=chunk.length; if(size>MAX_BODY_BYTES)throw Object.assign(new Error('payload_too_large'),{status:413}); chunks.push(chunk); }
  if(!chunks.length)return{};
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(new Error('invalid_json'),{status:400});}
}
async function persist(){
  if(tasks.length>MAX_TASKS_RETAINED)tasks=tasks.slice(-MAX_TASKS_RETAINED);
  const tmp=`${TASKS_FILE}.tmp-${process.pid}`;
  await fs.writeFile(tmp,`${JSON.stringify(tasks,null,2)}\n`,{mode:0o600});
  await fs.rename(tmp,TASKS_FILE);
}
function findTask(id){return tasks.find(t=>t.id===id);}
function publicTask(task){
  return {
    id:task.id,status:task.status,instruction:task.instruction,profile:task.profile,
    requestedBudgetUsd:task.requestedBudgetUsd,authorizedBudgetUsd:task.authorizedBudgetUsd,
    spentUsd:Number(task.spentUsd||0),reservedUsd:Number(task.reservedUsd||0),modelPolicy:task.modelPolicy,
    createdAt:task.createdAt,updatedAt:task.updatedAt,authorizedAt:task.authorizedAt||null,
    startedAt:task.startedAt||null,completedAt:task.completedAt||null,cancelledAt:task.cancelledAt||null,
    workspace:task.workspace||null,result:task.result||null,error:task.error||null,note:task.note||null,
  };
}
function todayAuthorizedUsd(){
  const today=dayKey();
  return tasks.filter(t=>String(t.authorizedAt||'').startsWith(today)&&t.status!=='cancelled')
    .reduce((sum,t)=>sum+Number(t.authorizedBudgetUsd||0),0);
}
function validMoney(value){return typeof value==='number'&&Number.isFinite(value)&&value>0&&Math.round(value*1e6)===value*1e6;}
function validWorkspace(value){return typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(value);}
function b64url(value){return Buffer.from(value).toString('base64url');}
function signLease(task,profile){
  const payload={
    v:1,jti:randomUUID(),taskId:task.id,profile:profile.name,model:profile.model,reasoning:profile.reasoning,
    maxOutputTokens:profile.maxOutputTokens,budgetMicroUsd:Math.floor(task.authorizedBudgetUsd*1e6),
    iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+LEASE_TTL_SECONDS,
  };
  const body=b64url(JSON.stringify(payload));
  const sig=createHmac('sha256',LEASE_SECRET).update(body).digest('base64url');
  return {token:`lia1.${body}.${sig}`,payload};
}
async function internalJson(url,options={}){
  const response=await fetch(url,{redirect:'error',...options,signal:AbortSignal.timeout(options.timeoutMs||300000)});
  const text=await response.text();
  let data={}; try{data=text?JSON.parse(text):{};}catch{data={error:'invalid_internal_json'};}
  return {ok:response.ok,status:response.status,data};
}

const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
    if(req.method==='GET'&&url.pathname==='/health'){
      return send(res,200,{ok:true,service:'lia-dev-gateway',version:'2026-09-17-v2',executionEnabled:EXECUTION_ENABLED,profiles:profileNames(),bind:HOST});
    }
    if(!authorized(req))return send(res,401,{error:'unauthorized'});
    if(req.method==='GET'&&url.pathname==='/v1/models'){
      return send(res,200,{profiles:Object.entries(MODEL_PROFILES).map(([name,p])=>({name,model:p.model,reasoning:p.reasoning,premium:p.premium,maxOutputTokens:p.maxOutputTokens}))});
    }
    if(req.method==='GET'&&url.pathname==='/v1/budget'){
      return send(res,200,{maxTaskBudgetUsd:MAX_TASK_BUDGET_USD,maxDailyBudgetUsd:MAX_DAILY_BUDGET_USD,authorizedTodayUsd:Number(todayAuthorizedUsd().toFixed(6)),executionEnabled:EXECUTION_ENABLED});
    }
    if(req.method==='GET'&&url.pathname==='/v1/tasks')return send(res,200,{tasks:tasks.slice(-100).reverse().map(publicTask)});
    if(req.method==='POST'&&url.pathname==='/v1/tasks'){
      const body=await readJson(req),instruction=typeof body.instruction==='string'?body.instruction.trim():'',requestedBudgetUsd=Number(body.requestedBudgetUsd),profile=resolveProfile(body.profile||'dev');
      if(!instruction||instruction.length>MAX_INSTRUCTION_CHARS)return send(res,400,{error:'invalid_instruction'});
      if(!profile)return send(res,400,{error:'invalid_profile',profiles:profileNames()});
      if(!validMoney(requestedBudgetUsd)||requestedBudgetUsd>MAX_TASK_BUDGET_USD)return send(res,400,{error:'invalid_requested_budget',maxTaskBudgetUsd:MAX_TASK_BUDGET_USD});
      const now=isoNow();
      const task={id:randomUUID(),status:'draft',instruction,profile:profile.name,requestedBudgetUsd,authorizedBudgetUsd:0,spentUsd:0,reservedUsd:0,modelPolicy:profile.name,createdAt:now,updatedAt:now,note:'Aguardando autorização de orçamento.'};
      tasks.push(task);await persist();return send(res,201,{task:publicTask(task)});
    }
    const match=url.pathname.match(/^\/v1\/tasks\/([0-9a-f-]+)\/(authorize|cancel|run)$/i);
    if(req.method==='POST'&&match){
      const [,id,action]=match,task=findTask(id); if(!task)return send(res,404,{error:'task_not_found'});
      if(action==='cancel'){
        if(task.status==='cancelled')return send(res,200,{task:publicTask(task),duplicate:true});
        if(!['draft','authorized'].includes(task.status))return send(res,409,{error:'task_not_cancellable'});
        task.status='cancelled';task.cancelledAt=isoNow();task.updatedAt=task.cancelledAt;await persist();return send(res,200,{task:publicTask(task)});
      }
      if(action==='authorize'){
        if(task.status!=='draft')return send(res,409,{error:'task_not_authorizable'});
        const body=await readJson(req),budgetUsd=Number(body.budgetUsd),profile=resolveProfile(task.profile);
        if(!validMoney(budgetUsd)||budgetUsd>task.requestedBudgetUsd||budgetUsd>MAX_TASK_BUDGET_USD)return send(res,400,{error:'invalid_authorized_budget'});
        if(profile.premium&&body.premiumApproval!=='ASTRA')return send(res,409,{error:'premium_human_approval_required',requiredValue:'ASTRA'});
        if(todayAuthorizedUsd()+budgetUsd>MAX_DAILY_BUDGET_USD+1e-9)return send(res,409,{error:'daily_budget_exceeded',authorizedTodayUsd:Number(todayAuthorizedUsd().toFixed(6)),maxDailyBudgetUsd:MAX_DAILY_BUDGET_USD});
        task.status='authorized';task.authorizedBudgetUsd=budgetUsd;task.authorizedAt=isoNow();task.updatedAt=task.authorizedAt;task.note='Orçamento autorizado. Execução depende do interruptor global.';await persist();return send(res,200,{task:publicTask(task)});
      }
      if(action==='run'){
        if(!EXECUTION_ENABLED)return send(res,423,{error:'gateway_execution_locked'});
        if(task.status!=='authorized')return send(res,409,{error:'task_not_authorized'});
        const body=await readJson(req),workspace=String(body.workspace||'').trim(); if(!validWorkspace(workspace))return send(res,400,{error:'invalid_workspace'});
        const profile=resolveProfile(task.profile); if(!profile)return send(res,409,{error:'profile_unavailable'});
        const lease=signLease(task,profile);
        task.status='running';task.workspace=workspace;task.startedAt=isoNow();task.updatedAt=task.startedAt;task.note=`Executando com perfil ${profile.name}; sem rede no sandbox.`;await persist();
        const worker=await internalJson(`${WORKER_URL}/v1/run`,{method:'POST',headers:{authorization:`Bearer ${WORKER_TOKEN}`,'content-type':'application/json'},body:JSON.stringify({workspace,instruction:task.instruction,profile:profile.name,model:profile.model,reasoning:profile.reasoning,lease:lease.token}),timeoutMs:420000});
        if(!worker.ok){task.status='failed';task.error=`worker_${worker.status}:${String(worker.data?.error||'failed').slice(0,160)}`;task.updatedAt=isoNow();task.note='Falha do worker; nenhuma repetição automática.';await persist();return send(res,502,{error:'worker_failed',task:publicTask(task)});}
        let brokerStatus=null;
        try{const b=await internalJson(`${BROKER_URL}/v1/leases/${encodeURIComponent(lease.payload.jti)}`,{headers:{authorization:`Bearer ${BROKER_ADMIN_TOKEN}`},timeoutMs:10000});if(b.ok)brokerStatus=b.data;}catch{}
        const actualMicro=actualCostMicroUsd(worker.data?.usage||{},profile);
        task.spentUsd=Number((actualMicro/1e6).toFixed(6));
        task.reservedUsd=Number(((Number(brokerStatus?.reservedMicroUsd||0))/1e6).toFixed(6));
        task.status='completed';task.completedAt=isoNow();task.updatedAt=task.completedAt;task.result={finalResponse:String(worker.data?.finalResponse||'').slice(0,12000),usage:worker.data?.usage||null,git:worker.data?.git||null,model:profile.model,profile:profile.name};task.note='Concluída no workspace isolado; nenhuma publicação em produção foi feita.';await persist();
        return send(res,200,{task:publicTask(task)});
      }
    }
    return send(res,404,{error:'not_found'});
  }catch(error){return send(res,error?.status||500,{error:error?.status?error.message:'internal_error'});}
});
server.requestTimeout=430000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
server.listen(PORT,HOST,()=>console.log(JSON.stringify({event:'lia_dev_gateway_started',version:'v2',host:HOST,port:PORT,executionEnabled:EXECUTION_ENABLED,profiles:profileNames()})));
