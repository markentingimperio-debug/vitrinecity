import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import express from 'express';
import { setupCustomerRetention, normalizeRetentionInput, parseRetentionCsv, retentionPhone, retentionEmail } from '../customer-retention.js';
import { setupCampaignPreferences } from '../campaign-preferences.js';
const source={platform:'shopee',store:'Loja Fictícia',order_id:'TEST-001',buyer_id:'DEMO-01',name:'Cliente de teste',ordered_at:'2026-08-01',total:'35,90',status:'Pago',phone:'******17',email:'',postal_code:'01001000',city:'São Paulo',state:'São Paulo',product:'Adubo de teste',sku:'DEMO-SKU',quantity:1};
async function fixture(t,{mailer=true}={}){
  const db=new Database(':memory:');db.pragma('foreign_keys=ON');
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,email TEXT,whatsapp TEXT,account_status TEXT);INSERT INTO users VALUES(1,'Admin','admin@example.test','','active'),(2,'Cliente','cliente@example.test','11999999999','active'),(3,'Outra pessoa','outra@example.test','','active');
    CREATE TABLE store_profiles(order_reference TEXT PRIMARY KEY,business_name TEXT);INSERT INTO store_profiles VALUES('agro','Loja de teste'),('other','Outra loja');
    CREATE TABLE consent_records(id INTEGER PRIMARY KEY,subject_user_id INTEGER,purpose TEXT,granted INTEGER,evidence_json TEXT);CREATE TABLE leads(email TEXT,consent INTEGER);`);
  const app=express();app.use(express.json({limit:'5mb'}));const mails=[],limits={allow:true};
  const user=(req,res,next)=>{req.user=db.prepare('SELECT * FROM users WHERE id=?').get(Number(req.headers['x-user']||0));return req.user?next():res.status(401).json({error:'login'});};
  const admin=(req,res,next)=>user(req,res,()=>req.user.id===1?next():res.status(403).json({error:'admin'}));
  const origin=(req,res,next)=>req.headers.origin==='https://vitrinecity.test'?next():res.status(403).json({error:'origin'});
  const recordConsent=(_req,{userId,purpose,granted,evidence})=>db.prepare('INSERT INTO consent_records(subject_user_id,purpose,granted,evidence_json) VALUES(?,?,?,?)').run(userId,purpose,granted?1:0,JSON.stringify(evidence));
  const preferences=setupCampaignPreferences(app,{db,requireUser:user,sameOriginOnly:origin,recordConsent});
  const service=setupCustomerRetention({app,db,requireAdmin:admin,requireUser:user,sameOriginOnly:origin,publicDir:new URL('../public',import.meta.url).pathname,siteUrl:'https://vitrinecity.test',campaignPreferences:preferences,sendVerification:mailer?async m=>mails.push(m):null,signingSecret:()=> 'test-secret-32-characters-long-12345',allowAttempt:()=>limits.allow});
  app.use((error,req,res,next)=>res.status(500).json({error:error.message}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
  const call=async(url,body,{id=1,method,originValue='https://vitrinecity.test'}={})=>{const r=await fetch(`http://127.0.0.1:${server.address().port}${url}`,{method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json','x-user':String(id),origin:originValue},...(body?{body:JSON.stringify(body)}:{})});const text=await r.text();return{status:r.status,data:r.headers.get('content-type')?.includes('json')?JSON.parse(text):text,headers:r.headers};};
  const preview=(rows=[source],target='agro')=>call('/api/admin/recompra/preview',{storeReference:target,content:JSON.stringify(rows),fileName:'ficticios.json'});
  const importRows=async(rows=[source],target='agro')=>{const p=await preview(rows,target);assert.equal(p.status,200);assert.ok(p.data.id,JSON.stringify(p.data.errors));return call(`/api/admin/recompra/imports/${p.data.id}/confirm`,{confirmed:true});};
  const claim=()=>call('/api/recompra/claim',{storeReference:'agro',platform:'shopee',orderId:'TEST-001',postal:'01001-000'},{id:2});
  const opt=values=>call('/api/recompra/preferences',{storeReference:'agro',email:true,whatsapp:false,...values},{id:2});
  const confirm=()=>call('/api/recompra/confirm',{token:mails.at(-1).text.match(/confirmar#([\w-]+)/)[1]},{id:2});
  const audience=()=>call('/api/admin/recompra/audience',{filters:{storeReference:'agro',days:0},channel:'email'});
  return{db,call,preview,importRows,claim,opt,confirm,audience,mails,limits,service};
}
test('normalização mantém máscaras como indisponíveis e não inventa e-mails',()=>{
 assert.deepEqual(retentionPhone('******17'),{value:'',status:'masked'});assert.equal(retentionPhone('(11) 99999-9999').value,'5511999999999');assert.equal(retentionPhone('1.1999999999E+10').status,'invalid');assert.equal(retentionEmail('x***@example.test').status,'masked');assert.equal(retentionEmail(' Cliente@EXAMPLE.TEST ').value,'cliente@example.test');
 const d=normalizeRetentionInput(JSON.stringify([source,{...source,sku:'OUTRO',product:'Outro produto'},source]));assert.equal(d.orders.length,1);assert.equal(d.orders[0].items.length,2);assert.equal(d.orders[0].totalCents,3590);assert.equal(d.summary.repeatedLines,1);assert.equal(d.summary.withPhone,0);
});
test('CSV / TSV suportam português e valores multiline sem colisões silenciosas',()=>{
 assert.equal(parseRetentionCsv('nome;texto\nAna;"linha 1\nlinha 2"')[0].texto,'linha 1\nlinha 2');assert.equal(parseRetentionCsv('nome\tvalor\nAna\t10')[0].valor,'10');assert.throws(()=>parseRetentionCsv('nome;nome\nAna;Bia'),/repetida/);assert.throws(()=>parseRetentionCsv('nome;valor\nAna;"'),/fechadas/);
 const csv='Plataformas;Nome da Loja no UpSeller;Nº de Pedido da Plataforma;ID do Comprador;Nome de Comprador;Hora do Pedido;Valor do Pedido;Estado do Pedido\nShopee;Teste;T-1;C-1;Teste;01/08/2026 10:30;35,90;Pago';assert.equal(normalizeRetentionInput(csv).orders[0].totalCents,3590);
});
test('dados divergentes, datas impossíveis, valores e IDs danificados impedem importação',()=>{
 for(const change of [{ordered_at:'2026-02-30'},{total:'-10'},{buyer_id:'9.32342E+10'},{quantity:1.5},{status:{}}])assert.ok(normalizeRetentionInput(JSON.stringify([{...source,...change}])).errors.length);
 assert.ok(normalizeRetentionInput(JSON.stringify([source,{...source,total:'40'}])).errors.length);assert.throws(()=>normalizeRetentionInput('x'.repeat(3*1024*1024+1)),/3 MB/);
 for(const status of ['Cancelado','Reembolsado','Devolvido','Não pago','unpaid'])assert.equal(normalizeRetentionInput(JSON.stringify([{...source,status,paid_at:'2026-08-01'}])).orders[0].paid,false);
});
test('rotas privadas exigem administrador e mutações exigem a origem autorizada',async t=>{
 const f=await fixture(t);for(const id of [0,2])assert.equal((await f.call('/api/admin/recompra/overview',null,{id})).status,id?403:401);
 assert.equal((await f.call('/api/admin/recompra/preview',{content:'[]',storeReference:'agro'},{originValue:'https://evil.test'})).status,403);assert.equal((await f.call('/api/recompra/me',null,{id:0})).status,401);
 assert.match((await f.call('/api/admin/recompra/overview')).headers.get('cache-control'),/no-store/);
});
test('prévia não grava clientes; confirmação é atômica e repetível',async t=>{
 const f=await fixture(t),p=await f.preview([source,{...source,sku:'B'}]);assert.equal(f.db.prepare('SELECT count(*) n FROM retention_customers').get().n,0);
 const url=`/api/admin/recompra/imports/${p.data.id}/confirm`;assert.equal((await f.call(url,{confirmed:false})).status,400);const r=await f.call(url,{confirmed:true});assert.equal(r.data.summary.added,1);assert.equal((await f.call(url,{confirmed:true})).data.repeated,true);
 assert.equal(f.db.prepare('SELECT count(*) n,sum(total_cents) cents FROM retention_orders').get().cents,3590);assert.equal(f.db.prepare('SELECT rows_json FROM retention_imports').get().rows_json,'[]');assert.equal(f.db.prepare('SELECT count(*) n FROM retention_preferences').get().n,0);
 const again=await f.importRows([source,{...source,sku:'B'}]);assert.equal(again.data.summary.unchanged,1);assert.equal((await f.importRows([{...source,total:'42'}])).data.summary.updated,1);
});
test('não une homônimos nem origens de lojas diferentes; impede reassociação de loja',async t=>{
 const f=await fixture(t);await f.importRows([source,{...source,order_id:'T-2',buyer_id:'C-2'},{...source,order_id:'T-3',buyer_id:''},{...source,order_id:'T-4',buyer_id:''},{...source,store:'Outra origem'}]);assert.equal(f.db.prepare('SELECT count(*) n FROM retention_customers').get().n,5);
 const p=await f.preview([source],'other');assert.equal(p.data.id,null);assert.match(p.data.errors[0].message,/outra loja/);
});
test('contatos contraditórios são sinalizados e o cadastro anterior é preservado',async t=>{
 const f=await fixture(t),rows=[source,{...source,order_id:'T-2',email:'um@example.test',phone:''},{...source,order_id:'T-3',email:'dois@example.test',phone:''}];const preview=await f.preview(rows);assert.equal(preview.data.summary.withEmail,1);assert.equal(preview.data.summary.ambiguousContacts,1);await f.importRows(rows);const c=f.db.prepare('SELECT * FROM retention_customers').get();assert.equal(c.contact_conflict,1);assert.equal(c.email,'um@example.test');assert.equal(c.phone_status,'masked');
});
test('lote com qualquer erro não pode ser confirmado e prévia expira',async t=>{
 const f=await fixture(t);assert.equal((await f.preview([source,{...source,order_id:'T-2',ordered_at:'invalido'}])).data.id,null);
 const p=await f.preview();f.db.prepare('UPDATE retention_imports SET expires_at=0 WHERE id=?').run(p.data.id);assert.equal((await f.call(`/api/admin/recompra/imports/${p.data.id}/confirm`,{confirmed:true})).status,400);
});
test('vínculo exige compra paga, loja, identificador e CEP corretos, com limite de tentativas',async t=>{
 const f=await fixture(t);await f.importRows();assert.equal((await f.call('/api/recompra/claim',{storeReference:'agro',platform:'shopee',orderId:'TEST-001',postal:'99999999'},{id:2})).status,400);assert.equal((await f.claim()).status,200);
 assert.equal((await f.call('/api/recompra/claim',{storeReference:'agro',platform:'shopee',orderId:'TEST-001',postal:'01001000'},{id:3})).status,400);f.limits.allow=false;assert.equal((await f.claim()).status,429);
});
test('público só inclui compra vinculada, autorização e e-mail confirmado',async t=>{
 const f=await fixture(t);await f.importRows();assert.equal((await f.audience()).data.eligible,0);await f.claim();await f.opt();assert.equal(f.mails.length,1);assert.equal((await f.audience()).data.eligible,0);assert.equal((await f.confirm()).status,200);assert.equal((await f.audience()).data.eligible,1);assert.equal((await f.confirm()).status,400);
 f.db.prepare("UPDATE users SET email='trocado@example.test' WHERE id=2").run();assert.equal((await f.audience()).data.eligible,0);
});
test('sem SMTP, não há confirmação fictícia nem público habilitado',async t=>{
 const f=await fixture(t,{mailer:false});await f.importRows();await f.claim();assert.equal((await f.opt()).status,503);assert.equal((await f.audience()).data.eligible,0);
});

test('portabilidade inclui preferências e compras vinculadas somente da própria conta',async t=>{
 const f=await fixture(t);await f.importRows([{...source,email:'origem@example.test'}]);await f.claim();await f.opt();const exported=f.service.exportUser(2);assert.equal(exported.preferences[0].email,'cliente@example.test');assert.equal(exported.linkedPurchases[0].order_id,'TEST-001');assert.doesNotMatch(JSON.stringify(exported),/origem@example.test|01001000/);assert.deepEqual(f.service.exportUser(3),{preferences:[],linkedPurchases:[]});
});
test('descadastro assinado funciona sem login, é idempotente e invalida tokens pendentes',async t=>{
 const f=await fixture(t);await f.importRows();await f.claim();await f.opt();await f.confirm();const a=await f.audience(),token=a.data.items[0].unsubscribeUrl.split('#')[1];assert.equal((await f.call('/api/recompra/unsubscribe',{token:token+'x'},{id:0})).status,400);assert.equal((await f.call('/api/recompra/unsubscribe',{token},{id:0})).status,200);assert.equal((await f.audience()).data.eligible,0);assert.equal((await f.call('/api/recompra/unsubscribe',{token},{id:0})).status,200);
 await f.opt();const confirmation=f.mails.at(-1).text.match(/confirmar#([\w-]+)/)[1];await f.opt({email:false});assert.equal((await f.call('/api/recompra/confirm',{token:confirmation},{id:2})).status,400);
});
test('exportação reavalia opt-out global e não dispara mensagens de campanha',async t=>{
 const f=await fixture(t);await f.importRows();await f.claim();await f.opt();await f.confirm();const c=await f.call('/api/admin/recompra/campaigns',{name:'Rascunho',message:'Oferta de teste',channel:'email',filters:{storeReference:'agro',days:0}});assert.equal(c.data.state,'draft');const endpoint=`/api/admin/recompra/campaigns/${c.data.id}/export`;assert.match((await f.call(endpoint,{})).data,/cliente@example.test/);
 await f.call('/api/privacy/communications',{email:false,whatsapp:false},{id:2,method:'PUT'});assert.doesNotMatch((await f.call(endpoint,{})).data,/cliente@example.test/);assert.equal(f.mails.length,1);
});
test('supressão e cancelamento de compra removem elegibilidade sem apagar histórico',async t=>{
 const f=await fixture(t);await f.importRows();await f.claim();await f.opt();await f.confirm();await f.importRows([{...source,status:'Cancelado',paid_at:'2026-08-01'}]);assert.equal((await f.audience()).data.eligible,0);await f.importRows();assert.equal((await f.audience()).data.eligible,1);const c=f.db.prepare('SELECT id FROM retention_customers').get();await f.call(`/api/admin/recompra/customers/${c.id}/suppress`,{});assert.equal((await f.audience()).data.eligible,0);assert.equal(f.db.prepare('SELECT count(*) n FROM retention_orders').get().n,1);
});
test('WhatsApp fica bloqueado; relatório regional não expõe contatos nem endereços exatos',async t=>{
 const f=await fixture(t);await f.importRows([source,{...source,order_id:'T-2',buyer_id:'B-2',state:'SP'},{...source,order_id:'T-3',buyer_id:'B-3',state:'Paraná',city:'Curitiba'}]);const g=await f.call('/api/admin/recompra/geography?days=365');assert.equal(g.data.items[0].state,'SP');assert.equal(g.data.items[0].orders,2);assert.equal(g.data.items[0].revenueCents,7180);assert.doesNotMatch(JSON.stringify(g.data),/01001000|TEST-001|Cliente de teste/);
 const c=await f.call('/api/admin/recompra/campaigns',{name:'WhatsApp teste',message:'Fictício',channel:'whatsapp',filters:{storeReference:'agro'}});assert.equal((await f.call(`/api/admin/recompra/campaigns/${c.data.id}/export`,{})).status,409);
 const list=await f.call('/api/admin/recompra/customers?q=Cliente');assert.equal(list.data.total,3);assert.equal(list.data.items[0].address_json,undefined);
});
