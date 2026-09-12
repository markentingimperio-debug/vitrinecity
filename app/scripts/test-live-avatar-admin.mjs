import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import Database from 'better-sqlite3';
import express from 'express';
import {createLiveAvatarAdmin,setupLiveAvatarAdmin} from '../live-avatar-admin.js';

const ids={avatarId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',contextId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',voiceId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'};
const KEY='isolated-api-key-never-live',origin='https://vitrinecity.test';
function fixture(t,overrides={}){
  const db=new Database(':memory:'),aes=randomBytes(32),state={time:Date.parse('2026-09-12T18:00:00Z'),calls:[],decrypts:0};t.after(()=>db.close());
  const encrypt=plain=>{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',aes,iv),bytes=Buffer.concat([cipher.update(plain),cipher.final()]);return Buffer.concat([iv,bytes,cipher.getAuthTag()]).toString('base64');};
  const decrypt=value=>{state.decrypts++;const bytes=Buffer.from(value,'base64'),cipher=createDecipheriv('aes-256-gcm',aes,bytes.subarray(0,12));cipher.setAuthTag(bytes.subarray(-16));return Buffer.concat([cipher.update(bytes.subarray(12,-16)),cipher.final()]).toString();};
  const data=pathname=>pathname.endsWith('/credits')?{credits_left:'10.00'}:pathname.includes('/avatars/')?{id:ids.avatarId,status:'ACTIVE',is_expired:false}:pathname.includes('/contexts/')?{id:ids.contextId,required_dynamic_variables:[],prompt:'PRIVATE_PROMPT_DO_NOT_RETURN'}:{id:ids.voiceId,language:'pt-BR'};
  const options={db,encrypt,decrypt,siteUrl:origin,now:()=>state.time,fetchImpl:async(url,opts)=>{state.calls.push({url,opts});if(overrides.response)return overrides.response(url,opts,data);return new Response(JSON.stringify({code:1000,data:data(new URL(url).pathname),message:'ok'}),{status:200});},...overrides};
  const service=createLiveAvatarAdmin(options),save=(values={})=>service.configure({revision:service.status().revision,apiKey:KEY,...ids,...values});
  return {db,state,options,service,save,advance:ms=>{state.time+=ms;},raw:()=>db.prepare('SELECT * FROM live_avatar_admin_settings').get()};
}

test('construction and status are local; no API credential, session or public avatar is inferred from provider login',t=>{
  const f=fixture(t),s=f.service.status();assert.equal(s.configured,false);assert.equal(s.apiConnection,'not_configured');assert.equal(s.liveEnabled,false);assert.equal(s.sessionStarted,false);assert.equal(s.transmission,'not_tested');assert.equal(f.state.calls.length,0);assert.equal(f.state.decrypts,0);
});
test('secret uses authenticated encryption, blank preserves it, IDs and changes need the current revision',t=>{
  const f=fixture(t);const s=f.save(),encrypted=f.raw().key_encrypted;assert.notEqual(encrypted,KEY);assert.equal(f.options.decrypt(encrypted),KEY);assert.doesNotMatch(JSON.stringify(s),/isolated-api|encrypted/);
  f.service.configure({revision:s.revision,apiKey:'',...ids});assert.equal(f.raw().key_encrypted,encrypted);assert.equal(f.service.status().revision,s.revision);assert.equal(f.state.calls.length,0);
  f.service.configure({revision:s.revision,avatarId:''});assert.equal(f.raw().key_encrypted,encrypted);assert.equal(f.service.status().checks.avatar.state,'not_configured');assert.throws(()=>f.service.configure({revision:s.revision,apiKey:'',...ids}),/configuration_changed/);
});
test('malformed config, endpoint overrides and absent encryption cannot mutate a saved secret',t=>{
  const f=fixture(t);f.save();const before=f.raw();
  for(const values of [{avatarId:'https://evil.test'},{contextId:'../private'},{voiceId:3},{apiKey:'key with whitespace inside'},{apiKey:null},{baseUrl:'https://evil.test'},{revision:-1}])assert.throws(()=>f.service.configure({revision:before.revision,...values}));
  assert.deepEqual(f.raw(),before);const unavailable=fixture(t,{encrypt:value=>value});assert.throws(()=>unavailable.save(),/encryption_unavailable/);assert.equal(unavailable.raw().key_encrypted,'');
});
test('the explicit check uses four fixed GETs, validates exact IDs and stores only safe summary metadata',async t=>{
  const f=fixture(t);f.save();const result=await f.service.verify();assert.equal(result.apiConnection,'verified');assert.equal(result.configurationVerified,true);assert.equal(result.liveEnabled,false);assert.equal(result.checks.api.creditsRemaining,'10.00');assert.equal(result.checks.voice.portugueseConfirmed,true);
  assert.deepEqual(f.state.calls.map(call=>new URL(call.url).pathname),['/v1/users/credits','/v1/avatars/'+ids.avatarId,'/v1/contexts/'+ids.contextId,'/v1/voices/'+ids.voiceId]);
  for(const call of f.state.calls){assert.equal(new URL(call.url).origin,'https://api.liveavatar.com');assert.equal(call.opts.method,'GET');assert.equal(call.opts.redirect,'error');assert.equal(call.opts.headers['X-API-KEY'],KEY);assert.equal(call.opts.body,undefined);}
  assert.doesNotMatch(JSON.stringify(result)+f.raw().verification_json,/PRIVATE_PROMPT|isolated-api-key|preview_url|space_id/);
  f.service.status();assert.equal(f.state.calls.length,4);
});
test('unprepared, expired, mismatched avatar and missing Portuguese or context variables remain explicit dependencies',async t=>{
  const cases=[['avatars',{id:ids.contextId,status:'ACTIVE',is_expired:false},'avatar','invalid_response'],['avatars',{id:ids.avatarId,status:'DEPLOYING',is_expired:false},'avatar','preparing'],['avatars',{id:ids.avatarId,status:'ACTIVE',is_expired:true},'avatar','expired'],['contexts',{id:ids.contextId,required_dynamic_variables:['private_customer_value']},'context','variables_required'],['voices',{id:ids.voiceId,language:'English'},'voice','verified']];
  for(const [route,changed,field,expected] of cases){const f=fixture(t,{response:async(url,_opts,data)=>new Response(JSON.stringify({code:100,data:url.includes('/'+route+'/')?changed:data(new URL(url).pathname)}),{status:200})});f.save();const result=await f.service.verify();assert.equal(result.checks[field].state,expected);assert.equal(result.configurationVerified,false);assert.equal(result.liveEnabled,false);assert.doesNotMatch(JSON.stringify(result),/private_customer_value/);}
});
test('HTTP and provider errors or malformed success never claim API connection and never leak errors',async t=>{
  for(const response of [()=>new Response('PRIVATE_ERROR',{status:401}),()=>new Response('PRIVATE_ERROR',{status:503}),()=>new Response(JSON.stringify({code:999,data:{credits_left:'10'}})),()=>new Response(JSON.stringify({code:1000,data:{credits_left:null}})),()=>new Response(JSON.stringify({code:1000,data:{credits_left:'Infinity'}})),()=>{throw Error(KEY);}]){const f=fixture(t,{response});f.save();const result=await f.service.verify();assert.notEqual(result.apiConnection,'verified');assert.equal(result.configurationVerified,false);assert.equal(f.state.calls.length,1);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_ERROR|isolated-api-key/);}
});
test('concurrent checks share a durable limit and a stale provider response cannot overwrite changed configuration',async t=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});const f=fixture(t,{response:async()=>{await gate;return new Response(JSON.stringify({code:1000,data:{credits_left:'10'}}));}});f.save();const first=f.service.verify();await Promise.resolve();const second=createLiveAvatarAdmin(f.options);await assert.rejects(second.verify(),/verification_throttled/);assert.equal(f.state.calls.length,1);
  f.service.configure({revision:f.service.status().revision,contextId:''});release();await assert.rejects(first,/configuration_changed/);assert.equal(f.service.status().apiConnection,'not_verified');assert.equal(f.service.status().contextId,'');assert.equal(f.raw().verification_json,null);
});
test('a stored check expires honestly; refresh status has no network and a later explicit check can recover',async t=>{
  const f=fixture(t);f.save();await f.service.verify();await assert.rejects(createLiveAvatarAdmin(f.options).verify(),/verification_throttled/);f.advance(86400001);assert.equal(f.service.status().apiConnection,'verification_due');assert.equal(f.service.status().configurationVerified,false);assert.equal(f.state.calls.length,4);await f.service.verify();assert.equal(f.service.status().configurationVerified,true);assert.equal(f.state.calls.length,8);
});
test('unsafe development origin initializes disabled and cannot save credentials or call the provider',async t=>{
  for(const siteUrl of ['http://localhost:3000','https://localhost','https://127.0.0.1','not a URL']){const f=fixture(t,{siteUrl});assert.equal(f.service.status().enabled,false);assert.throws(()=>f.save(),/secure_origin_required/);await assert.rejects(f.service.verify(),/secure_origin_required/);assert.equal(f.state.calls.length,0);}
});
test('real HTTP routes require admin, same-origin and JSON; status alone never contacts LiveAvatar',async t=>{
  const f=fixture(t),app=express();app.use(express.json());setupLiveAvatarAdmin({app,...f.options,requireAdmin:(req,res,next)=>req.headers.authorization==='admin'?next():res.sendStatus(401),sameOriginOnly:(req,res,next)=>req.headers.origin===origin?next():res.sendStatus(403)});
  const server=await new Promise(resolve=>{const listening=app.listen(0,'127.0.0.1',()=>resolve(listening));});t.after(()=>new Promise(resolve=>server.close(resolve)));const base='http://127.0.0.1:'+server.address().port+'/api/admin/live-avatar';
  assert.equal((await fetch(base+'/status')).status,401);assert.equal((await fetch(base+'/status',{headers:{authorization:'admin'}})).status,200);assert.equal(f.state.calls.length,0);
  const request=(route,body,headers={})=>fetch(base+route,{method:'POST',headers:{authorization:'admin',origin,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  assert.equal((await request('/settings',{revision:0,apiKey:KEY,...ids},{origin:'https://evil.test'})).status,403);assert.equal((await request('/settings',{revision:0,apiKey:KEY,...ids},{'Content-Type':'text/plain'})).status,415);
  assert.equal((await request('/settings',{revision:0,apiKey:KEY,...ids})).status,200);assert.equal(f.state.calls.length,0);const checked=await request('/verify',{});assert.equal(checked.status,200);assert.equal(checked.headers.get('cache-control'),'no-store');assert.equal((await checked.json()).configurationVerified,true);assert.equal(f.state.calls.length,4);assert.equal((await request('/verify',{url:'https://evil.test'})).status,400);assert.equal((await request('/sessions/start',{})).status,404);
});
test('private panel opens status-only, preserves blank secret and blocks duplicate verify clicks without session endpoints',async()=>{
  class Element{constructor(){this.listeners={};this.value='';this.disabled=false;this.children=[];}addEventListener(type,fn){this.listeners[type]=fn;}replaceChildren(...nodes){this.children=nodes;}}
  const nodes=Object.fromEntries(['save','verify','refresh','status','api-key','key-note','avatar-id','context-id','voice-id','steps','checked-at','error','settings-form'].map(id=>[id,new Element()])),calls=[];
  const dto={enabled:true,configured:true,hasApiKey:true,revision:2,...ids,apiConnection:'verified',checks:{api:{state:'verified',creditsRemaining:'10'},avatar:{state:'not_configured'},context:{state:'verified'},voice:{state:'verified',portugueseConfirmed:true}},detail:'Sem sessão',verifiedAt:'2026-09-12T18:00:00Z'};
  const context={document:{getElementById:id=>nodes[id],createElement:()=>new Element()},Date,AbortSignal,fetch:async(url,opts)=>{calls.push({url,opts});return {ok:true,json:async()=>dto};}};
  vm.runInNewContext(fs.readFileSync(new URL('../optional-integrations/live-avatar/admin-live-avatar.js',import.meta.url),'utf8'),context);await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,1);assert.equal(calls[0].opts.method,undefined);assert.equal(calls[0].url,'/api/admin/live-avatar/status');assert.equal(nodes['api-key'].value,'');
  nodes.verify.listeners.click();nodes.verify.listeners.click();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.filter(call=>call.url.endsWith('/verify')).length,1);
  nodes['settings-form'].listeners.submit({preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));const save=calls.find(call=>call.url.endsWith('/settings'));assert.equal(JSON.parse(save.opts.body).apiKey,'');assert.equal(JSON.parse(save.opts.body).revision,2);assert.equal(nodes['api-key'].value,'');
  assert(calls.every(call=>!call.url.includes('/sessions/')));const html=fs.readFileSync(new URL('../optional-integrations/live-avatar/admin-live-avatar.html',import.meta.url),'utf8');assert.match(html,/type="password"/);assert.match(html,/noindex,nofollow/);assert.doesNotMatch(html,/<iframe|<video|liveavatar-web-sdk/);
});

test('optional integration is not imported by production and panel templates are outside the static public directory',()=>{
  assert.equal(fs.existsSync(new URL('../public/admin-live-avatar.html',import.meta.url)),false);assert.equal(fs.existsSync(new URL('../public/admin-live-avatar.js',import.meta.url)),false);
  assert.doesNotMatch(fs.readFileSync(new URL('../server.js',import.meta.url),'utf8'),/from\s+['"]\.\/live-avatar-admin\.js['"]|setupLiveAvatarAdmin\(/);
});
