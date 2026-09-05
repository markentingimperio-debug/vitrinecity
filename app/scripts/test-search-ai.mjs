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
