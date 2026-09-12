import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {createFacebookMessenger,normalizeFacebookMessages} from '../facebook-messenger.js';

const instant=Date.parse('2026-09-12T15:00:00Z'),DAY=86400000;
const event=(patch={})=>({sender:{id:'200'},recipient:{id:'100'},timestamp:instant,message:{mid:'mid-1',text:'Onde está a receita do bolo?'},...patch});
const body=(message=event(),page='100')=>({object:'page',entry:[{id:page,messaging:[message]}]});
const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
const source={key:'recipe',title:'Receita do bolo',summary:'Ingredientes e preparo explicados.',body:'Receita de bolo de cenoura.',sourcePath:'/artigo/bolo',commercial:false};
function fixture(t,{enabled=true}={}){
  const db=new Database(':memory:');t.after(()=>db.close());
  db.exec(`CREATE TABLE social_accounts(id INTEGER PRIMARY KEY,page_id TEXT,token_encrypted TEXT,status TEXT);
    INSERT INTO social_accounts VALUES(7,'100','protected-offline-secret','connected'),(5,'300','protected-other-secret','connected');
    CREATE TABLE omnichannel_automation_settings(channel TEXT PRIMARY KEY,enabled INTEGER,instructions TEXT,campaign_mode TEXT,site_url TEXT,whatsapp_group_url TEXT,daily_limit INTEGER,start_hour INTEGER,end_hour INTEGER,approval_required INTEGER);
    INSERT INTO omnichannel_automation_settings VALUES('facebook',1,'','site','https://vitrinecity.com/oracao-do-dia','','30',9,20,1);
    CREATE TABLE omnichannel_automation_jobs(id TEXT PRIMARY KEY,channel TEXT,external_id TEXT UNIQUE,destination TEXT,source_text TEXT,account_id INTEGER,source_kind TEXT DEFAULT '',media_id TEXT DEFAULT '',status TEXT DEFAULT 'pending',reply_text TEXT DEFAULT '',error TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,processed_at TEXT);
    CREATE TABLE social_webhook_events(object_type TEXT,object_id TEXT,field_name TEXT,payload_json TEXT);`);
  const state={now:instant,run:true,textCalls:[],catalogQueries:[],sends:[],sources:new Map([['recipe',source]]),reply:'A receita está aqui:',sourceIndex:1,payload:null,textHook:null,sendHook:null};
  const opts={db,siteUrl:'https://vitrinecity.com',canRun:()=>state.run,now:()=>state.now,
    sourceCatalog:{list:({q,limit})=>{state.catalogQueries.push(q);const normalized=value=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();return [...state.sources.values()].filter(value=>q.split(' ').every(term=>normalized(value.title+' '+value.body).includes(term))).slice(0,limit);},get:key=>state.sources.get(key)},
    decryptToken:token=>token,apiVersion:()=> 'v26.0',
    requestText:async input=>{state.textCalls.push(input);if(state.textHook)await state.textHook(input);return state.payload||{output_text:JSON.stringify({reply:state.reply,sourceIndex:state.sourceIndex})};},
    fetchImpl:async(url,options)=>{state.sends.push({url,options});if(state.sendHook)return state.sendHook(url,options);return response({recipient_id:JSON.parse(options.body).recipient.id,message_id:'sent-'+state.sends.length});}};
  const service=createFacebookMessenger(opts);if(enabled)service.configure({enabled:true,autoReply:true,accountIds:[7,5]});
  const enqueue=(input=body())=>{const ids=service.ingestWebhook(input);return ids.map(id=>db.prepare('SELECT * FROM omnichannel_automation_jobs WHERE id=?').get(id));};
  return {db,state,opts,service,enqueue,row:job=>db.prepare('SELECT * FROM facebook_messenger_messages WHERE job_id=?').get(job.id),async ready(input){const [job]=enqueue(input);job.reply_text=await service.generateReply(job);return job;}};
}

test('normalizes only received Page text with its exact PSID, mid and original 24h timestamp',()=>{
  assert.deepEqual(normalizeFacebookMessages(body(),instant),[{pageId:'100',psid:'200',mid:'mid-1',receivedAt:instant,text:event().message.text}]);
  for(const value of [body(event({message:{mid:'echo',text:'hello',is_echo:true}})),body(event({delivery:{mids:['m']}})),body(event({read:{watermark:instant}})),body(event({postback:{payload:'x'}})),body(event({recipient:{id:'999'}})),body(event({sender:{id:'100'}})),body(event({sender:{id:'comment_100_9'}})),body(event({message:{mid:'attachment',attachments:[{type:'image',payload:{url:'https://invalid.test'}}]}})),body(event({message:{mid:'no-text',text:' '}})),body(event({timestamp:instant-DAY})),body(event({timestamp:instant+60001})),body(event({timestamp:String(instant)})),{...body(),object:'instagram'}])assert.deepEqual(normalizeFacebookMessages(value,instant),[]);
  assert.equal(normalizeFacebookMessages(body(event({timestamp:instant-DAY+1})),instant).length,1);
});

test('Messenger has a separate disabled-by-default policy and only explicitly chosen connected accounts',t=>{
  const f=fixture(t,{enabled:false});assert.deepEqual(f.service.settings(),{enabled:false,autoReply:false,accountIds:[],startHour:0,endHour:24,dailyLimit:30});assert.deepEqual(f.enqueue(),[]);
  for(const accountIds of [[],[999],[7,7],['7']])assert.throws(()=>f.service.configure({enabled:true,autoReply:true,accountIds}));
  f.db.exec("INSERT INTO social_accounts VALUES(4,'100','old-protected-secret','connected')");
  assert.throws(()=>f.service.configure({enabled:true,autoReply:true,accountIds:[7,4]}));
  f.service.configure({enabled:true,autoReply:true,accountIds:[7]});const [job]=f.enqueue();assert.equal(job.account_id,7);
  assert.deepEqual(f.enqueue(body(event({sender:{id:'201'},recipient:{id:'300'}}),'300')),[]);
  assert.equal(f.db.prepare("SELECT approval_required FROM omnichannel_automation_settings WHERE channel='facebook'").get().approval_required,1);
});

test('deduplication is durable per Page+mid and does not confuse another Page with the same mid',t=>{
  const f=fixture(t);assert.equal(f.enqueue().length,1);assert.equal(f.enqueue().length,0);
  const restart=createFacebookMessenger(f.opts);assert.equal(restart.ingestWebhook(body()).length,0);
  assert.equal(f.enqueue(body(event({recipient:{id:'300'}}),'300')).length,1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM omnichannel_automation_jobs').get().n,2);
});

test('Send API uses page/messages + recipient.id + RESPONSE and persists a matching real receipt',async t=>{
  const f=fixture(t),job=await f.ready();const result=await f.service.send(job,job.reply_text,{automatic:true});
  assert.deepEqual(result,{messageId:'sent-1'});assert.equal(f.state.sends.length,1);
  const sent=f.state.sends[0];assert.equal(sent.url,'https://graph.facebook.com/v26.0/100/messages');
  assert.deepEqual(JSON.parse(sent.options.body),{recipient:{id:'200'},messaging_type:'RESPONSE',message:{text:job.reply_text}});
  assert.equal(sent.options.headers.Authorization,'Bearer protected-offline-secret');assert.ok(!sent.url.includes('secret'));
  assert.equal(f.row(job).state,'sent');assert.equal(f.row(job).provider_message_id,'sent-1');
  await assert.rejects(f.service.send(job,job.reply_text),/already_attempted/);assert.equal(f.state.sends.length,1);
});

test('the server appends only the selected catalog URL and gives the model indices without URL bindings',async t=>{
  const f=fixture(t);f.state.sources.set('other',{...source,key:'other',sourcePath:'/artigo/bolo-alternativo'});f.state.sourceIndex=2;
  const job=await f.ready();const input=JSON.parse(f.state.textCalls[0].input);
  assert.deepEqual(input.catalog.map(item=>item.sourceIndex),[1,2]);
  for(const item of input.catalog)for(const property of ['url','key','binding'])assert.equal(Object.hasOwn(item,property),false);
  assert.equal(job.reply_text,'A receita está aqui:\nhttps://vitrinecity.com/artigo/bolo');
  assert.equal((job.reply_text.match(/https:\/\//g)||[]).length,1);
  const bindings=JSON.parse(f.row(job).sources_json);assert.equal(bindings.length,1);assert.equal(bindings[0].key,'recipe');
  await f.service.send(job,job.reply_text);assert.equal(JSON.parse(f.state.sends[0].options.body).message.text,job.reply_text);
});

test('null selection produces no link even when a catalog source is available',async t=>{
  const f=fixture(t);f.state.sourceIndex=null;f.state.reply='Você prefere uma receita doce ou salgada?';const job=await f.ready();
  assert.equal(job.reply_text,f.state.reply);assert.equal(f.row(job).sources_json,'[]');await f.service.send(job,job.reply_text);
  assert.equal(JSON.parse(f.state.sends[0].options.body).message.text,f.state.reply);
});

test('the Messenger contract rejects missing, duplicate, foreign and out-of-range source selections',async t=>{
  for(const raw of ['{"reply":"Olá"}','{"reply":"Olá","sourceIndex":1,"url":"https://evil.test"}','{"reply":"Olá","sourceIndex":1,"sourceIndex":null}','{"reply":"Olá","reply":"Outro","sourceIndex":1}','{"reply":"Olá","sourceIndex":"https://evil.test"}','{"reply":"Olá","sourceIndex":0}','{"reply":"Olá","sourceIndex":1.5}','{"reply":"Olá","sourceIndex":6}']){
    const f=fixture(t);f.state.payload={output_text:raw};const [job]=f.enqueue();await assert.rejects(f.service.generateReply(job),/messenger_invalid/);assert.equal(f.row(job).reply_text,'');assert.equal(f.row(job).claimed_at,null);assert.equal(f.state.sends.length,0);
  }
  const f=fixture(t);f.state.sources.clear();const [job]=f.enqueue();await assert.rejects(f.service.generateReply(job),/invalid_source/);assert.equal(f.row(job).sources_json,'[]');
});

test('even an exact model-written catalog link is rejected and the appended message still obeys the final text limit',async t=>{
  const f=fixture(t);f.state.reply='Veja https://vitrinecity.com/artigo/bolo';const [job]=f.enqueue();await assert.rejects(f.service.generateReply(job),/unverified_link/);assert.equal(f.state.sends.length,0);
  const long=fixture(t);long.state.reply='a'.repeat(590);const [largeJob]=long.enqueue();await assert.rejects(long.service.generateReply(largeJob),/mensagem final válida/);assert.equal(long.row(largeJob).reply_text,'');
});

test('a source changed while generating text is rejected before saving or submitting its URL',async t=>{
  const f=fixture(t);f.state.textHook=()=>f.state.sources.set('recipe',{...source,sourcePath:'/artigo/outro-bolo'});const [job]=f.enqueue();
  await assert.rejects(f.service.generateReply(job),/source_changed/);assert.equal(f.row(job).reply_text,'');assert.equal(f.row(job).sources_json,'[]');assert.equal(f.state.sends.length,0);
});

test('the shared envelope gate still rejects partial, multiple, reasoning-only and tool-call responses',async t=>{
  const raw=JSON.stringify({reply:'A receita está aqui:',sourceIndex:1}),message={type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:raw}]};
  for(const payload of [
    {status:'incomplete',output_text:raw},
    {output:[{...message,status:'in_progress'}]},
    {output:[message,message]},
    {output:[{...message,role:'user'}]},
    {output:[{type:'reasoning',text:raw}],output_text:raw},
    {output:[message,{type:'function_call',name:'send'}]},
    {output:[{...message,content:[{type:'reasoning_text',text:raw}]}]},
    {output:[{...message,content:[{type:'output_text',text:raw},{type:'output_text',text:raw}]}]},
    {choices:[{finish_reason:'length',message:{role:'assistant',content:raw}}]},
    {choices:[{message:{role:'assistant',content:raw,tool_calls:[{id:'tool'}]}}]},
    {choices:[{message:{role:'assistant',content:raw,refusal:'Cannot answer'}}]},
    {choices:[{message:{role:'assistant',content:raw}},{message:{role:'assistant',content:raw}}]},
    {output_text:JSON.stringify({reply:'Análise: preciso responder ao usuário.',sourceIndex:null})}
  ]){
    const f=fixture(t);f.state.payload=payload;const [job]=f.enqueue();await assert.rejects(f.service.generateReply(job));assert.equal(f.row(job).reply_text,'');assert.equal(f.row(job).claimed_at,null);assert.equal(f.state.sends.length,0);
  }
});

test('completed provider envelopes use only final text while reasoning remains excluded',async t=>{
  const raw=JSON.stringify({sourceIndex:1,reply:'A receita está aqui:'});
  for(const payload of [
    {status:'completed',output:[{type:'reasoning',summary:[{text:'PRIVATE_REASONING'}]},{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:raw}]}]},
    {choices:[{finish_reason:'stop',message:{role:'assistant',content:raw,reasoning_content:'PRIVATE_REASONING'}}]},
    {choices:[{finish_reason:'stop',message:{role:'assistant',content:[{type:'text',text:raw}]}}]},
    {output_text:'```json\n'+raw+'\n```'}
  ]){
    const f=fixture(t);f.state.payload=payload;const job=await f.ready();assert.equal(job.reply_text,'A receita está aqui:\nhttps://vitrinecity.com/artigo/bolo');assert.ok(!job.reply_text.includes('PRIVATE_REASONING'));
  }
});

test('a durable claim exists before POST and blocks a race or process restart from resending',async t=>{
  const f=fixture(t),job=await f.ready();let finish;
  f.state.sendHook=()=>{assert.equal(f.row(job).state,'submitting');return new Promise(resolve=>{finish=resolve;});};
  const first=f.service.send(job,job.reply_text);const restart=createFacebookMessenger(f.opts);
  await assert.rejects(restart.send(job,job.reply_text),/already_attempted/);assert.equal(f.state.sends.length,1);
  finish(response({recipient_id:'200',message_id:'late-real-receipt'}));await first;assert.equal(f.row(job).provider_message_id,'late-real-receipt');
});

test('explicit startup recovery releases a pre-send crash but constructing/configuring a second service never steals active work',async t=>{
  const f=fixture(t),job=await f.ready();f.db.prepare("UPDATE omnichannel_automation_jobs SET status='processing' WHERE id=?").run(job.id);
  const ops=createFacebookMessenger(f.opts);ops.configure({enabled:true,autoReply:true,accountIds:[7,5]});
  assert.equal(f.db.prepare('SELECT status FROM omnichannel_automation_jobs WHERE id=?').get(job.id).status,'processing');
  assert.deepEqual(ops.recoverInterrupted(),{pending:1,unknown:0,sent:0,failed:0});assert.equal(f.db.prepare('SELECT status FROM omnichannel_automation_jobs WHERE id=?').get(job.id).status,'pending');assert.equal(f.state.sends.length,0);
});

test('startup recovery holds a crashed POST claim and mirrors only a durably confirmed send without reposting',async t=>{
  const f=fixture(t),unknown=await f.ready();f.db.prepare("UPDATE omnichannel_automation_jobs SET status='processing' WHERE id=?").run(unknown.id);f.db.prepare("UPDATE facebook_messenger_messages SET state='submitting',claimed_at=? WHERE job_id=?").run(instant,unknown.id);
  const confirmed=await f.ready(body(event({message:{mid:'confirmed-2',text:event().message.text}})));await f.service.send(confirmed,confirmed.reply_text);f.db.prepare("UPDATE omnichannel_automation_jobs SET status='processing' WHERE id=?").run(confirmed.id);
  assert.deepEqual(f.service.recoverInterrupted(),{pending:0,unknown:1,sent:1,failed:0});assert.equal(f.row(unknown).state,'held_unknown');assert.equal(f.db.prepare('SELECT status FROM omnichannel_automation_jobs WHERE id=?').get(unknown.id).status,'failed');
  assert.equal(f.db.prepare('SELECT status FROM omnichannel_automation_jobs WHERE id=?').get(confirmed.id).status,'sent');assert.equal(f.row(confirmed).provider_message_id,'sent-1');
  await assert.rejects(f.service.send(unknown,unknown.reply_text),/already_attempted/);assert.equal(f.state.sends.length,1);
});

test('timeouts, 5xx, malformed bodies and mismatched or missing receipts remain unknown without retry',async t=>{
  for(const sendHook of [async()=>{throw Error('protected-offline-secret');},async()=>response({error:{code:1}},503),async()=>({...response(null),json:async()=>{throw Error('invalid-json');}}),async()=>response({}),async()=>response({message_id:'id'}),async()=>response({message_id:'id',recipient_id:'999'}),async()=>response({message_id:4,recipient_id:'200'})]){
    const f=fixture(t),job=await f.ready();f.state.sendHook=sendHook;
    await assert.rejects(f.service.send(job,job.reply_text),error=>/unknown/.test(error.message)&&!error.message.includes('protected'));
    assert.equal(f.row(job).state,'held_unknown');assert.equal(f.row(job).provider_message_id,null);
    await assert.rejects(createFacebookMessenger(f.opts).send(job,job.reply_text),/already_attempted/);assert.equal(f.state.sends.length,1);
  }
});

test('a confirmed permission rejection is terminal, sanitized and never retried automatically',async t=>{
  const f=fixture(t),job=await f.ready();f.state.sendHook=async()=>response({error:{code:200,message:'protected-offline-secret'}},403);
  await assert.rejects(f.service.send(job,job.reply_text),/rejected_check_permissions/);assert.equal(f.row(job).state,'failed');assert.ok(!f.row(job).error.includes('secret'));
  await assert.rejects(f.service.send(job,job.reply_text),/already_attempted/);assert.equal(f.state.sends.length,1);
});

test('send revalidates the original response window, account allowlist, pause and auto-reply approval',async t=>{
  for(const change of [f=>f.state.now+=DAY,f=>f.state.run=false,f=>f.db.prepare("UPDATE social_accounts SET status='disconnected' WHERE id=7").run(),f=>f.service.configure({enabled:true,autoReply:true,accountIds:[5]}),f=>f.service.configure({enabled:false,autoReply:false}),f=>f.service.configure({enabled:true,autoReply:false})]){
    const f=fixture(t),job=await f.ready();change(f);await assert.rejects(f.service.send(job,job.reply_text,{automatic:true}));assert.equal(f.state.sends.length,0);assert.equal(f.row(job).claimed_at,null);
  }
  const manual=fixture(t),job=await manual.ready();manual.service.configure({enabled:true,autoReply:false});await manual.service.send(job,job.reply_text);assert.equal(manual.row(job).state,'sent');
});

test('a pause during text generation stops the outbound reply without a send claim',async t=>{
  const f=fixture(t),[job]=f.enqueue();f.state.textHook=()=>{f.state.run=false;};await assert.rejects(f.service.generateReply(job),/ecosystem_paused/);assert.equal(f.state.sends.length,0);assert.equal(f.row(job).claimed_at,null);
});

test('a newer customer opt-out blocks an older queued answer and receives no automatic promotion',async t=>{
  const f=fixture(t),job=await f.ready();f.state.now++;assert.deepEqual(f.enqueue(body(event({timestamp:f.state.now,message:{mid:'stop-2',text:'Pare de enviar mensagens'}}))),[]);
  await assert.rejects(f.service.send(job,job.reply_text),/customer_declined/);assert.equal(f.state.sends.length,0);
  assert.equal(f.db.prepare("SELECT status FROM omnichannel_automation_jobs WHERE source_text LIKE 'Pare%'").get().status,'cancelled');
});

test('declining one product does not opt out of requested help, and disconnecting never prevents a global Messenger pause',t=>{
  const f=fixture(t);assert.equal(f.enqueue(body(event({message:{mid:'other-recipe',text:'Não quero bolo de cenoura. Tem outra receita?'}}))).length,1);
  f.db.exec("UPDATE social_accounts SET status='disconnected' WHERE id=7");f.service.configure({enabled:false,autoReply:false});assert.equal(f.service.settings().enabled,false);
  assert.throws(()=>f.service.configure({enabled:true,autoReply:true}));
});

test('short opt-out commands with punctuation remain respected',t=>{
  for(const text of ['Pare!', 'parar.', 'STOP', 'sair']){const f=fixture(t);assert.deepEqual(f.enqueue(body(event({message:{mid:'stop-'+text,text}}))),[]);}
});

test('specific content terms rank ahead of broad recipe matches',async t=>{
  const f=fixture(t);f.state.sources.clear();for(let n=0;n<5;n++)f.state.sources.set('generic-'+n,{...source,key:'generic-'+n,title:'Receita de arroz '+n,body:'Receita de arroz.',sourcePath:'/artigo/arroz-'+n});f.state.sources.set('recipe',source);
  const [job]=f.enqueue();const reply=await f.service.generateReply(job);assert.equal(JSON.parse(f.state.textCalls[0].input).catalog[0].title,'Receita do bolo');assert.match(reply,/https:\/\/vitrinecity.com\/artigo\/bolo$/);
});

test('a greeting or test introduction does not hide the requested product from the grounded reply',async t=>{
  for(const text of ['Teste de atendimento da VitrineCity: onde encontro o adubo para rosa do deserto?','Oi Lia eu entrei ontem no site e gostaria de saber onde encontro adubo para rosa do deserto']){
    const f=fixture(t);f.state.sources.clear();
    for(let n=0;n<5;n++)for(const word of ['teste','atendimento','adubo','rosa','deserto'])f.state.sources.set(word+n,{...source,key:word+n,title:'Artigo sobre '+word,body:'Informações gerais.',sourcePath:'/artigo/'+word+n});
    f.state.sources.set('product:11',{key:'product:11',title:'Adubo para Rosa do Deserto',summary:'Produto da loja Agrotécnica.',body:'Adubo para rosa do deserto.',sourcePath:'/produto/11/adubo-para-rosa-do-deserto',commercial:true});
    f.state.reply='O adubo para rosa do deserto está aqui:';
    const job=await f.ready(body(event({message:{mid:'product-introduction',text}})));
    assert.equal(JSON.parse(f.state.textCalls[0].input).catalog[0].title,'Adubo para Rosa do Deserto');
    assert.equal(job.reply_text,f.state.reply+'\nhttps://vitrinecity.com/produto/11/adubo-para-rosa-do-deserto');assert.ok(f.state.catalogQueries.length<=7);assert.equal(f.state.sends.length,0);
  }
});

test('the final specific term survives a long introduction and repeated earlier terms',async t=>{
  const f=fixture(t);f.state.sources.clear();
  f.state.sources.set('product:11',{key:'product:11',title:'Adubo para Rosa do Deserto',summary:'Produto da loja.',body:'Adubo para rosa do deserto.',sourcePath:'/produto/11/adubo-para-rosa-do-deserto',commercial:true});
  f.state.reply='Veja o produto:';
  const job=await f.ready(body(event({message:{mid:'long-introduction',text:'Deserto: comecei pesquisando artigos, acessei a plataforma, tentei encontrar informações e agora quero adubo para rosa do deserto'}})));
  assert.match(job.reply_text,/https:\/\/vitrinecity.com\/produto\/11\/adubo-para-rosa-do-deserto$/);
  assert.ok(f.state.catalogQueries.length<=7);assert.ok(f.state.catalogQueries.includes('deserto'));
});

test('product retrieval still excludes unsafe sources and blocks a withdrawn product before sending',async t=>{
  const f=fixture(t);f.state.sources.clear();
  const product={key:'product:11',title:'Adubo para Rosa do Deserto',summary:'Produto da loja.',body:'Adubo para rosa do deserto.',sourcePath:'/produto/11/adubo-para-rosa-do-deserto',commercial:true};
  f.state.sources.set('missing-path',{...product,key:'missing-path',sourcePath:undefined});
  f.state.sources.set('external-path',{...product,key:'external-path',sourcePath:'https://evil.test/adubo'});
  f.state.sources.set(product.key,product);f.state.reply='Veja o adubo:';
  const job=await f.ready(body(event({message:{mid:'product-guard',text:'Oi Lia, onde encontro o adubo para rosa do deserto?'}})));
  assert.deepEqual(JSON.parse(f.state.textCalls[0].input).catalog.map(item=>item.title),['Adubo para Rosa do Deserto']);assert.match(job.reply_text,/https:\/\/vitrinecity.com\/produto\/11\/adubo-para-rosa-do-deserto$/);
  f.state.sources.set(product.key,{...product,active:false});
  await assert.rejects(f.service.send(job,job.reply_text),/source_changed/);assert.equal(f.state.sends.length,0);
});

test('conversation context is limited to that Page and PSID and includes only confirmed assistant messages',async t=>{
  const f=fixture(t),first=await f.ready();await f.service.send(first,first.reply_text);
  f.state.now++;f.enqueue(body(event({timestamp:f.state.now,sender:{id:'777'},message:{mid:'other-user',text:'PRIVATE_OTHER_USER'}})));
  const [next]=f.enqueue(body(event({timestamp:f.state.now,message:{mid:'mid-2',text:'Pode enviar esse link?'}})));await f.service.generateReply(next);
  const input=JSON.parse(f.state.textCalls.at(-1).input);assert.deepEqual(input.history,[{role:'user',content:first.source_text},{role:'assistant',content:first.reply_text}]);assert.ok(!JSON.stringify(input).includes('PRIVATE_OTHER_USER'));
  assert.ok(input.catalog.some(item=>item.title==='Receita do bolo'));assert.ok(!JSON.stringify(input).includes('protected-offline-secret'));assert.ok(!JSON.stringify(input).includes('mid-1'));
  assert.match(f.state.textCalls.at(-1).instructions,/Não envie sempre a página de oração/);assert.match(f.state.textCalls.at(-1).instructions,/não pressione/);
});

test('unknown or withdrawn links are blocked rather than replaced by an unrelated prayer promotion',async t=>{
  for(const reply of ['Acesse https://evil.test/', 'Veja https://vitrinecity.com/artigo/inventado','Veja www.evil.test','Veja evil.test','Veja ftp://evil.test','Use javascript:alert(1)','Veja https://vitrinecity.com/oracao-do-dia']){
    const f=fixture(t),[job]=f.enqueue();f.state.reply=reply;await assert.rejects(f.service.generateReply(job),/unverified_link/);assert.equal(f.state.sends.length,0);
  }
  const f=fixture(t),job=await f.ready();f.state.sources.delete('recipe');await assert.rejects(f.service.send(job,job.reply_text),/source_changed/);assert.equal(f.state.sends.length,0);
});

test('unknown topics ask for context without invented links or catalog offers',async t=>{
  const f=fixture(t);f.state.reply='Quero ajudar. Qual é o nome ou o assunto do conteúdo que você procura?';f.state.sourceIndex=null;
  const [job]=f.enqueue(body(event({message:{mid:'unknown-topic',text:'Qual microscópio tem?'}})));const reply=await f.service.generateReply(job);
  assert.deepEqual(JSON.parse(f.state.textCalls[0].input).catalog,[]);await f.service.send(job,reply);assert.equal(f.row(job).state,'sent');
});

test('a reviewed answer cannot be silently replaced before sending',async t=>{
  const f=fixture(t),job=await f.ready();await assert.rejects(f.service.send(job,'Mensagem diferente'),/reply_changed/);assert.equal(f.state.sends.length,0);
});

test('daily cap counts uncertain claims and uses the Brasília date, reserving before POST',async t=>{
  const f=fixture(t),job=await f.ready(),insert=f.db.prepare("INSERT INTO facebook_messenger_messages(job_id,page_id,psid,mid,account_id,received_at,state,claimed_at) VALUES (?,'100','200',?,7,?,'held_unknown',?)");
  for(let i=0;i<30;i++)insert.run('prior-'+i,'prior-mid-'+i,instant,instant);
  await assert.rejects(f.service.send(job,job.reply_text),/daily_limit/);assert.equal(f.state.sends.length,0);assert.equal(f.row(job).claimed_at,null);
  f.state.now=Date.parse('2026-09-13T02:59:59Z');await assert.rejects(f.service.send(job,job.reply_text),/daily_limit/);
  f.state.now=Date.parse('2026-09-13T03:00:00Z');await f.service.send(job,job.reply_text);assert.equal(f.row(job).state,'sent');
});

const server=readFileSync(new URL('../server.js',import.meta.url),'utf8');
test('the real signed webhook wires Messenger and preserves the existing comment branch',t=>{
  const f=fixture(t),comments=[];let handler;
  const start=server.indexOf("app.post('/api/webhooks/social'"),end=server.indexOf('function saveSocialPages(',start);assert.ok(start>0&&end>start);
  vm.runInNewContext(server.slice(start,end),{app:{post(path,callback){handler=callback;}},db:f.db,facebookMessenger:f.service,socialCommentCampaigns:{ingestWebhook:()=>new Set()},enqueueOmnichannelJob:(...args)=>comments.push(args),process:{env:{META_SOCIAL_APP_SECRET:'offline-secret'}},Buffer,createHmac,timingSafeEqual,console:{error(){throw Error('Webhook should not fail');}}});
  const payload=body();payload.entry[0].changes=[{field:'feed',value:{item:'comment',comment_id:'comment-1',message:'Comentário legado'}}];
  const rawBody=Buffer.from(JSON.stringify(payload));let status;
  const res={sendStatus:value=>{status=value;return value;}},request={body:payload,rawBody,get:()=> 'invalid'};
  handler(request,res);assert.equal(status,401);assert.equal(f.db.prepare('SELECT count(*) n FROM facebook_messenger_messages').get().n,0);
  request.get=()=> 'sha256='+createHmac('sha256','offline-secret').update(rawBody).digest('hex');handler(request,res);
  assert.equal(status,200);assert.equal(f.db.prepare('SELECT count(*) n FROM facebook_messenger_messages').get().n,1);assert.equal(comments.length,1);assert.equal(comments[0][0],'facebook');assert.equal(comments[0][2],'comment-1');
});

test('the real worker uses Messenger auto-reply at 23h while leaving comment approval enabled',async t=>{
  const f=fixture(t),[job]=f.enqueue();f.db.prepare("UPDATE omnichannel_automation_settings SET enabled=0 WHERE channel='facebook'").run();
  const start=server.indexOf('async function processOmnichannelAutomation()'),end=server.indexOf("app.get('/api/admin/marketplace/payments/setup'",start);assert.ok(start>0&&end>start);
  const worker=vm.runInNewContext('let omnichannelAutomationRunning=false;'+server.slice(start,end)+';processOmnichannelAutomation;',{
    db:f.db,facebookMessenger:f.service,ecosystemCanRun:()=>true,discoverWhatsAppQrAutomationJobs:async()=>{},ecosystemLocalWindow:()=>({hour:23,start:'2026-09-12T03:00:00Z',end:'2026-09-13T03:00:00Z'}),generateServiceReply:(_channel,_text,item)=>f.service.generateReply(item),sendOmnichannelReply:(item,reply,options)=>f.service.send(item,reply,options)});
  await worker();assert.equal(f.row(job).state,'sent');assert.equal(f.db.prepare('SELECT status FROM omnichannel_automation_jobs WHERE id=?').get(job.id).status,'sent');
  assert.equal(f.db.prepare("SELECT approval_required FROM omnichannel_automation_settings WHERE channel='facebook'").get().approval_required,1);
});

test('older comments outside their permitted hours cannot occupy the three worker slots ahead of Messenger',async t=>{
  const f=fixture(t),[job]=f.enqueue();
  for(let i=0;i<3;i++)f.db.prepare("INSERT INTO omnichannel_automation_jobs(id,channel,external_id,destination,source_text,account_id,source_kind,created_at) VALUES (?,'facebook',?,'comment-id','Comentário antigo',7,'feed','2026-09-11 00:00:00')").run('legacy-'+i,'facebook:legacy-'+i);
  const start=server.indexOf('async function processOmnichannelAutomation()'),end=server.indexOf("app.get('/api/admin/marketplace/payments/setup'",start);
  const worker=vm.runInNewContext('let omnichannelAutomationRunning=false;'+server.slice(start,end)+';processOmnichannelAutomation;',{
    db:f.db,facebookMessenger:f.service,ecosystemCanRun:()=>true,discoverWhatsAppQrAutomationJobs:async()=>{},ecosystemLocalWindow:()=>({hour:23,start:'2026-09-12T03:00:00Z',end:'2026-09-13T03:00:00Z'}),generateServiceReply:(_channel,_text,item)=>{assert.equal(item.source_kind,'facebook_message');return f.service.generateReply(item);},sendOmnichannelReply:(item,reply,options)=>f.service.send(item,reply,options)});
  await worker();assert.equal(f.row(job).state,'sent');assert.equal(f.state.sends.length,1);
  assert.equal(f.db.prepare("SELECT count(*) n FROM omnichannel_automation_jobs WHERE source_kind='feed' AND status='pending'").get().n,3);
});

test('admin controls require authentication and same-origin and expose no Page credentials',()=>{
  const start=server.indexOf("app.get('/api/admin/facebook-messenger'"),end=server.indexOf("app.get('/api/admin/omnichannel-automation'",start),routes=[];
  const admin=()=>{},origin=()=>{};
  vm.runInNewContext(server.slice(start,end),{app:{get:(...args)=>routes.push(args),put:(...args)=>routes.push(args)},requireAdmin:admin,sameOriginOnly:origin,aiConfigured:()=>true,facebookMessenger:{}});
  assert.equal(routes[0][1],admin);assert.equal(routes[1][1],admin);assert.equal(routes[1][2],origin);assert.ok(!server.slice(start,end).includes('token_encrypted'));
});
