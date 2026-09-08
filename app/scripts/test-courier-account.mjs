import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash,randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import express from 'express';
import Database from 'better-sqlite3';
import {setupCourierAccount} from '../courier-account.js';

const appDir=fileURLToPath(new URL('..',import.meta.url));
const digest=value=>createHash('sha256').update(String(value)).digest('hex');
const passwordHash=value=>{const salt=randomBytes(16).toString('hex');return `scrypt:${salt}:${scryptSync(value,salt,64).toString('hex')}`;};
const checkPassword=(value,hash)=>{const [,salt,encoded]=hash.split(':');return timingSafeEqual(Buffer.from(encoded,'hex'),scryptSync(value,salt,64));};
const initialPassword='Senha-inicial-123!';
async function fixture(t,{mailer=true}={}){
  const db=new Database(':memory:');db.pragma('foreign_keys=ON');
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,password_hash TEXT);
    CREATE TABLE local_delivery_couriers(id INTEGER PRIMARY KEY,name TEXT,whatsapp TEXT,city TEXT,state TEXT,status TEXT,available INTEGER,balance_cents INTEGER,password_hash TEXT,updated_at TEXT);
    CREATE TABLE local_delivery_courier_sessions(token_hash TEXT PRIMARY KEY,courier_id INTEGER,expires_at INTEGER);
    CREATE TABLE marketplace_orders(reference TEXT PRIMARY KEY,payment_status TEXT,customer_confirmed_at TEXT);
    CREATE TABLE local_delivery_jobs(id INTEGER PRIMARY KEY,order_reference TEXT,courier_id INTEGER,status TEXT);
    CREATE TABLE local_delivery_offers(id INTEGER PRIMARY KEY,job_id INTEGER,courier_id INTEGER,status TEXT,responded_at TEXT);
    CREATE TABLE local_delivery_withdrawals(id INTEGER PRIMARY KEY,courier_id INTEGER,amount_cents INTEGER,status TEXT);
    CREATE TABLE marketplace_manual_payouts(id INTEGER PRIMARY KEY,recipient_type TEXT,recipient_reference TEXT,amount_cents INTEGER,status TEXT);
    CREATE TABLE local_delivery_ledger(id INTEGER PRIMARY KEY,courier_id INTEGER,amount_cents INTEGER);
    INSERT INTO users VALUES(1,'customer-password-untouched');`);
  const hash=passwordHash(initialPassword);
  for(const id of [1,2])db.prepare("INSERT INTO local_delivery_couriers VALUES (?,?,'62999999999','Silvânia','GO','active',1,0,?,'before')").run(id,`Teste ${id}`,hash);
  let current=Date.now(),failMail=false;const messages=[],attempts=new Map(),redispatched=[];
  const signIn=(id=1)=>{const token=randomBytes(20).toString('hex');db.prepare('INSERT INTO local_delivery_courier_sessions VALUES (?,?,?)').run(digest(token),id,current+86400000);return token;};
  const app=express();app.use(express.json());
  const requireCourier=(req,res,next)=>{
    const courier=db.prepare("SELECT c.* FROM local_delivery_courier_sessions s JOIN local_delivery_couriers c ON c.id=s.courier_id WHERE s.token_hash=? AND s.expires_at>? AND c.status='active'").get(digest(req.headers['x-session']||''),current);
    if(!courier)return res.status(401).json({error:'login'});req.courier=courier;next();
  };
  const requireAdmin=(req,res,next)=>{if(req.headers['x-role']!=='admin')return res.status(403).json({error:'admin'});req.user={id:1};next();};
  let origin;
  const sameOriginOnly=(req,res,next)=>req.headers.origin!==origin?res.status(403).json({error:'origin'}):next();
  setupCourierAccount({app,db,requireCourier,requireAdmin,sameOriginOnly,hashPassword:passwordHash,verifyPassword:checkPassword,sessionHash:digest,
    allowAttempt:(key,limit,windowMs)=>{const times=(attempts.get(key)||[]).filter(time=>time>current-windowMs);attempts.set(key,times);if(times.length>=limit)return false;times.push(current);return true;},
    sendMail:mailer?async message=>{if(failMail)throw Error('simulated smtp failure');messages.push(message);}:null,
    siteUrl:'https://vitrine.example',publicDir:path.join(appDir,'public'),redispatch:id=>redispatched.push(id),now:()=>current});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));origin=`http://127.0.0.1:${server.address().port}`;
  const request=async(url,{method='POST',body,session,admin=false,foreign=false}={})=>{
    const response=await fetch(origin+url,{method,headers:{origin:foreign?'https://other.example':origin,'content-type':'application/json',...(session?{'x-session':session}:{}),...(admin?{'x-role':'admin'}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,headers:response.headers,body:await response.json().catch(()=>null)};
  };
  const mailToken=purpose=>new URL(messages.at(-1).text.match(/https:\/\/[^\s]+/)[0]).searchParams.get(purpose==='verify'?'verify':'token');
  const verifyEmail=async(email='courier@example.test',id=1)=>{
    const response=await request('/api/courier/account/email',{session:signIn(id),body:{email,currentPassword:initialPassword}});assert.equal(response.status,200);
    const token=mailToken('verify');assert.equal((await request('/api/courier/account/email/confirm',{body:{token}})).status,200);return token;
  };
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();});
  return {db,request,signIn,messages,mailToken,verifyEmail,redispatched,origin,
    advance:ms=>{current+=ms;},failMail:value=>{failMail=value;}};
}

test('courier recovery requires current password and a verified mailbox, independently of customers',async t=>{
  const f=await fixture(t),session=f.signIn();
  assert.equal((await f.request('/api/courier/account',{method:'GET'})).status,401);
  assert.equal((await f.request('/api/courier/account/email',{body:{email:'courier@example.test',currentPassword:initialPassword}})).status,401);
  assert.equal((await f.request('/api/courier/account/email',{session,foreign:true,body:{email:'courier@example.test',currentPassword:initialPassword}})).status,403);
  assert.equal((await f.request('/api/courier/account/email',{session,body:{email:'courier@example.test',currentPassword:'wrong'}})).status,400);
  assert.equal(f.messages.length,0);
  const bind=await f.request('/api/courier/account/email',{session,body:{email:'Courier@Example.Test',currentPassword:initialPassword}});assert.equal(bind.status,200);
  const verify=f.mailToken('verify'),row=f.db.prepare('SELECT * FROM courier_recovery_tokens').get();
  assert.equal(row.token_hash,digest(verify));assert.notEqual(row.token_hash,verify);assert.equal(row.used_at,null);
  const unverified=await f.request('/api/courier/password-reset/request',{body:{email:'courier@example.test'}});
  const unknown=await f.request('/api/courier/password-reset/request',{body:{email:'unknown@example.test'}});
  assert.deepEqual(unverified.body,unknown.body);assert.equal(f.messages.length,1);
  assert.equal((await f.request('/api/courier/account/email/confirm',{body:{token:verify}})).status,200);
  assert.equal((await f.request('/api/courier/account/email/confirm',{body:{token:verify}})).status,400);
  const own=await f.request('/api/courier/account',{method:'GET',session});assert.equal(own.body.recoveryEmail,'courier@example.test');assert.equal(own.headers.get('cache-control'),'no-store');
  await f.request('/api/courier/password-reset/request',{body:{email:'courier@example.test'}});const token=f.mailToken('reset');
  assert.equal((await f.request('/api/courier/password-reset/confirm',{body:{token,password:'short'}})).status,400);
  assert.equal((await f.request('/api/courier/password-reset/confirm',{foreign:true,body:{token,password:'Nova-senha-123!'}})).status,403);
  assert.equal((await f.request('/api/courier/password-reset/confirm',{body:{token,password:'Nova-senha-123!'}})).status,200);
  assert.equal((await f.request('/api/courier/password-reset/confirm',{body:{token,password:'Outra-senha-123!'}})).status,400);
  assert.equal((await f.request('/api/courier/account',{method:'GET',session})).status,401);
  assert.equal(checkPassword('Nova-senha-123!',f.db.prepare('SELECT password_hash FROM local_delivery_couriers WHERE id=1').get().password_hash),true);
  assert.equal(f.db.prepare('SELECT password_hash FROM users WHERE id=1').get().password_hash,'customer-password-untouched');
  assert.equal(f.db.prepare('SELECT count(*) n FROM courier_recovery_tokens WHERE courier_id=1 AND used_at IS NULL').get().n,0);
});

test('expired, superseded, blocked and pre-admin-password tokens cannot change courier credentials',async t=>{
  const f=await fixture(t);await f.verifyEmail();
  await f.request('/api/courier/password-reset/request',{body:{email:'courier@example.test'}});const old=f.mailToken('reset');
  await f.request('/api/courier/password-reset/request',{body:{email:'courier@example.test'}});let token=f.mailToken('reset');
  assert.equal((await f.request('/api/courier/password-reset/confirm',{body:{token:old,password:'Nova-senha-123'}})).status,400);
  f.advance(31*60*1000);
  assert.equal((await f.request('/api/courier/password-reset/confirm',{body:{token,password:'Nova-senha-123'}})).status,400);
  await f.request('/api/courier/password-reset/request',{body:{email:'courier@example.test'}});token=f.mailToken('reset');
  f.db.prepare("UPDATE local_delivery_couriers SET status='blocked' WHERE id=1").run();
  assert.equal((await f.request('/api/courier/password-reset/confirm',{body:{token,password:'Nova-senha-123'}})).status,400);
  f.db.prepare("UPDATE local_delivery_couriers SET status='active',password_hash=? WHERE id=1").run(passwordHash('Admin-temporary-123'));
  assert.equal((await f.request('/api/courier/password-reset/confirm',{body:{token,password:'Nova-senha-123'}})).status,400);
});

test('mailbox reassignment requires password, possession and uniqueness; verification expires',async t=>{
  const f=await fixture(t);await f.verifyEmail();const session=f.signIn(2),count=f.messages.length;
  const duplicate=await f.request('/api/courier/account/email',{session,body:{email:'courier@example.test',currentPassword:initialPassword}});
  assert.equal(duplicate.status,200);assert.equal(f.messages.length,count);assert.equal(f.db.prepare('SELECT count(*) n FROM courier_recovery_profiles').get().n,1);
  await f.request('/api/courier/account/email',{session,body:{email:'second@example.test',currentPassword:initialPassword}});let token=f.mailToken('verify');
  f.advance(31*60*1000);assert.equal((await f.request('/api/courier/account/email/confirm',{body:{token}})).status,400);
  await f.request('/api/courier/account/email',{session,body:{email:'second@example.test',currentPassword:initialPassword}});token=f.mailToken('verify');
  f.db.prepare('UPDATE local_delivery_couriers SET password_hash=? WHERE id=2').run(passwordHash('Changed-by-admin-123'));
  assert.equal((await f.request('/api/courier/account/email/confirm',{body:{token}})).status,400);
  assert.equal(f.db.prepare('SELECT count(*) n FROM courier_recovery_profiles').get().n,1);
});

test('own password changes revoke sessions and recovery tokens; endpoints are rate limited',async t=>{
  const f=await fixture(t);await f.verifyEmail();const session=f.signIn();
  await f.request('/api/courier/password-reset/request',{body:{email:'courier@example.test'}});const reset=f.mailToken('reset');
  assert.equal((await f.request('/api/courier/account/password',{method:'PUT',session,body:{currentPassword:'wrong',password:'New-password-123'}})).status,400);
  assert.equal((await f.request('/api/courier/account/password',{method:'PUT',session,body:{currentPassword:initialPassword,password:'New-password-123'}})).status,200);
  assert.equal((await f.request('/api/courier/account',{method:'GET',session})).status,401);
  assert.equal((await f.request('/api/courier/password-reset/confirm',{body:{token:reset,password:'Newer-password-123'}})).status,400);
  const session2=f.signIn(2);let last;
  for(let i=0;i<6;i++)last=await f.request('/api/courier/account/password',{method:'PUT',session:session2,body:{currentPassword:'wrong',password:'New-password-123'}});
  assert.equal(last.status,429);
  f.advance(16*60*1000);const start=f.messages.length;let generic;
  for(let i=0;i<5;i++){last=await f.request('/api/courier/password-reset/request',{body:{email:'courier@example.test'}});generic??=last.body;assert.equal(last.status,200);assert.deepEqual(last.body,generic);}
  assert.equal(f.messages.length-start,3);
});

test('mail transport unavailable or failing does not enumerate accounts or leave usable unsent tokens',async t=>{
  const f=await fixture(t);await f.verifyEmail();f.failMail(true);
  const known=await f.request('/api/courier/password-reset/request',{body:{email:'courier@example.test'}}),unknown=await f.request('/api/courier/password-reset/request',{body:{email:'unknown@example.test'}});
  assert.deepEqual(known.body,unknown.body);assert.equal(f.db.prepare("SELECT count(*) n FROM courier_recovery_tokens WHERE purpose='password_reset' AND used_at IS NULL").get().n,0);
  assert.equal((await f.request('/api/courier/account/email',{session:f.signIn(),body:{email:'new@example.test',currentPassword:initialPassword}})).status,503);
  const unavailable=await fixture(t,{mailer:false});
  assert.equal((await unavailable.request('/api/courier/account/email',{session:unavailable.signIn(),body:{email:'new@example.test',currentPassword:initialPassword}})).status,503);
  assert.deepEqual((await unavailable.request('/api/courier/password-reset/request',{body:{email:'new@example.test'}})).body,unknown.body);
});

test('only admin can exclude from operations, after resolving every operational or financial obligation',async t=>{
  const f=await fixture(t),url='/api/admin/local-delivery/couriers/1',body={reason:'Encerramento solicitado pelo entregador'};
  assert.equal((await f.request(url,{method:'DELETE',session:f.signIn(),body})).status,403);
  assert.equal((await f.request(url,{method:'DELETE',admin:true,foreign:true,body})).status,403);
  assert.equal((await f.request(url,{method:'DELETE',admin:true,body:{reason:'x'}})).status,400);
  f.db.exec("INSERT INTO marketplace_orders VALUES ('order','approved',NULL); INSERT INTO local_delivery_jobs VALUES(1,'order',1,'assigned');");
  const remove=()=>f.request(url,{method:'DELETE',admin:true,body});
  assert.equal((await remove()).status,409);
  f.db.exec("UPDATE local_delivery_jobs SET status='picked_up'");assert.equal((await remove()).status,409);
  f.db.exec("UPDATE local_delivery_jobs SET status='delivered'");assert.equal((await remove()).status,409);
  f.db.exec("UPDATE marketplace_orders SET customer_confirmed_at='confirmed'; UPDATE local_delivery_couriers SET balance_cents=100 WHERE id=1");assert.equal((await remove()).status,409);
  f.db.exec('UPDATE local_delivery_couriers SET balance_cents=-100 WHERE id=1');assert.equal((await remove()).status,409);
  f.db.exec("UPDATE local_delivery_couriers SET balance_cents=0 WHERE id=1; INSERT INTO local_delivery_withdrawals VALUES(1,1,100,'requested')");assert.equal((await remove()).status,409);
  f.db.exec("UPDATE local_delivery_withdrawals SET status='approved'");assert.equal((await remove()).status,409);
  f.db.exec("UPDATE local_delivery_withdrawals SET status='paid'; INSERT INTO marketplace_manual_payouts VALUES(1,'courier','1',500,'pending')");assert.equal((await remove()).status,409);
  f.db.exec("UPDATE marketplace_manual_payouts SET status='blocked'");assert.equal((await remove()).status,409);
  assert.equal(f.db.prepare('SELECT status FROM local_delivery_couriers WHERE id=1').get().status,'active');
  assert.equal(f.db.prepare('SELECT count(*) n FROM courier_account_audit').get().n,0);
});

test('operational exclusion preserves historical records and balances, cancels offers and revokes access',async t=>{
  const f=await fixture(t);await f.verifyEmail();const session=f.signIn();
  await f.request('/api/courier/password-reset/request',{body:{email:'courier@example.test'}});const token=f.mailToken('reset');
  f.db.exec(`INSERT INTO marketplace_orders VALUES('done','approved','confirmed');
    INSERT INTO local_delivery_jobs VALUES(1,'done',1,'delivered');
    INSERT INTO local_delivery_jobs VALUES(2,'next',NULL,'available');
    INSERT INTO local_delivery_offers VALUES(1,2,1,'offered',NULL);
    INSERT INTO local_delivery_withdrawals VALUES(1,1,500,'paid');
    INSERT INTO marketplace_manual_payouts VALUES(1,'courier','1',500,'paid');
    INSERT INTO local_delivery_ledger VALUES(1,1,500);INSERT INTO local_delivery_ledger VALUES(2,1,-500);`);
  const tables=['marketplace_orders','local_delivery_jobs','local_delivery_withdrawals','marketplace_manual_payouts','local_delivery_ledger'];
  const before=tables.map(table=>f.db.prepare(`SELECT * FROM ${table}`).all());
  const result=await f.request('/api/admin/local-delivery/couriers/1',{method:'DELETE',admin:true,body:{reason:'Encerramento autorizado no teste'}});
  assert.equal(result.status,200);assert.equal(result.body.removedFromOperations,true);
  assert.deepEqual(tables.map(table=>f.db.prepare(`SELECT * FROM ${table}`).all()),before);
  const courier=f.db.prepare('SELECT * FROM local_delivery_couriers WHERE id=1').get();assert.equal(courier.status,'blocked');assert.equal(courier.available,0);assert.equal(courier.balance_cents,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM local_delivery_couriers').get().n,2);
  assert.equal(f.db.prepare('SELECT status FROM local_delivery_offers WHERE id=1').get().status,'cancelled');assert.deepEqual(f.redispatched,[2]);
  assert.equal(f.db.prepare('SELECT count(*) n FROM courier_account_audit WHERE admin_user_id=1 AND courier_id=1').get().n,1);
  assert.equal((await f.request('/api/courier/account',{method:'GET',session})).status,401);
  assert.equal((await f.request('/api/courier/password-reset/confirm',{body:{token,password:'Forbidden-new-123'}})).status,400);
});

test('recovery page never consumes a link on GET; UI provides distinct courier login and admin operations',async t=>{
  const f=await fixture(t);
  const response=await fetch(f.origin+'/recuperar-acesso-entregador.html?verify=example');assert.equal(response.status,200);
  assert.equal(response.headers.get('referrer-policy'),'no-referrer');assert.equal(response.headers.get('cache-control'),'no-store');
  const html=await response.text();assert.match(html,/courier-recovery\.js/);assert.doesNotMatch(html,/global-market-banner/);
  assert.equal(f.db.prepare('SELECT count(*) n FROM courier_recovery_profiles').get().n,0);
  const courier=readFileSync(path.join(appDir,'public/entregador.html'),'utf8'),admin=readFileSync(path.join(appDir,'public/admin-entregas.html'),'utf8');
  assert.match(courier,/href="\/recuperar-acesso-entregador\.html"/);assert.match(courier,/src="\/courier-account\.js"/);assert.match(admin,/data-remove-courier/);assert.match(admin,/Excluir do operacional/);
  for(const source of [courier,admin])for(const match of source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))if(match[1].trim())new vm.Script(match[1]);
  for(const name of ['courier-account.js','courier-recovery.js','admin-courier-account.js'])new vm.Script(readFileSync(path.join(appDir,'public',name),'utf8'));
});
