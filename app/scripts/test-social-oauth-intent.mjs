import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {socialOauthRequest,socialOauthScopes,socialOauthConfigId,signSocialOauthState,verifySocialOauthState,socialOauthDestination} from '../social-oauth-intent.js';

const secret='social-oauth-test-secret-only',now=Date.parse('2026-09-09T12:00:00Z');
const state=(change={})=>({userId:42,returnTo:'chatbot',intent:'comment_replies',...change});
const sign=(data,at=now)=>signSocialOauthState(data,{secret,now:at});
const verify=(value,change={})=>verifySocialOauthState(value,42,{secret,isAdmin:true,now,...change});
const resign=data=>{const payload=Buffer.from(JSON.stringify(data)).toString('base64url');return payload+'.'+createHmac('sha256',secret).update(payload).digest('base64url');};

test('Instagram messaging has its own admin-only grant and cannot reuse read/comment login configurations',()=>{
  assert.throws(()=>socialOauthRequest({intent:'instagram_messages'},false),error=>error.status===403);
  assert.deepEqual(socialOauthRequest({intent:'instagram_messages',returnTo:'chatbot'},true),{intent:'instagram_messages',returnTo:'chatbot'});
  const scopes=socialOauthScopes('instagram_messages');for(const scope of ['instagram_manage_messages','instagram_basic','pages_manage_metadata','instagram_manage_comments','pages_messaging','business_management'])assert.ok(scopes.includes(scope));
  assert.ok(!scopes.includes('instagram_content_publish'));assert.equal(new Set(scopes).size,scopes.length);
  assert.ok(!socialOauthScopes('read_only').includes('instagram_manage_messages'));assert.ok(!socialOauthScopes('comment_replies').includes('instagram_manage_messages'));
  const configs={readOnlyConfigId:'987654321',commentConfigId:'987654322',instagramMessageConfigId:'987654323'};
  assert.equal(socialOauthConfigId('instagram_messages',configs),'987654323');
  for(const value of [undefined,'',configs.readOnlyConfigId,configs.commentConfigId,'123&scope=x'])assert.throws(()=>socialOauthConfigId('instagram_messages',{...configs,instagramMessageConfigId:value}),error=>error.status===503);
  const value=sign(state({intent:'instagram_messages'}));assert.equal(verify(value).intent,'instagram_messages');assert.equal(verify(value,{isAdmin:false}),null);assert.equal(verifySocialOauthState(value,43,{secret,isAdmin:true,now}),null);
});

test('ordinary connections remain read-only; only admins can request comment permissions',()=>{
  assert.deepEqual(socialOauthRequest({returnTo:'chatbot'},false),{returnTo:'carteira',intent:'read_only'});
  assert.deepEqual(socialOauthRequest({returnTo:'admin'},true),{returnTo:'admin',intent:'read_only'});
  assert.throws(()=>socialOauthRequest({intent:'comment_replies',returnTo:'chatbot'},false),error=>error.status===403);
  assert.throws(()=>socialOauthRequest({intent:['comment_replies']},true));
  const request=socialOauthRequest({intent:'comment_replies',returnTo:'chatbot'},true);assert.deepEqual(request,{intent:'comment_replies',returnTo:'chatbot'});
  const readonly=socialOauthScopes(),expanded=socialOauthScopes(request.intent);
  for(const name of ['pages_messaging','pages_manage_metadata','instagram_manage_comments','business_management','pages_manage_engagement','pages_manage_posts','instagram_content_publish']){assert.ok(expanded.includes(name));assert.ok(!readonly.includes(name));}
  assert.equal(expanded.length,13);assert.equal(new Set(expanded).size,13);
  assert.ok(!expanded.includes('instagram_manage_messages'));assert.deepEqual(expanded.slice(0,readonly.length),readonly);
});

test('Business Login configurations stay separate and each intent requires only its own configuration',()=>{
  const configs={readOnlyConfigId:'987654321',commentConfigId:'987654322'};
  assert.equal(socialOauthConfigId('read_only',configs),configs.readOnlyConfigId);
  assert.equal(socialOauthConfigId('comment_replies',configs),configs.commentConfigId);
  assert.equal(socialOauthConfigId('read_only',{readOnlyConfigId:configs.readOnlyConfigId}),configs.readOnlyConfigId);
  assert.equal(socialOauthConfigId('comment_replies',{commentConfigId:configs.commentConfigId}),configs.commentConfigId);
  assert.throws(()=>socialOauthConfigId('comment_replies',{readOnlyConfigId:configs.readOnlyConfigId}),error=>error.status===503&&error.message.includes('META_SOCIAL_COMMENT_LOGIN_CONFIG_ID'));
  assert.throws(()=>socialOauthConfigId('read_only',{commentConfigId:configs.commentConfigId}),error=>error.status===503);
  assert.throws(()=>socialOauthConfigId('comment_replies',{...configs,commentConfigId:configs.readOnlyConfigId}),error=>error.status===503);
});

test('Business Login rejects malformed configuration IDs before redirecting to Meta',()=>{
  for(const value of ['',undefined,null,123456789,' 123456789','123456789 ','012345678','1234','1'.repeat(31),'123456789&scope=pages_messaging','https://example.com']){
    assert.throws(()=>socialOauthConfigId('read_only',{readOnlyConfigId:value}),error=>error.status===503);
    assert.throws(()=>socialOauthConfigId('comment_replies',{commentConfigId:value}),error=>error.status===503);
  }
  assert.throws(()=>socialOauthConfigId('unsupported',{}),error=>error.status===400);
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
