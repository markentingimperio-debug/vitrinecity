import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Codex } from '@openai/codex-sdk';
import { resolveProfile } from './model-policy.mjs';

const HOST=process.env.LIA_CODEX_HOST||'127.0.0.1';
const PORT=Number(process.env.LIA_CODEX_PORT||8790);
const TOKEN=String(process.env.LIA_CODEX_WORKER_TOKEN||'');
const WORKSPACE_ROOT=path.resolve(process.env.LIA_CODEX_WORKSPACE_ROOT||'/opt/lia/workspaces');
const DATA_DIR=path.resolve(process.env.LIA_CODEX_DATA_DIR||'/opt/lia/codex-data');
const BROKER_BASE_URL=String(process.env.LIA_CODEX_BROKER_BASE_URL||'http://127.0.0.1:8791/v1').replace(/\/+$/,'');
const EXECUTION_ENABLED=process.env.LIA_CODEX_EXECUTION_ENABLED==='1';
const RUN_TIMEOUT_MS=Math.max(30000,Math.min(600000,Number(process.env.LIA_CODEX_RUN_TIMEOUT_MS||240000)));
const MAX_BODY_BYTES=96*1024,MAX_INSTRUCTION_CHARS=8000;
let active=false;

if(!Number.isInteger(PORT)||PORT<1||PORT>65535)throw new Error('invalid_port');
if(TOKEN.length<32)throw new Error('worker_token_too_short');
await fs.mkdir(WORKSPACE_ROOT,{recursive:true,mode:0o750});
await fs.mkdir(DATA_DIR,{recursive:true,mode:0o750});
await fs.mkdir(path.join(DATA_DIR,'home'),{recursive:true,mode:0o750});
await fs.mkdir(path.join(DATA_DIR,'codex-home'),{recursive:true,mode:0o750});

function digest(v){return createHash('sha256').update(String(v)).digest();}
function equal(a,b){return timingSafeEqual(digest(a),digest(b));}
function authorized(req){const b=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');return Boolean(b)&&equal(b,TOKEN);}
function send(res,status,payload){const raw=JSON.stringify(payload);res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','content-length':Buffer.byteLength(raw)});res.end(raw);}
async function readJson(req){let size=0,chunks=[];for await(const c of req){size+=c.length;if(size>MAX_BODY_BYTES)throw Object.assign(new Error('payload_too_large'),{status:413});chunks.push(c);}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(new Error('invalid_json'),{status:400});}}
function validWorkspaceName(v){return typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(v);}
async function workspaceInfo(name){
  if(!validWorkspaceName(name))throw Object.assign(new Error('invalid_workspace'),{status:400});
  const root=await fs.realpath(WORKSPACE_ROOT),target=path.resolve(root,name);if(target===root||!target.startsWith(root+path.sep))throw Object.assign(new Error('invalid_workspace'),{status:400});
  let real;try{real=await fs.realpath(target);}catch(error){if(error?.code==='ENOENT')throw Object.assign(new Error('workspace_not_found'),{status:404});throw error;}
  if(real===root||!real.startsWith(root+path.sep))throw Object.assign(new Error('workspace_escape_blocked'),{status:400});
  try{const st=await fs.stat(path.join(real,'.git'));if(!st.isDirectory()&&!st.isFile())throw new Error('not_git');}catch{throw Object.assign(new Error('workspace_not_git'),{status:400});}
  return{name,path:real};
}
function runFixed(command,args,cwd,timeoutMs=30000){return new Promise(resolve=>{const child=spawn(command,args,{cwd,stdio:['ignore','pipe','pipe'],env:{PATH:process.env.PATH||'/usr/local/bin:/usr/bin:/bin'}});let out='',err='',done=false;const finish=(code)=>{if(done)return;done=true;clearTimeout(timer);resolve({code,stdout:out.slice(-16000),stderr:err.slice(-8000)});};child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);child.on('error',()=>finish(-1));child.on('close',code=>finish(code??-1));const timer=setTimeout(()=>{child.kill('SIGKILL');finish(-1);},timeoutMs);});}
async function gitSnapshot(cwd){
  const [status,stat,names]=await Promise.all([
    runFixed('git',['status','--short','--untracked-files=all'],cwd),
    runFixed('git',['diff','--stat'],cwd),
    runFixed('git',['diff','--name-only'],cwd),
  ]);
  return{status:status.stdout.trim(),diffStat:stat.stdout.trim(),changedFiles:names.stdout.trim().split(/\r?\n/).filter(Boolean).slice(0,200)};
}
const GUARD=`Você é o executor de programação da LIA em um workspace Git isolado. Trabalhe somente dentro do workspace atual. Não faça deploy, não acesse produção, pagamentos, credenciais, bancos reais ou dados de clientes. Não use rede. Não altere arquivos fora do workspace. Faça mudanças pequenas e verificáveis. Execute testes locais apropriados quando disponíveis. Não afirme que publicou ou executou algo fora do que as ferramentas mostrarem.`;

const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
    if(req.method==='GET'&&url.pathname==='/health')return send(res,200,{ok:true,service:'lia-codex-worker',version:'2026-09-17-v2',sdkLoaded:true,executionEnabled:EXECUTION_ENABLED,brokerBaseUrl:BROKER_BASE_URL,bind:HOST,active});
    if(!authorized(req))return send(res,401,{error:'unauthorized'});
    if(req.method==='GET'&&url.pathname==='/v1/capabilities')return send(res,200,{executionEnabled:EXECUTION_ENABLED,sandboxMode:'workspace-write',networkAccess:false,webSearch:false,productionDeploy:false,concurrency:1});
    if(req.method==='POST'&&url.pathname==='/v1/dry-run'){
      const body=await readJson(req),instruction=typeof body.instruction==='string'?body.instruction.trim():'';if(!instruction||instruction.length>MAX_INSTRUCTION_CHARS)return send(res,400,{error:'invalid_instruction'});const workspace=await workspaceInfo(body.workspace);const profile=resolveProfile(body.profile||'dev');if(!profile)return send(res,400,{error:'invalid_profile'});return send(res,200,{ok:true,dryRun:true,executionStarted:false,wouldUse:{workspace:workspace.name,model:profile.model,reasoning:profile.reasoning,sandboxMode:'workspace-write',networkAccess:false}});
    }
    if(req.method==='POST'&&url.pathname==='/v1/run'){
      if(!EXECUTION_ENABLED)return send(res,423,{error:'execution_locked'});
      if(active)return send(res,409,{error:'worker_busy'});
      const body=await readJson(req),instruction=typeof body.instruction==='string'?body.instruction.trim():'',lease=String(body.lease||''),profile=resolveProfile(body.profile);
      if(!instruction||instruction.length>MAX_INSTRUCTION_CHARS)return send(res,400,{error:'invalid_instruction'});
      if(!profile||body.model!==profile.model||body.reasoning!==profile.reasoning)return send(res,400,{error:'model_policy_mismatch'});
      if(!/^lia1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(lease)||lease.length>8192)return send(res,400,{error:'invalid_lease'});
      const workspace=await workspaceInfo(body.workspace);active=true;
      try{
        const before=await gitSnapshot(workspace.path);
        const codex=new Codex({
          apiKey:lease,baseUrl:BROKER_BASE_URL,
          env:{PATH:process.env.PATH||'/usr/local/bin:/usr/bin:/bin',HOME:path.join(DATA_DIR,'home'),CODEX_HOME:path.join(DATA_DIR,'codex-home')},
          config:{sandbox_workspace_write:{network_access:false}},
        });
        const thread=codex.startThread({model:profile.model,workingDirectory:workspace.path,sandboxMode:'workspace-write',modelReasoningEffort:profile.reasoning,networkAccessEnabled:false,webSearchMode:'disabled',approvalPolicy:'never'});
        const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),RUN_TIMEOUT_MS);
        let turn;try{turn=await thread.run(`${GUARD}\n\nTAREFA AUTORIZADA:\n${instruction}`,{signal:controller.signal});}finally{clearTimeout(timer);}
        const after=await gitSnapshot(workspace.path);
        return send(res,200,{ok:true,workspace:workspace.name,profile:profile.name,model:profile.model,finalResponse:String(turn.finalResponse||'').slice(0,12000),usage:turn.usage||null,threadId:thread.id||null,git:{before,after}});
      }catch(error){return send(res,502,{error:'codex_run_failed',detail:String(error?.message||'failed').slice(0,240)});}finally{active=false;}
    }
    return send(res,404,{error:'not_found'});
  }catch(error){return send(res,error?.status||500,{error:error?.status?error.message:'internal_error'});}
});
server.requestTimeout=RUN_TIMEOUT_MS+30000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
server.listen(PORT,HOST,()=>console.log(JSON.stringify({event:'lia_codex_worker_started',version:'v2',host:HOST,port:PORT,executionEnabled:EXECUTION_ENABLED,brokerBaseUrl:BROKER_BASE_URL})));
