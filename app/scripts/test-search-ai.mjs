import assert from 'node:assert/strict';
import express from 'express';
import Database from 'better-sqlite3';
import { setupSearchAi } from '../search-ai.js';

const db = new Database(':memory:'); let clock = Date.now(), calls = [], failGemini = true;
const env = { SEARCH_AI_FREE_PROVIDERS:'gemini,groq', SEARCH_AI_GEMINI_KEY:'test', SEARCH_AI_GROQ_KEY:'test', SEARCH_AI_GEMINI_DAILY:'2', SEARCH_AI_GROQ_DAILY:'2' };
const lookup = async () => ({results:[{title:'Receita',url:'https://example.com/receita',description:'Preaqueça o forno a 180 graus.'}]});
const fetchImpl = async (url, options) => {
  assert.equal(options.redirect,'error');
  assert.ok(options.signal); const provider = url.includes('googleapis')?'gemini':'groq'; calls.push(provider);
  assert.ok(!url.includes('test')); // Keys must be headers, not URL parameters.
  if (provider==='gemini' && failGemini) return new Response('{}',{status:429,headers:{'Retry-After':'120'}});
  return Response.json(provider==='gemini'?{candidates:[{content:{parts:[{text:'Use forno a 180 graus [1].'}]}}]}:{choices:[{message:{content:'Use forno a 180 graus [1].'}}]});
};
const app=express();app.use(express.json());setupSearchAi(app,{db,env,lookup,fetchImpl,now:()=>clock});
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
const ask=async q=>{const r=await fetch(base+'/api/search/ai',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({q})});return {status:r.status,data:await r.json()};};
try {
  const first=await ask('como fazer bolo');assert.equal(first.status,200);assert.equal(first.data.provider,'groq');assert.deepEqual(calls,['gemini','groq']);assert.equal(first.data.sources[0].url,'https://example.com/receita');
  const cached=await ask('como fazer bolo');assert.equal(cached.data.cached,true);assert.equal(calls.length,2);
  await ask('receita de bolo');assert.deepEqual(calls,['gemini','groq','groq']); // Gemini cooling, Groq quota now full.
  assert.equal((await ask('outra receita')).status,429); // Per-visitor limit.
  clock+=121000;failGemini=false;
  const next=await ask('bolo simples');assert.equal(next.data.provider,'gemini');
  const exhausted=await ask('bolo de chocolate');assert.equal(exhausted.status,503);assert.equal(calls.length,4);
  assert.equal(db.prepare('SELECT SUM(requests) n FROM search_ai_usage').get().n,4);
  // A fresh manager retains the persisted daily quota, rather than resetting on restart.
  const app2=express();app2.use(express.json());setupSearchAi(app2,{db,env,lookup,fetchImpl,now:()=>clock});
  const server2=app2.listen(0,'127.0.0.1');await new Promise(r=>server2.once('listening',r));
  try {const r=await fetch('http://127.0.0.1:'+server2.address().port+'/api/search/ai',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({q:'reiniciado'})});assert.equal(r.status,503);assert.equal(calls.length,4);}finally{server2.close();}
  const off=express();off.use(express.json());setupSearchAi(off,{db,env:{...env,SEARCH_AI_FREE_PROVIDERS:''},lookup,fetchImpl});
  const offServer=off.listen(0,'127.0.0.1');await new Promise(r=>offServer.once('listening',r));
  try{const r=await fetch('http://127.0.0.1:'+offServer.address().port+'/api/search/ai/status');assert.equal((await r.json()).enabled,false);assert.equal(calls.length,4);}finally{offServer.close();}
  console.log('search-ai: quota allocation, failover, cooldown, cache, persistent limits and opt-in passed');
} finally {server.close();db.close();}

// Exercise Cloudflare's native response envelope, both fallback directions and opt-in.
const cfDb = new Database(':memory:');
let cfClock = Date.now(), cfMode = 'groq-fails', cfCalls = [];
const cfEnv = { SEARCH_AI_FREE_PROVIDERS: 'groq,cloudflare', SEARCH_AI_GROQ_KEY: 'groq-secret',
  SEARCH_AI_CLOUDFLARE_KEY: 'cf-secret', SEARCH_AI_CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
  SEARCH_AI_GROQ_DAILY: '3', SEARCH_AI_CLOUDFLARE_DAILY: '2' };
const cfFetch = async (url, options) => {
  const isCf = url.includes('api.cloudflare.com'); const id = isCf ? 'cloudflare' : 'groq'; cfCalls.push(id);
  assert.equal(options.redirect, 'error');
  assert.equal(options.headers.Authorization, `Bearer ${isCf ? 'cf-secret' : 'groq-secret'}`);
  assert.ok(!url.includes('secret'));
  if (isCf) {
    assert.equal(url, `https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/ai/run/@cf/meta/llama-3.1-8b-instruct-fp8-fast`);
    const body = JSON.parse(options.body); assert.equal(body.max_tokens, 512); assert.equal(body.messages.length, 2);
    assert.equal(body.reasoning_effort, undefined);
    if (cfMode === 'cf-fails') return Response.json({success:false,errors:[{code:123,message:'Unavailable'}]});
    return Response.json({success:true,result:{response:'Preaqueça a 180 graus [1].'}});
  }
  if (cfMode === 'groq-fails') return new Response('{}', {status:429,headers:{'retry-after':'60'}});
  return Response.json({choices:[{message:{content:'Resposta Groq [1].'}}]});
};
const cfApp=express();cfApp.use(express.json());setupSearchAi(cfApp,{db:cfDb,env:cfEnv,lookup,fetchImpl:cfFetch,now:()=>cfClock});
const cfServer=cfApp.listen(0,'127.0.0.1');await new Promise(r=>cfServer.once('listening',r));
const cfBase='http://127.0.0.1:'+cfServer.address().port;
const cfAsk=async q=>{const r=await fetch(cfBase+'/api/search/ai',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({q})});return {status:r.status,data:await r.json()};};
try {
  assert.deepEqual((await (await fetch(cfBase+'/api/search/ai/status')).json()).providers,['groq','cloudflare']);
  assert.equal((await cfAsk('bolo receita')).data.provider,'cloudflare');assert.deepEqual(cfCalls,['groq','cloudflare']);
  assert.equal((await cfAsk('bolo receita')).data.cached,true);assert.equal(cfCalls.length,2);
  // Groq remains cooling. A failed Cloudflare envelope must not become an answer.
  cfMode='cf-fails'; assert.equal((await cfAsk('bolo novo')).status,503);
  assert.equal(cfDb.prepare("SELECT requests FROM search_ai_usage WHERE provider='cloudflare'").get().requests,2);
  cfClock+=61000; cfMode='ok';
  assert.equal((await cfAsk('outra receita')).data.provider,'groq'); // Cloudflare daily limit reached.
  assert.deepEqual(cfCalls,['groq','cloudflare','cloudflare','groq']);
  cfClock+=86400000; cfMode='cf-fails';
  // Force Cloudflare first through the persisted quota ratio, then recover with Groq.
  cfDb.prepare('INSERT INTO search_ai_usage(day,provider,requests) VALUES(?,?,1)').run(new Date(cfClock).toISOString().slice(0,10),'groq');
  assert.equal((await cfAsk('receita do dia')).data.provider,'groq');assert.deepEqual(cfCalls.slice(-2),['cloudflare','groq']);
  const invalid=express();setupSearchAi(invalid,{db:cfDb,env:{...cfEnv,SEARCH_AI_FREE_PROVIDERS:'cloudflare',SEARCH_AI_CLOUDFLARE_ACCOUNT_ID:'../invalid'},lookup,fetchImpl:cfFetch});
  const s=invalid.listen(0,'127.0.0.1');await new Promise(r=>s.once('listening',r));
  try {assert.equal((await (await fetch('http://127.0.0.1:'+s.address().port+'/api/search/ai/status')).json()).enabled,false);} finally {s.close();}
  console.log('search-ai: Cloudflare request, envelope, both fallback directions, daily quota and account validation passed');
} finally {cfServer.close();cfDb.close();}
