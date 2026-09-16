import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import Database from 'better-sqlite3';
import {setupSiteAssistantGifts,validGiftEmailReceipt} from '../site-assistant-gifts.js';
import {setupDigitalPublisher} from '../digital-publisher.js';

const origin='https://vitrinecity.com',slug='guia-pratico-da-zamioculca',course='livro-'+slug,version='lia-gift-zamioculca-v1',user={id:1,name:'Teste',email:'recipient@example.test'},tick=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture(t,{mail=true,sender,mailWaitMs=1000}={}){
  const db=new Database(':memory:');db.pragma('foreign_keys=ON');
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,email TEXT,whatsapp TEXT,marketing_email INTEGER DEFAULT 0,marketing_whatsapp INTEGER DEFAULT 0);
    INSERT INTO users VALUES(1,'Teste','recipient@example.test','',0,0),(2,'Outro','other@example.test','',0,0);
    CREATE TABLE course_orders(id INTEGER PRIMARY KEY,reference TEXT UNIQUE,user_id INTEGER NOT NULL REFERENCES users(id),course_slug TEXT,course_title TEXT,amount_cents INTEGER,status TEXT,mp_preference_id TEXT,mp_payment_id TEXT);
    CREATE TABLE course_enrollments(id INTEGER PRIMARY KEY,user_id INTEGER REFERENCES users(id),course_slug TEXT,order_reference TEXT UNIQUE REFERENCES course_orders(reference),status TEXT DEFAULT 'active');
    CREATE TABLE managed_courses(slug TEXT PRIMARY KEY,title TEXT,description TEXT,audience TEXT,price_cents INTEGER,modules INTEGER,cover_url TEXT,material_url TEXT,status TEXT,updated_at TEXT);
    INSERT INTO managed_courses(slug,title,status,material_url,price_cents) VALUES('${course}','Guia próprio','active','/ler-livro/${slug}',999);`);
  const app=express();app.use(express.json());
  const requireUser=(req,res,next)=>{req.user=db.prepare('SELECT id,name,email FROM users WHERE id=?').get(Number(req.headers['x-user']));return req.user?next():res.sendStatus(401);};
  const sameOriginOnly=(req,res,next)=>req.headers.origin===origin?next():res.sendStatus(403);
  const publisher=setupDigitalPublisher({app,db,requireUser,requireAdmin:(_req,res)=>res.sendStatus(401),sameOriginOnly,activeEnrollment:(id,s)=>db.prepare("SELECT 1 FROM course_enrollments WHERE user_id=? AND course_slug=? AND status='active'").get(id,s),schedule:false});
  db.prepare("UPDATE digital_books SET status='published',word_count=9450,page_count=31,cover_url='/uploads/guide.png' WHERE id='guide-zamioculca-2026'").run();
  db.prepare("UPDATE digital_book_chapters SET status='approved',content='Capítulo próprio com instruções de cultivo.' WHERE book_id='guide-zamioculca-2026'").run();
  const state={time:Date.parse('2026-09-11T17:00:00Z'),messages:[]};
  const send=async message=>{state.messages.push(message);return sender?sender(message):{accepted:[message.to],rejected:[],messageId:message.messageId};};
  const options={app,db,requireUser,sameOriginOnly,siteUrl:origin,sendGiftEmail:mail?send:null,schedule:false,now:()=>state.time,mailWaitMs};
  const service=setupSiteAssistantGifts(options),server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const req=async(path='',body,headers={})=>{const r=await fetch('http://127.0.0.1:'+server.address().port+(path.startsWith('/')?path:'/api/gifts/zamioculca'+path),{...(body?{method:'POST',body:JSON.stringify(body)}:{}),headers:{'Content-Type':'application/json','x-user':'1',origin,...headers}});return {status:r.status,data:r.headers.get('content-type')?.includes('json')?await r.json():await r.text()};};
  t.after(async()=>{service.close();publisher.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();});
  return {db,state,service,options,req,rows:()=>db.prepare('SELECT * FROM site_assistant_gift_claims').all()};
}

test('only the complete published owned guide with active private reader is eligible; SMTP is part of offer availability',async t=>{
  const f=await fixture(t);assert.equal(f.service.available(),true);const gift=f.service.catalog();assert.equal(gift.id,'zamioculca');assert.equal(gift.version,version);assert.equal(gift.amountCents,0);
  for(const statement of ["UPDATE digital_books SET status='review'","UPDATE digital_books SET source_trend_id='affiliate'","UPDATE managed_courses SET material_url='https://affiliate.test/download'","UPDATE digital_book_chapters SET status='pending' WHERE position=1"]){
    f.db.exec('SAVEPOINT check_gift');f.db.exec(statement);assert.equal(f.service.catalog(),null);f.db.exec('ROLLBACK TO check_gift; RELEASE check_gift');
  }
  const noMail=setupSiteAssistantGifts({...f.options,app:null,sendGiftEmail:null});assert.equal(noMail.catalog().available,false);noMail.close();
  assert.equal(f.state.messages.length,0);
});

test('a claim requires authenticated identity, explicit versioned acceptance and same origin',async t=>{
  const f=await fixture(t),before=f.db.prepare('SELECT * FROM users ORDER BY id').all();
  assert.equal((await f.req('/api/gifts/zamioculca/claim',{accepted:true,version},{'x-user':'0'})).status,401);
  assert.equal((await f.req('/api/gifts/zamioculca/claim',{accepted:true,version},{origin:'https://attacker.test'})).status,403);
  for(const body of [{accepted:false,version},{accepted:true,version:'other'},{accepted:true,version,userId:2},{accepted:true,version,email:'attacker@example.test'},{accepted:true,version,marketing:true}])assert.equal((await f.req('/api/gifts/zamioculca/claim',body)).status,400);
  assert.equal(f.rows().length,0);assert.equal(f.state.messages.length,0);assert.deepEqual(f.db.prepare('SELECT * FROM users ORDER BY id').all(),before);
});

test('grant is idempotent, zero cost and grants access through the existing reader without touching market price or paid-sales metrics',async t=>{
  const f=await fixture(t);assert.equal((await f.req('/ler-livro/'+slug)).status,403);
  const first=f.service.grant(user),second=f.service.grant(user);assert.equal(first.created,true);assert.equal(second.created,false);
  const order=f.db.prepare('SELECT * FROM course_orders').get();assert.equal(order.status,'gift');assert.equal(order.amount_cents,0);assert(order.reference.startsWith('gift_'));assert.equal(order.mp_preference_id,null);assert.equal(order.mp_payment_id,null);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM course_orders').get().n,1);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM course_enrollments').get().n,1);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM course_orders WHERE status IN ('approved','paid')").get().n,0);
  assert.equal(f.db.prepare('SELECT price_cents FROM managed_courses WHERE slug=?').get(course).price_cents,999);
  const reader=await f.req('/ler-livro/'+slug);assert.equal(reader.status,200);assert(reader.data.includes('Capítulo próprio'));
  const data=await f.req('/api/my-courses/'+course+'/book');assert.equal(data.status,200);assert.equal(data.data.chapters.length,10);
  assert.equal((await f.req('/ler-livro/'+slug,undefined,{'x-user':'2'})).status,403);
});

test('existing paid enrollment and payment records stay byte-for-byte unchanged while the explicit gift email is requested once',async t=>{
  const f=await fixture(t);f.db.prepare("INSERT INTO course_orders(reference,user_id,course_slug,course_title,amount_cents,status,mp_payment_id) VALUES('course_paid',1,?,'Guia pago',999,'approved','123')").run(course);
  f.db.prepare("INSERT INTO course_enrollments(user_id,course_slug,order_reference,status) VALUES(1,?,'course_paid','active')").run(course);
  const before={order:f.db.prepare('SELECT * FROM course_orders').all(),enrollment:f.db.prepare('SELECT * FROM course_enrollments').all()};
  assert.equal(f.service.grant(user).alreadyOwned,true);f.service.grant(user);await f.service.processEmails();await f.service.processEmails();
  assert.deepEqual(f.db.prepare('SELECT * FROM course_orders').all(),before.order);assert.deepEqual(f.db.prepare('SELECT * FROM course_enrollments').all(),before.enrollment);assert.equal(f.state.messages.length,1);
});

test('pending payment and revoked gift access are not silently replaced or reactivated',async t=>{
  const f=await fixture(t);f.db.prepare("INSERT INTO course_orders(reference,user_id,course_slug,course_title,amount_cents,status) VALUES('course_pending',1,?,'Guia',999,'pending')").run(course);
  assert.throws(()=>f.service.grant(user),error=>error.code==='gift_purchase_pending');assert.equal(f.rows().length,0);
  f.db.prepare("UPDATE course_orders SET status='cancelled'").run();f.service.grant(user);f.db.prepare("UPDATE course_enrollments SET status='revoked'").run();
  assert.throws(()=>f.service.grant(user),error=>error.code==='gift_access_changed');await f.service.processEmails();assert.equal(f.state.messages.length,0);assert.equal(f.service.access(1).email.status,'failed');
});

test('SMTP absence cannot claim a sent email or grant a new email-promised gift',async t=>{
  const f=await fixture(t,{mail:false});assert.equal((await f.req()).data.gift.available,false);
  const r=await f.req('/api/gifts/zamioculca/claim',{accepted:true,version});assert.equal(r.status,503);assert.equal(r.data.code,'gift_email_unavailable');assert.equal(f.rows().length,0);
});

test('real email acceptance is required, the authenticated recipient is fixed and retries never resend',async t=>{
  const f=await fixture(t);const response=await f.req('/api/gifts/zamioculca/claim',{accepted:true,version});assert.equal(response.status,201);await tick();
  const row=f.rows()[0];assert.equal(row.email_status,'sent');assert.equal(row.email_attempts,1);assert.equal(row.recipient,user.email);
  assert.equal(f.state.messages.length,1);const sent=f.state.messages[0];assert.equal(sent.to,user.email);assert(sent.text.includes(origin+'/meus-cursos.html'));assert(sent.text.includes(origin+'/ler-livro/'+slug));assert(!sent.text.includes('mercadopago'));
  assert.equal((await f.req('/api/gifts/zamioculca/claim',{accepted:true,version})).status,200);await f.service.processEmails();assert.equal(f.state.messages.length,1);
  assert.equal((await f.req('/api/gifts/zamioculca/status')).data.email.status,'sent');
  assert.equal((await f.req('/api/gifts/zamioculca/status',undefined,{'x-user':'2'})).data.claimed,false);
});

test('unknown email outcomes are terminal for automatic sending; false receipts and wrong recipients never count as sent',async t=>{
  for(const outcome of [undefined,{messageId:'x',accepted:[]},{messageId:'x',accepted:['other@example.test']},{messageId:'undefined',accepted:[user.email]},'throw']){
    const f=await fixture(t,{sender:async()=>{if(outcome==='throw')throw Error('SMTP uncertainty');return outcome;}});f.service.grant(user);await f.service.processEmails();await f.service.processEmails();
    assert.equal(f.state.messages.length,1);assert.equal(f.rows()[0].email_status,'uncertain');assert.deepEqual(f.service.access(1).email,{status:'pending',confirmation:'unknown',needsReview:true});
    f.service.grant(user);await f.service.processEmails();assert.equal(f.state.messages.length,1);
  }
  assert.equal(validGiftEmailReceipt({messageId:'<real@host>',accepted:[user.email],rejected:[user.email]},user.email),false);
});

test('concurrent workers claim once; interrupted claims become uncertain and only the matching late receipt resolves them',async t=>{
  let release,entered;const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
  const f=await fixture(t,{sender:async message=>{entered();await gate;return {accepted:[message.to],messageId:message.messageId};}});f.service.grant(user);
  const running=f.service.processEmails();await started;
  const other=setupSiteAssistantGifts({...f.options,app:null});await other.processEmails();assert.equal(f.state.messages.length,1);
  f.state.time+=120001;await other.processEmails();assert.equal(f.rows()[0].email_status,'uncertain');
  release();await running;await other.processEmails();assert.equal(f.rows()[0].email_status,'sent');assert.equal(f.state.messages.length,1);other.close();
});

test('SMTP timeout returns pending review without another attempt, while a later real receipt can settle that claim',async t=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const f=await fixture(t,{mailWaitMs:15,sender:async message=>{await gate;return {accepted:[message.to],messageId:message.messageId};}});
  f.service.grant(user);await f.service.processEmails();assert.equal(f.rows()[0].email_status,'uncertain');await f.service.processEmails();assert.equal(f.state.messages.length,1);
  release();await tick();assert.equal(f.rows()[0].email_status,'sent');assert.equal(f.rows()[0].email_attempts,1);
});

test('a retired claim or revoked entitlement at the last dispatch boundary never reaches SMTP',async t=>{
  for(const change of ['claim','access']){
    const f=await fixture(t);f.service.grant(user);const processing=f.service.processEmails();
    if(change==='claim')f.db.prepare("UPDATE site_assistant_gift_claims SET email_status='uncertain',email_claim_id='replaced'").run();
    else f.db.prepare("UPDATE course_enrollments SET status='revoked'").run();
    await processing;assert.equal(f.state.messages.length,0);assert.equal(f.service.access(1).email.needsReview,true);
  }
});
