import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import express from 'express';
import {referenceMediaKind,requestsImageReference,routeReferenceMedia} from '../public/neural-reference-media.js';
import {createNeuralChatEngine,routeChatIntent} from '../vitriny-neural/chat-engine.js';
import {createPaidChatRuntime} from '../vitriny-neural/paid-chat-runtime.js';
import {createChatArtifacts} from '../vitriny-neural/chat-artifacts.js';
import {mountNeuralChatApi} from '../vitriny-neural/chat-api.js';
import {setupLiaChatOperations} from '../vitriny-neural/lia-chat-operations.js';
import {createCoinWallet} from '../vitrine-coins-wallet.js';
import {createCoinAiWalletAdapter} from '../vitriny-neural/coin-wallet-adapter.js';
import {VITRINE_COINS_POLICY} from '../public/vitrine-coins-contract.js';

const cases=[
 ['Gere um vídeo demonstrativo desse produto','video'],['Use essa imagem e crie um vídeo anúncio','video'],
 ['Anime esse produto','video'],['Anime essa imagem','video'],['Quero animar esta foto','video'],
 ['Transforme esse print em vídeo','video'],['Gere um vídeo desse produto com áudio nativo','video'],
 ['Crie uma image de anúncio desse produto','image'],['Crie uma arte usando essa embalagem','image'],
 ['Faça uma foto desse produto com fundo branco','image'],['Gere uma imagem com uma legenda no canto','image'],
 ['Escreva um roteiro para um vídeo desse produto','text'],['Gere uma legenda para essa imagem','text'],
 ['Escreva um prompt para animar essa foto','text'],['Gere um texto para anúncio do produto','text'],
 ['Descreva essa imagem','text'],['Como animar essa foto?','text'],['O que está escrito no rótulo?','text'],
 ['Envie um vídeo ao cliente','action'],['Publique uma imagem desse produto','action'],
 ['Pesquise esse produto','research'],['Crie uma narração para esse vídeo','audio']
];
for(const [message,kind] of cases)test('intent: '+message,()=>assert.equal(routeReferenceMedia(message,routeChatIntent(message)).kind,kind));
for(const message of ['desse produto','dessa embalagem','esta foto','use a imagem','a imagem anexada','o print que eu enviei'])
 test('private reuse: '+message,()=>assert.equal(requestsImageReference(message),true));
for(const message of ['Gere um vídeo de uma montanha','Não use essa imagem','sem usar a foto','um produto qualquer'])
 test('no implicit reuse: '+message,()=>assert.equal(requestsImageReference(message),false));
test('writing or analysis never declares reference generation',()=>{
 for(const s of ['Crie uma legenda para um vídeo','Analise a imagem','Explique como animar um produto','Faça um roteiro de propaganda'])assert.equal(referenceMediaKind(s),null);
});

const AUDIO=process.env.REFERENCE_AUDIO_ENABLED==='1';
const TARIFF={enabled:true,model:'kling-3.0',resolution:'720p',usdPerSecond:'0.126',
 tariffVersion:'kling-3.0-native-audio-720p-20260919',effectiveAt:'2026-09-19T00:00:00.000Z'};
const response=data=>new Response(JSON.stringify({code:0,data}),{headers:{'content-type':'application/json'}});
async function fixture({lost=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lia-reference-test-'));
 const encode=(args)=>assert.equal(spawnSync('/usr/bin/ffmpeg',['-v','error','-nostdin',...args],{timeout:15000,env:{PATH:'/usr/bin:/bin'}}).status,0);
 const png=path.join(root,'product.png'),mp4=path.join(root,'output.mp4');
 encode(['-f','lavfi','-i','color=c=white:s=320x320','-frames:v','1','-threads','1',png]);
 encode(['-f','lavfi','-i','color=c=white:s=320x320:r=5',...(AUDIO?['-f','lavfi','-i','sine=frequency=440:sample_rate=16000']:[]),
  '-t','5','-c:v','libx264','-threads','1','-pix_fmt','yuv420p',...(AUDIO?['-c:a','aac']:['-an']),'-movflags','+faststart',mp4]);
 const image=fs.readFileSync(png),video=fs.readFileSync(mp4),db=new Database(':memory:');let now=Date.parse('2026-09-19T17:00:00Z');
 db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,is_admin INTEGER,email TEXT,account_status TEXT);INSERT INTO users VALUES(1,1,'one@example.test','active'),(2,0,'two@example.test','active')");
 const coins=createCoinWallet({db,enabled:true,now:()=>now}),wallet=createCoinAiWalletAdapter({db,coinWallet:coins,now:()=>now});
 wallet.grant('user:1',{paymentReference:'mercadopago:91920262001',amountMicroBrl:20000000,termsVersion:VITRINE_COINS_POLICY.version});
 const artifacts=createChatArtifacts({db,directory:path.join(root,'private'),now:()=>now,
  download:async url=>url.endsWith('.mp4')?{data:video,mimeType:'video/mp4'}:{data:image,mimeType:'image/png'}});
 const calls=[],tasks=new Map();
 const config={enabled:true,billingPolicyVersion:VITRINE_COINS_POLICY.version,fx:{version:'fixture-fx',observedAt:new Date(now).toISOString(),usdToBrl:'5'},
  kling:{accountBinding:'test-account',policyRevision:'test-policy',tariffVersion:'test-silent',effectiveAt:new Date(now).toISOString(),videoUsdPerSecond:'0.084',imageUsdEach:'0.028',unitUsd:{video:'0.14',image:'0.0035'},...(AUDIO?{nativeAudio720:TARIFF}:{})}};
 const runtime=createPaidChatRuntime({db,wallet,artifacts,config,env:{KLING_API_KEY:'fixture-only-not-a-real-credential'},now:()=>now,pollIntervalMs:30000,authorizeScope:s=>wallet.allowsScope(s),fetchImpl:async(url,init)=>{
  assert.equal(new URL(url).hostname,'api-singapore.klingai.com');
  const body=init.method==='POST'?JSON.parse(init.body):null;calls.push({url,method:init.method,body});
  if(init.method==='POST'){
   if(lost)throw Error('synthetic lost POST');
   const kind=url.includes('/images/')?'image':'video',external=kind==='video'?body.options.external_task_id:body.external_task_id,id='test-'+external;
   tasks.set(id,{kind,external,audio:body.settings?.audio});
   return response(kind==='video'?{id,external_id:external,status:'submitted',create_time:now,update_time:now}:{task_id:id,task_status:'submitted',task_info:{external_task_id:external}});
  }
  const u=new URL(url),id=u.pathname.includes('/images/')?decodeURIComponent(u.pathname.split('/').pop()):u.searchParams.get('task_ids'),t=tasks.get(id);assert.ok(t);
  return response(t.kind==='image'?{task_id:id,task_status:'succeed',task_info:{external_task_id:t.external},final_unit_deduction:'8',final_balance_deduction:{quota:'0'},task_result:{images:[{url:'https://fixture.klingai.com/result.png'}]}}:
   [{id,external_id:t.external,status:'succeeded',create_time:now-6000,update_time:now,billing:[{charge_type:'cash',cash_type:'balance',currency:'USD',amount:t.audio==='native'?'0.63':'0.42'}],outputs:[{type:'video',id:'video-001',duration:'5.000',url:'https://fixture.klingai.com/result.mp4'}]}]);
 }});
 const chat=createNeuralChatEngine({db,paidRuntime:runtime,config:{enabled:true,mode:'advisory'},env:{VITRINE_COINS_ENABLED:'true'},now:()=>now,qualifications:{latest:()=>null},
  skills:{status:()=>({providers:[]}),invoke:()=>{throw Error('No text or local inference is permitted in this fixture');}},queueOptions:{pollIntervalMs:30000}});
 const app=express();app.disable('x-powered-by');app.use(express.json());
 const auth=(req,res,next)=>{if(!['1','2'].includes(req.get('x-test-user')))return res.sendStatus(401);req.user={id:Number(req.get('x-test-user'))};next();};
 const originGuard=(req,res,next)=>req.get('origin')==='https://fixture.test'?next():res.sendStatus(403);
 mountNeuralChatApi({app,chat,artifacts,requireAdmin:auth,requireUser:auth,sameOriginOnly:originGuard,getAuthorizedStore:()=>null});
 setupLiaChatOperations({app,db,coinWallet:coins,requireUser:auth,sameOriginOnly:originGuard,
  env:{LIA_CHAT_OPERATIONS_ENABLED:'true',LIA_OPERATIONS_TOKEN:'fixture-token-not-a-secret-000000000000'},fetchImpl:()=>{throw Error('No remote worker expected');}});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const http=(suffix,{method='GET',body,user='1',origin='https://fixture.test'}={})=>fetch('http://127.0.0.1:'+server.address().port+'/api/neural/chat'+suffix,
  {method,headers:{'content-type':'application/json','x-test-user':user,'x-neural-request':'1',origin},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const upload=(scope='user:1')=>chat.upload(scope,{name:'produto.png',mimeType:'image/png',dataBase64:image.toString('base64')});
 return {db,chat,runtime,coins,artifacts,calls,image,http,upload,
  submit:(message,attachmentIds=[],conversationId)=>chat.submit('user:1',{message,idempotencyKey:randomUUID(),attachmentIds,...(conversationId?{conversationId}:{})}),
  async finish(q){chat.confirm('user:1',q.requestId,{quoteId:q.payment.quoteId,idempotencyKey:'confirm_'+q.requestId});await chat.wait(q.requestId);now+=6000;runtime.kick();await runtime.wait(q.requestId);},
  async close(){chat.close();server.closeAllConnections();await new Promise(r=>server.close(r));db.close();fs.rmSync(root,{recursive:true,force:true});}};
}

test('real HTTP image upload to video: private first frame, correct quote, one charge and owned download',async()=>{
 const f=await fixture();try{
  const uploaded=await f.http('/attachments',{method:'POST',body:{name:'produto.png',mimeType:'image/png',dataBase64:f.image.toString('base64')}});
  assert.equal(uploaded.status,201);const attachment=(await uploaded.json()).attachment;
  const res=await f.http('/messages',{method:'POST',body:{message:'Gere um vídeo demonstrativo desse produto de 5 segundos.',attachmentIds:[attachment.id],idempotencyKey:randomUUID()}});
  assert.equal(res.status,202);const q=await res.json();assert.equal(q.payment.kind,'video');assert.match(q.payment.summary,/usando a imagem anexada/);assert.equal(f.calls.length,0);
  await f.finish(q);const r=f.chat.request('user:1',q.requestId);assert.equal(r.status,'completed');assert.equal(r.artifacts.length,1);
  const post=f.calls.find(c=>c.method==='POST');assert.ok(post.url.endsWith('/image-to-video/kling-3.0'));
  assert.equal(post.body.contents.find(c=>c.type==='first_frame').url,f.image.toString('base64'));assert.equal(post.body.settings.aspect_ratio,undefined);
  assert.equal(post.body.contents.find(c=>c.type==='prompt').text,'Gere um vídeo demonstrativo desse produto de 5 segundos.');
  assert.equal(post.body.settings.audio,'off');assert.equal(r.payment.chargedMicro,2100000);
  await f.finish(q);assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
  const url='/artifacts/'+r.artifacts[0].id+'/content';assert.equal((await f.http(url)).status,200);assert.equal((await f.http(url,{user:'2'})).status,404);
 }finally{await f.close();}
});
test('anime essa imagem is video, with the original image attached',async()=>{const f=await fixture();try{const a=f.upload();const q=f.submit('Anime essa imagem',[a.id]);assert.equal(q.payment.kind,'video');await f.finish(q);assert.equal(f.chat.request('user:1',q.requestId).status,'completed');assert.ok(f.calls[0].url.endsWith('/image-to-video/kling-3.0'));}finally{await f.close();}});
test('image reference to new image preserves original uploaded bytes',async()=>{const f=await fixture();try{const a=f.upload(),q=f.submit('Crie uma image de anúncio desse produto',[a.id]);assert.equal(q.payment.kind,'image');await f.finish(q);const r=f.chat.request('user:1',q.requestId);assert.equal(r.status,'completed');assert.equal(f.calls[0].body.image,f.image.toString('base64'));assert.equal(r.payment.chargedMicro,140000);}finally{await f.close();}});
test('explicit previous product reference survives intervening messages and remains attached to the new request',async()=>{const f=await fixture();try{
 const a=f.upload(),first=f.submit('Descreva essa imagem',[a.id]);assert.equal(first.status,'unavailable');
 f.submit('Obrigado',[],first.conversationId);
 const q=f.submit('Gere um vídeo deste produto',[],first.conversationId);assert.equal(q.payment.kind,'video');
 const linked=f.db.prepare('SELECT attachment_id FROM neural_chat_message_attachments WHERE message_id=?').all(q.messageId);assert.deepEqual(linked.map(x=>x.attachment_id),[a.id]);
 await f.finish(q);assert.equal(f.calls[0].body.contents[1].url,f.image.toString('base64'));
}finally{await f.close();}});
test('missing reference and unrelated conversations cannot silently become text-to-video',async()=>{const f=await fixture();try{const a=f.upload();f.submit('Descreva esse produto',[a.id]);const q=f.submit('Gere um vídeo desse produto');assert.equal(q.status,'unavailable');assert.equal(q.payment,undefined);assert.equal(f.calls.length,0);assert.equal(f.coins.status(1).reservedAtoms,'0');}finally{await f.close();}});
test('no implicit use of prior picture for unrelated landscape generation',async()=>{const f=await fixture();try{const a=f.upload(),first=f.submit('Descreva esse produto',[a.id]);const q=f.submit('Gere um vídeo de uma montanha',[],first.conversationId);await f.finish(q);assert.ok(f.calls[0].url.endsWith('/text-to-video/kling-3.0'));}finally{await f.close();}});
test('another user attachment and multiple reference images are rejected before quoting',async()=>{const f=await fixture();try{const other=f.upload('user:2');assert.throws(()=>f.submit('Gere um vídeo desse produto',[other.id]));const a=f.upload(),b=f.upload();assert.throws(()=>f.submit('Gere um vídeo desse produto',[a.id,b.id]));assert.equal(f.calls.length,0);assert.equal(f.coins.status(1).reservedAtoms,'0');}finally{await f.close();}});
test('analysis and scripts with an image never silently generate paid media',async()=>{const f=await fixture();try{const a=f.upload();for(const message of ['Descreva essa imagem','Escreva uma legenda para esse vídeo','Escreva um prompt para animar essa foto']){const q=f.submit(message,[a.id]);assert.equal(q.status,'unavailable');assert.equal(q.payment,undefined);}assert.equal(f.calls.length,0);}finally{await f.close();}});
test('explicit refusal to use attached image blocks conflicting generation',async()=>{const f=await fixture();try{const a=f.upload(),q=f.submit('Gere um vídeo mas não use essa imagem',[a.id]);assert.equal(q.status,'unavailable');assert.equal(q.payment,undefined);assert.equal(f.calls.length,0);}finally{await f.close();}});
test('generation with dimensions is not misrouted to FFmpeg; resizing remains operational',async()=>{const f=await fixture();try{
 for(const [instruction,supported] of [['Gere um vídeo desse produto em 500x500',false],['Crie uma imagem desse produto em 500x500',false],['Redimensione a imagem para 500x500',true]]){
  const r=await f.http('/operations/quote',{method:'POST',body:{instruction,mimeType:'image/png'}});assert.equal(r.status,200);assert.equal((await r.json()).item.supported,supported);
 }assert.equal(f.calls.length,0);
}finally{await f.close();}});
test('authentication and origin protections remain enforced',async()=>{const f=await fixture();try{const body={message:'Anime esse produto',idempotencyKey:randomUUID()};assert.equal((await f.http('/messages',{method:'POST',body,user:''})).status,401);assert.equal((await f.http('/messages',{method:'POST',body,origin:'https://evil.test'})).status,403);assert.equal(f.calls.length,0);}finally{await f.close();}});
test('lost image-to-video response is held without another paid POST',async()=>{const f=await fixture({lost:true});try{const a=f.upload(),q=f.submit('Anime esse produto',[a.id]);await f.finish(q);await f.chat.wait(q.requestId);assert.equal(f.calls.filter(c=>c.method==='POST').length,1);assert.notEqual(f.coins.status(1).reservedAtoms,'0');}finally{await f.close();}});
test('native audio reference video works only when the separate audio implementation is installed',async()=>{const f=await fixture();try{const a=f.upload();if(!AUDIO){assert.throws(()=>f.submit('Gere um vídeo desse produto com áudio nativo',[a.id]));assert.equal(f.calls.length,0);}else{const q=f.submit('Gere um vídeo desse produto com áudio nativo',[a.id]);assert.equal(q.payment.amountMicro,3150000);await f.finish(q);assert.equal(f.chat.request('user:1',q.requestId).status,'completed');assert.equal(f.calls[0].body.settings.audio,'native');assert.equal(f.calls[0].body.contents[1].url,f.image.toString('base64'));}}finally{await f.close();}});
