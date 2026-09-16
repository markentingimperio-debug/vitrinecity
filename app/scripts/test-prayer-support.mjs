import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import express from 'express';
import Database from 'better-sqlite3';
import {setupPrayerSupport,prayerSupportEnvironment,prayerSupportCheckoutUrl,PRAYER_SUPPORT_AMOUNTS_CENTS} from '../prayer-support.js';

const SITE='https://vitrinecity.com';
const key=()=>randomUUID();
const validConfig=()=>({enabled:true,beneficiary:'Agrotecnica',collectorId:'123456',accessToken:'FAKE-TEST-TOKEN',webhookSecret:'FAKE-TEST-SECRET'});
async function fixture(t,{config=validConfig(),accountId='123456',limit=true,preferenceFailure=null}={}){
  const db=new Database(':memory:');db.pragma('foreign_keys=ON');
  const app=express();app.use(express.json());const calls=[],payments=new Map();let time=Date.now();
  const state={config,accountId,limit,preferenceFailure};
  const fetchImpl=async(url,options={})=>{
    calls.push({url,options});
    if(url==='https://api.mercadolibre.com/users/me')return {ok:true,status:200,json:async()=>({id:state.accountId,email:'NEVER-PUBLIC@example.test',nickname:'PRIVATE-NAME'})};
    if(url==='https://api.mercadopago.com/checkout/preferences'){
      if(state.preferenceFailure==='timeout')throw Error('Simulated timeout');
      if(state.preferenceFailure==='4xx')return {ok:false,status:400,json:async()=>({message:'Provider validation error'})};
      const n=calls.filter(c=>c.options.method==='POST').length;
      return {ok:true,status:201,json:async()=>({id:'fixture-'+n,collector_id:state.preferenceFailure==='collector'?'999999':state.accountId,
        init_point:state.preferenceFailure==='url'?'https://mercadopago.com.br.attacker.test/checkout/v1/redirect':'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=fixture-'+n})};
    }
    if(url.startsWith('https://api.mercadopago.com/v1/payments/')){const value=payments.get(url.split('/').at(-1));return {ok:!!value,status:value?200:404,json:async()=>value};}
    throw Error('Unexpected provider URL: '+url);
  };
  const origin=(req,res,next)=>req.get('origin')===SITE?next():res.sendStatus(403);
  const service=setupPrayerSupport({app,db,siteUrl:SITE,sameOriginOnly:origin,allowAttempt:()=>state.limit,
    verifySignature:(req,id)=>req.get('x-test-signature')==='valid'&&Boolean(id),readConfig:()=>state.config,fetchImpl,now:()=>time});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
  const base=`http://127.0.0.1:${server.address().port}/api/prayer-support`;
  const request=async(path,{method='GET',body,headers={}}={})=>{
    const response=await fetch(base+path,{method,headers:{origin:SITE,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
    const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}return {status:response.status,headers:response.headers,data};
  };
  const checkout=(amountCents=500,requestKey=key(),extra={})=>request('/checkout',{method:'POST',body:{requestKey,accepted:true,amountCents,...extra}});
  return {db,service,calls,state,request,checkout,payments,advance:ms=>time+=ms,
    order:reference=>db.prepare('SELECT * FROM prayer_support_orders WHERE reference=?').get(reference),
    events:()=>db.prepare('SELECT * FROM prayer_support_events').all(),posts:()=>calls.filter(c=>c.options.method==='POST')};
}

test('configuration stays disabled by default and never reveals credentials or account personal fields',async t=>{
  assert.equal(prayerSupportEnvironment({}).enabled,false);
  const f=await fixture(t,{config:{...validConfig(),enabled:false}});
  const result=await f.request('/config');assert.equal(result.status,200);assert.equal(result.data.enabled,false);assert.equal(f.calls.length,0);
  assert.deepEqual(result.data.amountsCents,[50,100,200,300,500]);assert.equal(result.data.oneTime,true);assert.equal(result.data.defaultAmountCents,500);
  assert.equal(result.headers.get('cache-control'),'no-store');assert.doesNotMatch(JSON.stringify(result.data),/FAKE|123456|accessToken|webhookSecret/);
  assert.equal((await f.checkout()).status,503);assert.equal(f.posts().length,0);
});

test('readiness verifies exact recipient account through authenticated GET and caches only that credential/account pair',async t=>{
  const f=await fixture(t);let result=await f.request('/config');assert.equal(result.data.enabled,true);
  assert.equal(f.calls[0].url,'https://api.mercadolibre.com/users/me');assert.equal(f.calls[0].options.headers.Authorization,'Bearer FAKE-TEST-TOKEN');
  assert.doesNotMatch(JSON.stringify(result.data),/NEVER-PUBLIC|PRIVATE-NAME|123456/);
  await f.request('/config');assert.equal(f.calls.length,1);
  f.state.config={...validConfig(),collectorId:'999999'};result=await f.request('/config');assert.equal(result.data.enabled,false);assert.equal(result.data.reason,'beneficiary_unverified');
  assert.equal((await f.checkout()).status,503);assert.equal(f.posts().length,0);
});

test('unverified configuration, consent, foreign origin, arbitrary values, quantities and recurrence fail before preferences',async t=>{
  const f=await fixture(t);
  assert.equal((await f.request('/checkout',{method:'POST',headers:{origin:'https://attacker.test'},body:{requestKey:key(),accepted:true,amountCents:500}})).status,403);
  for(const amount of [undefined,0,49,51,150,501,-500,'500',500.01,Infinity])assert.equal((await f.checkout(amount,key(),{amountCents:amount})).status,400);
  for(const extra of [{accepted:false},{quantity:2},{recurring:true}])assert.equal((await f.checkout(500,key(),extra)).status,400);
  f.state.limit=false;assert.equal((await f.checkout()).status,429);
  f.state.config={...validConfig(),collectorId:''};assert.equal((await f.checkout()).status,503);
  assert.equal(f.posts().length,0);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM prayer_support_orders').get().n,0);
});

test('all five allowed amounts produce a single separate support preference with clean return URLs and no benefits or personal data',async t=>{
  const f=await fixture(t);
  for(const amount of PRAYER_SUPPORT_AMOUNTS_CENTS){
    const result=await f.checkout(amount);assert.equal(result.status,201,JSON.stringify(result.data));assert.equal(result.data.amountCents,amount);
    const call=f.posts().at(-1),payload=JSON.parse(call.options.body),order=f.order(result.data.reference);
    assert.equal(payload.items.length,1);assert.equal(payload.items[0].unit_price,amount/100);assert.equal(payload.items[0].quantity,1);assert.equal(payload.items[0].currency_id,'BRL');
    assert.equal(order.amount_cents,amount);assert.equal(order.status,'pending');assert.equal(order.collector_id,'123456');
    assert.equal(payload.external_reference,result.data.reference);assert.equal(payload.metadata.purpose,'prayer_voluntary_support');
    assert.equal(payload.notification_url,SITE+'/api/prayer-support/webhook');assert.equal(new Set(Object.values(payload.back_urls)).size,1);
    const back=new URL(payload.back_urls.success);assert.equal(back.origin,SITE);assert.equal(back.pathname,'/oracao-do-dia.html');assert.equal(back.searchParams.get('apoio'),'retorno');
    assert.equal(back.searchParams.get('ref'),order.reference);assert.equal(back.searchParams.has('status'),false);assert.equal(payload.payer,undefined);
    assert.equal(payload.auto_recurring,undefined);assert.equal(payload.marketplace_fee,undefined);assert.equal(payload.subscription,undefined);
    assert.equal(call.options.headers['X-Idempotency-Key'],order.reference);assert.notEqual(order.status_token_hash,result.data.statusToken);
  }
  assert.deepEqual(f.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(x=>x.name),['prayer_support_events','prayer_support_orders']);
});

test('repeated and concurrent clicks cannot create duplicate preferences or silently change the amount',async t=>{
  const f=await fixture(t),requestKey=key();
  const results=await Promise.all([f.checkout(50,requestKey),f.checkout(50,requestKey)]);
  assert.ok(results.every(r=>[200,201,409].includes(r.status)));assert.equal(f.posts().length,1);assert.equal(results[0].data.reference,results[1].data.reference);
  const again=await f.checkout(50,requestKey);assert.equal(again.status,200);assert.equal(again.data.statusToken,results[0].data.statusToken);
  const changed=await f.checkout(500,requestKey);assert.equal(changed.status,409);assert.equal(changed.data.amountCents,50);assert.equal(f.posts().length,1);
});

test('unknown provider results remain pending verification and retry uses the same ledger reference',async t=>{
  for(const failure of ['timeout','collector','url']){
    const f=await fixture(t,{preferenceFailure:failure}),requestKey=key();
    const result=await f.checkout(100,requestKey);assert.equal(result.status,502);assert.equal(result.data.status,'creating');assert.equal(result.data.checkoutUrl,undefined);
    const repeat=await f.checkout(100,requestKey);assert.equal(repeat.status,409);assert.equal(repeat.data.reference,result.data.reference);assert.equal(repeat.data.statusToken,result.data.statusToken);assert.equal(f.posts().length,1);
  }
});

test('explicit provider rejection never resubmits a different amount or claims a payment',async t=>{
  const f=await fixture(t,{preferenceFailure:'4xx'}),requestKey=key(),result=await f.checkout(50,requestKey);
  assert.equal(result.status,422);assert.equal(result.data.status,'creation_rejected');assert.equal(result.data.amountCents,50);assert.equal(f.order(result.data.reference).status,'creation_rejected');
  assert.equal(JSON.parse(f.posts()[0].options.body).items[0].unit_price,.5);assert.equal((await f.checkout(50,requestKey)).status,409);assert.equal(f.posts().length,1);
});

test('only an unguessable status token exposes a receipt, and browser return query never confirms payment',async t=>{
  const f=await fixture(t),result=await f.checkout(200),{reference,statusToken}=result.data;
  assert.equal((await f.request('/orders/'+reference)).status,404);assert.equal((await f.request('/orders/'+reference,{headers:{'X-Support-Token':'wrong'}})).status,404);
  const receipt=await f.request('/orders/'+reference+'?status=approved&collection_status=approved',{headers:{'X-Support-Token':statusToken}});
  assert.equal(receipt.status,200);assert.equal(receipt.data.status,'pending');assert.equal(receipt.data.amountCents,200);assert.equal(receipt.headers.get('cache-control'),'private,no-store');
  assert.deepEqual(Object.keys(receipt.data).sort(),['amountCents','beneficiary','currency','reference','status']);
});

test('webhook requires signature, matching IDs and server-fetched exact amount, currency and recipient',async t=>{
  const f=await fixture(t),created=await f.checkout(50),reference=created.data.reference;
  const notify=(id,bodyId=id,signed=true)=>f.request('/webhook?type=payment&data.id='+id,{method:'POST',headers:{'x-test-signature':signed?'valid':'invalid'},body:{type:'payment',data:{id:bodyId}}});
  assert.equal((await notify('100','100',false)).status,401);assert.equal((await notify('100','101')).status,400);assert.equal(f.calls.filter(c=>c.url.includes('/v1/payments/')).length,0);
  const payment={id:'100',external_reference:reference,transaction_amount:.5,currency_id:'BRL',collector_id:'123456',status:'approved',live_mode:true};
  for(const mismatch of [{transaction_amount:5},{currency_id:'USD'},{collector_id:'999999'}]){f.payments.set('100',{...payment,...mismatch});assert.equal((await notify('100')).status,502);assert.equal(f.order(reference).status,'pending');}
  f.payments.set('100',payment);f.state.config.enabled=false;assert.equal((await notify('100')).status,200);assert.equal(f.order(reference).status,'approved');
  assert.equal((await notify('100')).status,200);assert.equal(f.events().length,1);assert.equal(f.events()[0].amount_cents,50);
});

test('simulated or unspecified payment mode cannot confirm real support through settlement, webhook or receipt',async t=>{
  const f=await fixture(t),created=await f.checkout(100),{reference,statusToken}=created.data;
  const payment={id:'150',external_reference:reference,transaction_amount:1,currency_id:'BRL',collector_id:'123456',status:'approved'};
  for(const marker of [{},{live_mode:false},{live_mode:'true'},{live_mode:1}]){
    const unverified={...payment,...marker};
    assert.throws(()=>f.service.settle(unverified),/not verified as live/);
    f.payments.set('150',unverified);
    const result=await f.request('/webhook?type=payment&data.id=150',{method:'POST',headers:{'x-test-signature':'valid'},body:{type:'payment',data:{id:'150'}}});
    assert.equal(result.status,502);assert.equal(f.order(reference).status,'pending');assert.equal(f.order(reference).payment_id,null);assert.equal(f.events().length,0);
    const receipt=await f.request('/orders/'+reference,{headers:{'X-Support-Token':statusToken}});
    assert.equal(receipt.data.status,'pending');
  }
  f.service.settle({...payment,live_mode:true});assert.equal(f.order(reference).status,'approved');assert.equal(f.events().length,1);
});

test('payment events are idempotent, preserve approvals against stale events, and track refunds or duplicate approvals',async t=>{
  const f=await fixture(t),created=await f.checkout(300),reference=created.data.reference;
  const payment={id:'200',external_reference:reference,transaction_amount:3,currency_id:'BRL',collector_id:'123456',status:'approved',live_mode:true};
  f.service.settle(payment);f.service.settle(payment);assert.equal(f.events().length,1);
  f.service.settle({...payment,status:'pending'});assert.equal(f.order(reference).status,'approved');
  f.service.settle({...payment,transaction_amount_refunded:1});assert.equal(f.order(reference).status,'partially_refunded');
  f.service.settle(payment);assert.equal(f.order(reference).status,'partially_refunded');
  f.service.settle({...payment,status:'refunded',transaction_amount_refunded:3});assert.equal(f.order(reference).status,'refunded');
  f.service.settle(payment);assert.equal(f.order(reference).status,'refunded');
  f.service.settle({...payment,id:'201'});assert.equal(f.order(reference).status,'review_required');assert.equal(f.events().filter(e=>e.payment_id==='201').length,1);
  f.service.settle({...payment,id:'201'});assert.equal(f.events().filter(e=>e.payment_id==='201').length,1);
});

test('a newer mediation suspends confirmation, stale approvals cannot restore it, and only a newer resolution can confirm again',async t=>{
  const f=await fixture(t),created=await f.checkout(500),{reference,statusToken}=created.data;
  const at=hour=>`2026-09-10T${hour}:00:00.000Z`;
  const payment={id:'300',external_reference:reference,transaction_amount:5,currency_id:'BRL',collector_id:'123456',status:'approved',live_mode:true};
  f.service.settle({...payment,date_last_updated:at('12')});assert.equal(f.order(reference).status,'approved');
  f.service.settle({...payment,status:'in_mediation',date_last_updated:at('11')});assert.equal(f.order(reference).status,'approved');
  f.service.settle({...payment,status:'in_mediation',date_last_updated:at('13')});assert.equal(f.order(reference).status,'in_mediation');
  assert.equal(f.order(reference).provider_updated_ms,Date.parse(at('13')));
  for(const date_last_updated of [at('12'),at('13'),undefined,'invalid-date']){
    f.service.settle({...payment,date_last_updated});assert.equal(f.order(reference).status,'in_mediation');
    const receipt=await f.request('/orders/'+reference,{headers:{'X-Support-Token':statusToken}});assert.equal(receipt.data.status,'in_mediation');
  }
  assert.equal(f.events().length,2);
  f.service.settle({...payment,date_last_updated:at('14')});assert.equal(f.order(reference).status,'approved');assert.equal(f.events().length,3);
  f.service.settle({...payment,status:'in_mediation',date_last_updated:at('13')});assert.equal(f.order(reference).status,'approved');
  f.service.settle({...payment,status:'refunded',transaction_amount_refunded:5,date_last_updated:at('15')});assert.equal(f.order(reference).status,'refunded');
  f.service.settle({...payment,date_last_updated:at('16')});assert.equal(f.order(reference).status,'refunded');
  const second=await f.checkout(500),other={...payment,id:'301',external_reference:second.data.reference};
  f.service.settle({...other,date_last_updated:at('12')});f.service.settle({...other,status:'charged_back',date_last_updated:at('13')});
  f.service.settle({...other,date_last_updated:at('14')});assert.equal(f.order(second.data.reference).status,'charged_back');
});

test('hosted checkout URL validator rejects unsafe destinations and requires official checkout path',()=>{
  assert.ok(prayerSupportCheckoutUrl('https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=test'));
  for(const value of ['javascript:alert(1)','//mercadopago.com.br/checkout/v1','http://mercadopago.com.br/checkout/v1','https://mercadopago.com.br.attacker.test/checkout/v1','https://user:pass@mercadopago.com.br/checkout/v1','https://mercadopago.com.br:8080/checkout/v1','https://mercadopago.com.br/not-checkout'])assert.equal(prayerSupportCheckoutUrl(value),'');
});
