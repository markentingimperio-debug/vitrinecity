import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import express from 'express';
import Database from 'better-sqlite3';
import {setupSiteSalesAssistant} from '../site-sales-assistant.js';
import {setupSiteSalesExperience} from '../site-sales-experience.js';

const origin='https://vitrinecity.test',page='/artigo/bolo-caseiro';
const response=(reply='Posso ajudar com os utensílios. O que você quer preparar?',offerIds=['product:1'])=>({output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply,offerIds})}]}]});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function fixture(t,options={}){
  const db=new Database(':memory:'),app=express(),sessions=new Map(),seen={calls:[],events:[],outcomes:[],offers:[]};app.use(express.json({limit:'8kb'}));
  db.exec(`CREATE TABLE editorial_articles(id TEXT PRIMARY KEY,slug TEXT,title TEXT,summary TEXT,body TEXT,portal TEXT,updated_at TEXT,status TEXT);
    CREATE TABLE store_profiles(order_reference TEXT PRIMARY KEY,business_name TEXT,description TEXT,review_status TEXT);
    CREATE TABLE store_products(id INTEGER PRIMARY KEY,store_reference TEXT,name TEXT,description TEXT,category TEXT,image_url TEXT,active INTEGER,marketplace_enabled INTEGER,available INTEGER,stock_quantity INTEGER,price_cents INTEGER);
    CREATE TABLE affiliate_catalog(slug TEXT PRIMARY KEY,title TEXT,description TEXT,category TEXT,keywords TEXT,platform TEXT,affiliate_url TEXT,image TEXT,status TEXT,availability TEXT,health TEXT);
    INSERT INTO editorial_articles VALUES('recipe','bolo-caseiro','Bolo caseiro','Receita de bolo','Misture os ingredientes indicados e use uma forma adequada. Confira o preparo completo nesta receita.','receitas','2026-09-11','published');
    INSERT INTO editorial_articles VALUES('private','privado','Privado','','Nunca compartilhar','receitas','2026-09-11','draft');
    INSERT INTO store_profiles VALUES('official','Loja oficial','Produtos para sua rotina','published');
    INSERT INTO store_profiles VALUES('private','Loja privada','','draft');
    INSERT INTO store_products VALUES(1,'official','Forma para bolo','Forma de alumínio para uso culinário.','Cozinha','/assets/forma.png',1,1,1,5,3000);
    INSERT INTO store_products VALUES(2,'official','Adubo para plantas','Leia as instruções do produto.','Jardinagem','/assets/adubo.png',1,1,1,4,1000);
    INSERT INTO store_products VALUES(3,'official','Panela indisponível','','Cozinha','',1,1,0,4,1000);
    INSERT INTO store_products VALUES(4,'official','Panela sem estoque','','Cozinha','',1,1,1,0,1000);
    INSERT INTO store_products VALUES(5,'private','Panela privada','','Cozinha','',1,1,1,4,1000);
    INSERT INTO affiliate_catalog VALUES('mixer-real','Mixer de cozinha','Confira a opção na loja.','Cozinha','mixer','shopee','https://shopee.com.br/produto-i.123.456','https://down-tx-br.img.susercontent.com/br-123.webp','published','available','reachable');
    INSERT INTO affiliate_catalog VALUES('mixer-unknown','Mixer incerto','','Cozinha','','shopee','https://shopee.com.br/item','','published','unknown','unchecked');
    INSERT INTO affiliate_catalog VALUES('mixer-bad-link','Mixer link inválido','','Cozinha','','shopee','https://evil.test/item','','published','available','reachable');`);
  const experience=options.realExperience?setupSiteSalesExperience({app,db,requireAdmin:(_req,res)=>res.sendStatus(403),siteUrl:origin,schedule:false}):{session(req,res){const token=req.get('cookie')?.match(/(?:^|; )test_sid=([a-f0-9]{64})/)?.[1];if(token&&sessions.has(token))return sessions.get(token);const id=randomBytes(32).toString('hex'),session={id,versionId:1,versionNumber:1,approach:options.approach||'helpful_question'};sessions.set(id,session);res.append('Set-Cookie',`test_sid=${id}; Path=/; HttpOnly; SameSite=Lax`);return session;},recordEvent(id,type,data){seen.events.push({id,type,data});},recordOutcome(id,data){seen.outcomes.push({id,...data});},registerOffers(id,offers){seen.offers.push({id,offers});}};
  if(options.interestError)experience.markInterest=()=>{throw Error('measurement_unavailable');};
  const handler=setupSiteSalesAssistant({app,db,publicOrigin:origin,salesExperience:experience,getSessionUser:req=>req.get('x-test-user')==='active'?{id:7,name:'Ana',account_status:'active',email:'private@test.invalid'}:null,requestOpenAI:async body=>{seen.calls.push(body);return options.request?options.request(body,db):response();},getGroups:()=>options.groups||[],getPublicCourses:()=>options.courses||[],getPublicServices:()=>options.services||[],recipeVipUrl:options.recipeVipUrl||'',sendWhatsApp:options.sendWhatsApp||null});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
  const client=()=>{const jar=new Map();return async(path,{method='GET',body,headers={},missingOrigin=false}={})=>{const res=await fetch(base+path,{method,headers:{...(!missingOrigin?{origin}:{}),...(jar.size?{cookie:[...jar.values()].join('; ')}:{}),...(body!==undefined?{'content-type':'application/json'}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});for(const cookie of res.headers.getSetCookie()){const first=cookie.split(';')[0];jar.set(first.split('=')[0],first);}return {status:res.status,body:await res.json(),cookies:res.headers.getSetCookie()};};};
  const call=client();t.after(async()=>{handler.close();experience.close?.();server.closeAllConnections();await new Promise(r=>server.close(r));db.close();});
  return {db,seen,handler,call,client,chat:(message='Quero uma forma para bolo',extra={})=>call('/api/site-assistant/chat',{method:'POST',body:{message,contextPath:page},...extra})};
}
test('anonymous context is free and selects only available pertinent catalog entries',async t=>{
  const f=await fixture(t),r=await f.call('/api/site-assistant/context?path='+page);
  assert.equal(r.status,200);assert.equal(r.body.enabled,true);assert.match(r.body.identity,/IA/);assert.match(r.body.greeting,/Oi! Eu sou a Lia/);assert.doesNotMatch(r.body.greeting,/assistente virtual/);assert.equal(r.body.visitorName,undefined);assert.equal(f.seen.calls.length,0);
  assert.deepEqual(r.body.offers.map(o=>o.id),['affiliate:mixer-real','product:1']);assert.match(r.body.offers[0].disclosure,/comissão/);
  assert.deepEqual(r.body.offers.map(o=>o.assetType),['affiliate','product']);assert.equal(f.seen.offers.length,1);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM site_assistant_history').get().n,0);
});
test('authenticated name comes only from server session lookup, never client fields',async t=>{
  const f=await fixture(t),r=await f.call('/api/site-assistant/context?path='+page+'&name=Inventado',{headers:{'x-test-user':'active'}});
  assert.equal(r.body.visitorName,'Ana');assert.match(r.body.greeting,/Ana/);assert.doesNotMatch(JSON.stringify(r.body),/private@test|Inventado/);
});
test('private/unpublished/malformed contexts and foreign or missing POST Origin never invoke AI',async t=>{
  const f=await fixture(t);
  for(const path of ['/admin','/checkout','/artigo/privado','https://evil.test','/artigo/bolo-caseiro?token=x'])assert.equal((await f.call('/api/site-assistant/context?path='+encodeURIComponent(path))).status,404);
  assert.equal((await f.chat('Olá',{headers:{origin:'https://evil.test'}})).status,403);assert.equal((await f.chat('Olá',{missingOrigin:true})).status,403);assert.equal(f.seen.calls.length,0);
});
test('client history, business context, role or model overrides are rejected before any paid request',async t=>{
  const f=await fixture(t);
  for(const field of ['history','businessContext','role','model'])assert.equal((await f.call('/api/site-assistant/chat',{method:'POST',body:{message:'Olá',contextPath:page,[field]:'untrusted'}})).status,400);
  assert.equal(f.seen.calls.length,0);
});
test('valid explicit chat uses bounded server history and validated card IDs',async t=>{
  const f=await fixture(t);const first=await f.chat(),second=await f.chat('Qual material da forma?');
  assert.equal(first.body.mode,'ai');assert.equal(second.body.mode,'ai');assert.equal(first.body.offers[0].url,'/produto/1/forma-para-bolo');
  assert.equal(f.seen.calls[0].store,false);assert.equal(f.seen.calls[0].max_output_tokens,400);assert.equal(f.seen.calls[0].tools,undefined);assert.equal(f.seen.calls[0].model,undefined);
  const input=JSON.parse(f.seen.calls[1].input[0].content);assert.equal(input.history.length,2);assert.equal(input.history[0].content,'Quero uma forma para bolo');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM site_assistant_history').get().n,4);
});
test('the same real session restores a conversation at the course destination and continues its topic',async t=>{
  const f=await fixture(t,{realExperience:true,request:()=>response('Podemos seguir com essa escolha. Qual dúvida você tem?',[])});
  const first=await f.chat('Quero um curso para minha loja');
  const destination=first.body.actions.find(a=>a.assetId==='courses').url;
  const restored=await f.call('/api/site-assistant/context?path='+destination);
  assert.equal(restored.status,200);assert.equal(restored.body.history.length,2);
  assert.deepEqual(restored.body.history[0],{role:'user',content:'Quero um curso para minha loja',contextPath:page});
  assert.deepEqual(restored.body.quickActions,[]);assert.doesNotMatch(restored.body.greeting,/sou a Lia/i);
  assert.equal(f.seen.calls.length,0); // Restoring never generates another paid response.
  const next=await f.call('/api/site-assistant/chat',{method:'POST',body:{message:'Qual curso me ajuda a começar?',contextPath:destination}});
  assert.equal(next.body.mode,'ai');assert.deepEqual(next.body.actions,[]);
  const input=JSON.parse(f.seen.calls[0].input[0].content);
  assert.equal(input.page.path,destination);assert.equal(input.history[0].content,'Quero um curso para minha loja');
  assert.match(f.seen.calls[0].instructions,/não se reapresente/);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM site_sales_sessions').get().n,1);
});
test('product navigation keeps prior needs and never exposes a different visitor conversation',async t=>{
  const f=await fixture(t);await f.chat('Preciso de uma forma pequena para bolo');
  const restored=await f.call('/api/site-assistant/context?path=/produto/1');
  assert.equal(restored.body.history[0].content,'Preciso de uma forma pequena para bolo');
  await f.call('/api/site-assistant/chat',{method:'POST',body:{message:'Esse material serve?',contextPath:'/produto/1'}});
  const input=JSON.parse(f.seen.calls.at(-1).input[0].content);
  assert.equal(input.page.path,'/produto/1');assert.equal(input.history.length,2);
  const stranger=await f.client()('/api/site-assistant/context?path=/produto/1');
  assert.deepEqual(stranger.body.history,[]);assert.match(stranger.body.greeting,/Eu sou a Lia/);
});
test('restored history excludes expired or no longer public sources on both context and AI input',async t=>{
  const f=await fixture(t);await f.chat('Preciso de uma forma pequena');
  f.db.prepare("UPDATE editorial_articles SET status='draft' WHERE id='recipe'").run();
  assert.deepEqual((await f.call('/api/site-assistant/context?path=/produto/1')).body.history,[]);
  await f.call('/api/site-assistant/chat',{method:'POST',body:{message:'Qual material?',contextPath:'/produto/1'}});
  assert.deepEqual(JSON.parse(f.seen.calls.at(-1).input[0].content).history,[]);
  f.db.prepare('UPDATE site_assistant_history SET created_ms=0').run();
  assert.deepEqual((await f.call('/api/site-assistant/context?path=/produto/1')).body.history,[]);
});
test('an expired real visitor session starts with no restored transcript',async t=>{
  const f=await fixture(t,{realExperience:true});await f.chat();
  f.db.prepare('UPDATE site_sales_sessions SET expires_at=0').run();
  const restored=await f.call('/api/site-assistant/context?path=/produto/1');
  assert.deepEqual(restored.body.history,[]);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM site_sales_sessions').get().n,2);
});
test('fabricated IDs, URLs, prices and invalid JSON use deterministic catalog fallback',async t=>{
  for(const generated of [response('Veja o produto',['inventado']),response('Compre em https://evil.test'),response('Custa R$ 9,99'),{output:[{type:'message',content:[{type:'output_text',text:'não é JSON'}]}]}]){
    const f=await fixture(t,{request:()=>generated}),r=await f.chat();assert.equal(r.body.mode,'fallback');assert.doesNotMatch(r.body.reply,/evil|9,99/);assert.ok(r.body.offers.every(o=>['product:1','affiliate:mixer-real'].includes(o.id)));
  }
});
test('provider outage never turns into a claim of sent message, order or payment',async t=>{
  const f=await fixture(t,{request:()=>{throw Error('private-provider-detail');}}),r=await f.chat();assert.equal(r.status,200);assert.equal(r.body.mode,'fallback');assert.doesNotMatch(JSON.stringify(r.body),/private-provider-detail/);assert.equal(f.seen.outcomes[0].outcome,'fallback');
});
test('withdrawn offer after AI request is removed and its generated copy is discarded',async t=>{
  const gate=deferred(),f=await fixture(t,{request:()=>gate.promise}),pending=f.chat();
  while(!f.seen.calls.length)await new Promise(r=>setTimeout(r,5));
  f.db.prepare('UPDATE store_products SET stock_quantity=0 WHERE id=1').run();gate.resolve(response('A forma que você deseja está disponível.'));
  const r=await pending;assert.equal(r.body.mode,'fallback');assert.equal(r.body.offers.some(o=>o.id==='product:1'),false);assert.doesNotMatch(r.body.reply,/forma que você deseja/);
});
test('source withdrawn during request returns conflict and saves no conversation',async t=>{
  const gate=deferred(),f=await fixture(t,{request:()=>gate.promise}),pending=f.chat();while(!f.seen.calls.length)await new Promise(r=>setTimeout(r,5));
  f.db.prepare("UPDATE editorial_articles SET status='draft' WHERE id='recipe'").run();gate.resolve(response());assert.equal((await pending).status,409);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM site_assistant_history').get().n,0);
});
test('explicit plant intention can change category, but declining offers yields none',async t=>{
  const f=await fixture(t,{request:body=>{const input=JSON.parse(body.input[0].content);return response('Posso ajudar com os detalhes.',input.candidateOffers.map(o=>o.id));}});
  const plant=await f.chat('Quero adubo para plantas');assert.deepEqual(plant.body.offers.map(o=>o.id),['product:2']);
  assert.deepEqual((await f.chat('Não quero comprar, só a receita')).body.offers,[]);
});
test('VIP is absent on opening; direct group request uses exact topic and verified URL only',async t=>{
  const valid='https://chat.whatsapp.com/ABCDEFGHIJKLMNOPQRSTUV';
  const f=await fixture(t,{groups:[{id:'news',topic:'news',title:'Notícias',url:valid,enabled:true},{id:'recipes',topic:'recipes',title:'Receitas inválido',url:'https://evil.test/group',enabled:true}]});
  const opening=await f.call('/api/site-assistant/context?path='+page);assert.deepEqual(opening.body.actions,[]);assert.ok(opening.body.quickActions.every(a=>!/vip|grupo/i.test(a.message)));
  const recipes=await f.chat('Quero o grupo de receitas');assert.deepEqual(recipes.body.actions,[]);assert.match(recipes.body.reply,/Não tenho/);
  const news=await f.chat('Quero o grupo de notícias');assert.equal(news.body.actions[0].url,valid);assert.deepEqual(news.body.offers,[]);assert.equal(f.seen.calls.length,0);
});
test('prayer and voluntary signup use real navigation without product pressure or AI call',async t=>{
  const f=await fixture(t),prayer=await f.call('/api/site-assistant/chat',{method:'POST',body:{message:'Quero oração',contextPath:'/oracao-do-dia.html'}});
  assert.equal(prayer.body.actions[0].url,'/oracao-do-dia.html');assert.deepEqual(prayer.body.offers,[]);assert.match(prayer.body.reply,/Não é necessário comprar/);
  const signup=await f.chat('Quero criar conta');assert.equal(signup.body.actions[0].url,'/entrar-cidade.html');assert.match(signup.body.reply,/opcional/);assert.equal(f.seen.calls.length,0);
});
test('only injected ready courses enter the catalog',async t=>{
  const f=await fixture(t,{courses:[{slug:'cozinha-basica',title:'Cozinha básica',available:true},{slug:'cozinha-incompleta',title:'Cozinha incompleta',available:false}]});
  const r=await f.call('/api/site-assistant/context?path='+page);assert.ok(r.body.offers.some(o=>o.id==='course:cozinha-basica'));assert.ok(!r.body.offers.some(o=>o.id==='course:cozinha-incompleta'));
});
test('history is capped, expired rows are excluded and IP addresses are never stored raw',async t=>{
  const f=await fixture(t);for(let i=0;i<6;i++)await f.chat('Ajude com a forma '+i);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM site_assistant_history').get().n,8);
  f.db.prepare('UPDATE site_assistant_history SET created_ms=0').run();await f.chat('Mais uma dúvida sobre a forma');assert.equal(JSON.parse(f.seen.calls.at(-1).input[0].content).history.length,0);
  assert.ok(f.db.prepare('SELECT subject FROM site_assistant_limits').all().every(row=>row.subject==='all'||/^[a-f0-9]{64}$/.test(row.subject)));
});
test('a full worker pool does not impose an artificial hourly quota on other visitors',async t=>{
  const f=await fixture(t),now=Date.now(),start=Math.floor(now/3600000)*3600000;f.db.prepare('INSERT INTO site_assistant_limits VALUES(?,?,?,?,?)').run('ai-global','all',30,start,start+3600000);
  const result=await f.chat();assert.equal(result.status,200);assert.equal(result.body.mode,'ai');assert.equal(f.seen.calls.length,1);
});
test('session rate limit rejects further requests before the provider',async t=>{
  const f=await fixture(t);for(let i=0;i<120;i++)assert.equal((await f.chat('Tenho uma dúvida '+i)).status,200);
  assert.equal((await f.chat()).status,429);assert.equal(f.seen.calls.length,120);
});
test('a concurrent turn in the same session cannot fork history or charge twice',async t=>{
  const gate=deferred(),f=await fixture(t,{request:()=>gate.promise});await f.call('/api/site-assistant/context?path='+page);const pending=f.chat();while(!f.seen.calls.length)await new Promise(r=>setTimeout(r,5));
  assert.equal((await f.chat()).status,409);gate.resolve(response());await pending;assert.equal(f.seen.calls.length,1);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM site_assistant_history').get().n,2);
});
test('each experience approach changes the greeting, choices and AI strategy',async t=>{
  const greetings=new Set(),instructions=new Set();
  for(const approach of ['helpful_question','simple_choices','direct_product','checkout_help']){
    const f=await fixture(t,{approach}),r=await f.call('/api/site-assistant/context?path='+page);greetings.add(r.body.greeting);assert.match(r.body.greeting,/Lia/);assert.equal(r.body.quickActions.length,2);
    await f.chat();instructions.add(f.seen.calls[0].instructions);
  }
  assert.equal(greetings.size,4);assert.equal(instructions.size,4);
});
test('product without slug resolves only a live item and preserves the requested context path',async t=>{
  const f=await fixture(t),r=await f.call('/api/site-assistant/context?path=/produto/1');assert.equal(r.status,200);assert.equal(r.body.context.path,'/produto/1');assert.equal(r.body.offers[0].url,'/produto/1/forma-para-bolo');
  assert.equal((await f.call('/api/site-assistant/context?path=/produto/1/slug-errado')).status,404);assert.equal((await f.call('/api/site-assistant/context?path=/produto/999')).status,404);
});
test('a cheaper alternative uses only real own catalog prices, never affiliate guesses',async t=>{
  const f=await fixture(t);f.db.prepare("INSERT INTO store_products VALUES(6,'official','Forma pequena','Confira as medidas.','Cozinha','',1,1,1,3,1500)").run();
  const r=await f.call('/api/site-assistant/chat',{method:'POST',body:{message:'Está muito caro, tem mais barato?',contextPath:'/produto/1'}});
  assert.equal(r.body.offers.length,1);assert.equal(r.body.offers[0].id,'product:6');assert.equal(r.body.offers[0].priceCents,undefined);
});
test('only looking is respected without a paid request or a group/signup invitation',async t=>{
  const f=await fixture(t),r=await f.chat('Só estou olhando');assert.deepEqual(r.body.offers,[]);assert.deepEqual(r.body.actions,[]);assert.match(r.body.reply,/fique à vontade/);assert.equal(f.seen.calls.length,0);
});
test('news context resolves only the news group, never a recipe group',async t=>{
  const url='https://chat.whatsapp.com/ABCDEFGHIJKLMNOPQRSTUV',f=await fixture(t,{groups:[{id:'news-01',topic:'news',title:'Notícias',url,enabled:true}]});
  const r=await f.call('/api/site-assistant/chat',{method:'POST',body:{message:'Quero o grupo',contextPath:'/noticias'}});
  assert.equal(r.body.actions[0].assetType,'group');assert.equal(r.body.actions[0].assetId,'news-01');assert.equal(r.body.actions[0].url,url);assert.ok(f.seen.offers.at(-1).offers.some(o=>o.assetType==='group'));
});
test('VIP WhatsApp contact requires explicit consent, encrypts the number and schedules a reviewable follow-up',async t=>{
  const url='https://chat.whatsapp.com/ABCDEFGHIJKLMNOPQRSTUV',sent=[],f=await fixture(t,{realExperience:true,groups:[{id:'news-01',topic:'news',title:'Notícias',url,enabled:true}],sendWhatsApp:async payload=>{sent.push(payload);}});
  const chat=await f.call('/api/site-assistant/chat',{method:'POST',body:{message:'Quero o grupo de notícias',contextPath:'/noticias'}});
  assert.equal(chat.status,200);assert.equal(chat.body.contactOffer.purpose,'group_and_offers');
  const refused=await f.call('/api/site-assistant/contact',{method:'POST',body:{phone:'62999999999',purpose:'group_and_offers',groupId:'news-01',contextPath:'/noticias',consent:false}});
  assert.equal(refused.status,400);
  const saved=await f.call('/api/site-assistant/contact',{method:'POST',body:{phone:'62999999999',purpose:'group_and_offers',groupId:'news-01',contextPath:'/noticias',consent:true}});
  assert.equal(saved.status,201);assert.match(saved.body.phone,/^\+•+ 9999$/);assert.equal(saved.body.followUp.scheduled,true);
  const row=f.db.prepare('SELECT phone_ciphertext,phone_last4,purpose,revoked_at,followup_status FROM site_assistant_contacts').get();assert.notEqual(row.phone_ciphertext,'5562999999999');assert.equal(row.phone_last4,'9999');assert.equal(row.purpose,'group_and_offers');assert.equal(row.revoked_at,null);assert.equal(row.followup_status,'pending');
  const admin=await f.call('/api/admin/site-assistant/contacts?includePhone=1');assert.equal(admin.status,200);assert.equal(admin.body.items[0].phone,'+5562999999999');
  f.db.prepare('UPDATE site_assistant_contacts SET next_followup_at=?').run(Date.now()-1);assert.deepEqual((await f.handler.processFollowups()).sent,1);assert.equal(sent.length,1);assert.match(sent[0].message,/Sou a Lia/);assert.match(sent[0].message,/SAIR/);assert.equal(f.db.prepare('SELECT followup_status FROM site_assistant_contacts').get().followup_status,'sent');
  const revoked=await f.call('/api/site-assistant/contact/revoke',{method:'POST',body:{}});assert.equal(revoked.status,200);assert.equal(revoked.body.revoked,true);assert.equal(f.db.prepare('SELECT followup_status FROM site_assistant_contacts').get().followup_status,'cancelled');
});
test('ready digital services use a server-built detail URL, ignoring arbitrary checkout URLs',async t=>{
  const f=await fixture(t,{services:[{slug:'site-simples',title:'Criação de site',description:'Página para seu negócio.',available:true,checkoutUrl:'https://evil.test'},{slug:'private',title:'Serviço privado',available:false}]});
  const r=await f.call('/api/site-assistant/context?path=/servicos-digitais.html');assert.equal(r.body.offers.length,1);assert.equal(r.body.offers[0].url,'/servicos-digitais.html?servico=site-simples');assert.equal(r.body.offers[0].assetType,'service');
});
test('contact numbers and emails are omitted from provider input and bounded history',async t=>{
  const f=await fixture(t);await f.chat('Meu email ana@example.com e telefone 5562999999999. Quero uma forma.');
  assert.doesNotMatch(JSON.stringify(f.seen.calls),/ana@example|5562999999999/);assert.doesNotMatch(JSON.stringify(f.db.prepare('SELECT content FROM site_assistant_history').all()),/ana@example|5562999999999/);
});
test('real experience integration creates opaque HttpOnly cookies and records one valid message with delivered actions',async t=>{
  const f=await fixture(t,{realExperience:true}),r=await f.chat('Quero criar conta');
  assert.equal(r.status,200);assert.equal(r.cookies.length,2);assert.ok(r.cookies.every(c=>/HttpOnly/.test(c)&&/SameSite=Lax/.test(c)&&/Secure/.test(c)));
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM site_sales_events WHERE event_type='message'").get().n,1);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM site_sales_interests').get().n,1);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM site_sales_offers WHERE asset_type='navigation' AND asset_id='signup'").get().n,1);
  assert.equal((await f.chat('Como comprar?')).status,200);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM site_sales_sessions').get().n,1);
});
test('concurrent visitors share a worker pool without falling back merely because another visitor is active',async t=>{
  const gate=deferred(),f=await fixture(t,{request:()=>gate.promise}),a=f.client(),b=f.client(),c=f.client();
  const body={message:'Quero uma forma para bolo',contextPath:page};
  const first=a('/api/site-assistant/chat',{method:'POST',body}),second=b('/api/site-assistant/chat',{method:'POST',body});
  while(f.seen.calls.length<2)await new Promise(r=>setTimeout(r,5));
  const third=c('/api/site-assistant/chat',{method:'POST',body});
  while(f.seen.calls.length<3)await new Promise(r=>setTimeout(r,5));
  assert.equal(f.seen.calls.length,3);
  gate.resolve(response());await Promise.all([first,second,third]);assert.equal(f.db.prepare('SELECT COUNT(DISTINCT session_id) n FROM site_assistant_history').get().n,3);
});
test('uncertain interest measurement does not block the answer or retry the event',async t=>{
  const f=await fixture(t,{interestError:true}),r=await f.chat();assert.equal(r.status,200);assert.equal(r.body.mode,'ai');assert.equal(f.seen.calls.length,1);assert.equal(f.seen.events.filter(e=>e.type==='message').length,0);
});
test('queued visitors reuse a released AI slot and leave capacity for later arrivals',{timeout:5000},async t=>{
  const previous=process.env.SITE_ASSISTANT_AI_CONCURRENCY;process.env.SITE_ASSISTANT_AI_CONCURRENCY='1';
  const gate=deferred();let f;
  try{f=await fixture(t,{request:()=>gate.promise});}
  finally{if(previous===undefined)delete process.env.SITE_ASSISTANT_AI_CONCURRENCY;else process.env.SITE_ASSISTANT_AI_CONCURRENCY=previous;}
  const send=()=>f.client()('/api/site-assistant/chat',{method:'POST',body:{message:'Qual material da forma?',contextPath:page}});
  const first=send();while(!f.seen.calls.length)await new Promise(r=>setTimeout(r,5));
  const second=send(),third=send();
  while(f.seen.events.filter(e=>e.type==='message').length<3)await new Promise(r=>setTimeout(r,5));
  assert.equal(f.seen.calls.length,1);gate.resolve(response());
  assert.ok((await Promise.all([first,second,third])).every(r=>r.body.mode==='ai'));
  assert.equal((await send()).body.mode,'ai');assert.equal(f.seen.calls.length,4);
});
