// Full production route wiring against a disposable database. No SMTP credentials,
// real accounts, external fetch, or operational production data are available.
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {createHash,randomBytes,scryptSync} from 'node:crypto';
import Database from 'better-sqlite3';

const dataDir=mkdtempSync(path.join(tmpdir(),'vitriny-courier-account-'));
const port=45000+Math.floor(Math.random()*1000),origin=`http://127.0.0.1:${port}`;
const guard=path.join(dataDir,'outbound-guard.mjs');
writeFileSync(guard,"globalThis.fetch=async()=>{throw Error('External fetch disabled in courier account test')};");
const env=Object.fromEntries(['PATH','SystemRoot','WINDIR','TEMP','TMP'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
Object.assign(env,{DATA_DIR:dataDir,PORT:String(port),SITE_URL:origin});
const child=spawn(process.execPath,['--import',pathToFileURL(guard).href,'server.js'],{cwd:new URL('..',import.meta.url),env,stdio:['ignore','pipe','pipe']});
let output='',db;child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
const digest=value=>createHash('sha256').update(value).digest('hex');
const password='Courier-safe-test-123!',salt='112233445566778899aabbccddeeff00',hash=`scrypt:${salt}:${scryptSync(password,salt,64).toString('hex')}`;
const request=(url,{method='GET',body,cookie,foreign=false}={})=>fetch(origin+url,{method,redirect:'manual',headers:{origin:foreign?'https://other.example':origin,'content-type':'application/json',...(cookie?{cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
try{
  let ready=false;for(let i=0;i<100;i++){try{if((await request('/api/health')).ok){ready=true;break;}}catch{}if(child.exitCode!==null)break;await new Promise(resolve=>setTimeout(resolve,100));}assert.ok(ready,output.slice(-2500));
  db=new Database(path.join(dataDir,'vitrinecity.db'));
  const courierId=Number(db.prepare("INSERT INTO local_delivery_couriers(name,whatsapp,city,state,password_hash) VALUES ('Isolated courier','62988888888','Silvânia','GO',?)").run(hash).lastInsertRowid);
  const adminId=Number(db.prepare("INSERT INTO users(name,email,password_hash,is_admin,totp_enabled,adult_confirmed) VALUES ('Isolated admin','admin@example.test',?,1,1,1)").run(hash).lastInsertRowid);
  const userId=Number(db.prepare("INSERT INTO users(name,email,password_hash,adult_confirmed) VALUES ('Isolated buyer','buyer@example.test',?,1)").run(hash).lastInsertRowid);
  const userCookie=id=>{const token=randomBytes(32).toString('base64url');db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)').run(digest(token),id,Date.now()+3600000);return {token,cookie:`vc_session=${token}`};};
  const admin=userCookie(adminId),buyer=userCookie(userId);
  const recovery=await request('/recuperar-acesso-entregador.html?verify=unconsumed');assert.equal(recovery.status,200);
  assert.equal(recovery.headers.get('referrer-policy'),'no-referrer');assert.equal(recovery.headers.get('cache-control'),'no-store');
  const html=await recovery.text();assert.match(html,/courier-recovery\.js/);assert.doesNotMatch(html,/global-market-banner|public-measurement|googletagmanager/);
  assert.equal((await request('/courier-recovery.js')).status,200);
  assert.equal((await request('/api/courier/account')).status,401);
  const login=await request('/api/courier/auth/login',{method:'POST',body:{whatsapp:'62988888888',password}});assert.equal(login.status,200);
  let courierCookie=login.headers.get('set-cookie').split(';')[0];
  assert.equal((await request('/api/courier/account',{cookie:courierCookie})).status,200);
  assert.equal((await request('/api/courier/account/email',{method:'POST',cookie:courierCookie,foreign:true,body:{email:'courier@example.test',currentPassword:password}})).status,403);
  assert.equal((await request('/api/courier/account/email',{method:'POST',cookie:courierCookie,body:{email:'courier@example.test',currentPassword:password}})).status,503,'No real mail service exists in this test');
  const generic=await (await request('/api/courier/password-reset/request',{method:'POST',body:{email:'courier@example.test'}})).json();
  assert.deepEqual(generic,await (await request('/api/courier/password-reset/request',{method:'POST',body:{email:'unknown@example.test'}})).json());
  // Simulate a previously verified mailbox and delivered reset link in the fixture only.
  db.prepare('INSERT INTO courier_recovery_profiles(courier_id,email,verified_at) VALUES (?,?,?)').run(courierId,'courier@example.test',Date.now());
  const token=randomBytes(32).toString('base64url');db.prepare("INSERT INTO courier_recovery_tokens(token_hash,courier_id,purpose,email,password_version,expires_at) VALUES (?,?,'password_reset',?,?,?)").run(digest(token),courierId,'courier@example.test',digest(hash),Date.now()+300000);
  assert.equal((await request('/api/courier/password-reset/confirm',{method:'POST',body:{token,password:'Changed-courier-123!'}})).status,200);
  assert.equal((await request('/api/courier/password-reset/confirm',{method:'POST',body:{token,password:'Changed-again-123!'}})).status,400);
  assert.equal((await request('/api/courier/me',{cookie:courierCookie})).status,401);
  assert.equal((await request('/api/courier/auth/login',{method:'POST',body:{whatsapp:'62988888888',password}})).status,401);
  const relogin=await request('/api/courier/auth/login',{method:'POST',body:{whatsapp:'62988888888',password:'Changed-courier-123!'}});assert.equal(relogin.status,200);courierCookie=relogin.headers.get('set-cookie').split(';')[0];
  const deletion=`/api/admin/local-delivery/couriers/${courierId}`,reason={reason:'Encerramento solicitado no teste isolado'};
  assert.equal((await request(deletion,{method:'DELETE',body:reason})).status,401);
  assert.equal((await request(deletion,{method:'DELETE',body:reason,cookie:buyer.cookie})).status,403);
  assert.equal((await request(deletion,{method:'DELETE',body:reason,cookie:courierCookie})).status,401);
  assert.equal((await request(deletion,{method:'DELETE',body:reason,cookie:admin.cookie})).status,401,'Admin second factor still applies');
  db.prepare("INSERT INTO privileged_sessions(token_hash,user_id,scope,expires_at) VALUES (?,?,'admin',?)").run(digest(admin.token),adminId,Date.now()+300000);
  assert.equal((await request(deletion,{method:'DELETE',body:reason,cookie:admin.cookie,foreign:true})).status,403);
  db.prepare('UPDATE local_delivery_couriers SET balance_cents=50 WHERE id=?').run(courierId);
  assert.equal((await request(deletion,{method:'DELETE',body:reason,cookie:admin.cookie})).status,409);
  assert.equal(db.prepare('SELECT balance_cents FROM local_delivery_couriers WHERE id=?').get(courierId).balance_cents,50);
  db.prepare('UPDATE local_delivery_couriers SET balance_cents=0 WHERE id=?').run(courierId);
  assert.equal((await request(deletion,{method:'DELETE',body:reason,cookie:admin.cookie})).status,200);
  assert.equal((await request('/api/courier/me',{cookie:courierCookie})).status,401);
  assert.equal((await request('/api/courier/auth/login',{method:'POST',body:{whatsapp:'62988888888',password:'Changed-courier-123!'}})).status,401);
  assert.equal(db.prepare('SELECT status FROM local_delivery_couriers WHERE id=?').get(courierId).status,'blocked');
  assert.equal(db.prepare('SELECT password_hash FROM users WHERE id=?').get(userId).password_hash,hash);
  assert.equal(db.prepare('SELECT count(*) n FROM courier_account_audit WHERE courier_id=?').get(courierId).n,1);
  console.log('courier-account-integration: real auth, admin second factor, same-origin, isolated recovery, session revocation and safe operational exclusion passed');
}finally{
  db?.close();if(child.exitCode===null&&child.signalCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}
  const resolved=path.resolve(dataDir);if(path.dirname(resolved)===path.resolve(tmpdir())&&path.basename(resolved).startsWith('vitriny-courier-account-'))rmSync(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
