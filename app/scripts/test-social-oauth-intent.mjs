import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {socialOauthRequest,socialOauthScopes,signSocialOauthState,verifySocialOauthState,socialOauthDestination} from '../social-oauth-intent.js';

const secret='social-oauth-test-secret-only',now=Date.parse('2026-09-09T12:00:00Z');
const state=(change={})=>({userId:42,returnTo:'chatbot',intent:'comment_replies',...change});
const sign=(data,at=now)=>signSocialOauthState(data,{secret,now:at});
const verify=(value,change={})=>verifySocialOauthState(value,42,{secret,isAdmin:true,now,...change});
const resign=data=>{const payload=Buffer.from(JSON.stringify(data)).toString('base64url');return payload+'.'+createHmac('sha256',secret).update(payload).digest('base64url');};

test('ordinary connections remain read-only; only admins can request comment permissions',()=>{
  assert.deepEqual(socialOauthRequest({returnTo:'chatbot'},false),{returnTo:'carteira',intent:'read_only'});
  assert.deepEqual(socialOauthRequest({returnTo:'admin'},true),{returnTo:'admin',intent:'read_only'});
  assert.throws(()=>socialOauthRequest({intent:'comment_replies',returnTo:'chatbot'},false),error=>error.status===403);
  assert.throws(()=>socialOauthRequest({intent:['comment_replies']},true));
  const request=socialOauthRequest({intent:'comment_replies',returnTo:'chatbot'},true);assert.deepEqual(request,{intent:'comment_replies',returnTo:'chatbot'});
  const readonly=socialOauthScopes(),expanded=socialOauthScopes(request.intent);
  for(const name of ['pages_messaging','pages_manage_metadata','instagram_manage_comments']){assert.ok(expanded.includes(name));assert.ok(!readonly.includes(name));}
  assert.ok(!expanded.includes('instagram_manage_messages'));assert.deepEqual(expanded.slice(0,readonly.length),readonly);
});

test('OAuth state binds identity, intent and return destination; demoted administrators cannot complete it',()=>{
  const value=sign(state()),verified=verify(value);assert.equal(verified.intent,'comment_replies');assert.equal(verified.returnTo,'chatbot');
  assert.equal(verify(value,{isAdmin:false}),null);assert.equal(verifySocialOauthState(value,43,{secret,isAdmin:true,now}),null);
  const [payload,signature]=value.split('.'),altered={...JSON.parse(Buffer.from(payload,'base64url')),intent:'read_only',returnTo:'carteira'};
  assert.equal(verify(Buffer.from(JSON.stringify(altered)).toString('base64url')+'.'+signature),null);
  assert.equal(verify(value+'.ignored'),null);assert.equal(verify(value,{secret:'different'}),null);
});

test('expired, future and malformed signed states cannot complete OAuth',()=>{
  assert.equal(verify(sign(state(),now-600001)),null);assert.equal(verify(sign(state(),now+30001)),null);
  const good=verify(sign(state()));for(const change of [{issuedAt:'NaN'},{issuedAt:null},{nonce:'bad'},{returnTo:'https://evil.test'},{intent:'admin_all'},{userId:0}])assert.equal(verify(resign({...good,...change})),null);
  assert.equal(verify('invalid'),null);assert.equal(verify(null),null);
});

test('normal in-flight readonly states remain compatible and returns are constrained to platform pages',()=>{
  const normal=verify(sign(state({returnTo:'carteira',intent:'read_only'})),{isAdmin:false});assert.equal(normal.intent,'read_only');
  const legacy={...normal};delete legacy.intent;assert.equal(verify(resign(legacy),{isAdmin:false}).intent,'read_only');
  assert.equal(socialOauthDestination(state(),'connected'),'/admin-chatbotx.html?social=connected#socialCommentCampaigns');
  assert.equal(socialOauthDestination({returnTo:'admin'},'cancelled'),'/admin?social=cancelled#admin-social');
  assert.equal(socialOauthDestination(null,'invalid_state'),'/carteira.html?social=invalid_state#socialConnectArea');
  assert.ok(socialOauthDestination({returnTo:'https://evil.test'},'error').startsWith('/carteira.html?'));
});
