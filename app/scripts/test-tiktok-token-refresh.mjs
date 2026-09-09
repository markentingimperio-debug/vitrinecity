import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,unlinkSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {createTikTokTokenRefresh} from '../tiktok-token-refresh.js';

const enc=value=>'protected:'+Buffer.from(value).toString('base64');
const dec=value=>{if(typeof value!=='string'||!value.startsWith('protected:'))throw Error('SECRET_DECRYPT_ERROR');return Buffer.from(value.slice(10),'base64').toString();};
function fixture(t,{file=':memory:',seed=true,...overrides}={}){
  const db=new Database(file);t.after(()=>db.close());
  const state={time:Date.parse('2026-09-09T12:00:00Z'),calls:[],config:{configured:true,clientKey:'CLIENT_KEY_SECRET',clientSecret:'CLIENT_SECRET_SECRET',environment:'sandbox'}};
  if(seed){
    db.exec(`CREATE TABLE tiktok_oauth_account(id INTEGER PRIMARY KEY,open_id TEXT,refresh_token_encrypted TEXT,scopes TEXT,expires_at INTEGER,refresh_expires_at INTEGER,status TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE social_provider_credentials(provider TEXT PRIMARY KEY,credentials_encrypted TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);`);
    db.prepare("INSERT INTO tiktok_oauth_account(id,open_id,refresh_token_encrypted,scopes,expires_at,refresh_expires_at,status) VALUES (1,'creator-1',?,'user.info.basic,video.list',?,?,'connected')").run(enc('OLD_REFRESH_SECRET'),state.time-1000,state.time+86400_000);
    db.prepare("INSERT INTO social_provider_credentials(provider,credentials_encrypted) VALUES ('tiktok',?)").run(enc(JSON.stringify({TIKTOK_CONTENT_ACCESS_TOKEN:'OLD_ACCESS_SECRET'})));
  }
  const data=()=>({open_id:'creator-1',access_token:'NEW_ACCESS_SECRET',refresh_token:'NEW_REFRESH_SECRET',scope:'user.info.basic,video.list',expires_in:86400,refresh_expires_in:31536000,token_type:'Bearer'});
  const fetchImpl=async(url,options)=>{state.calls.push({url,options});return {ok:true,status:200,json:async()=>data()};};
  const deps={db,decrypt:dec,encrypt:enc,getAppConfig:()=>state.config,fetchImpl,now:()=>state.time,...overrides};
  const service=createTikTokTokenRefresh(deps);
  return {db,state,data,deps,service,account:()=>db.prepare('SELECT * FROM tiktok_oauth_account').get(),access:()=>JSON.parse(dec(db.prepare("SELECT credentials_encrypted FROM social_provider_credentials WHERE provider='tiktok'").get().credentials_encrypted))};
}
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const secretFree=result=>assert.doesNotMatch(JSON.stringify(result),/SECRET|protected:|access_token|refresh_token|client_secret|log_id/);

test('factory is inert; explicit renewal uses OAuth refresh and stores rotated tokens together',async t=>{
  const f=fixture(t);assert.equal(f.state.calls.length,0);assert.equal(f.db.prepare('PRAGMA table_info(tiktok_oauth_account)').all().length,8);
  const result=await f.service.run();assert.equal(result.status,'refreshed');secretFree(result);
  assert.equal(f.state.calls.length,1);const call=f.state.calls[0];assert.equal(call.url,'https://open.tiktokapis.com/v2/oauth/token/');assert.equal(call.options.redirect,'error');
  assert.deepEqual([...call.options.body.keys()].sort(),['client_key','client_secret','grant_type','refresh_token']);assert.equal(call.options.body.get('grant_type'),'refresh_token');
  assert.equal(dec(f.account().refresh_token_encrypted),'NEW_REFRESH_SECRET');assert.equal(f.access().TIKTOK_CONTENT_ACCESS_TOKEN,'NEW_ACCESS_SECRET');
  assert.equal(f.account().expires_at,f.state.time+86400_000);assert.equal(f.account().refresh_lock_owner,'');assert.equal(f.account().scopes,'user.info.basic,video.list');
});
test('fresh authorization makes no request and does not imply publishing permission',async t=>{
  const f=fixture(t);f.db.prepare('UPDATE tiktok_oauth_account SET expires_at=?').run(f.state.time+3600_000);
  const result=await f.service.run();assert.equal(result.status,'fresh');assert.equal(f.state.calls.length,0);assert.deepEqual(result.account.scopes,['user.info.basic','video.list']);assert.equal(result.canPublish,undefined);secretFree(result);
});
test('legacy credentials newer than the account require reconnection instead of overwrite',async t=>{
  const f=fixture(t);f.db.prepare("UPDATE tiktok_oauth_account SET updated_at='2026-09-09 12:00:00'").run();f.db.prepare("UPDATE social_provider_credentials SET updated_at='2026-09-09 12:00:01'").run();
  assert.equal((await f.service.run()).status,'reconnect_required');assert.equal(f.state.calls.length,0);assert.equal(f.access().TIKTOK_CONTENT_ACCESS_TOKEN,'OLD_ACCESS_SECRET');
});
test('expired refresh token, missing configuration and revoked account never call provider',async t=>{
  const f=fixture(t);f.db.prepare('UPDATE tiktok_oauth_account SET refresh_expires_at=?').run(f.state.time-1);assert.equal((await f.service.run()).status,'reconnect_required');
  f.state.config.configured=false;assert.equal((await f.service.run()).status,'missing_configuration');
  f.db.prepare("UPDATE tiktok_oauth_account SET status='revoked'").run();assert.equal((await f.service.run()).status,'not_connected');assert.equal(f.state.calls.length,0);
});
test('same instance coalesces concurrent explicit requests',async t=>{
  const gate=deferred(),f=fixture(t);let calls=0;const service=createTikTokTokenRefresh({...f.deps,fetchImpl:async()=>{calls++;await gate.promise;return {ok:true,status:200,json:async()=>f.data()};}});
  const first=service.run(),second=service.run();assert.equal(first,second);assert.equal(calls,1);gate.resolve();assert.equal((await first).status,'refreshed');
});
test('independent database connections share the persistent lock',async t=>{
  const folder=mkdtempSync(path.join(tmpdir(),'vc-tiktok-refresh-'));const file=path.join(folder,'test.sqlite'),f=fixture(t,{file}),other=fixture(t,{file,seed:false}),gate=deferred();
  t.after(()=>{unlinkSync(file);rmdirSync(folder);});
  let calls=0;const service=createTikTokTokenRefresh({...f.deps,fetchImpl:async()=>{calls++;await gate.promise;return {ok:true,status:200,json:async()=>f.data()};}});
  const first=service.run();assert.equal((await other.service.run()).status,'busy');assert.equal(other.state.calls.length,0);gate.resolve();assert.equal((await first).status,'refreshed');assert.equal(calls,1);
});
for(const mutation of ['account','access','refresh','config'])test('late response preserves newer '+mutation+' revision',async t=>{
  const f=fixture(t),gate=deferred();const service=createTikTokTokenRefresh({...f.deps,fetchImpl:async()=>{await gate.promise;return {ok:true,status:200,json:async()=>f.data()};}}),pending=service.run();
  if(mutation==='account')f.db.prepare("UPDATE tiktok_oauth_account SET open_id='new-creator'").run();
  if(mutation==='access')f.db.prepare("UPDATE social_provider_credentials SET credentials_encrypted=? WHERE provider='tiktok'").run(enc(JSON.stringify({TIKTOK_CONTENT_ACCESS_TOKEN:'RECONNECTED_SECRET'})));
  if(mutation==='refresh')f.db.prepare('UPDATE tiktok_oauth_account SET refresh_token_encrypted=?').run(enc('RECONNECTED_SECRET'));
  if(mutation==='config')f.state.config={...f.state.config,clientKey:'REPLACED_KEY_SECRET'};
  gate.resolve();const result=await pending;assert.equal(result.status,'superseded');assert.notEqual(f.access().TIKTOK_CONTENT_ACCESS_TOKEN,'NEW_ACCESS_SECRET');assert.notEqual(dec(f.account().refresh_token_encrypted),'NEW_REFRESH_SECRET');secretFree(result);
});
test('scope revocation is stored exactly and missing scope is not guessed',async t=>{
  const f=fixture(t);const service=createTikTokTokenRefresh({...f.deps,fetchImpl:async()=>({ok:true,status:200,json:async()=>({...f.data(),scope:'user.info.basic'})})});
  assert.equal((await service.run()).status,'refreshed');assert.equal(f.account().scopes,'user.info.basic');
  f.db.prepare('UPDATE tiktok_oauth_account SET expires_at=0').run();const missing=createTikTokTokenRefresh({...f.deps,fetchImpl:async()=>({ok:true,status:200,json:async()=>({...f.data(),scope:undefined})})});
  assert.equal((await missing.run()).status,'unknown');assert.equal(f.account().scopes,'user.info.basic');
});
test('wrong creator or malformed duration is rejected without credentials write',async t=>{
  for(const fields of [{open_id:'different-creator'},{expires_in:-1},{refresh_expires_in:Infinity},{token_type:'Other'}]){
    const f=fixture(t);const service=createTikTokTokenRefresh({...f.deps,fetchImpl:async()=>({ok:true,status:200,json:async()=>({...f.data(),...fields})})});
    const result=await service.run();assert.equal(result.status,'unknown');assert.equal(f.access().TIKTOK_CONTENT_ACCESS_TOKEN,'OLD_ACCESS_SECRET');secretFree(result);
  }
});
test('uncertain transport does not retry the same credential; reconnect replaces uncertainty',async t=>{
  const f=fixture(t);let calls=0;const service=createTikTokTokenRefresh({...f.deps,fetchImpl:async()=>{calls++;throw Error('client_secret=SECRET_PROVIDER');}});
  const first=await service.run();assert.equal(first.status,'unknown');secretFree(first);f.state.time+=60_000;assert.equal((await service.run()).status,'unknown');assert.equal(calls,1);
  f.db.prepare('UPDATE tiktok_oauth_account SET refresh_token_encrypted=?').run(enc('RECONNECTED_REFRESH_SECRET'));
  assert.equal((await f.service.run()).status,'refreshed');
});
test('15 second deadline also bounds a provider that never settles',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const f=fixture(t);let signal;
  const service=createTikTokTokenRefresh({...f.deps,fetchImpl:async(_url,options)=>{signal=options.signal;return new Promise(()=>{});}}),pending=service.run();
  t.mock.timers.tick(15_000);
  const result=await pending;assert.equal(result.status,'unknown');assert.equal(signal.aborted,true);assert.equal(f.access().TIKTOK_CONTENT_ACCESS_TOKEN,'OLD_ACCESS_SECRET');secretFree(result);
});
test('stale processing lock is reported unknown without calling provider',async t=>{
  const f=fixture(t),gate=deferred();let calls=0;const service=createTikTokTokenRefresh({...f.deps,fetchImpl:async()=>{calls++;await gate.promise;return {ok:true,status:200,json:async()=>f.data()};}}),first=service.run();
  f.state.time+=46_000;assert.equal((await f.service.run()).status,'unknown');assert.equal(f.state.calls.length,0);gate.resolve();assert.equal((await first).status,'superseded');assert.equal(calls,1);assert.equal(f.access().TIKTOK_CONTENT_ACCESS_TOKEN,'OLD_ACCESS_SECRET');
});
test('known rejection is redacted and does not change credentials',async t=>{
  for(const [status,error,expected]of [[400,'invalid_grant','reconnect_required'],[401,'invalid_client','failed'],[429,'rate_limit','failed'],[503,'server_error','unknown']]){
    const f=fixture(t);const service=createTikTokTokenRefresh({...f.deps,fetchImpl:async()=>({ok:false,status,json:async()=>({error,error_description:'SECRET_PROVIDER_DESCRIPTION',log_id:'SECRET_LOG'})})});
    const result=await service.run();assert.equal(result.status,expected);secretFree(result);assert.equal(f.access().TIKTOK_CONTENT_ACCESS_TOKEN,'OLD_ACCESS_SECRET');
  }
});
test('failed atomic credential write rolls back account rotation',async t=>{
  const f=fixture(t);f.db.exec("CREATE TRIGGER reject_tiktok_write BEFORE UPDATE ON social_provider_credentials BEGIN SELECT RAISE(ABORT,'SECRET_DATABASE_ERROR'); END;");
  const result=await f.service.run();assert.equal(result.status,'failed');assert.equal(f.access().TIKTOK_CONTENT_ACCESS_TOKEN,'OLD_ACCESS_SECRET');assert.equal(dec(f.account().refresh_token_encrypted),'OLD_REFRESH_SECRET');secretFree(result);
});
