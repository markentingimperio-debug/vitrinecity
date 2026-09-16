import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import Database from 'better-sqlite3';
import express from 'express';
import { openaiPurchaseReceipts, setupOpenAIPurchaseMeasurement } from '../openai-purchase-measurement.js';

const req = (id=1, general='accepted', openai='accepted') => ({ user:{id},get:key=>({'x-vc-analytics-consent':general,'x-vc-openai-ads-consent':openai})[key] });
function fixture(){
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE course_orders(id INTEGER PRIMARY KEY,reference TEXT,user_id INTEGER,course_slug TEXT,course_title TEXT,amount_cents INTEGER,mp_payment_id TEXT,status TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE analytics_events(id INTEGER PRIMARY KEY,event_name TEXT,asset_type TEXT,asset_id TEXT,user_id INTEGER,metadata_json TEXT,path TEXT,value_cents INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE marketplace_orders(id INTEGER PRIMARY KEY,reference TEXT,buyer_user_id INTEGER,total_cents INTEGER,products_cents INTEGER,shipping_cents INTEGER,payment_status TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE marketplace_payment_events(order_reference TEXT,payment_status TEXT);
    CREATE TABLE marketplace_order_items(order_reference TEXT,product_id INTEGER,quantity INTEGER,unit_price_cents INTEGER);
    INSERT INTO course_orders(reference,user_id,course_slug,course_title,amount_cents,mp_payment_id,status) VALUES('private-course-reference',1,'canva-para-lojas','Canva para Lojas',2399,'123456','approved');
    INSERT INTO marketplace_orders(reference,buyer_user_id,total_cents,products_cents,shipping_cents,payment_status) VALUES('private-market-reference',1,3000,2500,500,'approved');
    INSERT INTO marketplace_order_items VALUES('private-market-reference',8,2,1250);
    INSERT INTO marketplace_payment_events VALUES('private-market-reference','approved');`);
  for(const [type,reference,amount] of [['course','private-course-reference',2399],['marketplace','private-market-reference',3000]]){
    db.prepare("INSERT INTO analytics_events(event_name,asset_type,asset_id,user_id,metadata_json) VALUES('checkout_start',?,?,1,?)").run(type,reference,JSON.stringify({origin:'server',openaiConsent:true}));
    db.prepare("INSERT INTO analytics_events(event_name,asset_type,asset_id,path,value_cents) VALUES('purchase',?,?,'/webhook',?)").run(type,reference,amount);
  }
  return db;
}
test('only owned approved purchases with explicit consent produce stable minimal receipts',()=>{
  const db=fixture(),receipts=openaiPurchaseReceipts(db,req());
  assert.equal(receipts.length,2); assert.equal(receipts[0].data.amount,2399);
  assert.equal(receipts[0].data.contents[0].id,'course-canva-para-lojas');
  assert.equal(receipts[1].data.amount,3000);
  assert.deepEqual(receipts,openaiPurchaseReceipts(db,req()));
  assert.match(receipts[0].eventId,/^vc_purchase_[a-f0-9]{64}$/);
  assert(!JSON.stringify(receipts).includes('private-'));
  for(const request of [req(2),req(null),req(1,'essential'),req(1,'accepted','essential'),req(1,'accepted',null)]) assert.deepEqual(openaiPurchaseReceipts(db,request),[]);
  db.close();
});
test('pending, failed, refunded, coins, absent webhook and invalid totals never count as purchases',()=>{
  for(const sql of ["UPDATE course_orders SET status='pending'","UPDATE course_orders SET status='failed'","UPDATE course_orders SET status='refunded'","UPDATE course_orders SET mp_payment_id='vitrinycoins'","DELETE FROM analytics_events WHERE event_name='purchase' AND asset_type='course'","UPDATE course_orders SET amount_cents=0"]){
    const db=fixture();db.exec(sql);assert.equal(openaiPurchaseReceipts(db,req()).filter(r=>r.data.contents[0].id.startsWith('course-')).length,0);db.close();
  }
  for(const sql of ["UPDATE marketplace_orders SET payment_status='refunded'","DELETE FROM marketplace_payment_events","UPDATE marketplace_order_items SET unit_price_cents=99","UPDATE marketplace_order_items SET quantity=-1","UPDATE marketplace_orders SET shipping_cents=-5"]){
    const db=fixture();db.exec(sql);assert.equal(openaiPurchaseReceipts(db,req()).filter(r=>r.data.contents[0].id.startsWith('product-')).length,0);db.close();
  }
});
test('no retroactive export or forged checkout provenance',()=>{
  for(const sql of ["UPDATE analytics_events SET metadata_json='{}' WHERE event_name='checkout_start'","UPDATE analytics_events SET metadata_json='invalid' WHERE event_name='checkout_start'","UPDATE analytics_events SET metadata_json='{\"origin\":\"browser\",\"openaiConsent\":true}' WHERE event_name='checkout_start'","UPDATE analytics_events SET created_at=datetime('now','-8 days')","UPDATE analytics_events SET user_id=2 WHERE event_name='checkout_start'","UPDATE analytics_events SET path='/forged' WHERE event_name='purchase'"]){const db=fixture();db.exec(sql);assert.deepEqual(openaiPurchaseReceipts(db,req()),[]);db.close();}
});
test('receipt endpoint requires authentication and prevents caching',async()=>{
  const db=fixture(), app=express();
  setupOpenAIPurchaseMeasurement({app,db,requireUser:(request,response,next)=>{if(request.get('authorization')!=='test-only')return response.sendStatus(401);request.user={id:1};next();}});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  try{
    const url='http://127.0.0.1:'+server.address().port+'/api/measurement/openai-purchases';
    assert.equal((await fetch(url)).status,401);
    const response=await fetch(url,{headers:{authorization:'test-only','x-vc-analytics-consent':'accepted','x-vc-openai-ads-consent':'accepted'}});
    assert.match(response.headers.get('cache-control'),/no-store/);assert.equal((await response.json()).receipts.length,2);
    assert.deepEqual(await (await fetch(url,{headers:{authorization:'test-only'}})).json(),{receipts:[]});
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});

const source=readFileSync(new URL('../public/openai-purchase-events.js',import.meta.url),'utf8');
async function browser({consent=true,receipts=[],stored=new Map(),pathname='/meus-cursos.html'}={}){
  if(consent){stored.set('vc_analytics_consent','accepted');stored.set('vc_openai_ads_consent_v1','accepted');}
  const calls=[],requests=[],scripts=[],listeners={},timers=[];
  const storage={getItem:key=>stored.get(key)||null,setItem:(key,val)=>stored.set(key,val)};
  const window={addEventListener:(name,fn)=>listeners['window:'+name]=fn};
  const document={addEventListener:(name,fn)=>listeners[name]=fn,createElement:()=>({}),head:{appendChild:script=>{scripts.push(script);window.oaiq=(...args)=>calls.push(args);queueMicrotask(()=>script.onload?.());}}};
  runInNewContext(source,{window,document,location:{pathname,search:'?resultado=sucesso&ref=forged'},localStorage:storage,navigator:{locks:{request:async(_name,fn)=>fn()}},Date,Set,Promise,Number,Array,JSON,Error,
    setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout:()=>{},fetch:async(...args)=>{requests.push(args);return {ok:true,json:async()=>({receipts})};}});
  for(let i=0;i<12;i++)await Promise.resolve();
  return {calls,requests,scripts,listeners,stored,timers};
}
test('pixel never loads without consent, on unrelated pages or from success query parameters',async()=>{
  for(const options of [{consent:false},{receipts:[]},{pathname:'/admin.html'}]){const b=await browser(options);assert.equal(b.calls.length,0);assert.equal(b.scripts.length,0);}
  assert.equal((await browser({consent:false})).requests.length,0);
});
test('approved server receipt dispatches once, with opt-out and no personal/order fields',async()=>{
  const db=fixture(),receipt=openaiPurchaseReceipts(db,req())[0];db.close();
  const b=await browser({receipts:[receipt,receipt]});
  assert.equal(b.calls.filter(call=>call[0]==='measure').length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(b.calls.find(call=>call[0]==='measure')[3])),{event_id:receipt.eventId,opt_out:true});
  assert.equal(b.requests[0][1].headers['X-VC-OpenAI-Ads-Consent'],'accepted');
  const again=await browser({receipts:[receipt],stored:b.stored});assert.equal(again.scripts.length,0);
  b.stored.set('vc_openai_ads_consent_v1','essential');await b.listeners['vc:measurement-consent']();assert.deepEqual(b.calls.at(-1),['consent',false]);
});
test('invalid receipts and amounts are rejected before loading SDK',async()=>{
  const db=fixture(),receipt=openaiPurchaseReceipts(db,req())[0];db.close();
  for(const bad of [{...receipt,eventId:'private-order'}, {...receipt,data:{...receipt.data,amount:0}}, {...receipt,event:'checkout_started'}, {...receipt,data:{...receipt.data,contents:[{id:'bad',quantity:1,content_type:'product'}]}}])assert.equal((await browser({receipts:[bad]})).scripts.length,0);
});
test('compatibility loader contains no query-based sales or profile-update conversion',()=>{
  const legacy=readFileSync(new URL('../public/openai-ads.js',import.meta.url),'utf8');
  assert(!legacy.includes('paymentStatus'));assert(!legacy.includes('seller-profile'));assert(!legacy.includes('bzrcdn.openai.com'));
  assert(legacy.includes('installNeuralEntry'));assert(legacy.includes('/openai-purchase-events.js'));
});
