import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import express from 'express';
import {referenceMediaKind,requestsImageReference,routeReferenceMedia,referenceMediaDecision} from '../public/neural-reference-media.js';
import {createNeuralChatEngine,routeChatIntent} from '../vitriny-neural/chat-engine.js';
import {createPaidChatRuntime} from '../vitriny-neural/paid-chat-runtime.js';
import {createChatArtifacts} from '../vitriny-neural/chat-artifacts.js';
import {mountNeuralChatApi} from '../vitriny-neural/chat-api.js';
import {setupLiaChatOperations} from '../vitriny-neural/lia-chat-operations.js';
import {createCoinWallet} from '../vitrine-coins-wallet.js';
import {createCoinAiWalletAdapter} from '../vitriny-neural/coin-wallet-adapter.js';
import {VITRINE_COINS_POLICY} from '../public/vitrine-coins-contract.js';


const cases=[
  [
    "vc pode usar essa foto de imagem de referencia e crair outra imagem com esse produto com flores e orquideas bem floridas no seu lado bem relista",
    "image"
  ],
  [
    "voce pode usar a foto e criar outra imagem",
    "image"
  ],
  [
    "faz uma arte desse produto",
    "image"
  ],
  [
    "cria um banner com essa embalagem",
    "image"
  ],
  [
    "pode montar uma capa para mim usando essa foto",
    "image"
  ],
  [
    "vc pode crair outra imagm usando esta foto",
    "image"
  ],
  [
    "gere uma imagme com flores",
    "image"
  ],
  [
    "criar outra imagem com esse produto",
    "image"
  ],
  [
    "crie para mim uma linda imagem realista",
    "image"
  ],
  [
    "faz um videozinho desse produto",
    "video"
  ],
  [
    "vc pode gerar um vidio com essa foto",
    "video"
  ],
  [
    "gere um viedo do produto",
    "video"
  ],
  [
    "cria um clipe dessa embalagem",
    "video"
  ],
  [
    "monte um reels usando essa foto",
    "video"
  ],
  [
    "pode animar esse produto",
    "video"
  ],
  [
    "anima essa imagem",
    "video"
  ],
  [
    "transforme esse print em um vídeo",
    "video"
  ],
  [
    "converta esta foto em video",
    "video"
  ],
  [
    "dê vida a essa foto",
    "video"
  ],
  [
    "coloque movimento nessa imagem",
    "video"
  ],
  [
    "use essa imagem e crie um video anuncio",
    "video"
  ],
  [
    "gere a partir dessa foto um video",
    "video"
  ],
  [
    "gere usando a foto um video",
    "video"
  ],
  [
    "quero um vídeo com essa embalagem",
    "video"
  ],
  [
    "quero uma imagem de um produto",
    "image"
  ],
  [
    "Gere um vídeo sem áudio",
    "video"
  ],
  [
    "Sem áudio, gere um vídeo",
    "video"
  ],
  [
    "Gere um vídeo; não adicione textos",
    "video"
  ],
  [
    "Gere uma imagem com legenda",
    "image"
  ],
  [
    "Gere uma imagem com texto no rótulo",
    "image"
  ],
  [
    "Crie uma narração para esse vídeo",
    "audio"
  ],
  [
    "Faça uma música para esse vídeo",
    "audio"
  ],
  [
    "escreva um roteiro para gerar um vídeo",
    "text"
  ],
  [
    "faça um prompt para crair uma imagm",
    "text"
  ],
  [
    "gere uma legenda para animar essa imagem",
    "text"
  ],
  [
    "crie um texto para anúncio desse vídeo",
    "text"
  ],
  [
    "vc pode explicar como gerar uma imagem",
    "text"
  ],
  [
    "descreve essa foto",
    "text"
  ],
  [
    "analise esse produto",
    "text"
  ],
  [
    "como criar um vídeo com esta foto?",
    "text"
  ],
  [
    "o que está escrito nesse rótulo?",
    "text"
  ],
  [
    "qual o peso do saco?",
    "text"
  ],
  [
    "quero ideias de vídeo para usar com essa foto",
    "text"
  ],
  [
    "publique uma imagem desse produto",
    "action"
  ],
  [
    "vc pode enviar esse vídeo",
    "action"
  ],
  [
    "pesquise esse produto",
    "research"
  ],
  [
    "faça uma propaganda desse produto",
    "reference_clarify"
  ],
  [
    "crie um anuncio com essa foto",
    "reference_clarify"
  ],
  [
    "gere um comercial",
    "reference_clarify"
  ],
  [
    "crie uma imagem ou vídeo",
    "reference_clarify"
  ],
  [
    "crie uma imagem e um vídeo",
    "reference_clarify"
  ],
  [
    "gere um vídeo e crie uma foto",
    "reference_clarify"
  ],
  [
    "crie algo usando essa imagem",
    "reference_clarify"
  ],
  [
    "não gere vídeo",
    "reference_cancelled"
  ],
  [
    "não crie imagem",
    "reference_cancelled"
  ],
  [
    "nunca gere uma imagem",
    "reference_cancelled"
  ],
  [
    "não quero que vc gere um vídeo",
    "reference_cancelled"
  ],
  [
    "sem criar vídeo",
    "reference_cancelled"
  ],
  [
    "nao quero video",
    "reference_cancelled"
  ],
  [
    "não crair uma imagm",
    "reference_cancelled"
  ],
  [
    "não gere vídeo, crie uma imagem",
    "reference_cancelled"
  ],
  [
    "qual meu saldo",
    "text"
  ],
  [
    "quero ler esse texto",
    "text"
  ],
  [
    "me diga o valor desse produto",
    "text"
  ],
  [
    "o artista está em viagem",
    "text"
  ],
  [
    "fazer orçamento para comprar uma passagem",
    "text"
  ],
  [
    "armazene o arquivo para revisão",
    "text"
  ]
];
for(const [message,expected] of cases)test('flex route: '+message,()=>{
 const base=routeChatIntent(message),result=routeReferenceMedia(message,base);
 assert.equal(result.referenceHold||result.kind,expected);
});
test('bounded inputs and exact short words',()=>{
 for(const value of [null,undefined,{},'x'.repeat(6001)])assert.equal(referenceMediaDecision(value).kind,null);
 for(const value of ['ler','ver','saldo','lote','artefato','videochamada','revisao'])assert.equal(referenceMediaKind(value),null);
});
test('original message and base intent are immutable',()=>{
 const message='Vc pode CRAIR outra IMAGM com esse produto?';const base=Object.freeze({kind:'text',capability:'support.draft-reply'});
 assert.equal(routeReferenceMedia(message,base).kind,'image');assert.equal(message,'Vc pode CRAIR outra IMAGM com esse produto?');
});
test('reference reuse still requires explicit scoped reference',()=>{
 for(const s of ['essa foto','desse produto','a imagem anexada','essa imagm'])assert.equal(requestsImageReference(s),true);
 for(const s of ['foto de um produto','um video qualquer','não use essa imagem','sem usar a foto'])assert.equal(requestsImageReference(s),false);
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


test('original screenshot request reaches image quote and private reference unchanged',async()=>{
 const f=await fixture();try{
  const message=cases[0][0],attachment=f.upload();const q=f.submit(message,[attachment.id]);
  assert.equal(q.status,'awaiting_confirmation');assert.equal(q.payment.kind,'image');assert.match(q.payment.summary,/imagem anexada/);
  assert.equal(f.calls.length,0);
  const original=f.db.prepare("SELECT text FROM neural_chat_messages WHERE request_id=? AND role='user'").get(q.requestId);assert.equal(original.text,message);
  await f.finish(q);assert.equal(f.chat.request('user:1',q.requestId).status,'completed');assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
 }finally{await f.close();}
});
test('video typo with audio preserves reference, quote, explicit confirmation and audio mode',async()=>{
 const f=await fixture();try{
  const attachment=f.upload(),q=f.submit('vc pode gerar um vidio de 5 segundos com essa foto'+(AUDIO?' com áudio nativo':''),[attachment.id]);
  assert.equal(q.status,'awaiting_confirmation');assert.equal(q.payment.kind,'video');assert.equal(f.calls.length,0);
  await f.finish(q);assert.equal(f.chat.request('user:1',q.requestId).status,'completed');
  const post=f.calls.find(c=>c.method==='POST');assert.equal(post.body.contents.find(c=>c.type==='first_frame').url,f.image.toString('base64'));
  assert.equal(post.body.settings.audio,AUDIO?'native':'off');
 }finally{await f.close();}
});
test('ambiguous and negative requests never prepare charges or dispatch calls',async()=>{
 const f=await fixture();try{
  const image=f.upload();
  for(const msg of ['faça uma propaganda desse produto','crie uma imagem ou vídeo','não quero que vc gere vídeo','não crair uma imagm']) {
   const q=f.submit(msg,[image.id]);assert.equal(q.status,'unavailable');assert.ok(!q.payment);
   const text=f.db.prepare("SELECT text FROM neural_chat_messages WHERE request_id=? AND role='assistant'").get(q.requestId).text;
   assert.match(text,/único formato|não gerar mídia/);
  }
  assert.equal(f.calls.length,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM neural_paid_chat_requests').get().n,0);
 }finally{await f.close();}
});
test('ambiguity without attachments also cannot become a paid text request',async()=>{
 const f=await fixture();try{const q=f.submit('faça uma propaganda');assert.equal(q.status,'unavailable');assert.ok(!q.payment);assert.equal(f.calls.length,0);}finally{await f.close();}
});
