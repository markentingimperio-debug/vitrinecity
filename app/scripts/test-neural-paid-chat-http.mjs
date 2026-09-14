import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import Database from 'better-sqlite3';
import {createNeuralChatEngine} from '../vitriny-neural/chat-engine.js';
import {createPaidChatRuntime} from '../vitriny-neural/paid-chat-runtime.js';
import {createAiCreditWallet} from '../vitriny-neural/ai-credit-wallet.js';
import {createCoinWallet} from '../vitrine-coins-wallet.js';
import {createCoinAiWalletAdapter} from '../vitriny-neural/coin-wallet-adapter.js';
import {VITRINE_COINS_POLICY} from '../public/vitrine-coins-contract.js';
import {createChatArtifacts} from '../vitriny-neural/chat-artifacts.js';
import {mountNeuralChatApi} from '../vitriny-neural/chat-api.js';
import {createAiCreditPurchases,mountAiCreditPurchases,AI_PURCHASE_TERMS} from '../vitriny-neural/ai-credit-purchases.js';
import {assertChatReceipt,assertAiPurchaseStatus} from '../public/neural-chat-contract.js';

// Real composition with private SQLite/files/HTTP routes. Only external provider
// transport and CDN bytes are synthetic: no secret, real checkout or paid call.
const START=Date.parse('2026-09-14T17:00:00.000Z'),ACCOUNT='123456789';
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/T8AAAAASUVORK5CYII=','base64');
const DATE=new Date(START).toISOString();
const CONFIG={enabled:true,fx:{version:'http-fixture-fx',observedAt:DATE,usdToBrl:'5'},
  chat:{model:'gpt-4o-mini',acceptedResponseModels:['gpt-4o-mini'],tariffVersion:'http-fixture-chat',effectiveAt:DATE,inputUsdPerMillion:'0.15',cachedInputUsdPerMillion:'0.075',outputUsdPerMillion:'0.60',maxOutputTokens:128},
  kling:{accountBinding:'fixture-account',policyRevision:'fixture-policy',tariffVersion:'http-fixture-kling',effectiveAt:DATE,videoUsdPerSecond:'0.084',imageUsdEach:'0.028',unitUsd:{video:'0.14',image:'0.0035'}}};
const response=data=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
const owns=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
const canVideo=['ffmpeg','ffprobe'].every(binary=>spawnSync(binary,['-version'],{windowsHide:true,stdio:'ignore'}).status===0);

async function fixture({video=false,unified=false}={}){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'neural-paid-http-'));
  const db=new Database(path.join(directory,'state.db'));let now=START,chat,runtime,transportBehavior='normal',beforeConfirm;
  const paidCalls=[],cdnCalls=[],checkoutCalls=[],tasks=new Map();let mpId=10000,videoBytes;
  if(video){
    const filename=path.join(directory,'fixture-video.mp4');
    const generated=spawnSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=black:s=320x320:r=1','-t','5','-an','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart','-y',filename],{timeout:15000,windowsHide:true});
    assert.equal(generated.status,0,'synthetic MP4 fixture should encode');videoBytes=fs.readFileSync(filename);
  }
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,is_admin INTEGER,email TEXT,account_status TEXT);INSERT INTO users VALUES(1,1,'admin@example.test','active'),(2,1,'admin2@example.test','active');`);
  const coins=unified?createCoinWallet({db,enabled:true,now:()=>now}):null;
  const wallet=unified?createCoinAiWalletAdapter({db,coinWallet:coins,now:()=>now}):createAiCreditWallet({db,enabled:true,now:()=>now});
  const artifacts=createChatArtifacts({db,directory:path.join(directory,'private'),now:()=>now,download:async url=>{
    cdnCalls.push(url);const parsed=new URL(url);assert.equal(parsed.hostname,'fixture.klingai.com');
    return parsed.pathname.endsWith('.mp4')?{data:videoBytes,mimeType:'video/mp4'}:{data:PNG,mimeType:'image/png'};
  }});
  const fetchImpl=async(url,init)=>{
    const parsed=new URL(url),method=init.method||'GET';paidCalls.push({url:String(url),method});
    if(method==='POST'&&transportBehavior==='unknown')throw Error('synthetic post response lost');
    if(parsed.hostname==='api.openai.com'){
      assert.equal(method,'POST');const body=JSON.parse(init.body);assert.equal(body.model,'gpt-4o-mini');
      return response({id:'chatcmpl-fixture-'+paidCalls.length,object:'chat.completion',model:'gpt-4o-mini',choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:'Resposta simulada com contexto privado.'}}],
        usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120,prompt_tokens_details:{cached_tokens:40}}});
    }
    assert.equal(parsed.hostname,'api-singapore.klingai.com');
    if(method==='POST'){
      const body=JSON.parse(init.body),kind=parsed.pathname.includes('/images/')?'image':'video',externalId=kind==='image'?body.external_task_id:body.options.external_task_id,id=`fixture-${kind}-${externalId}`;
      tasks.set(id,{id,kind,externalId,duration:body.settings?.duration||5});
      return kind==='image'?response({code:0,data:{task_id:id,task_status:'submitted',task_info:{external_task_id:externalId}}}):response({code:0,data:{id,external_id:externalId,status:'submitted',create_time:now,update_time:now}});
    }
    const id=parsed.pathname.includes('/images/')?decodeURIComponent(parsed.pathname.split('/').pop()):parsed.searchParams.get('task_ids');
    const task=tasks.get(id);assert.ok(task,'free polling must target the persisted provider receipt');
    if(task.kind==='image')return response({code:0,data:{task_id:id,task_status:'succeed',task_info:{external_task_id:task.externalId},final_unit_deduction:'8',final_balance_deduction:{quota:'0'},task_result:{images:[{url:`https://fixture.klingai.com/${id}.png`}]}}});
    return response({code:0,data:[{id,external_id:task.externalId,status:'succeeded',create_time:START,update_time:now,billing:[{charge_type:'cash',cash_type:'balance',amount:'0.4200',currency:'USD'}],outputs:[{type:'video',id:'fixture-output',duration:String(task.duration),url:`https://fixture.klingai.com/${id}.mp4`}]}]});
  };
  function rebuild(){
    runtime=createPaidChatRuntime({db,wallet,artifacts,config:{...CONFIG,...(unified?{billingPolicyVersion:VITRINE_COINS_POLICY.version}:{})},env:{OPENAI_API_KEY:'fixture-not-real',KLING_API_KEY:'fixture-not-real'},fetchImpl,now:()=>now,pollIntervalMs:30000,authorizeScope:scope=>!unified||wallet.allowsScope(scope)});
    chat=createNeuralChatEngine({db,paidRuntime:runtime,config:{enabled:true,mode:'advisory'},qualifications:{latest:()=>null},skills:{status:()=>({providers:[]}),invoke:()=>{throw Error('local model not expected');}},
      env:{VITRINY_NEURAL_CHAT_STORES:'shop-a,shop-b',VITRINE_COINS_ENABLED:unified?'true':'false'},now:()=>now,queueOptions:{pollIntervalMs:30000}});
  }
  rebuild();
  const purchases=createAiCreditPurchases({db,wallet,enabled:true,expectedCollectorId:ACCOUNT,paymentReady:()=>true,now:()=>now,
    createPreference:async order=>{checkoutCalls.push(order);return {id:'fixture-preference-'+order.reference,init_point:'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=fixture',collector_id:ACCOUNT};},
    fetchPayment:async()=>{throw Error('not needed');},searchPayments:async()=>({results:[]})});
  const proxy=new Proxy({},{get:(_target,property)=>typeof chat[property]==='function'?(...args)=>{
    const result=chat[property](...args);if(property==='confirm')beforeConfirm?.(...args);return result;
  }:chat[property]});
  const app=express();app.use(express.json());
  const auth={requireAdmin:(req,res,next)=>{if(!req.get('x-fixture-admin'))return res.sendStatus(401);req.user={id:req.get('x-fixture-admin')};next();},
    requireUser:(req,res,next)=>{if(!req.get('x-fixture-admin'))return res.sendStatus(401);req.user={id:req.get('x-fixture-admin')};next();},
    sameOriginOnly:(req,res,next)=>req.get('origin')==='https://vitrinecity.test'?next():res.sendStatus(403),
    getAuthorizedStore:(req,res)=>{if(req.get('x-store-token')!=='token-'+req.params.reference){res.sendStatus(403);return null;}return {storeReference:req.params.reference};}};
  mountNeuralChatApi({app,chat:proxy,artifacts,...auth});mountAiCreditPurchases({app,purchases,...auth});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const host=`http://127.0.0.1:${server.address().port}`;
  const endpoint=unified?'/api/neural/chat':'/api/admin/vitriny-neural/chat';
  async function http(suffix,{method='GET',body,admin='1',headers={}}={}){
    return fetch(host+endpoint+suffix,{method,headers:{...(admin?{'x-fixture-admin':admin}:{}),...(method==='GET'?{}:{'x-neural-request':'1','content-type':'application/json',origin:'https://vitrinecity.test'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  }
  async function submit(message,key=randomUUID()){
    const result=await http('/messages',{method:'POST',body:{message,idempotencyKey:key}});assert.equal(result.status,202);const data=await result.json();assertChatReceipt(data);return data;
  }
  async function confirm(request,key=randomUUID()){
    return http('/requests/'+request.requestId+'/confirm',{method:'POST',body:{quoteId:request.payment.quoteId,idempotencyKey:key}});
  }
  async function fund(admin='1'){
    const result=await http('/credits/checkout',{method:'POST',admin,body:{amountCents:1000,key:randomUUID(),termsAccepted:true,termsVersion:unified?VITRINE_COINS_POLICY.version:AI_PURCHASE_TERMS.version}});
    assert.equal(result.status,200);const {order}=await result.json();assert.equal(order.status,'pending');
    // This fixture is the full trusted GET receipt that the production signed
    // webhook transport passes to reconciliation. Browser status is not trusted.
    purchases.reconcileVerifiedPayment({id:String(mpId++),collector_id:ACCOUNT,external_reference:order.reference,transaction_amount:10,transaction_amount_refunded:0,currency_id:'BRL',live_mode:true,status:'approved',date_last_updated:new Date(now).toISOString()});
    return order;
  }
  async function finish(id,{poll=false}={}){await chat.wait(id);if(poll){now+=6000;runtime.kick();await runtime.wait(id);}await new Promise(resolve=>setImmediate(resolve));}
  async function read(id){const r=await http('/requests/'+id);assert.equal(r.status,200);return (await r.json()).request;}
  return {db,wallet,coins,artifacts,purchases,paidCalls,cdnCalls,checkoutCalls,host,http,submit,confirm,fund,finish,read,
    get chat(){return chat;},get runtime(){return runtime;},setBeforeConfirm:fn=>{beforeConfirm=fn;},setTransport:value=>{transportBehavior=value;},advance:ms=>{now+=ms;},
    restart(){chat.close();rebuild();},async close(){chat.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();fs.rmSync(directory,{recursive:true,force:true});}};
}

for(const kind of ['chat','image','video'])test(`HTTP unified personal Coins: ${kind} net recharge, one settlement, private owner`,{skip:kind==='video'&&!canVideo&&'ffmpeg/ffprobe unavailable; must execute in Docker'},async()=>{
  const f=await fixture({unified:true,video:kind==='video'});try{
    assert.equal((await f.http('/status',{admin:null})).status,401);
    await f.fund();assert.equal(f.coins.status(1).availableCoins,'81.6');assert.equal(f.wallet.status('admin:1').availableMicroBrl,8500000);
    const q=await f.submit(kind==='chat'?'Escreva um texto sobre plantas.':kind==='image'?'Gere uma imagem de plantas.':'Gere um vídeo de 5 segundos de plantas.');
    assert.equal(q.payment.kind,kind);assert.doesNotMatch(q.payment.summary,/\+ 15%/);
    const key=randomUUID();assert.equal((await f.confirm(q,key)).status,202);await f.finish(q.requestId,{poll:kind!=='chat'});
    const r=await f.read(q.requestId);assert.equal(r.status,'completed');assert.equal(r.payment.chargedMicro,{chat:120,image:140000,video:2100000}[kind]);
    assert.equal(f.coins.status(1).reservedAtoms,'0');assert.equal(f.coins.status(1).chargedAtoms,String(r.payment.chargedMicro*96));
    assert.equal((await f.confirm(q,key)).status,202);await f.finish(q.requestId);assert.equal(f.paidCalls.filter(c=>c.method==='POST').length,1);
    assert.equal((await f.http('/requests/'+q.requestId,{admin:'2'})).status,404);
    if(kind!=='chat'){const file=r.artifacts[0];assert.equal((await f.http('/artifacts/'+file.id+'/download')).status,200);assert.equal((await f.http('/artifacts/'+file.id+'/download',{admin:'2'})).status,404);}
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='neural_ai_credit_lots'").get().n,0);
  }finally{await f.close();}
});

test('HTTP real composition: quote/insufficient spend nothing, verified purchase enables exactly one text dispatch/debit',async()=>{
  const f=await fixture();try{
    assert.equal((await f.http('/status',{admin:null})).status,401);
    const submitted=await f.submit('Escreva um texto curto para uma loja de plantas.');
    assert.equal(submitted.status,'awaiting_confirmation');assert.equal(submitted.payment.state,'quoted');assert.equal(f.paidCalls.length,0);
    assert.equal((await f.confirm(submitted)).status,402);assert.equal(f.paidCalls.length,0);
    await f.fund();assert.equal(f.checkoutCalls.length,1);assert.equal(f.paidCalls.length,0);
    const balance=await (await f.http('/credits/status')).json();assertAiPurchaseStatus(balance);assert.equal(balance.availableMicro,10_000_000);
    const key=randomUUID();assert.equal((await f.confirm(submitted,key)).status,202);await f.finish(submitted.requestId);
    assert.equal((await f.confirm(submitted,key)).status,202);await f.finish(submitted.requestId);
    const delivered=await f.read(submitted.requestId);assertChatReceipt(delivered);assert.equal(delivered.status,'completed');assert.equal(delivered.payment.state,'settled');
    assert.equal(f.paidCalls.filter(c=>c.method==='POST').length,1);assert.equal(f.wallet.status('admin:1').chargedMicroBrl,138);
    assert.equal(f.wallet.status('admin:1').availableMicroBrl,9_999_862);assert.equal(f.wallet.status('admin:1').reservedMicroBrl,0);
    const conversation=await (await f.http('/conversations/'+submitted.conversationId)).json();assert.match(conversation.messages[1].text,/Resposta simulada/);
    assert.equal((await f.http('/requests/'+submitted.requestId,{admin:'2'})).status,404);
    assert.equal((await f.http('/conversations/'+submitted.conversationId,{admin:'2'})).status,404);
  }finally{await f.close();}
});

test('HTTP image completion uses real private artifact storage and authenticated download, once-only confirmed cost',async()=>{
  const f=await fixture();try{
    await f.fund();const q=await f.submit('Gere uma imagem de um vaso com uma planta.');assert.equal(q.payment.kind,'image');assert.equal(f.paidCalls.length,0);
    const key=randomUUID();assert.equal((await f.confirm(q,key)).status,202);await f.finish(q.requestId,{poll:true});
    let r=await f.read(q.requestId);assert.equal(r.status,'completed');assert.equal(r.payment.chargedMicro,161000);assert.equal(r.artifacts.length,1);
    assert.equal(f.wallet.status('admin:1').chargedMicroBrl,161000);assert.equal(f.paidCalls.filter(c=>c.method==='POST').length,1);assert.equal(f.cdnCalls.length,1);
    const file=r.artifacts[0];assert.equal(owns(file,'url'),false);assert.equal(owns(file,'path'),false);
    const download=await f.http('/artifacts/'+file.id+'/download');assert.equal(download.status,200);assert.equal(download.headers.get('cache-control'),'no-store');assert.ok(Buffer.from(await download.arrayBuffer()).equals(PNG));
    assert.equal((await f.http('/artifacts/'+file.id+'/download',{admin:'2'})).status,404);
    assert.equal((await f.confirm(q,key)).status,202);await f.finish(q.requestId,{poll:true});r=await f.read(q.requestId);
    assert.equal(r.payment.chargedMicro,161000);assert.equal(f.cdnCalls.length,1);assert.equal(f.paidCalls.filter(c=>c.method==='POST').length,1);
  }finally{await f.close();}
});

test('HTTP video completion verifies a real MP4, retains private bytes and streams authenticated ranges', {skip:!canVideo&&'ffmpeg/ffprobe unavailable; execute this case in the production-compatible Docker image'},async()=>{
  const f=await fixture({video:true});try{
    await f.fund();const q=await f.submit('Gere um vídeo de 5 segundos de um vaso azul.');assert.equal(q.payment.kind,'video');assert.equal(f.paidCalls.length,0);
    const key=randomUUID();assert.equal((await f.confirm(q,key)).status,202);await f.finish(q.requestId,{poll:true});
    const r=await f.read(q.requestId);assert.equal(r.status,'completed');assert.equal(r.payment.chargedMicro,2415000);assert.equal(r.artifacts.length,1);
    const file=r.artifacts[0];assert.equal(file.mimeType,'video/mp4');assert.equal(file.durationSeconds,5);assert.equal(f.wallet.status('admin:1').chargedMicroBrl,2415000);
    const chunk=await f.http('/artifacts/'+file.id+'/content',{headers:{range:'bytes=0-15'}});assert.equal(chunk.status,206);assert.equal(chunk.headers.get('content-length'),'16');assert.equal((await chunk.arrayBuffer()).byteLength,16);
    assert.equal((await f.http('/artifacts/'+file.id+'/content',{admin:'2',headers:{range:'bytes=0-15'}})).status,404);
    assert.equal((await f.confirm(q,key)).status,202);await f.finish(q.requestId,{poll:true});assert.equal(f.paidCalls.filter(c=>c.method==='POST').length,1);
  }finally{await f.close();}
});

test('HTTP confirmed queued request freezes before worker boundary and never reaches paid transport',async()=>{
  const f=await fixture();try{
    await f.fund();const q=await f.submit('Escreva uma descrição para uma planta.');
    f.setBeforeConfirm(()=>f.wallet.freeze('admin:1',{paymentReference:'mercadopago:fixture-dispute',reason:'in_mediation'}));
    assert.equal((await f.confirm(q)).status,202);await f.finish(q.requestId);
    assert.equal(f.paidCalls.length,0);assert.equal(f.wallet.status('admin:1').frozen,true);assert.equal(f.wallet.status('admin:1').chargedMicroBrl,0);
    const r=await f.read(q.requestId);assert.ok(['failed','cancelled','interrupted'].includes(r.status));assert.equal(r.payment.state,'released');
  }finally{await f.close();}
});

test('HTTP unknown paid POST survives restart with reserved evidence and cannot be posted again',async()=>{
  const f=await fixture();try{
    await f.fund();const q=await f.submit('Escreva um pequeno roteiro para jardinagem.');const key=randomUUID();f.setTransport('unknown');
    assert.equal((await f.confirm(q,key)).status,202);await f.finish(q.requestId);assert.equal(f.paidCalls.filter(c=>c.method==='POST').length,1);
    const held=f.wallet.status('admin:1').reservedMicroBrl;assert.ok(held>0);assert.equal(f.wallet.status('admin:1').chargedMicroBrl,0);
    f.advance(130000);f.restart();f.setTransport('normal');assert.equal((await f.confirm(q,key)).status,202);await f.finish(q.requestId);
    const r=await f.read(q.requestId);assert.equal(r.payment.state,'held');assert.equal(f.wallet.status('admin:1').reservedMicroBrl,held);assert.equal(f.paidCalls.filter(c=>c.method==='POST').length,1);
  }finally{await f.close();}
});

test('HTTP exact paid result resumes finalization after storage interruption without repeat POST/debit',async()=>{
  const f=await fixture();try{
    await f.fund();const q=await f.submit('Escreva uma mensagem de boas-vindas para a loja.');
    // Simulate the crash boundary after receipt/cost writes but before UI result.
    f.db.exec("CREATE TRIGGER fixture_fail_ui BEFORE UPDATE OF text ON neural_chat_messages WHEN NEW.text LIKE 'Resposta simulada%' BEGIN SELECT RAISE(ABORT,'fixture-ui-interruption'); END");
    const key=randomUUID();assert.equal((await f.confirm(q,key)).status,202);await f.finish(q.requestId);
    assert.equal(f.paidCalls.filter(c=>c.method==='POST').length,1);
    f.db.exec('DROP TRIGGER fixture_fail_ui');f.advance(130000);f.restart();await f.finish(q.requestId);
    const recovered=await f.read(q.requestId);assert.equal(recovered.status,'completed');assert.equal(recovered.payment.state,'settled');
    assert.equal(f.wallet.status('admin:1').chargedMicroBrl,138);assert.equal(f.wallet.status('admin:1').reservedMicroBrl,0);
    assert.equal(f.paidCalls.filter(c=>c.method==='POST').length,1);
    assert.equal((await f.confirm(q,key)).status,202);await f.finish(q.requestId);assert.equal(f.wallet.status('admin:1').chargedMicroBrl,138);
  }finally{await f.close();}
});
