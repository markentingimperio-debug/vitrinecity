import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { resolveProfile, conservativeReservationMicroUsd } from './model-policy.mjs';

const HOST=process.env.LIA_BROKER_HOST||'127.0.0.1';
const PORT=Number(process.env.LIA_BROKER_PORT||8791);
const ADMIN_TOKEN=String(process.env.LIA_BROKER_ADMIN_TOKEN||'');
const API_KEY=String(process.env.OPENAI_API_KEY||'');
const LEASE_SECRET=String(process.env.LIA_LEASE_SECRET||'');
const EXECUTION_ENABLED=process.env.LIA_BROKER_EXECUTION_ENABLED==='1';
const DATA_DIR=path.resolve(process.env.LIA_BROKER_DATA_DIR||'/var/lib/lia-openai-broker');
const LEDGER_FILE=path.join(DATA_DIR,'lease-ledger.json');
const MAX_BODY_BYTES=4*1024*1024;
const MAX_REQUESTS_PER_LEASE=Math.max(1,Math.min(30,Number(process.env.LIA_BROKER_MAX_REQUESTS_PER_LEASE||12)));
const UPSTREAM='https://api.openai.com/v1/responses';

if(!Number.isInteger(PORT)||PORT<1||PORT>65535)throw new Error('invalid_port');
if(ADMIN_TOKEN.length<32)throw new Error('broker_token_too_short');
if(LEASE_SECRET.length<32)throw new Error('lease_secret_too_short');
if(!API_KEY||/[\r\n\0]/.test(API_KEY)||API_KEY.length<20)throw new Error('invalid_api_key');
await fs.mkdir(DATA_DIR,{recursive:true,mode:0o700});
let ledger={};
try{const parsed=JSON.parse(await fs.readFile(LEDGER_FILE,'utf8'));if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))ledger=parsed;}catch(error){if(error?.code!=='ENOENT')throw error;}

function digest(v){return createHash('sha256').update(String(v)).digest();}
function equal(a,b){return timingSafeEqual(digest(a),digest(b));}
function adminAuthorized(req){const b=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');return Boolean(b)&&equal(b,ADMIN_TOKEN);}
function send(res,status,payload){const raw=JSON.stringify(payload);res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','content-length':Buffer.byteLength(raw)});res.end(raw);}
async function readRaw(req){let size=0,chunks=[];for await(const c of req){size+=c.length;if(size>MAX_BODY_BYTES)throw Object.assign(new Error('payload_too_large'),{status:413});chunks.push(c);}return Buffer.concat(chunks).toString('utf8');}
async function persist(){const tmp=`${LEDGER_FILE}.tmp-${process.pid}`;await fs.writeFile(tmp,`${JSON.stringify(ledger,null,2)}\n`,{mode:0o600});await fs.rename(tmp,LEDGER_FILE);}
function decodeLease(token){
  const match=/^lia1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(String(token||''));if(!match)throw Object.assign(new Error('invalid_lease'),{status:401});
  const [,body,sig]=match,expected=createHmac('sha256',LEASE_SECRET).update(body).digest('base64url');
  if(!equal(sig,expected))throw Object.assign(new Error('invalid_lease_signature'),{status:401});
  let payload;try{payload=JSON.parse(Buffer.from(body,'base64url').toString('utf8'));}catch{throw Object.assign(new Error('invalid_lease_payload'),{status:401});}
  const now=Math.floor(Date.now()/1000);
  if(payload?.v!==1||typeof payload.jti!=='string'||typeof payload.taskId!=='string'||!Number.isInteger(payload.exp)||payload.exp<now||Number(payload.iat)>now+60)throw Object.assign(new Error('expired_or_invalid_lease'),{status:401});
  const profile=resolveProfile(payload.profile);if(!profile||payload.model!==profile.model||payload.reasoning!==profile.reasoning||Number(payload.maxOutputTokens)!==profile.maxOutputTokens)throw Object.assign(new Error('lease_policy_mismatch'),{status:401});
  const budgetMicroUsd=Number(payload.budgetMicroUsd);if(!Number.isSafeInteger(budgetMicroUsd)||budgetMicroUsd<=0)throw Object.assign(new Error('invalid_lease_budget'),{status:401});
  return{payload,profile,budgetMicroUsd};
}
function publicLease(entry){return{jti:entry.jti,taskId:entry.taskId,profile:entry.profile,model:entry.model,budgetMicroUsd:entry.budgetMicroUsd,reservedMicroUsd:entry.reservedMicroUsd,requests:entry.requests,expiresAt:entry.expiresAt,lastRequestAt:entry.lastRequestAt||null};}
async function reserve(lease,rawBytes){
  const {payload,profile,budgetMicroUsd}=lease;
  let entry=ledger[payload.jti];
  if(!entry){entry={jti:payload.jti,taskId:payload.taskId,profile:profile.name,model:profile.model,budgetMicroUsd,reservedMicroUsd:0,requests:0,expiresAt:new Date(payload.exp*1000).toISOString(),createdAt:new Date().toISOString()};ledger[payload.jti]=entry;}
  if(entry.taskId!==payload.taskId||entry.model!==profile.model||entry.budgetMicroUsd!==budgetMicroUsd)throw Object.assign(new Error('lease_ledger_mismatch'),{status:401});
  if(entry.requests>=MAX_REQUESTS_PER_LEASE)throw Object.assign(new Error('lease_request_limit'),{status:429});
  const reservation=conservativeReservationMicroUsd(rawBytes,profile);
  if(entry.reservedMicroUsd+reservation>budgetMicroUsd)throw Object.assign(new Error('lease_budget_exhausted'),{status:402});
  entry.reservedMicroUsd+=reservation;entry.requests+=1;entry.lastRequestAt=new Date().toISOString();await persist();return{entry,reservation};
}
function copyHeader(res,source,name){const value=source.headers.get(name);if(value)res.setHeader(name,value);}
function safeErrorSummary(text){
  const raw=String(text||'').replace(/[\r\n\t]+/g,' ').slice(0,1200);
  return raw.replace(/sk-[A-Za-z0-9_-]{10,}/g,'[redacted-key]');
}
function logEvent(event,payload={}){console.log(JSON.stringify({event,at:new Date().toISOString(),...payload}));}

const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
    if(req.method==='GET'&&url.pathname==='/health')return send(res,200,{ok:true,service:'lia-openai-broker',version:'2026-09-17-v2-observe',keyConfigured:true,executionEnabled:EXECUTION_ENABLED,leaseEnforced:true,bind:HOST});
    if(req.method==='GET'&&url.pathname==='/v1/status'){
      if(!adminAuthorized(req))return send(res,401,{error:'unauthorized'});
      return send(res,200,{keyConfigured:true,executionEnabled:EXECUTION_ENABLED,realKeyExposed:false,leaseEnforced:true,ledgerEntries:Object.keys(ledger).length});
    }
    const leaseStatus=url.pathname.match(/^\/v1\/leases\/([0-9a-f-]+)$/i);
    if(req.method==='GET'&&leaseStatus){if(!adminAuthorized(req))return send(res,401,{error:'unauthorized'});const entry=ledger[leaseStatus[1]];return entry?send(res,200,publicLease(entry)):send(res,404,{error:'lease_not_seen'});}
    if(req.method==='POST'&&url.pathname==='/v1/responses'){
      if(!EXECUTION_ENABLED)return send(res,423,{error:'broker_execution_locked'});
      const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');const lease=decodeLease(token);
      const raw=await readRaw(req);let body;try{body=JSON.parse(raw);}catch{throw Object.assign(new Error('invalid_json'),{status:400});}
      if(!body||typeof body!=='object'||Array.isArray(body))return send(res,400,{error:'invalid_request'});
      body.model=lease.profile.model;
      const requestedMax=Number(body.max_output_tokens);body.max_output_tokens=Number.isFinite(requestedMax)&&requestedMax>0?Math.min(Math.floor(requestedMax),lease.profile.maxOutputTokens):lease.profile.maxOutputTokens;
      body.reasoning={...(body.reasoning&&typeof body.reasoning==='object'?body.reasoning:{}),effort:lease.profile.reasoning};
      const outgoing=JSON.stringify(body);const reserved=await reserve(lease,Buffer.byteLength(outgoing));
      logEvent('lia_broker_upstream_start',{taskId:lease.payload.taskId,jti:lease.payload.jti,profile:lease.profile.name,model:lease.profile.model,requestNumber:reserved.entry.requests,reservedMicroUsd:reserved.entry.reservedMicroUsd});
      let upstream;
      try{
        upstream=await fetch(UPSTREAM,{method:'POST',headers:{authorization:`Bearer ${API_KEY}`,'content-type':'application/json','user-agent':'VitrineCity-LIA/1.0'},body:outgoing,redirect:'error',signal:AbortSignal.timeout(240000)});
      }catch(error){
        logEvent('lia_broker_upstream_transport_error',{taskId:lease.payload.taskId,jti:lease.payload.jti,error:String(error?.message||'transport_failed').slice(0,240)});
        return send(res,502,{error:'openai_transport_failed_no_retry'});
      }
      const requestId=upstream.headers.get('openai-request-id')||upstream.headers.get('x-request-id')||null;
      if(!upstream.ok){
        const errorText=await upstream.text();
        logEvent('lia_broker_upstream_error',{taskId:lease.payload.taskId,jti:lease.payload.jti,status:upstream.status,requestId,error:safeErrorSummary(errorText)});
        res.statusCode=upstream.status;copyHeader(res,upstream,'content-type');copyHeader(res,upstream,'openai-request-id');copyHeader(res,upstream,'x-request-id');res.setHeader('cache-control','no-store');res.setHeader('x-content-type-options','nosniff');res.end(errorText);return;
      }
      logEvent('lia_broker_upstream_ok',{taskId:lease.payload.taskId,jti:lease.payload.jti,status:upstream.status,requestId});
      res.statusCode=upstream.status;copyHeader(res,upstream,'content-type');copyHeader(res,upstream,'openai-request-id');copyHeader(res,upstream,'x-request-id');res.setHeader('cache-control','no-store');res.setHeader('x-content-type-options','nosniff');
      if(!upstream.body){res.end();return;}
      Readable.fromWeb(upstream.body).pipe(res);return;
    }
    return send(res,404,{error:'not_found'});
  }catch(error){return send(res,error?.status||500,{error:error?.status?error.message:'internal_error'});}
});
server.requestTimeout=260000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
server.listen(PORT,HOST,()=>logEvent('lia_openai_broker_started',{version:'v2-observe',host:HOST,port:PORT,keyConfigured:true,executionEnabled:EXECUTION_ENABLED,leaseEnforced:true}));
