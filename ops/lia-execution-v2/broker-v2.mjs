import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { resolveProfile, actualCostMicroUsd } from './model-policy.mjs';

const HOST=process.env.LIA_BROKER_HOST||'127.0.0.1';
const PORT=Number(process.env.LIA_BROKER_PORT||8791);
const ADMIN_TOKEN=String(process.env.LIA_BROKER_ADMIN_TOKEN||'');
const API_KEY=String(process.env.OPENAI_API_KEY||'');
const LEASE_SECRET=String(process.env.LIA_LEASE_SECRET||'');
const EXECUTION_ENABLED=process.env.LIA_BROKER_EXECUTION_ENABLED==='1';
const DATA_DIR=path.resolve(process.env.LIA_BROKER_DATA_DIR||'/var/lib/lia-openai-broker');
const LEDGER_FILE=path.join(DATA_DIR,'lease-ledger.json');
const MAX_BODY_BYTES=4*1024*1024;
const MAX_RESPONSE_BYTES=16*1024*1024;
const MAX_REQUESTS_PER_LEASE=Math.max(1,Math.min(30,Number(process.env.LIA_BROKER_MAX_REQUESTS_PER_LEASE||20)));
const BUDGET_SAFETY_RATIO=Math.max(0.50,Math.min(0.95,Number(process.env.LIA_BROKER_BUDGET_SAFETY_RATIO||0.90)));
const UPSTREAM='https://api.openai.com/v1/responses';

if(!Number.isInteger(PORT)||PORT<1||PORT>65535)throw new Error('invalid_port');
if(ADMIN_TOKEN.length<32)throw new Error('broker_token_too_short');
if(LEASE_SECRET.length<32)throw new Error('lease_secret_too_short');
if(!API_KEY||/[\r\n\0]/.test(API_KEY)||API_KEY.length<20)throw new Error('invalid_api_key');

await fs.mkdir(DATA_DIR,{recursive:true,mode:0o700});
let ledger={};
try{
  const parsed=JSON.parse(await fs.readFile(LEDGER_FILE,'utf8'));
  if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))ledger=parsed;
}catch(error){if(error?.code!=='ENOENT')throw error;}

for(const entry of Object.values(ledger)){
  if(!entry||typeof entry!=='object')continue;
  if(!Number.isFinite(Number(entry.spentMicroUsd)))entry.spentMicroUsd=0;
  if(!Number.isFinite(Number(entry.uncertainMicroUsd)))entry.uncertainMicroUsd=0;
  if(!Number.isFinite(Number(entry.inFlightMicroUsd)))entry.inFlightMicroUsd=0;
}

function digest(v){return createHash('sha256').update(String(v)).digest();}
function equal(a,b){return timingSafeEqual(digest(a),digest(b));}
function adminAuthorized(req){const b=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');return Boolean(b)&&equal(b,ADMIN_TOKEN);}
function send(res,status,payload){const raw=JSON.stringify(payload);res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','content-length':Buffer.byteLength(raw)});res.end(raw);}
async function readRaw(req){let size=0,chunks=[];for await(const c of req){size+=c.length;if(size>MAX_BODY_BYTES)throw Object.assign(new Error('payload_too_large'),{status:413});chunks.push(c);}return Buffer.concat(chunks).toString('utf8');}
async function persist(){const tmp=`${LEDGER_FILE}.tmp-${process.pid}`;await fs.writeFile(tmp,`${JSON.stringify(ledger,null,2)}\n`,{mode:0o600});await fs.rename(tmp,LEDGER_FILE);}
function safeErrorSummary(text){const raw=String(text||'').replace(/[\r\n\t]+/g,' ').slice(0,1200);return raw.replace(/sk-[A-Za-z0-9_-]{10,}/g,'[redacted-key]').replace(/lia1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[redacted-lease]');}
function logEvent(event,payload={}){console.log(JSON.stringify({event,at:new Date().toISOString(),...payload}));}

function decodeLease(token){
  const match=/^lia1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(String(token||''));
  if(!match)throw Object.assign(new Error('invalid_lease'),{status:401});
  const [,body,sig]=match,expected=createHmac('sha256',LEASE_SECRET).update(body).digest('base64url');
  if(!equal(sig,expected))throw Object.assign(new Error('invalid_lease_signature'),{status:401});
  let payload;try{payload=JSON.parse(Buffer.from(body,'base64url').toString('utf8'));}catch{throw Object.assign(new Error('invalid_lease_payload'),{status:401});}
  const now=Math.floor(Date.now()/1000);
  if(payload?.v!==1||typeof payload.jti!=='string'||typeof payload.taskId!=='string'||!Number.isInteger(payload.exp)||payload.exp<now||Number(payload.iat)>now+60)throw Object.assign(new Error('expired_or_invalid_lease'),{status:401});
  const profile=resolveProfile(payload.profile);
  if(!profile||payload.model!==profile.model||payload.reasoning!==profile.reasoning||Number(payload.maxOutputTokens)!==profile.maxOutputTokens)throw Object.assign(new Error('lease_policy_mismatch'),{status:401});
  const budgetMicroUsd=Number(payload.budgetMicroUsd);
  if(!Number.isSafeInteger(budgetMicroUsd)||budgetMicroUsd<=0)throw Object.assign(new Error('invalid_lease_budget'),{status:401});
  return{payload,profile,budgetMicroUsd};
}

function ensureEntry(lease){
  const {payload,profile,budgetMicroUsd}=lease;
  let entry=ledger[payload.jti];
  if(!entry){
    entry={
      jti:payload.jti,taskId:payload.taskId,profile:profile.name,model:profile.model,budgetMicroUsd,
      spentMicroUsd:0,uncertainMicroUsd:0,inFlightMicroUsd:0,requests:0,
      expiresAt:new Date(payload.exp*1000).toISOString(),createdAt:new Date().toISOString()
    };
    ledger[payload.jti]=entry;
  }
  if(entry.taskId!==payload.taskId||entry.model!==profile.model||Number(entry.budgetMicroUsd)!==budgetMicroUsd)throw Object.assign(new Error('lease_ledger_mismatch'),{status:401});
  entry.spentMicroUsd=Math.max(0,Number(entry.spentMicroUsd||0));
  entry.uncertainMicroUsd=Math.max(0,Number(entry.uncertainMicroUsd||0));
  entry.inFlightMicroUsd=Math.max(0,Number(entry.inFlightMicroUsd||0));
  return entry;
}
function totalCommitted(entry){return entry.spentMicroUsd+entry.uncertainMicroUsd+entry.inFlightMicroUsd;}
function publicLease(entry){
  return{
    jti:entry.jti,taskId:entry.taskId,profile:entry.profile,model:entry.model,
    budgetMicroUsd:entry.budgetMicroUsd,spentMicroUsd:entry.spentMicroUsd,
    uncertainMicroUsd:entry.uncertainMicroUsd,inFlightMicroUsd:entry.inFlightMicroUsd,
    reservedMicroUsd:totalCommitted(entry),requests:entry.requests,
    lastBodyBytes:Number(entry.lastBodyBytes||0),lastInputTokens:Number(entry.lastInputTokens||0),
    expiresAt:entry.expiresAt,lastRequestAt:entry.lastRequestAt||null
  };
}
function regularInputReserveMicroUsd(tokens,profile){return Math.ceil(Math.max(1,Number(tokens||0))*profile.inputUsdPerMTok);}
function outputReserveMicroUsd(tokens,profile){return Math.ceil(Math.max(0,Number(tokens||0))*profile.outputUsdPerMTok);}
function hasRichInput(body){
  const raw=JSON.stringify(body);
  return /"type"\s*:\s*"(?:input_image|input_file|input_audio)"/.test(raw)
    || /"image_url"\s*:/.test(raw)
    || /"file_id"\s*:/.test(raw);
}
function estimateInputTokenReserve(bodyBytes,entry,body){
  const bytes=Math.max(1,Number(bodyBytes||0));
  const previousBytes=Math.max(0,Number(entry.lastBodyBytes||0));
  const previousTokens=Math.max(0,Number(entry.lastInputTokens||0));
  if(hasRichInput(body)||previousBytes<1||previousTokens<1){
    return{tokens:bytes,mode:hasRichInput(body)?'worst_case_rich_input':'worst_case_first_request'};
  }
  const scale=bytes/previousBytes;
  const observedWithMargin=Math.ceil(previousTokens*scale*1.75+512);
  const textFloor=Math.ceil(bytes/3)+512;
  return{tokens:Math.min(bytes,Math.max(observedWithMargin,textFloor)),mode:'adaptive_text_observed_175pct'};
}

async function reserveForRequest(lease,body){
  const {profile,budgetMicroUsd}=lease;
  const entry=ensureEntry(lease);
  if(entry.requests>=MAX_REQUESTS_PER_LEASE)throw Object.assign(new Error('lease_request_limit'),{status:429});
  if(entry.inFlightMicroUsd>0)throw Object.assign(new Error('lease_request_already_in_flight'),{status:409});

  const requested=Number(body.max_output_tokens);
  const desiredMax=Number.isFinite(requested)&&requested>0?Math.min(Math.floor(requested),profile.maxOutputTokens):profile.maxOutputTokens;
  body.max_output_tokens=desiredMax;

  const safetyCeilingMicroUsd=Math.floor(budgetMicroUsd*BUDGET_SAFETY_RATIO);
  let outgoing=JSON.stringify(body);
  let bodyBytes=Buffer.byteLength(outgoing);
  let inputEstimate=estimateInputTokenReserve(bodyBytes,entry,body);
  let inputReserve=regularInputReserveMicroUsd(inputEstimate.tokens,profile);
  let remaining=safetyCeilingMicroUsd-entry.spentMicroUsd-entry.uncertainMicroUsd;
  let affordable=Math.floor((remaining-inputReserve)/profile.outputUsdPerMTok);
  if(!Number.isFinite(affordable)||affordable<1)throw Object.assign(new Error('lease_budget_exhausted'),{status:402});

  body.max_output_tokens=Math.max(1,Math.min(desiredMax,affordable));
  outgoing=JSON.stringify(body);
  bodyBytes=Buffer.byteLength(outgoing);
  inputEstimate=estimateInputTokenReserve(bodyBytes,entry,body);
  inputReserve=regularInputReserveMicroUsd(inputEstimate.tokens,profile);
  remaining=safetyCeilingMicroUsd-entry.spentMicroUsd-entry.uncertainMicroUsd;
  affordable=Math.floor((remaining-inputReserve)/profile.outputUsdPerMTok);
  if(!Number.isFinite(affordable)||affordable<1)throw Object.assign(new Error('lease_budget_exhausted'),{status:402});
  if(body.max_output_tokens>affordable){
    body.max_output_tokens=affordable;
    outgoing=JSON.stringify(body);
    bodyBytes=Buffer.byteLength(outgoing);
    inputEstimate=estimateInputTokenReserve(bodyBytes,entry,body);
    inputReserve=regularInputReserveMicroUsd(inputEstimate.tokens,profile);
  }

  const reservation=inputReserve+outputReserveMicroUsd(body.max_output_tokens,profile);
  if(entry.spentMicroUsd+entry.uncertainMicroUsd+reservation>safetyCeilingMicroUsd)throw Object.assign(new Error('lease_budget_exhausted'),{status:402});
  entry.inFlightMicroUsd=reservation;
  entry.pendingBodyBytes=bodyBytes;
  entry.pendingInputTokenReserve=inputEstimate.tokens;
  entry.pendingReservationMode=inputEstimate.mode;
  entry.requests+=1;
  entry.lastRequestAt=new Date().toISOString();
  await persist();
  return{entry,reservation,outgoing,bodyBytes,inputTokenReserve:inputEstimate.tokens,reservationMode:inputEstimate.mode,safetyCeilingMicroUsd};
}

function normalizeUsage(usage){
  if(!usage||typeof usage!=='object')return null;
  const input=Math.max(0,Number(usage.input_tokens||0));
  const cached=Math.max(0,Number(usage.cached_input_tokens??usage.input_tokens_details?.cached_tokens??0));
  const output=Math.max(0,Number(usage.output_tokens||0));
  if(!Number.isFinite(input)||!Number.isFinite(cached)||!Number.isFinite(output))return null;
  return{input_tokens:input,cached_input_tokens:Math.min(input,cached),output_tokens:output};
}
function extractJsonUsage(text){
  try{
    const parsed=JSON.parse(text);
    return normalizeUsage(parsed?.usage||parsed?.response?.usage);
  }catch{return null;}
}
function createSseUsageParser(){
  const decoder=new TextDecoder();
  let lineBuffer='',dataLines=[],usage=null,terminalType=null,terminalSummary=null,eventCount=0;
  function parseEvent(){
    if(!dataLines.length)return;
    const raw=dataLines.join('\n').trim();
    dataLines=[];
    if(!raw||raw==='[DONE]')return;
    try{
      const event=JSON.parse(raw);
      eventCount+=1;
      const type=String(event?.type||'');
      if(type==='response.completed'){
        terminalType=type;
        const parsed=normalizeUsage(event?.response?.usage);
        if(parsed)usage=parsed;
      }else if(type==='response.failed'||type==='response.incomplete'){
        terminalType=type;
        const parsed=normalizeUsage(event?.response?.usage);
        if(parsed)usage=parsed;
        terminalSummary=safeErrorSummary(JSON.stringify({
          error:event?.response?.error||null,
          incomplete_details:event?.response?.incomplete_details||null
        }));
      }else if(type==='error'){
        terminalType='error';
        terminalSummary=safeErrorSummary(JSON.stringify(event?.error||event));
      }
    }catch{}
  }
  function consumeLine(line){
    const clean=line.endsWith('\r')?line.slice(0,-1):line;
    if(clean===''){parseEvent();return;}
    if(clean.startsWith('data:'))dataLines.push(clean.slice(5).replace(/^ /,''));
  }
  return{
    push(chunk){
      lineBuffer+=decoder.decode(chunk,{stream:true});
      let idx;
      while((idx=lineBuffer.indexOf('\n'))>=0){
        const line=lineBuffer.slice(0,idx);
        lineBuffer=lineBuffer.slice(idx+1);
        consumeLine(line);
      }
    },
    finish(){
      lineBuffer+=decoder.decode();
      if(lineBuffer){consumeLine(lineBuffer);lineBuffer='';}
      parseEvent();
      return{usage,terminalType,terminalSummary,eventCount};
    }
  };
}

function clearPendingReservation(entry){
  entry.pendingBodyBytes=0;
  entry.pendingInputTokenReserve=0;
  entry.pendingReservationMode=null;
}
async function finalizeUsage(entry,reservation,usage,profile){
  entry.inFlightMicroUsd=0;
  if(usage){
    const actual=Math.max(0,actualCostMicroUsd(usage,profile));
    entry.spentMicroUsd+=actual;
    entry.lastActualMicroUsd=actual;
    entry.lastUsage=usage;
    entry.lastBodyBytes=Math.max(1,Number(entry.pendingBodyBytes||entry.lastBodyBytes||0));
    entry.lastInputTokens=Math.max(1,Number(usage.input_tokens||entry.lastInputTokens||0));
    const reservedInputTokens=Math.max(0,Number(entry.pendingInputTokenReserve||0));
    if(reservedInputTokens>0&&usage.input_tokens>reservedInputTokens){
      logEvent('lia_broker_input_estimate_under',{taskId:entry.taskId,jti:entry.jti,reservedInputTokens,actualInputTokens:usage.input_tokens,reservationMode:entry.pendingReservationMode||null});
    }
    if(actual>reservation)logEvent('lia_broker_reservation_underestimated',{taskId:entry.taskId,jti:entry.jti,reservationMicroUsd:reservation,actualMicroUsd:actual});
  }else{
    entry.uncertainMicroUsd+=reservation;
    entry.lastActualMicroUsd=null;
    entry.lastUsage=null;
    logEvent('lia_broker_usage_missing',{taskId:entry.taskId,jti:entry.jti,reservationMicroUsd:reservation});
  }
  clearPendingReservation(entry);
  await persist();
}
async function finalizeDefiniteError(entry){entry.inFlightMicroUsd=0;clearPendingReservation(entry);await persist();}
async function finalizeUncertain(entry,reservation){entry.inFlightMicroUsd=0;entry.uncertainMicroUsd+=reservation;clearPendingReservation(entry);await persist();}

function copySafeHeaders(res,source){
  const exact=new Set(['content-type','openai-request-id','x-request-id','openai-model','x-openai-model','x-codex-turn-state','x-reasoning-included','x-models-etag','retry-after']);
  for(const [name,value] of source.headers){
    const lower=name.toLowerCase();
    if(exact.has(lower)||lower.startsWith('x-ratelimit-'))res.setHeader(name,value);
  }
  res.setHeader('cache-control','no-store');
  res.setHeader('x-content-type-options','nosniff');
}

async function relaySse({upstream,res,entry,reservation,lease,requestId}){
  const parser=createSseUsageParser();
  const reader=upstream.body?.getReader?.();
  if(!reader){
    await finalizeUncertain(entry,reservation);
    if(!res.headersSent)return send(res,502,{error:'openai_stream_missing'});
    res.destroy();
    return;
  }

  res.statusCode=upstream.status;
  copySafeHeaders(res,upstream);
  res.flushHeaders?.();

  let bytes=0;
  try{
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      bytes+=value.byteLength;
      if(bytes>MAX_RESPONSE_BYTES){
        try{await reader.cancel('response_too_large');}catch{}
        await finalizeUncertain(entry,reservation);
        logEvent('lia_broker_upstream_response_too_large',{taskId:lease.payload.taskId,jti:lease.payload.jti,status:upstream.status,requestId,bytes});
        res.destroy();
        return;
      }
      parser.push(value);
      if(!res.destroyed)res.write(Buffer.from(value));
    }
    const parsed=parser.finish();
    await finalizeUsage(entry,reservation,parsed.usage,lease.profile);
    if(parsed.terminalType!=='response.completed'){
      logEvent('lia_broker_upstream_terminal_event',{
        taskId:lease.payload.taskId,jti:lease.payload.jti,status:upstream.status,requestId,
        terminalType:parsed.terminalType||'stream_ended_without_terminal_event',
        terminalSummary:parsed.terminalSummary||null,eventCount:parsed.eventCount
      });
    }
    logEvent('lia_broker_upstream_ok',{
      taskId:lease.payload.taskId,jti:lease.payload.jti,status:upstream.status,requestId,
      transport:'sse_passthrough',bytes,eventCount:parsed.eventCount,terminalType:parsed.terminalType||null,
      actualMicroUsd:entry.lastActualMicroUsd??null,spentMicroUsd:entry.spentMicroUsd,
      uncertainMicroUsd:entry.uncertainMicroUsd,usage:parsed.usage
    });
    if(!res.destroyed)res.end();
  }catch(error){
    await finalizeUncertain(entry,reservation);
    logEvent('lia_broker_upstream_stream_error',{taskId:lease.payload.taskId,jti:lease.payload.jti,status:upstream.status,requestId,error:String(error?.message||'stream_failed').slice(0,240),bytes});
    if(!res.destroyed)res.destroy(error);
  }
}

const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
    if(req.method==='GET'&&url.pathname==='/health')return send(res,200,{ok:true,service:'lia-openai-broker',version:'2026-09-18-v5-adaptive-budget',keyConfigured:true,executionEnabled:EXECUTION_ENABLED,leaseEnforced:true,actualUsageAccounting:true,ssePassthrough:true,adaptiveBudgetReservation:true,budgetSafetyRatio:BUDGET_SAFETY_RATIO,bind:HOST});
    if(req.method==='GET'&&url.pathname==='/v1/status'){
      if(!adminAuthorized(req))return send(res,401,{error:'unauthorized'});
      return send(res,200,{keyConfigured:true,executionEnabled:EXECUTION_ENABLED,realKeyExposed:false,leaseEnforced:true,actualUsageAccounting:true,ssePassthrough:true,adaptiveBudgetReservation:true,budgetSafetyRatio:BUDGET_SAFETY_RATIO,ledgerEntries:Object.keys(ledger).length});
    }
    const leaseStatus=url.pathname.match(/^\/v1\/leases\/([0-9a-f-]+)$/i);
    if(req.method==='GET'&&leaseStatus){
      if(!adminAuthorized(req))return send(res,401,{error:'unauthorized'});
      const entry=ledger[leaseStatus[1]];
      return entry?send(res,200,publicLease(entry)):send(res,404,{error:'lease_not_seen'});
    }

    if(req.method==='POST'&&url.pathname==='/v1/responses'){
      if(!EXECUTION_ENABLED)return send(res,423,{error:'broker_execution_locked'});
      const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
      const lease=decodeLease(token);
      const raw=await readRaw(req);
      let body;try{body=JSON.parse(raw);}catch{throw Object.assign(new Error('invalid_json'),{status:400});}
      if(!body||typeof body!=='object'||Array.isArray(body))return send(res,400,{error:'invalid_request'});

      body.model=lease.profile.model;
      body.reasoning={...(body.reasoning&&typeof body.reasoning==='object'?body.reasoning:{}),effort:lease.profile.reasoning};

      const {entry,reservation,outgoing,bodyBytes,inputTokenReserve,reservationMode,safetyCeilingMicroUsd}=await reserveForRequest(lease,body);
      logEvent('lia_broker_upstream_start',{taskId:lease.payload.taskId,jti:lease.payload.jti,profile:lease.profile.name,model:lease.profile.model,requestNumber:entry.requests,reservationMicroUsd:reservation,inputTokenReserve,reservationMode,bodyBytes,safetyCeilingMicroUsd,spentMicroUsd:entry.spentMicroUsd,uncertainMicroUsd:entry.uncertainMicroUsd,maxOutputTokens:body.max_output_tokens});

      let upstream;
      try{
        upstream=await fetch(UPSTREAM,{method:'POST',headers:{authorization:`Bearer ${API_KEY}`,'content-type':'application/json','user-agent':'VitrineCity-LIA/1.0'},body:outgoing,redirect:'error',signal:AbortSignal.timeout(240000)});
      }catch(error){
        await finalizeUncertain(entry,reservation);
        logEvent('lia_broker_upstream_transport_error',{taskId:lease.payload.taskId,jti:lease.payload.jti,error:String(error?.message||'transport_failed').slice(0,240),reservedAsUncertainMicroUsd:reservation});
        return send(res,502,{error:'openai_transport_failed_no_retry'});
      }

      const requestId=upstream.headers.get('openai-request-id')||upstream.headers.get('x-request-id')||null;
      const contentType=String(upstream.headers.get('content-type')||'').toLowerCase();

      if(!upstream.ok){
        let responseText='';
        try{responseText=await upstream.text();}catch{}
        await finalizeDefiniteError(entry);
        logEvent('lia_broker_upstream_error',{taskId:lease.payload.taskId,jti:lease.payload.jti,status:upstream.status,requestId,error:safeErrorSummary(responseText)});
        res.statusCode=upstream.status;
        copySafeHeaders(res,upstream);
        const bytes=Buffer.from(responseText);
        res.setHeader('content-length',bytes.length);
        res.end(bytes);
        return;
      }

      if(contentType.includes('text/event-stream')){
        return await relaySse({upstream,res,entry,reservation,lease,requestId});
      }

      const contentLength=Number(upstream.headers.get('content-length')||0);
      if(Number.isFinite(contentLength)&&contentLength>MAX_RESPONSE_BYTES){
        await finalizeUncertain(entry,reservation);
        logEvent('lia_broker_upstream_response_too_large',{taskId:lease.payload.taskId,jti:lease.payload.jti,status:upstream.status,requestId,contentLength});
        return send(res,502,{error:'openai_response_too_large'});
      }

      let responseBytes;
      try{responseBytes=Buffer.from(await upstream.arrayBuffer());}
      catch(error){
        await finalizeUncertain(entry,reservation);
        logEvent('lia_broker_upstream_body_error',{taskId:lease.payload.taskId,jti:lease.payload.jti,status:upstream.status,requestId,error:String(error?.message||'body_failed').slice(0,240)});
        return send(res,502,{error:'openai_body_failed_no_retry'});
      }
      if(responseBytes.length>MAX_RESPONSE_BYTES){
        await finalizeUncertain(entry,reservation);
        return send(res,502,{error:'openai_response_too_large'});
      }

      const usage=extractJsonUsage(responseBytes.toString('utf8'));
      await finalizeUsage(entry,reservation,usage,lease.profile);
      logEvent('lia_broker_upstream_ok',{taskId:lease.payload.taskId,jti:lease.payload.jti,status:upstream.status,requestId,transport:'buffered_json',bytes:responseBytes.length,actualMicroUsd:entry.lastActualMicroUsd??null,spentMicroUsd:entry.spentMicroUsd,uncertainMicroUsd:entry.uncertainMicroUsd,usage});
      res.statusCode=upstream.status;
      copySafeHeaders(res,upstream);
      res.setHeader('content-length',responseBytes.length);
      res.end(responseBytes);
      return;
    }

    return send(res,404,{error:'not_found'});
  }catch(error){
    if(error?.status)logEvent('lia_broker_rejected',{status:error.status,error:error.message});
    return send(res,error?.status||500,{error:error?.status?error.message:'internal_error'});
  }
});

server.requestTimeout=260000;
server.headersTimeout=10000;
server.keepAliveTimeout=5000;
server.listen(PORT,HOST,()=>logEvent('lia_openai_broker_started',{version:'v5-adaptive-budget',host:HOST,port:PORT,keyConfigured:true,executionEnabled:EXECUTION_ENABLED,leaseEnforced:true,actualUsageAccounting:true,ssePassthrough:true,adaptiveBudgetReservation:true,budgetSafetyRatio:BUDGET_SAFETY_RATIO}));
