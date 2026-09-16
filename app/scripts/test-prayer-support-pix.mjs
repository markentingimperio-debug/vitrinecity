import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import express from 'express';
import Database from 'better-sqlite3';
import {setupPrayerSupport,PRAYER_SUPPORT_AMOUNTS_CENTS} from '../prayer-support.js';

const SITE='https://vitrinecity.com',MP='https://api.mercadopago.com';
const QR='000201'+('1234567890'.repeat(12));
const PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=';
const config=()=>({enabled:true,beneficiary:'Agrotecnica',collectorId:'123456',accessToken:'FAKE-PIX-TOKEN',webhookSecret:'FAKE-PIX-SECRET'});
const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>structuredClone(data)});
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}

async function fixture(t){
  const db=new Database(':memory:');db.pragma('foreign_keys=ON');
  const app=express();app.use(express.json());
  let time=Date.parse('2026-09-12T12:00:00.000Z'),counter=1000;
  const calls=[],payments=new Map(),state={config:config(),accountId:'123456',allowed:true,onCreate:null,onRead:null,searchResults:null};
  const fetchImpl=async(url,options={})=>{
    calls.push({url,options});
    if(url==='https://api.mercadolibre.com/users/me')return response({id:state.accountId});
    if(url===MP+'/checkout/preferences')return response({id:'pref-'+(++counter),collector_id:state.accountId,init_point:'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=fixture'},201);
    if(url===MP+'/v1/payments'&&options.method==='POST'){
      const body=JSON.parse(options.body),payment={id:String(++counter),external_reference:body.external_reference,collector_id:'123456',currency_id:'BRL',
        transaction_amount:body.transaction_amount,transaction_amount_refunded:0,payment_method_id:'pix',live_mode:true,status:'pending',
        date_last_updated:new Date(time).toISOString(),date_of_expiration:body.date_of_expiration,
        point_of_interaction:{type:'PIX',transaction_data:{qr_code:QR,qr_code_base64:PNG,ticket_url:'https://www.mercadopago.com.br/payments/'+counter+'/ticket?hash=fixture'}}};
      payments.set(payment.id,payment);
      return state.onCreate?state.onCreate(payment,body,options):response(payment,201);
    }
    if(url.startsWith(MP+'/v1/payments/search?')){
      const reference=new URL(url).searchParams.get('external_reference');
      return response({results:state.searchResults??[...payments.values()].filter(p=>p.external_reference===reference)});
    }
    if(url.startsWith(MP+'/v1/payments/')){
      const id=url.slice((MP+'/v1/payments/').length),payment=payments.get(id);
      return state.onRead?state.onRead(id,payment):response(payment||{},payment?200:404);
    }
    throw Error('Unexpected provider call; all providers must be mocked: '+url);
  };
  const sameOriginOnly=(req,res,next)=>req.get('origin')===SITE?next():res.sendStatus(403);
  const service=setupPrayerSupport({app,db,siteUrl:SITE,sameOriginOnly,allowAttempt:()=>state.allowed,readConfig:()=>state.config,
    verifySignature:(req,id)=>req.get('x-test-signature')==='valid'&&Boolean(id),fetchImpl,now:()=>time});
  const server=app.listen(0,'127.0.0.1');await new Promise(done=>server.once('listening',done));
  t.after(async()=>{await new Promise(done=>server.close(done));db.close();});
  const base='http://127.0.0.1:'+server.address().port+'/api/prayer-support';
  async function request(path,{method='GET',body,headers={}}={}){
    const result=await fetch(base+path,{method,headers:{origin:SITE,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
    const raw=await result.text();let data;try{data=JSON.parse(raw);}catch{data=raw;}return {status:result.status,data,headers:result.headers};
  }
  const create=(amountCents=500,requestKey=randomUUID(),extra={})=>request('/pix',{method:'POST',body:{requestKey,amountCents,accepted:true,payerEmail:' Pessoa@Example.Test ',...extra}});
  const checkout=(requestKey,amountCents=500)=>request('/checkout',{method:'POST',body:{requestKey,amountCents,accepted:true}});
  const receipt=(created,token=created.statusToken)=>request('/orders/'+created.reference,{headers:{'X-Support-Token':token}});
  const notify=(id,{bodyId=id,signature='valid'}={})=>request('/webhook?type=payment&data.id='+id,{method:'POST',headers:{'x-test-signature':signature},body:{type:'payment',data:{id:bodyId}}});
  const order=reference=>db.prepare('SELECT * FROM prayer_support_orders WHERE reference=?').get(reference);
  function update(id,patch){time+=1000;const payment={...payments.get(id),...patch,date_last_updated:new Date(time).toISOString()};payments.set(id,payment);return payment;}
  return {db,state,calls,payments,service,request,create,checkout,receipt,notify,order,update,advance:ms=>time+=ms,now:()=>time,
    posts:()=>calls.filter(c=>c.options.method==='POST'),reads:()=>calls.filter(c=>c.url.startsWith(MP+'/v1/payments/'))};
}

test('Pix creates each allowed exact amount with real payer input, one-time metadata and private QR receipt',async t=>{
  const f=await fixture(t),ready=await f.request('/config');assert.equal(ready.data.pixEnabled,true);
  for(const amount of PRAYER_SUPPORT_AMOUNTS_CENTS){
    const created=await f.create(amount);assert.equal(created.status,201,JSON.stringify(created.data));
    const order=f.order(created.data.reference),post=f.posts().at(-1),body=JSON.parse(post.options.body);
    assert.equal(post.url,MP+'/v1/payments');assert.equal(post.options.headers['X-Idempotency-Key'],order.reference);
    assert.equal(body.transaction_amount,amount/100);assert.equal(body.payment_method_id,'pix');assert.deepEqual(body.payer,{email:'pessoa@example.test'});
    assert.equal(body.external_reference,order.reference);assert.equal(body.notification_url,SITE+'/api/prayer-support/webhook');
    assert.deepEqual(body.metadata,{purpose:'prayer_voluntary_support',one_time:true});
    assert.equal(Date.parse(body.date_of_expiration),f.now()+30*60000);
    assert.equal(created.data.status,'pending');assert.equal(created.data.method,'pix');assert.equal(created.data.amountCents,amount);
    assert.equal(created.data.pix.qrCode,QR);assert.equal(created.data.pix.qrCodeBase64,PNG);assert.equal(created.data.currency,'BRL');
    assert.equal(created.data.checkoutUrl,undefined);assert.equal(created.data.ticketUrl,undefined);
    assert.equal(created.headers.get('cache-control'),'private,no-store');
    assert.equal(order.payer_email_hash,createHash('sha256').update('pessoa@example.test').digest('hex'));
    assert.doesNotMatch(JSON.stringify(order),/pessoa@example\.test/i);assert.doesNotMatch(JSON.stringify(created.data),/pessoa@example\.test|FAKE-PIX|collector_id|accessToken|webhookSecret/);
    assert.equal(order.payment_method,'pix');assert.equal(order.preference_id,null);assert.equal(order.amount_cents,amount);
  }
  assert.deepEqual(f.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(x=>x.name),['prayer_support_events','prayer_support_orders']);
});

test('Pix validates origin, consent, allowed integer amounts and actual email before creating any payment',async t=>{
  const f=await fixture(t);
  assert.equal((await f.request('/pix',{method:'POST',headers:{origin:'https://attacker.test'},body:{requestKey:randomUUID(),amountCents:50,accepted:true,payerEmail:'a@b.test'}})).status,403);
  for(const amountCents of [0,49,51,150,501,-50,50.1,'50',null])assert.equal((await f.create(amountCents)).status,400);
  for(const extra of [{accepted:false},{quantity:2},{recurring:true},{requestKey:'short'},{payerEmail:''},{payerEmail:'not-an-email'},{payerEmail:'a\n@b.test'},{payerEmail:'a'.repeat(250)+'@b.test'}])assert.equal((await f.create(50,randomUUID(),extra)).status,400);
  f.state.allowed=false;assert.equal((await f.create()).status,429);
  f.state.config.enabled=false;assert.equal((await f.create()).status,503);assert.equal((await f.request('/config')).data.pixEnabled,false);
  assert.equal(f.posts().length,0);assert.equal(f.db.prepare('SELECT count(*) n FROM prayer_support_orders').get().n,0);
});

test('concurrent Pix clicks, changed amounts and replay cannot create another payment',async t=>{
  const f=await fixture(t),key=randomUUID();
  const results=await Promise.all([f.create(50,key),f.create(50,key)]);
  assert.ok(results.every(r=>[200,201,409].includes(r.status)));assert.equal(f.posts().length,1);
  assert.equal(results[0].data.reference,results[1].data.reference);
  const again=await f.create(50,key);assert.equal(again.status,200);assert.equal(again.data.reference,results[0].data.reference);assert.equal(again.data.statusToken,results[0].data.statusToken);
  const changed=await f.create(500,key);assert.equal(changed.status,409);assert.equal(changed.data.amountCents,50);assert.equal(f.posts().length,1);
});

test('Pix and Checkout Pro share the reservation key, including concurrent cross-method attempts',async t=>{
  const f=await fixture(t);
  const pixKey=randomUUID(),pix=await f.create(500,pixKey),afterPix=await f.checkout(pixKey);
  assert.equal(afterPix.status,409);assert.equal(afterPix.data.reference,pix.data.reference);
  const checkoutKey=randomUUID(),checkout=await f.checkout(checkoutKey),afterCheckout=await f.create(500,checkoutKey);
  assert.equal(afterCheckout.status,409);assert.equal(afterCheckout.data.reference,checkout.data.reference);
  const raceKey=randomUUID(),before=f.posts().length,results=await Promise.all([f.create(500,raceKey),f.checkout(raceKey)]);
  assert.equal(f.posts().length,before+1);assert.ok(results.every(r=>[201,409].includes(r.status)));
  assert.equal(results[0].data.reference,results[1].data.reference);
});

test('timeout keeps the same reference and recovers the existing Pix through search without a POST retry',async t=>{
  const f=await fixture(t),key=randomUUID();f.state.onCreate=()=>{throw Error('Simulated ambiguous timeout after provider accepted');};
  const first=await f.create(100,key);assert.equal(first.status,502);assert.equal(first.data.status,'creating');assert.equal(first.data.pix,undefined);
  const recovered=await f.create(100,key);assert.equal(recovered.status,200);assert.equal(recovered.data.reference,first.data.reference);assert.equal(recovered.data.statusToken,first.data.statusToken);
  assert.equal(recovered.data.pix.qrCode,QR);assert.equal(f.posts().length,1);
  assert.equal(f.reads().filter(c=>c.url.includes('/search?')).length,1);
  assert.equal(f.order(first.data.reference).payment_id,[...f.payments.keys()][0]);
});

test('empty or ambiguous search never concludes failure or creates a replacement Pix',async t=>{
  const f=await fixture(t),key=randomUUID();f.state.onCreate=()=>{throw Error('Uncertain creation');};f.state.searchResults=[];
  const first=await f.create(200,key),retry=await f.create(200,key);
  assert.equal(retry.status,409);assert.equal(retry.data.reference,first.data.reference);assert.equal(retry.data.status,'creating');assert.equal(f.posts().length,1);
  const payment=[...f.payments.values()][0];f.state.searchResults=[payment,{...payment,id:'999999'}];f.advance(15001);
  const reviewed=await f.receipt(first.data);assert.equal(reviewed.data.status,'review_required');assert.equal(reviewed.data.pix,undefined);assert.equal(f.posts().length,1);
});

test('provider identity, amount, currency, payment method and production mismatches cannot expose or confirm a Pix',async t=>{
  const f=await fixture(t);
  for(const patch of [{transaction_amount:9},{collector_id:'999999'},{id:'bad-id'},{external_reference:'support_other'},
    {payment_method_id:'visa'},{currency_id:'USD'},{live_mode:false},{live_mode:undefined},{live_mode:'true'}]){
    f.state.onCreate=payment=>response({...payment,...patch},201);
    const created=await f.create(50);assert.equal(created.status,502,JSON.stringify(patch));assert.equal(created.data.pix,undefined);
    const order=f.order(created.data.reference);assert.equal(order.status,'creating');assert.equal(order.payment_id,null);
  }
});

test('invalid QR data pins a verified payment for later retrieval but never exposes malformed QR or unsafe ticket URLs',async t=>{
  const f=await fixture(t);
  for(const transaction_data of [{qr_code:'bad',qr_code_base64:PNG},{qr_code:QR,qr_code_base64:'PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+'},
    {qr_code:QR+'\n',qr_code_base64:PNG},{qr_code:QR,qr_code_base64:PNG,ticket_url:'javascript:alert(1)'}]){
    f.state.onCreate=payment=>response({...payment,point_of_interaction:{transaction_data}},201);
    const created=await f.create();
    if(transaction_data.qr_code===QR&&transaction_data.qr_code_base64===PNG){assert.equal(created.status,201);assert.equal(created.data.ticketUrl,undefined);}
    else {assert.equal(created.status,502);assert.equal(created.data.pix,undefined);assert.ok(f.order(created.data.reference).payment_id);}
  }
});

test('receipt authentication is checked before reconciliation and concurrent polling is throttled durably',async t=>{
  const f=await fixture(t),created=await f.create();
  assert.equal((await f.receipt(created.data,'wrong')).status,404);
  assert.equal((await f.request('/orders/'+created.data.reference)).status,404);assert.equal(f.reads().length,0);
  const receipts=await Promise.all([f.receipt(created.data),f.receipt(created.data),f.receipt(created.data)]);
  assert.ok(receipts.every(r=>r.status===200));assert.equal(f.reads().length,1);
  assert.equal(receipts[0].headers.get('cache-control'),'private,no-store');
  f.advance(15001);await f.receipt(created.data);assert.equal(f.reads().length,2);
});

test('authenticated status GET confirms approved payment and later refund through the shared ledger',async t=>{
  const f=await fixture(t),created=await f.create(300),id=f.order(created.data.reference).payment_id;
  f.update(id,{status:'approved'});const approved=await f.receipt(created.data);
  assert.equal(approved.data.status,'approved');assert.equal(approved.data.pix,undefined);
  f.advance(15001);f.update(id,{transaction_amount_refunded:1});assert.equal((await f.receipt(created.data)).data.status,'partially_refunded');
  f.advance(15001);f.update(id,{status:'refunded',transaction_amount_refunded:3});assert.equal((await f.receipt(created.data)).data.status,'refunded');
  assert.equal(f.db.prepare('SELECT count(*) n FROM prayer_support_events').get().n,4);
  assert.equal(f.posts().length,1);
});

test('a mismatched GET response cannot change the bound payment or confirm funds',async t=>{
  const f=await fixture(t),created=await f.create(100),id=f.order(created.data.reference).payment_id;
  for(const patch of [{id:'888888'},{transaction_amount:2},{collector_id:'999'},{payment_method_id:'visa'},{live_mode:false}]){
    f.state.onRead=(_id,payment)=>response({...payment,status:'approved',...patch});f.advance(15001);
    const result=await f.receipt(created.data);assert.equal(result.data.status,'pending');assert.equal(f.order(created.data.reference).payment_id,id);
  }
  assert.equal(f.posts().length,1);
});

test('expiration hides the QR but does not mark the payment paid, cancelled or safe to replace',async t=>{
  const f=await fixture(t),key=randomUUID(),created=await f.create(50,key);f.advance(30*60000+1);
  const expired=await f.receipt(created.data);assert.equal(expired.data.status,'pending');assert.equal(expired.data.pix,undefined);
  const repeat=await f.create(50,key);assert.equal(repeat.status,409);assert.equal(repeat.data.reference,created.data.reference);assert.equal(repeat.data.pix,undefined);assert.equal(f.posts().length,1);
  f.advance(15001);f.update(f.order(created.data.reference).payment_id,{status:'approved'});
  assert.equal((await f.receipt(created.data)).data.status,'approved');
});

test('webhook approval before create response is preserved and old pending QR cannot reopen payment',async t=>{
  const f=await fixture(t),entered=deferred(),release=deferred();let original;
  f.state.onCreate=async payment=>{original=structuredClone(payment);entered.resolve(payment);await release.promise;return response(original,201);};
  const creating=f.create(200),payment=await entered.promise;
  f.update(payment.id,{status:'approved'});assert.equal((await f.notify(payment.id)).status,200);release.resolve();
  const result=await creating;assert.equal(result.status,201);assert.equal(result.data.status,'approved');assert.equal(result.data.pix,undefined);
  assert.equal(f.order(result.data.reference).status,'approved');assert.equal(f.posts().length,1);
});

test('webhook requires matching signed IDs and rejects non-Pix or mismatched bound payments',async t=>{
  const f=await fixture(t),created=await f.create(500),id=f.order(created.data.reference).payment_id;
  assert.equal((await f.notify(id,{signature:'invalid'})).status,401);
  assert.equal((await f.notify(id,{bodyId:'1111'})).status,400);assert.equal(f.reads().length,0);
  f.update(id,{status:'approved',payment_method_id:'visa'});assert.equal((await f.notify(id)).status,502);assert.equal(f.order(created.data.reference).status,'pending');
  f.update(id,{status:'approved',payment_method_id:'pix'});assert.equal((await f.notify(id)).status,200);
  f.payments.set('2222',{...f.payments.get(id),id:'2222'});assert.equal((await f.notify('2222')).status,502);
  assert.equal(f.order(created.data.reference).payment_id,id);assert.equal(f.order(created.data.reference).status,'approved');
});

test('refund and chargeback webhook states cannot be undone by stale pending or approval responses',async t=>{
  for(const status of ['refunded','charged_back']){
    const f=await fixture(t),created=await f.create(500),id=f.order(created.data.reference).payment_id,initial=structuredClone(f.payments.get(id));
    f.update(id,{status:'approved'});await f.notify(id);f.update(id,{status,transaction_amount_refunded:status==='refunded'?5:0});await f.notify(id);
    f.payments.set(id,initial);await f.notify(id);assert.equal(f.order(created.data.reference).status,status);
    f.update(id,{status:'approved'});await f.notify(id);assert.equal(f.order(created.data.reference).status,status);
    assert.equal((await f.receipt(created.data)).data.pix,undefined);assert.equal(f.posts().length,1);
  }
});

test('explicit provider rejection preserves each amount and never retries or silently falls back to Checkout Pro',async t=>{
  const f=await fixture(t);f.state.onCreate=()=>response({message:'Validation declined'},400);
  for(const amount of PRAYER_SUPPORT_AMOUNTS_CENTS){
    const key=randomUUID(),created=await f.create(amount,key);assert.equal(created.status,422);assert.equal(created.data.status,'creation_rejected');
    assert.equal(created.data.amountCents,amount);const before=f.posts().length;
    assert.equal((await f.create(amount,key)).status,409);assert.equal((await f.checkout(key,amount)).status,409);assert.equal(f.posts().length,before);
    assert.equal(JSON.parse(f.posts().at(-1).options.body).transaction_amount,amount/100);
  }
});

test('429 and server errors remain uncertain, preserve reference and never create an automatic retry',async t=>{
  const f=await fixture(t);
  for(const status of [429,500,503]){
    f.state.onCreate=()=>response({error:'temporarily_unavailable'},status);f.state.searchResults=[];
    const key=randomUUID(),created=await f.create(100,key);assert.equal(created.status,502);assert.equal(created.data.status,'creating');
    const before=f.posts().length,retry=await f.create(100,key);assert.equal(retry.status,409);assert.equal(retry.data.reference,created.data.reference);assert.equal(f.posts().length,before);
  }
});

test('a replay after webhook-secret rotation must not return an unusable receipt token',async t=>{
  const f=await fixture(t),key=randomUUID(),created=await f.create(100,key);
  f.state.config={...f.state.config,webhookSecret:'FAKE-ROTATED-PIX-SECRET'};
  const replay=await f.create(100,key);assert.equal(replay.status,200);assert.equal(replay.data.reference,created.data.reference);
  const receipt=await f.receipt(replay.data);assert.equal(receipt.status,200,'The token handed to the browser must authenticate the same durable receipt after rotation.');
  assert.equal(receipt.data.reference,created.data.reference);assert.equal(f.posts().length,1);
  assert.equal((await f.receipt(created.data)).status,200,'Previously saved receipt tokens remain valid.');
  f.state.config={...f.state.config,webhookSecret:'FAKE-ROTATED-AGAIN-PIX-SECRET'};
  const again=await f.create(100,key);
  assert.equal((await f.receipt(again.data)).status,200);
  assert.equal((await f.receipt(replay.data)).status,200);
  assert.equal((await f.receipt(created.data)).status,200);
});
