import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import{spawnSync}from'node:child_process';
import {createNeuralChatEngine} from '../vitriny-neural/chat-engine.js';
import {createPaidChatRuntime} from '../vitriny-neural/paid-chat-runtime.js';
import {createChatArtifacts} from '../vitriny-neural/chat-artifacts.js';
import {createCoinWallet} from '../vitrine-coins-wallet.js';
import {createCoinAiWalletAdapter} from '../vitriny-neural/coin-wallet-adapter.js';
import {VITRINE_COINS_POLICY} from '../public/vitrine-coins-contract.js';
import {NATIVE_AUDIO_720} from '../vitriny-neural/video-audio-policy.js';
import Database from 'better-sqlite3';
import express from 'express';
import {mountNeuralChatApi} from '../vitriny-neural/chat-api.js';
console.log('REAL_DEPENDENCIES: better-sqlite3 + Express');
async function fixture({audio=true,enabled=true,lost=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'audio-flow-'));let now=Date.parse('2026-09-19T12:00:00Z');
 const file=path.join(root,'test.mp4'),args=['-v','error','-f','lavfi','-i','color=c=black:s=320x320:r=5'];
 if(audio)args.push('-f','lavfi','-i','sine=frequency=440:sample_rate=16000');
 args.push('-t','5','-c:v','libx264','-threads','1','-pix_fmt','yuv420p',...(audio?['-c:a','aac']:['-an']),'-movflags','+faststart',file);
 assert.equal(spawnSync('ffmpeg',args,{timeout:15000}).status,0);
 const data=fs.readFileSync(file),db=new Database(':memory:');
 db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,is_admin INTEGER,email TEXT,account_status TEXT);INSERT INTO users VALUES(1,1,'test@example.test','active'),(2,0,'other@example.test','active')");
 const coins=createCoinWallet({db,enabled:true,now:()=>now}),wallet=createCoinAiWalletAdapter({db,coinWallet:coins,now:()=>now});
 wallet.grant('user:1',{paymentReference:'mercadopago:9192026',amountMicroBrl:20000000,termsVersion:VITRINE_COINS_POLICY.version});
 const artifacts=createChatArtifacts({db,directory:path.join(root,'private'),now:()=>now,download:async()=>({data,mimeType:'video/mp4'})});
 const calls=[],tasks=new Map(),config={enabled:true,billingPolicyVersion:VITRINE_COINS_POLICY.version,fx:{version:'synthetic-fx',observedAt:new Date(now).toISOString(),usdToBrl:'5'},
  kling:{accountBinding:'test-account',policyRevision:'test-policy',tariffVersion:'synthetic-silent',effectiveAt:new Date(now).toISOString(),videoUsdPerSecond:'0.084',imageUsdEach:'0.028',unitUsd:{video:'0.14',image:'0.0035'},nativeAudio720:{...NATIVE_AUDIO_720,enabled}}};
 const runtime=createPaidChatRuntime({db,wallet,artifacts,config,env:{KLING_API_KEY:'synthetic-only'},now:()=>now,pollIntervalMs:30000,authorizeScope:s=>wallet.allowsScope(s),fetchImpl:async(url,init)=>{
  calls.push({method:init.method,url});let value;
  if(init.method==='POST'){if(lost)throw Error('synthetic transport loss');const body=JSON.parse(init.body),external=body.options.external_task_id;
   const task={id:'task-'+external,external_id:external,status:'submitted',create_time:now,update_time:now,audio:body.settings.audio};tasks.set(task.id,task);value={...task};delete value.audio;
  }else{const id=new URL(url).searchParams.get('task_ids'),t=tasks.get(id);assert.ok(t);
   value=[{id:t.id,external_id:t.external_id,status:'succeeded',create_time:t.create_time,update_time:now,billing:[{charge_type:'cash',cash_type:'balance',amount:t.audio==='native'?'0.630':'0.420',currency:'USD'}],outputs:[{type:'video',id:'out-001',duration:'5.000',url:'https://synthetic.klingai.com/test.mp4'}]}];}
  return new Response(JSON.stringify({code:0,data:value}),{headers:{'content-type':'application/json'}});
 }});
 const chat=createNeuralChatEngine({db,paidRuntime:runtime,config:{enabled:true,mode:'advisory'},env:{VITRINE_COINS_ENABLED:'true'},now:()=>now,qualifications:{latest:()=>null},skills:{status:()=>({providers:[]}),invoke:()=>{throw Error('no model call');}},queueOptions:{pollIntervalMs:30000}});
 const app=express();app.disable('x-powered-by');app.use(express.json());
 const auth=(req,res,next)=>{if(!['1','2'].includes(req.get('x-test-user')))return res.sendStatus(401);req.user={id:Number(req.get('x-test-user'))};next();};
 mountNeuralChatApi({app,chat,artifacts,requireAdmin:auth,requireUser:auth,
  sameOriginOnly:(req,res,next)=>req.get('origin')==='https://fixture.test'?next():res.sendStatus(403),
  getAuthorizedStore:(_req,res)=>{res.sendStatus(403);return null;}});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const origin='http://127.0.0.1:'+server.address().port;
 const http=(suffix,{method='GET',body,user='1',originHeader='https://fixture.test'}={})=>fetch(origin+'/api/neural/chat'+suffix,{method,
  headers:{'content-type':'application/json','x-test-user':user,'x-neural-request':'1',origin:originHeader},
  ...(body===undefined?{}:{body:JSON.stringify(body)})});
 return {db,coins,wallet,artifacts,calls,chat,runtime,http,
  submit:(message)=>chat.submit('user:1',{message,idempotencyKey:randomUUID()}),
  confirm:(q,key=randomUUID())=>chat.confirm('user:1',q.requestId,{quoteId:q.payment.quoteId,idempotencyKey:key}),
  read:q=>chat.request('user:1',q.requestId),
  async finish(q,poll=true){await chat.wait(q.requestId);if(poll){now+=6000;runtime.kick();await runtime.wait(q.requestId);}await new Promise(r=>setImmediate(r));},
  async close(){chat.close();server.closeAllConnections();await new Promise(r=>server.close(r));db.close();fs.rmSync(root,{recursive:true,force:true});}};
}
test('full engine + SQLite + canonical wallet: native quote, one dispatch, one settlement, private audio result',async()=>{
 const f=await fixture();try{const q=f.submit('Gere um vídeo de 5 segundos com áudio de chuva.');
  assert.equal(q.payment.kind,'video');assert.equal(q.payment.amountMicro,3150000);assert.match(q.payment.summary,/com áudio nativo/);
  assert.equal(f.calls.length,0);assert.equal(f.coins.status(1).reservedAtoms,'0');const key=randomUUID();f.confirm(q,key);await f.finish(q);
  const result=f.read(q);assert.equal(result.status,'completed');assert.equal(result.payment.chargedMicro,3150000);assert.equal(result.artifacts.length,1);
  f.confirm(q,key);await f.finish(q);assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
  assert.equal(f.coins.status(1).chargedAtoms,String(3150000*96));assert.equal(f.coins.status(1).reservedAtoms,'0');
 }finally{await f.close();}
});
test('silent old quotes keep exact old pricing and work',async()=>{const f=await fixture({audio:false});try{const q=f.submit('Gere um vídeo de 5 segundos sem áudio.');assert.equal(q.payment.amountMicro,2100000);f.confirm(q);await f.finish(q);assert.equal(f.read(q).status,'completed');}finally{await f.close();}});
test('missing audio never reports delivery success or repeats a paid task',async()=>{const f=await fixture({audio:false});try{const q=f.submit('Gere um vídeo de 5 segundos com áudio.');f.confirm(q);await f.finish(q);const r=f.read(q);assert.equal(r.status,'failed');assert.equal(r.artifacts.length,0);assert.equal(r.payment.chargedMicro,3150000);assert.equal(f.calls.filter(c=>c.method==='POST').length,1);const text=f.db.prepare("SELECT text FROM neural_chat_messages WHERE request_id=? AND role='assistant'").get(q.requestId).text;assert.match(text,/verificação de áudio/);}finally{await f.close();}});
test('audio with missing tariff does not reserve or dispatch',async()=>{const f=await fixture({enabled:false});try{assert.throws(()=>f.submit('Gere um vídeo com áudio.'));assert.equal(f.calls.length,0);assert.equal(f.coins.status(1).reservedAtoms,'0');}finally{await f.close();}});
test('lost audio POST is held and never automatically repeated',async()=>{const f=await fixture({lost:true});try{const q=f.submit('Gere um vídeo com áudio.');f.confirm(q);await f.finish(q,false);await f.finish(q,false);assert.equal(f.calls.filter(c=>c.method==='POST').length,1);assert.notEqual(f.coins.status(1).reservedAtoms,'0');}finally{await f.close();}});

test('real HTTP personal chat confirms audio, delivers private bytes, prevents duplicate billing and denies another user',async()=>{
 const f=await fixture();try{
  const res=await f.http('/messages',{method:'POST',body:{message:'Gere um vídeo de 5 segundos com áudio.',idempotencyKey:randomUUID()}});
  assert.equal(res.status,202);const q=await res.json();assert.match(q.payment.summary,/com áudio nativo/);
  assert.equal(f.calls.length,0);const key=randomUUID();const body={quoteId:q.payment.quoteId,idempotencyKey:key};
  assert.equal((await f.http('/requests/'+q.requestId+'/confirm',{method:'POST',body})).status,202);
  await f.finish(q);const read=await f.http('/requests/'+q.requestId);assert.equal(read.status,200);
  const result=(await read.json()).request;assert.equal(result.status,'completed');assert.equal(result.artifacts.length,1);
  const url='/artifacts/'+result.artifacts[0].id+'/content';
  const bytes=await f.http(url);assert.equal(bytes.status,200);assert.equal(bytes.headers.get('x-powered-by'),null);assert.ok((await bytes.arrayBuffer()).byteLength>0);
  assert.equal((await f.http(url,{user:'2'})).status,404);
  assert.equal((await f.http('/requests/'+q.requestId,{user:'2'})).status,404);
  await f.http('/requests/'+q.requestId+'/confirm',{method:'POST',body});await f.finish(q);
  assert.equal(f.calls.filter(x=>x.method==='POST').length,1);assert.equal(f.coins.status(1).chargedAtoms,String(3150000*96));
 }finally{await f.close();}
});
test('real HTTP rejects missing login, cross origin and contradictory audio without dispatch or debit',async()=>{
 const f=await fixture();try{
  const base={message:'Gere um vídeo com áudio.',idempotencyKey:randomUUID()};
  assert.equal((await f.http('/messages',{method:'POST',body:base,user:''})).status,401);
  assert.equal((await f.http('/messages',{method:'POST',body:base,originHeader:'https://untrusted.test'})).status,403);
  assert.equal((await f.http('/messages',{method:'POST',body:{...base,message:'Gere um vídeo com áudio mas sem áudio.'}})).status,400);
  assert.equal(f.calls.length,0);assert.equal(f.coins.status(1).reservedAtoms,'0');
 }finally{await f.close();}
});
