import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import express from 'express';
import Database from 'better-sqlite3';
import {setupSiteSalesExperience} from '../site-sales-experience.js';

const DAY=86400000,ORIGIN='https://vitrinecity.test';
function setup(t,{file=':memory:',clock=Date.parse('2026-09-11T10:00:00Z')}={}){
  const db=new Database(file),app=express();app.use(express.json());let time=clock,allowed=true;
  db.exec(`CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY);INSERT OR IGNORE INTO users VALUES(1);INSERT OR IGNORE INTO users VALUES(2);
    CREATE TABLE IF NOT EXISTS marketplace_orders(reference TEXT PRIMARY KEY,buyer_user_id INTEGER,total_cents INTEGER,payment_status TEXT,mp_payment_id TEXT);
    CREATE TABLE IF NOT EXISTS marketplace_payment_events(order_reference TEXT,payment_id TEXT,payment_status TEXT);
    CREATE TABLE IF NOT EXISTS service_orders(reference TEXT PRIMARY KEY,amount_cents INTEGER,status TEXT,mp_payment_id TEXT);
    CREATE TABLE IF NOT EXISTS course_orders(reference TEXT PRIMARY KEY,user_id INTEGER,amount_cents INTEGER,status TEXT,mp_payment_id TEXT);`);
  const args={app,db,siteUrl:ORIGIN,requireAdmin:(req,res,next)=>req.get('x-test-admin')==='yes'?next():res.sendStatus(403),canRun:()=>allowed,schedule:false,now:()=>time};
  const experience=setupSiteSalesExperience(args);t.after(()=>{experience.close();db.close();});
  function browser(){const jar={},flags={};return {jar,flags,req:()=>({headers:{cookie:Object.entries(jar).map(([k,v])=>k+'='+v).join(';')},user:{id:1}}),res:{cookie(name,value,options){jar[name]=value;flags[name]=options;}}};}
  const newSession=()=>{const b=browser(),req=b.req(),session=experience.session(req,b.res);return {...b,session};};
  return {db,app,args,experience,newSession,browser,now:()=>time,advance:ms=>time+=ms,setTime:value=>time=value,pause:()=>allowed=false};
}

test('recent attributed orders show expected pending values and public titles without settling payments or exposing identity',t=>{
  const x=setup(t),b=x.newSession();x.experience.markInterest(b.req(),b.res,'message');
  x.db.exec(`ALTER TABLE course_orders ADD COLUMN course_title TEXT;ALTER TABLE service_orders ADD COLUMN name TEXT;
    CREATE TABLE marketplace_order_items(id INTEGER PRIMARY KEY,order_reference TEXT,product_name TEXT);
    INSERT INTO course_orders VALUES('course-visible',1,2399,'approved','PRIVATE_PAYMENT','Curso de plantas');
    INSERT INTO service_orders VALUES('service-visible',5900,'pending','PRIVATE_PAYMENT','PRIVATE_PERSON');
    INSERT INTO marketplace_orders VALUES('shop-visible',1,3100,'pending','PRIVATE_PAYMENT');
    INSERT INTO marketplace_order_items VALUES(1,'shop-visible','Adubo para plantas');`);
  for(const [orderType,orderReference] of [['course','course-visible'],['digital_service','service-visible'],['marketplace','shop-visible']]){
    x.experience.captureOrder(b.req(),{orderType,orderReference});x.advance(1);
  }
  const before=x.db.prepare('SELECT * FROM site_sales_order_attribution').all(),state=x.experience.snapshot();
  assert.deepEqual(state.recentOrders.map(row=>[row.title,row.amountCents,row.paymentStatus]),[['Adubo para plantas',3100,'pending'],['Serviço digital',5900,'pending'],['Curso de plantas',2399,'pending']]);
  assert.equal(state.metrics.paidOrders,0);assert.equal(state.metrics.revenueCents,0);
  assert.deepEqual(x.db.prepare('SELECT * FROM site_sales_order_attribution').all(),before);
  for(const row of state.recentOrders)assert.deepEqual(Object.keys(row).sort(),['orderType','orderReference','title','paymentStatus','amountCents','createdAt','approvedAt','versionNumber'].sort());
  assert.doesNotMatch(JSON.stringify(state.recentOrders),/PRIVATE|session|cookie|payment_id|user_id|email/);
});

test('recent attributed orders include previous versions, cap at twenty and keep safe metadata fallbacks',t=>{
  const x=setup(t),b=x.newSession();x.experience.markInterest(b.req(),b.res,'message');
  x.db.exec("INSERT INTO service_orders VALUES('old-service',500,'approved','pay-old')");
  x.experience.captureOrder(b.req(),{orderType:'digital_service',orderReference:'old-service'});
  x.experience.recordPayment({orderType:'digital_service',orderReference:'old-service',status:'approved',amountCents:500,paymentId:'pay-old'});
  x.advance(DAY);x.experience.review();const traffic=x.newSession();x.experience.markInterest(traffic.req(),traffic.res,'message');x.advance(DAY);x.experience.review();
  const newer=x.newSession();x.experience.markInterest(newer.req(),newer.res,'message');
  for(let i=0;i<19;i++){x.advance(1);const ref='course-'+i;x.db.prepare("INSERT INTO course_orders VALUES(?,1,2399,'pending','')").run(ref);x.experience.captureOrder(newer.req(),{orderType:'course',orderReference:ref});}
  let rows=x.experience.snapshot().recentOrders;assert.equal(rows.length,20);assert.equal(rows.at(-1).versionNumber,1);assert.equal(rows[0].versionNumber,2);assert.equal(rows[0].title,'Curso digital');
  x.advance(1);x.db.exec("INSERT INTO service_orders VALUES('newest',8900,'pending','')");x.experience.captureOrder(newer.req(),{orderType:'video_package',orderReference:'newest'});
  rows=x.experience.snapshot().recentOrders;assert.equal(rows.length,20);assert.equal(rows[0].title,'Pacote de vídeos');assert.equal(rows.some(row=>row.orderReference==='old-service'),false);
});

test('session uses an expiring opaque HttpOnly cookie independent from auth, and assigns a fixed version',t=>{
  const x=setup(t),b=x.newSession();assert.match(b.jar.vc_site_sales,/^[\w-]{32}$/);assert.notEqual(b.jar.vc_site_sales,b.session.id);
  assert.deepEqual(b.flags.vc_site_sales,{httpOnly:true,sameSite:'lax',secure:true,maxAge:DAY,path:'/'});
  assert.equal(x.experience.existingSession(b.req()).id,b.session.id);
  const stored=x.db.prepare('SELECT * FROM site_sales_sessions').get();assert.equal(stored.token_hash.length,64);assert.notEqual(stored.token_hash,b.jar.vc_site_sales);
  assert.equal(x.experience.existingSession({headers:{cookie:'vc_site_sales=bad; session=private-auth-token'}}),null);
  assert.equal(x.experience.existingSession({headers:{cookie:`vc_site_sales=${b.jar.vc_site_sales}; vc_site_sales=${b.jar.vc_site_sales}`}}),null);
  x.advance(DAY);assert.equal(x.experience.existingSession(b.req()),null);
  assert.notEqual(x.experience.session(b.req(),b.res).id,b.session.id);
});

test('context and clicks dedupe, arbitrary offers are refused, and messages/outcomes contain no raw text',t=>{
  const x=setup(t),b=x.newSession(),id=b.session.id;
  assert.equal(x.experience.recordEvent(id,'context'),true);assert.equal(x.experience.recordEvent(id,'context'),false);
  assert.equal(x.experience.recordEvent(id,'purchase'),false);assert.equal(x.experience.recordEvent(id,'offer_click',{assetType:'affiliate',assetId:'unknown'}),false);
  x.experience.registerOffers(id,[{assetType:'affiliate',assetId:'vaso'},{assetType:'group',assetId:'vip'}]);
  assert.equal(x.experience.recordEvent(id,'offer_click',{assetType:'affiliate',assetId:'vaso',email:'PRIVATE@example.test'}),true);
  assert.equal(x.experience.recordEvent(id,'offer_click',{assetType:'affiliate',assetId:'vaso'}),false);
  x.experience.recordEvent(id,'message',{message:'PRIVATE_MESSAGE'});x.experience.recordOutcome(id,{outcome:'answered',durationMs:456});
  const snapshot=x.experience.snapshot();assert.equal(snapshot.metrics.sessions,1);assert.equal(snapshot.metrics.offerClicks,1);assert.equal(snapshot.metrics.paidOrders,0);assert.equal(snapshot.metrics.externalSales,'unknown');
  assert.doesNotMatch(JSON.stringify(x.db.prepare('SELECT * FROM site_sales_events').all()),/PRIVATE|email|message.*body/);
  assert.equal(x.experience.recordOutcome(id,{outcome:'secret-error'}),false);
});

test('twenty-four hours without traffic records a review and keeps the seller active across restart',t=>{
  const x=setup(t);x.advance(DAY-1);assert.equal(x.experience.review().changed,false);x.advance(1);
  assert.equal(x.experience.review().status,'no_traffic');assert.equal(x.experience.snapshot().current.number,1);
  const restarted=setupSiteSalesExperience(x.args);t.after(()=>restarted.close());
  assert.equal(restarted.review().status,'collecting');assert.equal(restarted.snapshot().history.length,1);
  assert.equal(restarted.snapshot().current.status,'active');
});

test('low traffic produces one bounded trial after a full day, labels uncertainty and never immediately rotates again',t=>{
  const x=setup(t),b=x.newSession();x.experience.recordEvent(b.session.id,'context');x.advance(DAY);
  const review=x.experience.review();assert.equal(review.status,'trial_low_traffic');assert.equal(review.changed,true);
  const state=x.experience.snapshot();assert.equal(state.current.number,2);assert.equal(state.current.approach,'simple_choices');assert.equal(state.current.confidence,'low');
  assert.equal(state.current.reasonCode,'few_opens');assert.equal(state.versions[1].status,'superseded');assert.equal(x.experience.review().changed,false);
  x.advance(DAY-1);assert.equal(x.experience.review().changed,false);
});

test('a validated direct chat counts an attended session even without a preceding context request',t=>{
  const x=setup(t),b=x.newSession();x.experience.markInterest(b.req(),b.res,'message');
  assert.equal(x.experience.snapshot().metrics.sessions,1);x.advance(DAY);
  const result=x.experience.review();assert.equal(result.changed,true);assert.notEqual(result.status,'no_traffic');
});

test('a repeated valid offer click renews the 24-hour interest window without duplicating click counts',t=>{
  const x=setup(t),b=x.newSession();x.experience.registerOffers(b.session.id,[{assetType:'product',assetId:'1'}]);
  const detail={assetType:'product',assetId:'1'};x.experience.markInterest(b.req(),b.res,'offer_click',detail);const first=b.jar.vc_site_sales_interest;
  x.advance(23*3600000);assert.equal(x.experience.markInterest(b.req(),b.res,'offer_click',detail),true);assert.notEqual(b.jar.vc_site_sales_interest,first);assert.equal(x.experience.snapshot().metrics.offerClicks,1);
  x.advance(2*3600000);x.db.exec("INSERT INTO service_orders VALUES('return-click',500,'pending','')");assert.equal(x.experience.captureOrder(b.req(),{orderType:'digital_service',orderReference:'return-click'}),true);
});

test('discount eligibility is a server boolean requiring real Lia interest within 24h; forged cookies do not grant it',t=>{
  const x=setup(t),b=x.newSession();assert.equal(x.experience.canApplyLiaDiscount(b.req()),false);
  assert.equal(x.experience.canApplyLiaDiscount({headers:{cookie:'vc_site_sales_interest='+'A'.repeat(32)}}),false);
  x.experience.markInterest(b.req(),b.res,'message');assert.equal(x.experience.canApplyLiaDiscount(b.req()),true);
  x.advance(DAY-1);assert.equal(x.experience.canApplyLiaDiscount(b.req()),true);
  x.advance(1);assert.equal(x.experience.canApplyLiaDiscount(b.req()),false);
});

test('funneled traffic chooses checkout help, while sufficient sample is still not claimed proven improvement',t=>{
  const x=setup(t);for(let i=0;i<20;i++){const b=x.newSession();for(const type of ['context','open','message'])x.experience.recordEvent(b.session.id,type);x.experience.registerOffers(b.session.id,[{assetType:'product',assetId:'1'}]);x.experience.recordEvent(b.session.id,'offer_click',{assetType:'product',assetId:'1'});}
  x.advance(DAY);assert.equal(x.experience.review().status,'trial_started');const v=x.experience.snapshot().current;
  assert.equal(v.approach,'checkout_help');assert.equal(v.confidence,'limited');assert.equal(v.reasonCode,'no_attributed_payment');
});

test('a global pause and backward clock cannot create new approaches',t=>{
  const x=setup(t),b=x.newSession();x.experience.recordEvent(b.session.id,'context');x.setTime(x.now()-DAY);assert.equal(x.experience.review().changed,false);
  x.advance(3*DAY);x.pause();assert.equal(x.experience.review().status,'paused');assert.equal(x.experience.snapshot().versions.length,1);
});

test('checkout attribution requires actual interest, canonical order, correct buyer and is immutable',t=>{
  const x=setup(t),b=x.newSession();x.db.prepare('INSERT INTO marketplace_orders VALUES(?,1,1000,\'pending\',\'\')').run('order-1');
  assert.equal(x.experience.captureOrder(b.req(),{orderType:'marketplace',orderReference:'order-1'}),false);
  x.experience.markInterest(b.req(),b.res,'message');assert.equal(x.experience.captureOrder({...b.req(),user:{id:2}},{orderType:'marketplace',orderReference:'order-1'}),false);
  assert.equal(x.experience.captureOrder(b.req(),{orderType:'marketplace',orderReference:'missing'}),false);
  assert.equal(x.experience.captureOrder(b.req(),{orderType:'marketplace',orderReference:'order-1'}),true);
  assert.equal(x.experience.captureOrder(b.req(),{orderType:'marketplace',orderReference:'order-1'}),false);
  const b2=x.newSession();x.experience.markInterest(b2.req(),b2.res,'message');assert.equal(x.experience.captureOrder(b2.req(),{orderType:'marketplace',orderReference:'order-1'}),false);
  assert.equal(x.db.prepare('SELECT session_id FROM site_sales_order_attribution').get().session_id,b.session.id);
});

test('late verified payment belongs to its original version, is idempotent and reversals remove attributed revenue',t=>{
  const x=setup(t),b=x.newSession();x.experience.recordEvent(b.session.id,'context');x.advance(23*60*60*1000);x.experience.markInterest(b.req(),b.res,'message');
  x.advance(2*60*60*1000);assert.equal(x.experience.existingSession(b.req()),null);assert.equal(x.experience.review().changed,true);
  x.db.prepare('INSERT INTO marketplace_orders VALUES(?,1,1000,\'pending\',\'\')').run('late');
  assert.equal(x.experience.captureOrder(b.req(),{orderType:'marketplace',orderReference:'late'}),true,'interest attribution lasts 24h after message, independently of functional session expiry');
  const payload={orderType:'marketplace',orderReference:'late',status:'approved',amountCents:1000,paymentId:'p1'};
  assert.equal(x.experience.recordPayment(payload),false,'client success labels cannot settle an order');
  x.db.exec("UPDATE marketplace_orders SET payment_status='approved',mp_payment_id='p1' WHERE reference='late'");
  assert.equal(x.experience.recordPayment(payload),false,'a matching approved payment event is required');
  x.db.exec("INSERT INTO marketplace_payment_events VALUES('late','p1','approved')");
  assert.equal(x.experience.recordPayment({...payload,amountCents:999}),false);assert.equal(x.experience.recordPayment(payload),true);assert.equal(x.experience.recordPayment(payload),true);
  let old=x.experience.snapshot().versions.find(v=>v.number===1);assert.equal(old.paidOrders,1);assert.equal(old.revenueCents,1000);assert.equal(x.experience.snapshot().metrics.paidOrders,0);
  x.db.exec("UPDATE marketplace_orders SET payment_status='refunded' WHERE reference='late';INSERT INTO marketplace_payment_events VALUES('late','p1','refunded')");
  assert.equal(x.experience.recordPayment({...payload,status:'refunded'}),true);assert.equal(x.experience.recordPayment(payload),false,'stale approved callback cannot undo refund');
  old=x.experience.snapshot().versions.find(v=>v.number===1);assert.equal(old.paidOrders,0);assert.equal(old.revenueCents,0);
  x.advance(DAY);assert.equal(x.experience.captureOrder(b.req(),{orderType:'marketplace',orderReference:'late'}),false);
});

test('actual signup counts once, remains a positive result, and zero paid sales may still start a labeled daily trial',t=>{
  const x=setup(t),b=x.newSession();x.experience.recordEvent(b.session.id,'context');assert.equal(x.experience.recordSignup(b.req(),1),false);
  x.experience.markInterest(b.req(),b.res,'message');assert.equal(x.experience.recordSignup(b.req(),999),false);assert.equal(x.experience.recordSignup(b.req(),1),true);assert.equal(x.experience.recordSignup(b.req(),1),false);
  x.advance(DAY);assert.equal(x.experience.review().status,'trial_low_traffic');const snapshot=x.experience.snapshot();assert.equal(snapshot.versions.find(v=>v.number===1).signups,1);assert.equal(snapshot.versions.length,2);assert.equal(snapshot.current.reasonCode,'signups_without_paid_orders');assert.doesNotMatch(JSON.stringify(snapshot),/user_id|token_hash|session_id/);
});

test('service and course checkouts share verified settlement but affiliate clicks never create a sale',t=>{
  const x=setup(t),b=x.newSession();x.experience.markInterest(b.req(),b.res,'message');
  x.db.exec("INSERT INTO service_orders VALUES('svc',500,'approved','p2');INSERT INTO course_orders VALUES('course',1,700,'approved','p3')");
  for(const [orderType,orderReference,amountCents,paymentId] of [['digital_service','svc',500,'p2'],['course','course',700,'p3']]){
    assert.equal(x.experience.captureOrder(b.req(),{orderType,orderReference}),true);assert.equal(x.experience.recordPayment({orderType,orderReference,status:'approved',amountCents,paymentId}),true);
  }
  assert.equal(x.experience.recordPayment({orderType:'affiliate',orderReference:'offer',status:'approved',amountCents:500,paymentId:'p4'}),false);
  assert.equal(x.experience.snapshot().metrics.paidOrders,2);assert.equal(x.experience.snapshot().metrics.externalSales,'unknown');
});

test('a recently pending checkout is reported as pending and does not trigger a failure diagnosis',t=>{
  const x=setup(t),b=x.newSession();x.experience.recordEvent(b.session.id,'context');x.experience.markInterest(b.req(),b.res,'message');
  x.db.exec("INSERT INTO marketplace_orders VALUES('pending',1,1000,'pending','')");x.experience.captureOrder(b.req(),{orderType:'marketplace',orderReference:'pending'});
  x.advance(DAY);assert.equal(x.experience.review().status,'awaiting_payment');assert.equal(x.experience.snapshot().versions.length,1);
});

test('two database connections share the daily claim, and rollback preserves history and prevents an immediate new trial',t=>{
  const dir=mkdtempSync(path.join(tmpdir(),'vc-site-sales-'));
  const x=setup(t,{file:path.join(dir,'test.db')}),y=setup(t,{file:path.join(dir,'test.db')}),b=x.newSession();x.experience.recordEvent(b.session.id,'context');x.advance(DAY);y.advance(DAY);
  t.after(()=>{assert.equal(path.dirname(path.resolve(dir)),path.resolve(tmpdir()));assert.match(path.basename(dir),/^vc-site-sales-[A-Za-z0-9]+$/);rmSync(dir,{recursive:true,force:true});});
  assert.equal(x.experience.review().changed,true);assert.equal(y.experience.review().changed,false);const state=x.experience.snapshot();assert.equal(state.versions.length,2);
  assert.throws(()=>x.experience.rollback({versionId:1,revision:0}),error=>error.status===409);
  const rolled=x.experience.rollback({versionId:1,revision:state.revision});assert.equal(rolled.current.number,3);assert.equal(rolled.current.approach,'helpful_question');assert.equal(rolled.current.reasonCode,'rollback_version_1');assert.equal(rolled.versions[1].status,'rolled_back');assert.equal(y.experience.review().changed,false);assert.equal(rolled.history.length,1);
  assert.equal(x.experience.rollback({versionId:1}).current.number,3,'retrying the same rollback does not add another version');
});

test('cleanup expires functional handles, keeps late-sale attribution and preserves aggregate review history',t=>{
  const x=setup(t),b=x.newSession();x.experience.recordEvent(b.session.id,'context');x.experience.registerOffers(b.session.id,[{assetType:'group',assetId:'vip'}]);x.advance(23*3600000);x.experience.markInterest(b.req(),b.res,'message');
  x.advance(2*3600000);x.experience.review();x.experience.cleanup();
  assert.equal(x.experience.existingSession(b.req()),null);assert.equal(x.db.prepare('SELECT COUNT(*) n FROM site_sales_offers').get().n,0);assert.match(x.db.prepare('SELECT token_hash FROM site_sales_sessions').get().token_hash,/^expired:/);
  x.db.exec("INSERT INTO service_orders VALUES('after-expiry',500,'pending','')");assert.equal(x.experience.captureOrder(b.req(),{orderType:'digital_service',orderReference:'after-expiry'}),true,'independent interest token remains valid for its own 24h');
  x.advance(32*DAY);x.experience.cleanup();assert.equal(x.db.prepare('SELECT COUNT(*) n FROM site_sales_events').get().n,0);assert.equal(x.db.prepare('SELECT COUNT(*) n FROM site_sales_interests').get().n,0);assert.equal(x.experience.snapshot().history.length,1);assert.equal(x.db.prepare('SELECT COUNT(*) n FROM site_sales_order_attribution').get().n,1);
});

test('HTTP events need same origin and existing session; admin reads do not mutate and rollback is authenticated',async t=>{
  const x=setup(t);x.app.get('/test/context',(req,res)=>{const s=x.experience.session(req,res);x.experience.recordEvent(s.id,'context');x.experience.registerOffers(s.id,[{assetType:'group',assetId:'vip'}]);res.json({version:s.versionNumber});});
  const server=x.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));const base='http://127.0.0.1:'+server.address().port;
  const post=(body,{cookie='',origin=ORIGIN,admin=false,path='/api/site-assistant/event'}={})=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',origin,cookie,...(admin?{'x-test-admin':'yes'}:{})},body:JSON.stringify(body)});
  assert.equal((await post({type:'open'})).status,409);const context=await fetch(base+'/test/context'),cookie=context.headers.get('set-cookie').split(';')[0];
  assert.equal((await post({type:'open'},{cookie,origin:'https://evil.test'})).status,403);
  for(const type of ['purchase','signup','context','message'])assert.equal((await post({type},{cookie})).status,400);
  assert.equal((await post({type:'open',message:'private'},{cookie})).status,400);
  assert.equal((await post({type:'offer_click',assetType:'group',assetId:'other'},{cookie})).status,400);
  for(const type of ['invitation','open','dismiss'])assert.equal((await post({type},{cookie})).status,204);
  const click=await post({type:'offer_click',assetType:'group',assetId:'vip'},{cookie});assert.equal(click.status,204);assert.match(click.headers.get('set-cookie'),/vc_site_sales_interest=.*HttpOnly/);
  const adminPath='/api/admin/site-assistant/experiments';assert.equal((await fetch(base+adminPath)).status,403);
  const before=x.experience.snapshot().revision,read=await fetch(base+adminPath,{headers:{'x-test-admin':'yes'}});assert.equal(read.status,200);assert.equal(read.headers.get('cache-control'),'no-store');assert.equal((await read.json()).revision,before);
  assert.equal((await post({versionId:1},{path:adminPath+'/rollback'})).status,403);
  assert.equal((await post({versionId:1},{path:adminPath+'/rollback',admin:true,origin:'https://evil.test'})).status,403);
  assert.equal(x.experience.snapshot().metrics.paidOrders,0);
});
