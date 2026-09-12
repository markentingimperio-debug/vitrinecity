import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import express from 'express';
import Database from 'better-sqlite3';
import {setupSiteSalesAssistant} from '../site-sales-assistant.js';
import {setupSiteSalesExperience} from '../site-sales-experience.js';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {validWhatsAppReceiptId} from '../whatsapp-schedule-worker.js';

const origin='https://vitrinecity.test',page='/artigo/bolo-caseiro';
const welcomeGift={available:true,id:'zamioculca',topic:'plants',amountCents:0,title:'Guia prático da zamioculca: cultivo e cuidados em casa'};
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
  const handler=setupSiteSalesAssistant({app,db,publicOrigin:origin,salesExperience:experience,getSessionUser:req=>req.get('x-test-user')==='active'?{id:7,name:'Ana',account_status:'active',email:'private@test.invalid'}:null,requestOpenAI:async body=>{seen.calls.push(body);return options.request?options.request(body,db):response();},getWelcomeGift:()=>options.gift||null,getGroups:()=>options.groups||[],getPublicCourses:()=>options.courses||[],getPublicServices:()=>options.services||[],recipeVipUrl:options.recipeVipUrl||'',sendWhatsApp:options.sendWhatsApp||null,canSendFollowups:options.canSendFollowups||(()=>true)});
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

test('explicit welcome gift opens its secure form with no product, discount or claim of email delivery',async t=>{
  const f=await fixture(t,{gift:welcomeGift});
  const initial=await f.call('/api/site-assistant/context?path=/plantas-e-jardinagem');
  assert.equal(initial.body.actions.some(a=>a.assetId==='gift:zamioculca'),false);
  const result=await f.call('/api/site-assistant/chat',{method:'POST',body:{message:'Não quero comprar, quero receber o guia gratuito de zamioculca.',contextPath:'/plantas-e-jardinagem'}});
  assert.equal(result.status,200);assert.deepEqual(result.body.offers,[]);assert.equal(result.body.discountOffer,null);
  assert.equal(result.body.contactOffer,null);assert.equal(result.body.actions[0].url,'/presente.html?guia=zamioculca');
  assert.match(result.body.reply,/zamioculca/i);assert.doesNotMatch(result.body.reply,/enviei|foi enviado|pagamento aprovado/i);
});

test('gift form never becomes AI context and unavailable gifts are not promised',async t=>{
  const f=await fixture(t,{gift:{...welcomeGift,available:false}});
  assert.equal((await f.call('/api/site-assistant/context?path=/presente.html')).status,404);
  const result=await f.call('/api/site-assistant/chat',{method:'POST',body:{message:'Quero receber o guia gratuito de zamioculca.',contextPath:'/plantas-e-jardinagem'}});
  assert.equal(result.status,200);assert.equal(result.body.actions.some(a=>a.assetId==='gift:zamioculca'),false);
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

const prayerChat=(call,message)=>call('/api/site-assistant/chat',{method:'POST',body:{message,contextPath:'/oracao-do-dia.html'}});
const hasPrayerSupport=result=>result.body.actions.some(action=>action.assetId==='prayer-support');

test('prayer support is offered once only after relevant help, survives history trimming and registers its safe destination',async t=>{
  const f=await fixture(t,{realExperience:true});
  const opening=await f.call('/api/site-assistant/context?path=/oracao-do-dia.html');
  assert.equal(hasPrayerSupport(opening),false);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM site_assistant_prayer_support').get().n,0);
  assert.equal(hasPrayerSupport(await prayerChat(f.call,'Obrigada!')),false);
  const first=await prayerChat(f.call,'Quero acessar a oração de hoje');
  assert.equal(hasPrayerSupport(first),false);assert.match(first.body.reply,/Não é necessário comprar, doar ou se cadastrar/);
  const thanks=await prayerChat(f.call,'Amém, obrigada!');
  assert.equal(hasPrayerSupport(thanks),true);assert.deepEqual(thanks.body.offers,[]);assert.equal(thanks.body.discountOffer,null);assert.equal(thanks.body.contactOffer,null);
  assert.match(thanks.body.reply,/Se estiver ao seu alcance e não fizer falta para você/);assert.match(thanks.body.reply,/oração continua gratuita, com ou sem contribuição/);
  assert.ok(thanks.body.reply.length<240);assert.doesNotMatch(thanks.body.reply,/R\$|recebedor|regra/i);
  assert.deepEqual(thanks.body.actions,[{label:'Ver apoio voluntário',url:'/oracao-do-dia.html#supportTitle',kind:'internal',assetType:'prayer',assetId:'prayer-support'}]);
  assert.ok(thanks.body.reply.length<=600);assert.doesNotMatch(thanks.body.reply,/bênç|cura|garant|foi confirmado|desconto|LIA5/i);
  const invited=f.db.prepare('SELECT invited_ms FROM site_assistant_prayer_support').get().invited_ms;
  assert.ok(invited>0);
  const restored=await f.call('/api/site-assistant/context?path=/oracao-do-dia.html');
  assert.equal(hasPrayerSupport(restored),false);assert.ok(restored.body.history.some(row=>row.content===thanks.body.reply));
  for(let i=0;i<6;i++)assert.equal(hasPrayerSupport(await prayerChat(f.call,'Amém, obrigada!')),false);
  assert.equal(f.db.prepare('SELECT invited_ms FROM site_assistant_prayer_support').get().invited_ms,invited);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM site_assistant_history WHERE content LIKE '%Se estiver ao seu alcance%'").get().n,0);
  assert.equal(f.seen.calls.length,0);
});

test('an explicit support question can open the existing section without a prior appeal or provider request',async t=>{
  const f=await fixture(t),r=await prayerChat(f.call,'Como posso contribuir?');
  assert.equal(hasPrayerSupport(r),true);assert.match(r.body.reply,/apoio voluntário/);assert.deepEqual(r.body.offers,[]);
  assert.equal(hasPrayerSupport(await prayerChat(f.call,'Como faço para doar?')),false);
  assert.equal(f.seen.calls.length,0);assert.ok(f.seen.offers.some(event=>event.offers.some(offer=>offer.assetType==='prayer'&&offer.assetId==='prayer-support')));
});

test('declining support before or after an invitation prevents further appeals for that session',async t=>{
  const f=await fixture(t);
  for(const refusal of ['Não, obrigada','Agora não','Não quero','Só quero a oração','Não vou doar']){
    const call=f.client();await prayerChat(call,'Quero a oração de hoje');
    const declined=await prayerChat(call,refusal);assert.equal(hasPrayerSupport(declined),false);assert.match(declined.body.reply,/oração continua gratuita/);
    assert.equal(hasPrayerSupport(await prayerChat(call,'Amém, obrigada!')),false);
    assert.equal(hasPrayerSupport(await prayerChat(call,'Como posso apoiar?')),false);
  }
  const after=f.client();assert.equal(hasPrayerSupport(await prayerChat(after,'Quero contribuir')),true);
  await prayerChat(after,'Não, obrigada');assert.equal(hasPrayerSupport(await prayerChat(after,'Amém!')),false);
  assert.equal(f.seen.calls.length,0);
});

test('declared financial hardship suppresses prayer support across navigation and isolates sessions',async t=>{
  const f=await fixture(t,{realExperience:true});
  for(const statement of ['Estou sem dinheiro','Não tenho condições de contribuir','Estou desempregada','Estou com contas atrasadas','Não posso gastar','Isso vai me fazer falta','Não tenho como doar']){
    const call=f.client();await prayerChat(call,'Quero a oração de hoje');
    const r=await prayerChat(call,statement+'; como posso apoiar?');assert.equal(hasPrayerSupport(r),false);assert.match(r.body.reply,/não precisa contribuir/);
    assert.equal(hasPrayerSupport(await prayerChat(call,'Amém, obrigada')),false);
  }
  const call=f.client();await call('/api/site-assistant/chat',{method:'POST',body:{message:'Estou sem dinheiro e só olhando',contextPath:page}});
  await prayerChat(call,'Quero a oração');assert.equal(hasPrayerSupport(await prayerChat(call,'Obrigada!')),false);
  assert.equal(hasPrayerSupport(await prayerChat(f.client(),'Como posso contribuir?')),true);
  assert.deepEqual(f.db.prepare('PRAGMA table_info(site_assistant_prayer_support)').all().map(row=>row.name),['session_id','helped_ms','invited_ms','declined_ms','expires_ms']);
  assert.equal(f.seen.calls.length,0);
});

test('new distress or a negative response is not treated as a moment to invite support',async t=>{
  const f=await fixture(t);await prayerChat(f.call,'Quero a oração');
  for(const message of ['Obrigada, mas ainda estou triste','Não me ajudou','Amém, estou com medo','Obrigada, como faço para compartilhar?'])assert.equal(hasPrayerSupport(await prayerChat(f.call,message)),false);
  assert.equal(f.db.prepare('SELECT invited_ms FROM site_assistant_prayer_support').get().invited_ms,null);
  assert.equal(f.seen.calls.length,0);
});

test('support preference records expire after 24 hours and page opening never extends them',async t=>{
  const f=await fixture(t);const before=Date.now();await prayerChat(f.call,'Não tenho dinheiro');
  const state=f.db.prepare('SELECT * FROM site_assistant_prayer_support').get();assert.ok(state.expires_ms>=before+86400000&&state.expires_ms<=Date.now()+86400000);
  await f.call('/api/site-assistant/context?path=/oracao-do-dia.html');assert.equal(f.db.prepare('SELECT expires_ms FROM site_assistant_prayer_support').get().expires_ms,state.expires_ms);
  f.db.prepare('UPDATE site_assistant_prayer_support SET expires_ms=?').run(Date.now()-1);
  assert.equal(hasPrayerSupport(await prayerChat(f.call,'Como posso apoiar?')),true);
});

test('consultative instructions use declared needs, respect budget and preserve the existing AI budget',async t=>{
  const f=await fixture(t);await f.chat('Quero uma forma para bolo');await f.chat('Está muito caro, tem uma opção mais barata?');
  const request=f.seen.calls.at(-1),input=JSON.parse(request.input[0].content);
  assert.equal(request.max_output_tokens,400);assert.equal(request.store,false);assert.ok(input.history.some(row=>row.content==='Quero uma forma para bolo'));
  for(const rule of ['identifique a necessidade declarada no histórico','sem repetir algo já respondido','reconheça a preocupação sem discutir','Respeite o orçamento declarado','sem sugerir endividamento','depoimentos, garantias','Não afirme ter décadas de experiência'])assert.ok(request.instructions.includes(rule));
  const prior=f.seen.calls.length,r=await f.chat('Não quero comprar, só olhando');assert.equal(f.seen.calls.length,prior);assert.deepEqual(r.body.offers,[]);assert.equal(r.body.discountOffer,null);
});
test('only injected ready courses enter the catalog',async t=>{
  const f=await fixture(t,{courses:[{slug:'cozinha-basica',title:'Cozinha básica',available:true},{slug:'cozinha-incompleta',title:'Cozinha incompleta',available:false}]});
  const r=await f.call('/api/site-assistant/context?path='+page);assert.ok(r.body.offers.some(o=>o.id==='course:cozinha-basica'));assert.ok(!r.body.offers.some(o=>o.id==='course:cozinha-incompleta'));
});
test('course signup, login and payment help stay in the exact course checkout without an AI call',async t=>{
  const slug='vendas-pelo-whatsapp',courses=[{slug,title:'Vendas pelo WhatsApp',description:'Aulas em texto.',priceCents:2399,available:true}];
  const f=await fixture(t,{courses});
  for(const [message,expected] of [['Como criar conta?',/Sou novo por aqui/],['Como pago?',/Mercado Pago/],['Já tenho conta',/Já tenho conta/],['Como comprar o curso de WhatsApp?',/resumo e o preço/],['Qual o valor?',/resumo e o preço/]]){
    const r=await f.call('/api/site-assistant/chat',{method:'POST',body:{message,contextPath:'/cursos/'+slug}});
    assert.equal(r.status,200);assert.equal(r.body.mode,'fallback');assert.match(r.body.reply,expected);
    assert.deepEqual(r.body.actions,[{label:'Ver resumo e pagamento do curso',url:'/course-checkout.html?curso='+slug,kind:'internal',assetType:'course',assetId:slug}]);
    assert.deepEqual(r.body.offers,[]);assert.equal(r.body.contactOffer,null);
    assert.doesNotMatch(JSON.stringify(r.body),/entrar-cidade|detalhes do produto|R\$|pagamento recebido/);
  }
  assert.equal(f.seen.calls.length,0);
  const restored=await f.call('/api/site-assistant/context?path=/cursos/'+slug);assert.equal(restored.body.history.length,8);assert.match(restored.body.history.at(-1).content,/resumo e o preço/);
  assert.ok(f.seen.offers.some(row=>row.offers.some(item=>item.assetType==='course'&&item.assetId===slug)));
});
test('a claimed course payment points to the real access page without claiming confirmation',async t=>{
  const f=await fixture(t,{courses:[{slug:'cozinha-basica',title:'Cozinha básica',available:true}]});
  const r=await f.call('/api/site-assistant/chat',{method:'POST',body:{message:'Já paguei, e agora?',contextPath:'/cursos/cozinha-basica'}});
  assert.equal(r.status,200);assert.equal(r.body.actions[0].url,'/meus-cursos.html');assert.match(r.body.reply,/não consigo confirmar/);assert.equal(f.seen.calls.length,0);assert.deepEqual(r.body.offers,[]);
});
test('course guidance for follow-up AI uses the checkout flow without exposing fields or changing limits',async t=>{
  const f=await fixture(t,{courses:[{slug:'cozinha-basica',title:'Cozinha básica',available:true}],request:()=>response('Posso explicar essa etapa sem pedir seus dados.',[])});
  await f.call('/api/site-assistant/chat',{method:'POST',body:{message:'Como criar conta?',contextPath:'/cursos/cozinha-basica'}});
  await f.call('/api/site-assistant/chat',{method:'POST',body:{message:'Pode explicar essa etapa melhor?',contextPath:'/cursos/cozinha-basica'}});
  assert.equal(f.seen.calls.length,1);assert.match(f.seen.calls[0].instructions,/não mande sair para o cadastro geral/);assert.match(f.seen.calls[0].instructions,/nem peça nome, e-mail ou senha/);assert.equal(f.seen.calls[0].store,false);assert.equal(f.seen.calls[0].max_output_tokens,400);
  const history=JSON.parse(f.seen.calls[0].input[0].content).history;assert.equal(history.length,2);assert.match(history[1].content,/Sou novo por aqui/);
});

test('a platform question escapes the open course and describes only public sections with diverse cards',async t=>{
  const f=await fixture(t,{courses:[{slug:'cozinha-basica',title:'Cozinha básica',available:true},{slug:'oculto',title:'Curso privado',available:false}],services:[{slug:'site-profissional',title:'Site profissional',description:'Criação de site.',available:true}]});
  f.db.prepare("INSERT INTO store_profiles VALUES('official_agrotecnica','Agrotécnica','Produtos para plantas','published')").run();
  for(const contextPath of ['/cursos/cozinha-basica','/centro-educacional.html']){
    const r=await f.call('/api/site-assistant/chat',{method:'POST',body:{message:'O que tem na VitrineCity?',contextPath}});
    assert.equal(r.status,200);assert.equal(r.body.mode,'fallback');
    for(const phrase of ['cidade virtual','Agrotécnica','afiliado','cursos digitais','receitas publicadas','oração do dia','serviços digitais','VitrineSocial'])assert.ok(r.body.reply.includes(phrase),phrase);
    assert.match(r.body.reply,/sem escolher uma loja antes/);
    assert.deepEqual(r.body.offers.map(o=>o.assetType),['product','affiliate','course']);
    assert.deepEqual(r.body.actions.map(a=>a.url),['/multiverso','/receitas','/oracao-do-dia.html']);
    assert.doesNotMatch(JSON.stringify(r.body),/Curso privado|Panela indisponível|Panela privada|mixer-unknown|entrar-cidade|course-checkout/);
    assert.ok(r.body.reply.length<=600);assert.equal(r.body.contactOffer,null);
  }
  assert.equal(f.seen.calls.length,0);
  assert.ok(f.seen.offers.some(entry=>entry.offers.some(o=>o.assetType==='navigation'&&o.assetId==='city')));
});

test('natural overview phrasings never fall into current-course purchase guidance',async t=>{
  const f=await fixture(t,{courses:[{slug:'cozinha-basica',title:'Cozinha básica',available:true}]});
  for(const message of ['O que a VitrineCity oferece?','O que posso comprar no site?','Tem só cursos ou algo além na VitrineCity?','Quero conhecer a plataforma inteira','O que tem por aqui?']){
    const r=await f.call('/api/site-assistant/chat',{method:'POST',body:{message,contextPath:'/cursos/cozinha-basica'}});
    assert.equal(r.status,200);assert.match(r.body.reply,/cidade virtual/);assert.doesNotMatch(r.body.reply,/resumo deste curso|Mercado Pago/);
  }
  assert.equal(f.seen.calls.length,0);
});

test('overview immediately stops claiming sections whose last eligible content disappears',async t=>{
  const f=await fixture(t);
  f.db.exec("UPDATE store_products SET stock_quantity=0; UPDATE affiliate_catalog SET health='unchecked'; UPDATE editorial_articles SET status='draft';");
  const r=await f.call('/api/site-assistant/chat',{method:'POST',body:{message:'O que tem na VitrineCity?',contextPath:'/'}});
  assert.equal(r.status,200);assert.deepEqual(r.body.offers,[]);
  assert.deepEqual(r.body.actions.map(a=>a.url),['/multiverso','/oracao-do-dia.html']);
  assert.doesNotMatch(r.body.reply,/cursos digitais|receitas publicadas|serviços digitais|ofertas de parceiros|produtos de lojas/);
  assert.equal(f.seen.calls.length,0);
});

test('an explicit plant need overrides both a course catalog and a particular cooking course',async t=>{
  const f=await fixture(t,{courses:[{slug:'cozinha-basica',title:'Cozinha básica',description:'Curso de cozinha.',available:true}],request:body=>response('Posso explicar as informações deste produto.',JSON.parse(body.input[0].content).candidateOffers.map(o=>o.id))});
  for(const contextPath of ['/centro-educacional.html','/cursos/cozinha-basica']){
    const r=await f.call('/api/site-assistant/chat',{method:'POST',body:{message:'Quero comprar adubo para plantas',contextPath}});
    assert.equal(r.status,200);assert.equal(r.body.mode,'ai');assert.deepEqual(r.body.offers.map(o=>o.id),['product:2']);assert.deepEqual(r.body.actions,[]);
    const input=JSON.parse(f.seen.calls.at(-1).input[0].content);assert.equal(input.requestedScope,'plants');assert.match(f.seen.calls.at(-1).instructions,/página atual é contexto, não um limite/);
    assert.doesNotMatch(f.seen.calls.at(-1).instructions,/Neste curso, Comprar/);
    assert.doesNotMatch(r.body.reply,/curso|Mercado Pago/);
  }
  assert.equal(f.seen.calls.length,2);
  const targeted=await f.call('/api/site-assistant/chat',{method:'POST',body:{message:'Quero conhecer adubos na VitrineCity',contextPath:'/cursos/cozinha-basica'}});
  assert.deepEqual(targeted.body.offers.map(o=>o.id),['product:2']);assert.equal(targeted.body.mode,'ai');assert.doesNotMatch(targeted.body.reply,/cidade virtual/);
});

test('explicit services and partner offers override the open course using server catalog URLs',async t=>{
  const f=await fixture(t,{courses:[{slug:'cozinha-basica',title:'Cozinha básica',available:true}],services:[{slug:'site-profissional',title:'Site profissional',available:true,url:'https://evil.test',checkoutUrl:'https://evil.test'}],request:body=>response('Posso explicar estas opções.',JSON.parse(body.input[0].content).candidateOffers.map(o=>o.id))});
  for(const [message,id,url] of [['Quais serviços vocês têm?','service:site-profissional','/servicos-digitais.html?servico=site-profissional'],['Quero ofertas de parceiros','affiliate:mixer-real','/ofertas/mixer-real']]){
    const r=await f.call('/api/site-assistant/chat',{method:'POST',body:{message,contextPath:'/cursos/cozinha-basica'}});
    assert.equal(r.status,200);assert.equal(r.body.offers[0].id,id);assert.equal(r.body.offers[0].url,url);assert.doesNotMatch(JSON.stringify(r.body),/evil\.test/);
  }
});

test('specific course references preserve the current course and existing conversation',async t=>{
  const f=await fixture(t,{courses:[{slug:'cozinha-basica',title:'Cozinha básica',available:true},{slug:'cozinha-avancada',title:'Cozinha avançada',available:true}],request:body=>response('Posso explicar este conteúdo.',JSON.parse(body.input[0].content).candidateOffers.map(o=>o.id))});
  await f.call('/api/site-assistant/chat',{method:'POST',body:{message:'O que tem na VitrineCity?',contextPath:'/cursos/cozinha-basica'}});
  const r=await f.call('/api/site-assistant/chat',{method:'POST',body:{message:'Como é esse curso?',contextPath:'/cursos/cozinha-basica'}});
  assert.deepEqual(r.body.offers.map(o=>o.id),['course:cozinha-basica']);
  assert.equal(r.body.offers[0].url,'/cursos/cozinha-basica');
  const input=JSON.parse(f.seen.calls[0].input[0].content);assert.equal(input.history.length,2);assert.equal(input.page.title,'Cozinha básica');assert.equal(input.requestedScope,'course');
});

test('published editorial portals appear in the platform overview and specific requests leave the course scope',async t=>{
  const f=await fixture(t,{courses:[{slug:'cozinha-basica',title:'Cozinha básica',available:true}],services:[{slug:'site-profissional',title:'Site profissional',available:true}]});
  const portals={esportes:'esportes',noticias:'notícias',curiosidades:'curiosidades',tecnologia:'tecnologia','plantas-e-jardinagem':'plantas e jardinagem','inteligencia-artificial':'inteligência artificial'};
  const add=f.db.prepare('INSERT INTO editorial_articles VALUES(?,?,?,?,?,?,?,?)');
  for(const [portal,label] of Object.entries(portals))add.run(portal,portal,'Conteúdo de '+label,'','Texto público de teste.',portal,'2026-09-11','published');
  add.run('unmapped','unmapped','Não publicar','','Fonte interna','privado','2026-09-11','published');
  const overview=await f.call('/api/site-assistant/chat',{method:'POST',body:{message:'O que tem na VitrineCity?',contextPath:'/cursos/cozinha-basica'}});
  assert.ok(overview.body.reply.length<=600);for(const label of Object.values(portals))assert.ok(overview.body.reply.includes(label),label);assert.doesNotMatch(overview.body.reply,/privado|Não publicar/);
  for(const [portal,label] of Object.entries(portals)){
    const message=portal==='plantas-e-jardinagem'?'Quero conteúdos de plantas e jardinagem':'Quero ver '+label;
    const r=await f.call('/api/site-assistant/chat',{method:'POST',body:{message,contextPath:'/cursos/cozinha-basica'}});
    assert.equal(r.status,200);assert.equal(r.body.actions[0].url,'/'+portal);assert.deepEqual(r.body.offers,[]);assert.match(r.body.reply,/conteúdos publicados/);
  }
  f.db.prepare("UPDATE editorial_articles SET status='draft' WHERE portal='esportes'").run();
  const unpublished=await f.call('/api/site-assistant/chat',{method:'POST',body:{message:'Quero esportes',contextPath:'/cursos/cozinha-basica'}});
  assert.deepEqual(unpublished.body.actions,[]);assert.match(unpublished.body.reply,/Ainda não encontrei/);assert.equal(f.seen.calls.length,0);
});

test('social discovery provides only the existing explicit social link without posting or requiring signup',async t=>{
  const f=await fixture(t),r=await f.chat('Quero conhecer a rede social');
  assert.equal(r.body.actions[0].url,'/social');assert.equal(r.body.actions[0].assetId,'social');assert.deepEqual(r.body.offers,[]);assert.equal(r.body.contactOffer,null);assert.equal(f.seen.calls.length,0);
});

test('store discovery lists only published shops and entertainment stays with actual platform destinations',async t=>{
  const f=await fixture(t,{courses:[{slug:'cozinha-basica',title:'Cozinha básica',available:true}]});
  const shops=await f.call('/api/site-assistant/chat',{method:'POST',body:{message:'Quero conhecer as lojas da plataforma',contextPath:'/cursos/cozinha-basica'}});
  assert.deepEqual(shops.body.actions.map(a=>a.url),['/loja/official/loja-oficial']);
  assert.deepEqual(shops.body.offers,[]);assert.doesNotMatch(JSON.stringify(shops.body),/Loja privada/);
  const leisure=await f.chat('Quero entretenimento, o que posso fazer?');
  assert.deepEqual(leisure.body.actions.map(a=>a.url),['/multiverso','/social']);assert.deepEqual(leisure.body.offers,[]);
  assert.doesNotMatch(leisure.body.reply,/jogos|cinema|prêmios|conteúdos publicados/);
  f.db.prepare('INSERT INTO editorial_articles VALUES(?,?,?,?,?,?,?,?)').run('leisure','leitura','Leitura no fim de semana','','Conteúdo público.','entretenimento','2026-09-11','published');
  const published=await f.chat('Quero sugestões de diversão');
  assert.equal(published.body.actions[0].url,'/entretenimento');assert.match(published.body.reply,/conteúdos publicados de entretenimento/);
  f.db.prepare("UPDATE editorial_articles SET status='draft' WHERE id='leisure'").run();
  const removed=await f.chat('Quero entretenimento');assert.ok(removed.body.actions.every(a=>a.url!=='/entretenimento'));
  f.db.exec("CREATE TABLE digital_books(id TEXT,slug TEXT,status TEXT); INSERT INTO digital_books VALUES('book','livro-publico','published')");
  const books=await f.chat('Quero ver os livros');assert.equal(books.body.actions[0].url,'/livros');
  f.db.prepare("UPDATE digital_books SET status='review'").run();
  const privateBook=await f.chat('Quero livros');assert.deepEqual(privateBook.body.actions,[]);
  assert.equal(f.seen.calls.length,0);
});

test('LIA5 is a server-confirmed benefit for own purchases after a real interaction, never a welcome or affiliate claim',async t=>{
  const f=await fixture(t,{realExperience:true,courses:[{slug:'cozinha-basica',title:'Cozinha básica',available:true}]});
  const welcome=await f.call('/api/site-assistant/context?path=/cursos/cozinha-basica');assert.equal(welcome.body.discountOffer,undefined);
  const course=await f.call('/api/site-assistant/chat',{method:'POST',body:{message:'Como comprar esse curso?',contextPath:'/cursos/cozinha-basica'}});
  assert.equal(course.body.discountOffer.code,'LIA5');assert.equal(course.body.discountOffer.percent,5);assert.match(course.body.discountOffer.description,/Não inclui frete/);
  const unrelated=await f.chat('Quero ofertas de parceiros');assert.equal(unrelated.body.discountOffer,null);
  const otherStore=await f.chat('Quero uma forma para bolo');assert.equal(otherStore.body.discountOffer,null);
  f.db.prepare("INSERT INTO store_profiles VALUES('official_agrotecnica','Agrotecnica','Plantas','published')").run();
  f.db.prepare("UPDATE store_products SET store_reference='official_agrotecnica' WHERE id=1").run();
  const own=await f.chat('Quero uma forma para bolo');assert.equal(own.body.discountOffer.code,'LIA5');
  f.db.exec("ALTER TABLE store_products ADD COLUMN product_url TEXT DEFAULT ''; UPDATE store_products SET product_url='https://partner.test/item' WHERE id=1");
  const external=await f.chat('Quero uma forma para bolo');assert.equal(external.body.discountOffer,null);
  const refused=await f.chat('Não quero ofertas');assert.equal(refused.body.discountOffer,null);
  const prayer=await f.call('/api/site-assistant/chat',{method:'POST',body:{message:'Quero uma oração',contextPath:'/oracao-do-dia.html'}});assert.equal(prayer.body.discountOffer,null);
});

test('buying this course for a shop keeps the exact course checkout identity',async t=>{
  const f=await fixture(t,{courses:[{slug:'vendas-para-lojas',title:'Vendas para lojas',available:true}]}),r=await f.call('/api/site-assistant/chat',{method:'POST',body:{message:'Quero comprar esse curso para loja',contextPath:'/cursos/vendas-para-lojas'}});
  assert.equal(r.body.actions[0].url,'/course-checkout.html?curso=vendas-para-lojas');assert.match(r.body.reply,/resumo e o preço deste curso/);assert.equal(f.seen.calls.length,0);
});

test('broad discovery respects an explicit refusal and keeps prayer pages free of product cards',async t=>{
  const f=await fixture(t);
  const refused=await f.chat('Não quero ofertas, só estou olhando o que tem na VitrineCity');
  assert.deepEqual(refused.body.offers,[]);assert.deepEqual(refused.body.actions,[]);assert.match(refused.body.reply,/fique à vontade/);
  const prayer=await f.call('/api/site-assistant/chat',{method:'POST',body:{message:'O que tem na VitrineCity?',contextPath:'/oracao-do-dia.html'}});
  assert.deepEqual(prayer.body.offers,[]);assert.equal(prayer.body.contactOffer,null);assert.equal(f.seen.calls.length,0);
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
  const url='https://chat.whatsapp.com/ABCDEFGHIJKLMNOPQRSTUV',sent=[],f=await fixture(t,{realExperience:true,groups:[{id:'news-01',topic:'news',title:'Notícias',url,enabled:true}],sendWhatsApp:async payload=>{assert.equal(payload.beforeSubmit(),true);sent.push(payload);return {providerMessageId:'REAL-FIXTURE-RECEIPT'};}});
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
async function followupFixture(t,options={}){
  const f=await fixture(t,{...options,realExperience:true});await f.chat('Quero uma forma para bolo');
  const saveConsent=()=>f.call('/api/site-assistant/contact',{method:'POST',body:{phone:'62999999999',purpose:'offers',contextPath:page,consent:true}});
  assert.equal((await saveConsent()).status,201);
  const due=()=>f.db.prepare('UPDATE site_assistant_contacts SET next_followup_at=?').run(Date.now()-1);due();
  return {...f,due,saveConsent,row:()=>f.db.prepare('SELECT * FROM site_assistant_contacts').get()};
}
const rejectedBeforeSend=()=>Object.assign(Error('not dispatched'),{notSubmitted:true});

test('follow-up pause or missing configuration leaves the contact pending without consuming attempts',async t=>{
  let allowed=false,calls=0;
  const f=await followupFixture(t,{canSendFollowups:()=>allowed,sendWhatsApp:async p=>{assert.equal(p.beforeSubmit(),true);calls++;return {providerMessageId:'fixture-receipt'};}});
  for(let i=0;i<4;i++)assert.equal((await f.handler.processFollowups()).status,'paused');
  assert.equal(calls,0);assert.equal(f.row().followup_attempts,0);assert.equal(f.row().followup_status,'pending');assert.equal(f.row().followup_claim_id,'');
  allowed=true;assert.equal((await f.handler.processFollowups()).sent,1);assert.equal(calls,1);assert.equal(f.row().followup_attempts,1);
});
test('a pause at the dispatch boundary preserves attempts and the idempotency key when resumed',async t=>{
  let allowed=true,pauseOnce=true;const keys=[];
  const f=await followupFixture(t,{canSendFollowups:()=>allowed,sendWhatsApp:async p=>{
    keys.push(p.idempotencyKey);if(pauseOnce){pauseOnce=false;allowed=false;}
    if(!p.beforeSubmit())throw rejectedBeforeSend();return {providerMessageId:'receipt-after-resume'};
  }});
  await f.handler.processFollowups();assert.equal(f.row().followup_status,'pending');assert.equal(f.row().followup_attempts,0);
  allowed=true;assert.equal((await f.handler.processFollowups()).sent,1);assert.equal(keys[0],keys[1]);assert.doesNotMatch(keys[0],/62999999999/);
  const oldConsent=f.row().consented_at;assert.equal((await f.saveConsent()).status,201);assert.ok(f.row().consented_at>oldConsent);f.due();
  await f.handler.processFollowups();assert.notEqual(keys[2],keys[1]);assert.equal(f.row().followup_attempts,1);
});
test('revocation between claim and dispatch prevents the request and consumes no attempt',async t=>{
  let f,dispatched=0;f=await followupFixture(t,{sendWhatsApp:async p=>{
    assert.equal(f.handler.revokePhone('62999999999'),true);if(!p.beforeSubmit())throw rejectedBeforeSend();dispatched++;return {providerMessageId:'must-not-be-sent'};
  }});
  await f.handler.processFollowups();assert.equal(dispatched,0);assert.ok(f.row().revoked_at);assert.equal(f.row().followup_status,'cancelled');assert.equal(f.row().followup_attempts,0);
  await f.handler.processFollowups();assert.equal(dispatched,0);
});
test('missing or invalid receipt and unexpected provider errors become uncertain without automatic resend',async t=>{
  for(const result of [undefined,{},true,{providerMessageId:'undefined'},{providerMessageId:123},'throw'])await t.test(String(result),async t=>{
    let calls=0;const f=await followupFixture(t,{sendWhatsApp:async p=>{assert.equal(p.beforeSubmit(),true);calls++;if(result==='throw')throw Error('private provider detail');return result;}});
    const first=await f.handler.processFollowups();assert.equal(first.sent,0);assert.equal(first.failed,1);assert.equal(f.row().followup_status,'uncertain');assert.equal(f.row().followup_error,'confirmation_unknown');
    for(let i=0;i<4;i++){f.due();await f.handler.processFollowups();}assert.equal(calls,1);assert.equal(f.row().followup_attempts,1);assert.equal(f.row().followup_sent_at,null);
  });
});
test('an adapter result without the dispatch guard cannot claim a successful send',async t=>{
  const f=await followupFixture(t,{sendWhatsApp:async()=>({providerMessageId:'unverified-adapter-receipt'})});
  assert.equal((await f.handler.processFollowups()).sent,0);assert.equal(f.row().followup_status,'uncertain');assert.equal(f.row().followup_attempts,0);
});
test('a documented pre-submission failure is held for review without treating it as a send',async t=>{
  let calls=0;const f=await followupFixture(t,{sendWhatsApp:async p=>{assert.equal(p.beforeSubmit(),true);calls++;throw rejectedBeforeSend();}});
  await f.handler.processFollowups();assert.equal(f.row().followup_status,'failed');assert.equal(f.row().followup_error,'not_submitted');assert.equal(f.row().followup_attempts,0);
  f.due();await f.handler.processFollowups();assert.equal(calls,1);
});
test('concurrent polling cannot duplicate a submission and a receipt after revocation preserves cancellation',async t=>{
  const gate=deferred();let calls=0;const f=await followupFixture(t,{sendWhatsApp:async p=>{assert.equal(p.beforeSubmit(),true);calls++;return gate.promise;}});
  const pending=f.handler.processFollowups();assert.equal(calls,1);assert.equal((await f.handler.processFollowups()).status,'running');
  const revoked=await f.call('/api/site-assistant/contact/revoke',{method:'POST',body:{}});assert.equal(revoked.status,200);const revokedAt=f.row().revoked_at;
  gate.resolve({providerMessageId:'late-valid-receipt'});assert.equal((await pending).sent,1);
  assert.equal(f.row().followup_status,'cancelled');assert.equal(f.row().revoked_at,revokedAt);assert.equal(f.row().followup_provider_message_id,'late-valid-receipt');assert.ok(f.row().followup_sent_at);
  f.due();await f.handler.processFollowups();assert.equal(calls,1);
});
test('an old accepted response cannot overwrite a new explicit consent or its pending follow-up',async t=>{
  const gate=deferred();const f=await followupFixture(t,{sendWhatsApp:async p=>{assert.equal(p.beforeSubmit(),true);return gate.promise;}});
  const pending=f.handler.processFollowups(),old=f.row();assert.equal((await f.saveConsent()).status,201);const renewed=f.row();
  assert.ok(renewed.consented_at>old.consented_at);gate.resolve({providerMessageId:'old-consent-receipt'});await pending;
  assert.equal(f.row().consented_at,renewed.consented_at);assert.equal(f.row().followup_status,'pending');assert.equal(f.row().followup_attempts,0);assert.equal(f.row().followup_provider_message_id,'');
});
test('an abandoned sending claim becomes uncertain during pause and is not automatically retried',async t=>{
  let allowed=false,calls=0;const f=await followupFixture(t,{canSendFollowups:()=>allowed,sendWhatsApp:async()=>{calls++;}});
  f.db.prepare("UPDATE site_assistant_contacts SET followup_status='sending',followup_attempts=1,followup_claim_id='abandoned',followup_claimed_at=?").run(Date.now()-120001);
  assert.equal((await f.handler.processFollowups()).status,'paused');assert.equal(f.row().followup_status,'uncertain');assert.equal(f.row().followup_attempts,1);
  allowed=true;f.due();await f.handler.processFollowups();assert.equal(calls,0);
});
test('legacy pending retries with an ambiguous prior attempt migrate to uncertain without losing evidence',async t=>{
  const f=await followupFixture(t);f.handler.close();
  for(const name of ['followup_claim_id','followup_claimed_at','followup_provider_message_id'])f.db.exec(`ALTER TABLE site_assistant_contacts DROP COLUMN ${name}`);
  f.db.prepare("UPDATE site_assistant_contacts SET followup_attempts=1,followup_error='legacy_timeout'").run();
  const restart=setupSiteSalesAssistant({app:express(),db:f.db,publicOrigin:origin,salesExperience:{session:()=>null},canSendFollowups:()=>false});t.after(()=>restart.close());
  assert.equal(f.row().followup_status,'uncertain');assert.equal(f.row().followup_attempts,1);assert.equal(f.row().followup_error,'legacy_timeout');assert.equal(f.row().next_followup_at,0);
});
test('production follow-up adapter checks pause and maps only existing WhatsApp receipt fields',async()=>{
  const server=readFileSync(new URL('../server.js',import.meta.url),'utf8');
  const start=server.indexOf('  canSendFollowups:',server.indexOf('const siteSalesAssistant =')),end=server.indexOf('  requestOpenAI:',start);
  assert.ok(start>0&&end>start);let allowed=true,configured=true,calls=0,payload={data:{Id:'REAL-PROVIDER-ID'}};
  const adapter=vm.runInNewContext('({'+server.slice(start,end)+'})',{ecosystemCanRun:()=>allowed,whatsappQrConfig:()=>({configured}),validWhatsAppReceiptId,
    whatsappQrData:value=>{let data=value?.data??value;if(typeof data==='string'){try{data=JSON.parse(data);}catch{return {};}}return data&&typeof data==='object'?data:{};},
    whatsappQrRequest:async(path,options)=>{calls++;assert.equal(path,'/chat/send/text');assert.equal(JSON.parse(options.body).Id,'LIA-STABLE');return payload;}});
  const send=beforeSubmit=>adapter.sendWhatsApp({phone:'5562999999999',message:'Fixture',idempotencyKey:'LIA-STABLE',beforeSubmit});
  assert.equal((await send(()=>true)).providerMessageId,'REAL-PROVIDER-ID');
  payload={data:JSON.stringify({id:'LOWERCASE-ID'})};assert.equal((await send(()=>true)).providerMessageId,'LOWERCASE-ID');
  payload={data:{success:true}};assert.equal((await send(()=>true)).providerMessageId,undefined);
  const before=calls;allowed=false;assert.equal(adapter.canSendFollowups(),false);await assert.rejects(send(()=>true),e=>e.notSubmitted===true);
  allowed=true;configured=false;await assert.rejects(send(()=>true),e=>e.notSubmitted===true);configured=true;await assert.rejects(send(()=>false),e=>e.notSubmitted===true);assert.equal(calls,before);
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
