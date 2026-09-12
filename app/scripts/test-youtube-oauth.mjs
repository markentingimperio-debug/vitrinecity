import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import Database from 'better-sqlite3';
import {createYouTubeOAuth,setupYouTubeOAuth,YOUTUBE_PRAYER_CHANNEL,YOUTUBE_UPLOAD_SCOPES} from '../youtube-oauth.js';
const encrypt=v=>'protected:'+Buffer.from(v).toString('base64'),decrypt=v=>Buffer.from(v.slice(10),'base64').toString();
const clientId='123456789012-fixture.apps.googleusercontent.com';
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
function fixture(t,options={}){
  const db=new Database(':memory:');t.after(()=>db.close());const calls=[];let time=Date.parse('2026-09-12T10:00:00Z');
  const state={payload:{access_token:'ACCESS_SECRET',refresh_token:'REFRESH_SECRET',token_type:'Bearer',expires_in:3600,scope:YOUTUBE_UPLOAD_SCOPES.join(' ')},channel:YOUTUBE_PRAYER_CHANNEL};
  const fetchImpl=async(url,opts)=>{calls.push({url,opts});if(options.fetchImpl)return options.fetchImpl(url,opts,state);return response(url.includes('/channels?')?{items:[{id:state.channel,snippet:{title:'Canal de oração'}}]}:state.payload);};
  const service=createYouTubeOAuth({db,encrypt,decrypt,siteUrl:'https://vitrinecity.com',fetchImpl,now:()=>time});
  const identity={adminId:7,sessionKey:'SESSION_SECRET'};
  const begin=()=>{service.configure({clientId,clientSecret:'CLIENT_SECRET'});return new URL(service.begin(identity).authorizationUrl).searchParams.get('state');};
  const connect=async()=>service.complete({...identity,state:begin(),code:'CODE_SECRET'});
  return {db,state,calls,service,identity,begin,connect,advance:ms=>{time+=ms;}};
}
test('construct/status never call Google; scopes, secrets and Search Console remain separated',t=>{const f=fixture(t);assert.equal(f.calls.length,0);assert.equal(f.service.status().connected,false);assert.equal(f.db.prepare("SELECT 1 FROM sqlite_master WHERE name='google_search_oauth'").get(),undefined);f.service.configure({clientId,clientSecret:'CLIENT_SECRET'});assert.doesNotMatch(JSON.stringify(f.service.status()),/CLIENT_SECRET|REFRESH_SECRET|ACCESS_SECRET/);assert.notEqual(f.db.prepare('SELECT client_secret_encrypted v FROM youtube_upload_app').get().v,'CLIENT_SECRET');});

test('HTTP, local and invalid origins disable OAuth without decrypting, exchanging or replacing stored credentials',async t=>{
  const f=fixture(t);await f.connect();const before=f.db.prepare('SELECT * FROM youtube_upload_account').get();
  for(const siteUrl of ['http://127.0.0.1:37001','http://localhost:8080','http://vitrinecity.com','https://localhost','https://127.0.0.1','https://[::1]','https://app.localhost','https://intranet.local','https://user:password@vitrinecity.com','https://vitrinecity.com:8443','invalid']){
    const forbidden=()=>{assert.fail('Disabled OAuth must not encrypt, decrypt or contact Google');};
    const service=createYouTubeOAuth({db:f.db,encrypt:forbidden,decrypt:forbidden,fetchImpl:forbidden,siteUrl});
    assert.equal(service.status().status,'unconfigured');assert.equal(service.status().enabled,false);assert.equal(service.status().configured,false);assert.equal(service.status().connected,false);assert.equal(service.status().redirectUri,null);
    assert.throws(()=>service.configure({clientId,clientSecret:'NEW_SECRET'}),/https_origin_required/);
    assert.throws(()=>service.begin(f.identity),/https_origin_required/);
    await assert.rejects(service.complete({...f.identity,state:'STATE_SECRET',code:'CODE_SECRET'}),/https_origin_required/);
    await assert.rejects(service.accessToken(),/https_origin_required/);
    assert.equal(service.disconnect().status,'unconfigured');assert.deepEqual(f.db.prepare('SELECT * FROM youtube_upload_account').get(),before);
  }
  assert.equal(f.service.status().connected,true);assert.equal(await f.service.accessToken(),'ACCESS_SECRET');assert.equal(f.calls.length,2);
  assert.throws(()=>createYouTubeOAuth({db:f.db,encrypt,decrypt,siteUrl:'https://vitrinecity.com',expectedChannelId:'UCwrong'}),/configuration_invalid/);
});

test('real HTTP server starts with YouTube unconfigured and blocks admin configure, connect and callback', {timeout:30000},async t=>{
  const parentDir=path.resolve(tmpdir()),dataDir=mkdtempSync(path.join(parentDir,'vitrinecity-youtube-http-'));
  const guard=path.join(dataDir,'no-external-fetch.mjs');writeFileSync(guard,"globalThis.fetch=async()=>{throw Error('External requests disabled in isolated YouTube fixture');};\n");
  const port=42000+Math.floor(Math.random()*3000),origin=`http://127.0.0.1:${port}`;
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(PATH|SYSTEMROOT|WINDIR|COMSPEC|TMP|TEMP|TMPDIR|PATHEXT)$/i.test(key)));
  const child=spawn(process.execPath,['--import',pathToFileURL(guard).href,'server.js'],{cwd:new URL('..',import.meta.url),env:{...env,DATA_DIR:dataDir,COURSE_FILES_DIR:path.join(dataDir,'courses'),PORT:String(port),SITE_URL:origin,STORE_PORTAL_SECRET:'isolated-youtube-server-secret'},stdio:['ignore','pipe','pipe']});
  let output='',db;child.stdout.on('data',chunk=>{output=(output+chunk).slice(-5000);});child.stderr.on('data',chunk=>{output=(output+chunk).slice(-5000);});
  t.after(async()=>{db?.close();if(child.exitCode===null){child.kill();await new Promise(resolve=>child.once('exit',resolve));}const resolved=path.resolve(dataDir);assert.ok(resolved.startsWith(parentDir+path.sep)&&path.basename(resolved).startsWith('vitrinecity-youtube-http-'));rmSync(resolved,{recursive:true,force:true,maxRetries:5});});
  let ready=false;for(let i=0;i<150;i++){try{if((await fetch(origin+'/api/health')).ok){ready=true;break;}}catch{}if(child.exitCode!==null)break;await new Promise(resolve=>setTimeout(resolve,100));}
  assert.ok(ready,`HTTP server failed to start: ${output}`);
  const api='/api/admin/prayer-sharing/youtube',request=(route,options={})=>fetch(origin+route,{...options,headers:{origin,'Content-Type':'application/json',...options.headers}});
  assert.equal((await request(api+'/status')).status,401);
  const email=`youtube-http-${port}@example.com`,signup=await request('/api/auth/register',{method:'POST',body:JSON.stringify({name:'YouTube fixture',email,password:'isolated-password-123',adultConfirmed:true,termsAccepted:true})});
  assert.equal(signup.status,201);const cookie=signup.headers.get('set-cookie').split(';')[0];
  db=new Database(path.join(dataDir,'vitrinecity.db'));db.prepare('UPDATE users SET is_admin=1 WHERE email=?').run(email);
  const statusResponse=await request(api+'/status',{headers:{cookie}});assert.equal(statusResponse.status,200);const status=await statusResponse.json();assert.equal(status.status,'unconfigured');assert.equal(status.connected,false);assert.equal(status.configured,false);assert.equal(status.redirectUri,null);
  for(const route of ['/app','/connect']){const result=await request(api+route,{method:'POST',headers:{cookie},body:JSON.stringify({clientId,clientSecret:'UNSAVED_SECRET'})});assert.equal(result.status,409);const text=await result.text();assert.match(text,/HTTPS/);assert.doesNotMatch(text,/authorizationUrl|UNSAVED_SECRET/);}
  const callback=await request(api+'/callback?state=STATE_SECRET&code=CODE_SECRET',{headers:{cookie},redirect:'manual'});assert.equal(callback.status,303);assert.equal(callback.headers.get('location'),'/admin-youtube.html?youtube=needs_review');
  assert.equal(db.prepare('SELECT client_id v FROM youtube_upload_app').get().v,'');assert.equal(db.prepare('SELECT COUNT(*) n FROM youtube_upload_oauth_states').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM youtube_upload_account').get().n,0);
});
test('consent binds admin/session, uses offline and PKCE without activating any schedule',t=>{const f=fixture(t),state=f.begin(),row=f.db.prepare('SELECT * FROM youtube_upload_oauth_states').get();assert.equal(row.admin_id,7);assert.notEqual(row.session_hash,f.identity.sessionKey);assert.notEqual(row.state_hash,state);assert.notEqual(row.verifier_encrypted,decrypt(row.verifier_encrypted));const u=new URL(f.service.begin(f.identity).authorizationUrl);assert.equal(u.searchParams.get('access_type'),'offline');assert.equal(u.searchParams.get('code_challenge_method'),'S256');assert.deepEqual(u.searchParams.get('scope').split(' '),YOUTUBE_UPLOAD_SCOPES);assert.equal(f.calls.length,0);assert.equal(f.service.status().connected,false);});
test('wrong admin, wrong session, expired state and replay cannot exchange a code',async t=>{const f=fixture(t),state=f.begin();await assert.rejects(f.service.complete({...f.identity,adminId:8,state,code:'CODE_SECRET'}),/state_invalid/);await assert.rejects(f.service.complete({...f.identity,sessionKey:'OTHER_SECRET',state,code:'CODE_SECRET'}),/state_invalid/);assert.equal(f.calls.length,0);await f.service.complete({...f.identity,state,code:'CODE_SECRET'});await assert.rejects(f.service.complete({...f.identity,state,code:'CODE_SECRET'}),/state_invalid/);assert.equal(f.calls.length,2);const next=f.begin();f.advance(600001);await assert.rejects(f.service.complete({...f.identity,state:next,code:'CODE_SECRET'}),/state_invalid/);assert.equal(f.calls.length,2);});
test('valid consent validates exact channel and protects offline tokens',async t=>{const f=fixture(t),result=await f.connect();assert.equal(result.connected,true);assert.equal(result.channelId,YOUTUBE_PRAYER_CHANNEL);assert.equal(result.publicUploadVerified,false);const row=f.db.prepare('SELECT * FROM youtube_upload_account').get();assert.equal(decrypt(row.refresh_encrypted),'REFRESH_SECRET');assert.doesNotMatch(JSON.stringify(result),/ACCESS_SECRET|REFRESH_SECRET|CLIENT_SECRET|CODE_SECRET/);assert.equal(f.calls[0].opts.body.get('grant_type'),'authorization_code');assert.ok(f.calls[0].opts.body.get('code_verifier'));assert.equal(f.calls[0].opts.redirect,'error');assert.match(f.calls[1].url,/mine=true/);assert.equal(await f.service.accessToken(),'ACCESS_SECRET');assert.equal(f.calls.length,2);});
test('wrong channel, partial scopes, missing refresh and malformed token all remain disconnected',async t=>{for(const change of [f=>{f.state.channel='UCwrong';},f=>{f.state.payload.scope=YOUTUBE_UPLOAD_SCOPES[0];},f=>{delete f.state.payload.refresh_token;},f=>{f.state.payload.token_type='bad';}]){const f=fixture(t);change(f);await assert.rejects(f.connect());assert.equal(f.service.status().connected,false);assert.equal(f.db.prepare('SELECT * FROM youtube_upload_account').get(),undefined);}});
test('disconnect while code exchange is in flight cannot reconnect the account',async t=>{let release;const gate=new Promise(r=>{release=r;});const f=fixture(t,{fetchImpl:async(url,opts,s)=>{if(url.includes('/token')){await gate;return response(s.payload);}return response({items:[{id:s.channel,snippet:{title:'Canal'}}]});}});const pending=f.connect();await Promise.resolve();f.service.disconnect();release();await assert.rejects(pending,/connection_changed/);assert.equal(f.service.status().connected,false);});
test('refresh preserves omitted refresh token, coalesces concurrent requests and validates scopes',async t=>{const f=fixture(t);await f.connect();f.advance(3600001);f.state.payload={...f.state.payload,access_token:'NEW_ACCESS_SECRET'};delete f.state.payload.refresh_token;const values=await Promise.all([f.service.accessToken(),f.service.accessToken()]);assert.deepEqual(values,['NEW_ACCESS_SECRET','NEW_ACCESS_SECRET']);assert.equal(f.calls.length,3);assert.equal(decrypt(f.db.prepare('SELECT refresh_encrypted v FROM youtube_upload_account').get().v),'REFRESH_SECRET');assert.equal(f.calls[2].opts.body.get('grant_type'),'refresh_token');});
test('uncertain refresh and crashed claim require review without repeating requests',async t=>{const f=fixture(t);await f.connect();f.advance(3600001);f.state.payload={error:'invalid_grant'};await assert.rejects(f.service.accessToken());const calls=f.calls.length;await assert.rejects(f.service.accessToken());assert.equal(f.calls.length,calls);assert.equal(f.service.status().connected,false);const g=fixture(t);await g.connect();g.advance(3600001);g.db.prepare("UPDATE youtube_upload_account SET refresh_owner='interrupted',refresh_until=1").run();await assert.rejects(g.service.accessToken());assert.equal(g.calls.length,2);assert.equal(g.service.status().status,'needs_review');});
test('disconnect during refresh preserves removal, and saving another client invalidates old state',async t=>{const f=fixture(t);await f.connect();f.advance(3600001);const pending=f.service.accessToken();f.service.disconnect();await assert.rejects(pending);assert.equal(f.db.prepare('SELECT * FROM youtube_upload_account').get(),undefined);const state=f.begin();f.service.configure({clientId,clientSecret:'NEXT_SECRET'});await assert.rejects(f.service.complete({...f.identity,state,code:'CODE_SECRET'}));});
test('admin routes preserve auth and same-origin guards and never echo errors or credentials',async t=>{const db=new Database(':memory:');t.after(()=>db.close());const routes=new Map(),admin=()=>{},origin=()=>{},app={get:(p,...h)=>routes.set('GET '+p,h),post:(p,...h)=>routes.set('POST '+p,h)};setupYouTubeOAuth({app,db,requireAdmin:admin,sameOriginOnly:origin,getSessionKey:()=>'',encrypt,decrypt,siteUrl:'https://vitrinecity.com',fetchImpl:()=>{throw Error('NO_NETWORK');}});for(const [key,handlers]of routes){assert.equal(handlers[0],admin);if(key.startsWith('POST'))assert.equal(handlers[1],origin);}let body;const res={status(){return this;},set(){return this;},json(v){body=v;return this;}};routes.get('POST /api/admin/prayer-sharing/youtube/app').at(-1)({body:{clientId:'bad',clientSecret:'PRIVATE_SECRET'}},res);assert.doesNotMatch(JSON.stringify(body),/PRIVATE_SECRET|stack|CLIENT_SECRET/);});
test('explicit OAuth 503 and 429 recover after persistent backoff without new consent',async t=>{
  for(const status of [503,429]){
    let temporary=false;
    const f=fixture(t,{fetchImpl:async(url,opts,s)=>url.includes('/channels?')?response({items:[{id:s.channel,snippet:{title:'Canal'}}]}):temporary?new Response(JSON.stringify({error:'temporarily_unavailable'}),{status,headers:{'Retry-After':'120'}}):response(s.payload)});
    await f.connect();f.advance(3600001);temporary=true;
    await assert.rejects(f.service.accessToken(),/retry_later/);
    const row=f.db.prepare('SELECT * FROM youtube_upload_account').get();assert.equal(row.status,'connected');assert.equal(row.refresh_owner,'');assert.equal(row.refresh_failures,1);assert.ok(f.service.status().refreshRetryAt);
    const calls=f.calls.length;await assert.rejects(f.service.accessToken(),/retry_later/);assert.equal(f.calls.length,calls);
    f.advance(119999);await assert.rejects(f.service.accessToken(),/retry_later/);assert.equal(f.calls.length,calls);
    f.advance(2);temporary=false;assert.equal(await f.service.accessToken(),'ACCESS_SECRET');assert.equal(f.calls.length,calls+1);
    assert.equal(f.db.prepare('SELECT refresh_failures n FROM youtube_upload_account').get().n,0);assert.equal(f.service.status().refreshRetryAt,null);
  }
});
test('three explicit temporary refresh failures exhaust retry budget, while lost or malformed replies never retry',async t=>{
  let temporary=false;const f=fixture(t,{fetchImpl:async(url,opts,s)=>url.includes('/channels?')?response({items:[{id:s.channel,snippet:{title:'Canal'}}]}):temporary?response({error:'server_error'},503):response(s.payload)});
  await f.connect();f.advance(3600001);temporary=true;
  await assert.rejects(f.service.accessToken(),/retry_later/);f.advance(60001);await assert.rejects(f.service.accessToken(),/retry_later/);f.advance(300001);await assert.rejects(f.service.accessToken(),/pending_review/);
  const calls=f.calls.length;f.advance(86400000);await assert.rejects(f.service.accessToken());assert.equal(f.calls.length,calls);assert.equal(f.service.status().connected,false);
  for(const answer of [()=>{throw Error('lost response');},()=>new Response('not-json',{status:503}),()=>response({error:'invalid_grant'},503),()=>response({error:'temporarily_unavailable',refresh_token:'ROTATED_SECRET'},503)]){
    let fail=false;const g=fixture(t,{fetchImpl:async(url,opts,s)=>url.includes('/channels?')?response({items:[{id:s.channel,snippet:{title:'Canal'}}]}):fail?answer():response(s.payload)});
    await g.connect();g.advance(3600001);fail=true;await assert.rejects(g.service.accessToken());const total=g.calls.length;g.advance(86400000);await assert.rejects(g.service.accessToken());assert.equal(g.calls.length,total);assert.equal(g.service.status().connected,false);
  }
});
