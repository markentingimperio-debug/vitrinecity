import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {createMetaCommentApi} from '../meta-comment-api.js';

const NOW=Date.parse('2026-09-10T12:00:00Z');
function fixture(t){
  const db=new Database(':memory:');t.after(()=>db.close());
  db.exec(`CREATE TABLE social_accounts(id INTEGER PRIMARY KEY,page_id TEXT,instagram_id TEXT,token_encrypted TEXT,status TEXT);
    INSERT INTO social_accounts VALUES(1,'100','200','encrypted','connected');`);
  const env={META_SOCIAL_API_VERSION:'v26.0',META_SOCIAL_APP_ID:'123',META_SOCIAL_APP_SECRET:'APP_SECRET',META_SOCIAL_WEBHOOK_VERIFY_TOKEN:'VERIFY_SECRET'};
  const state={calls:[],hook:null,grant:{is_valid:true,app_id:'123',expires_at:0,data_access_expires_at:0,scopes:['pages_messaging','pages_read_engagement','pages_manage_metadata','instagram_basic','instagram_manage_comments'],granular_scopes:[]},identity:'100',linked:'200',subscriptions:['feed','group_feed'],igSubscriptions:['comments'],post:{id:'100_900',from:{id:'100'},permalink_url:'https://www.facebook.com/100/posts/900'},media:[{id:'800',owner:{id:'200'},permalink:'https://www.instagram.com/p/example/'}]};
  async function fetchImpl(raw,init){
    const url=new URL(raw),route=url.pathname.replace('/v26.0/','');state.calls.push({url,init,route});
    assert.equal(url.origin,'https://graph.facebook.com');assert.equal(init.redirect,'error');assert.equal(url.username,'');assert.equal(url.password,'');assert(init.signal);
    assert(!url.searchParams.has('access_token'));assert.equal(init.headers['Content-Type'],'application/json');
    if(state.hook){const response=await state.hook({url,init,route});if(response!==undefined)return response;}
    let data;
    if(route==='debug_token'){assert.equal(init.headers.Authorization,'Bearer 123|APP_SECRET');assert.equal(url.searchParams.get('input_token'),'PAGE_SECRET');data={data:state.grant};}
    else if(route==='123/subscriptions'){assert.equal(init.headers.Authorization,'Bearer 123|APP_SECRET');data={data:[{object:'instagram',active:true,fields:state.igSubscriptions.map(name=>({name}))}]};}
    else {assert.equal(init.headers.Authorization,'Bearer PAGE_SECRET');
      if(route==='me')data={id:state.identity};
      else if(route==='100')data={instagram_business_account:{id:state.linked}};
      else if(route==='100/subscribed_apps')data={data:[{id:'123',subscribed_fields:state.subscriptions}]};
      else if(route==='800')data=state.media.find(media=>media.id==='800')||{};
      else if(route==='100_900'||route==='777_900')data=state.post;
      else if(route==='100/messages'||route==='200/messages')data={message_id:'opaque_message_id',recipient_id:'visitor'};
      else throw Error('Unexpected mock route '+route);
    }
    return new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
  }
  const api=createMetaCommentApi({db,env,now:()=>NOW,decryptToken:value=>{assert.equal(value,'encrypted');return 'PAGE_SECRET';},fetchImpl});
  const inspect=overrides=>api.inspect({accountId:1,surface:'facebook_page',postId:'100_900',...overrides});
  const send=overrides=>api.send({accountId:1,surface:'facebook_page',commentId:'900_301',text:'Aqui está o conteúdo que você pediu: https://vitrinecity.com/artigo/receita',...overrides});
  return {db,env,state,api,inspect,send};
}

test('inspect is read-only, verifies token grants, subscription and Page ownership, and never claims advanced access',async t=>{
  const f=fixture(t),result=await f.inspect();assert.equal(result.ready,true);assert.deepEqual(result.missing,[]);
  assert.equal(result.details.permissionCheck,true);assert.equal(result.details.subscriptionCheck,true);assert.equal(result.details.ownershipCheck,true);assert.equal(result.details.publicAccessVerified,false);
  assert.match(result.note,/aprovação Meta/);assert(f.state.calls.every(call=>call.init.method==='GET'&&call.init.body===undefined));assert(!JSON.stringify(result).includes('SECRET'));
  assert.equal(f.state.calls.length,4);
});

test('expired access or data grants, wrong app, missing and granular permissions keep configuration blocked',async t=>{
  for(const mutation of [
    grant=>{grant.is_valid=false;},grant=>{grant.app_id='999';},grant=>{grant.expires_at=NOW/1000-1;},
    grant=>{grant.data_access_expires_at=NOW/1000-1;},grant=>{grant.scopes=grant.scopes.filter(scope=>scope!=='pages_messaging');},
    grant=>{grant.granular_scopes=[{scope:'pages_messaging',target_ids:['999']}];}
  ]){const f=fixture(t);mutation(f.state.grant);const result=await f.inspect();assert.equal(result.ready,false);assert(result.missing.length);assert(f.state.calls.every(call=>call.init.method==='GET'));}
  const f=fixture(t);f.state.grant.granular_scopes=[{scope:'pages_messaging',target_ids:['100']}];assert.equal((await f.inspect()).ready,true);
});

test('Page token mismatch, post created by a personal profile, missing subscription and absent configuration are blocked',async t=>{
  for(const change of [f=>{f.state.identity='999';},f=>{f.state.post.from.id='999';},f=>{f.state.subscriptions=[];},f=>{delete f.env.META_SOCIAL_WEBHOOK_VERIFY_TOKEN;},f=>{delete f.env.META_SOCIAL_APP_SECRET;}]){
    const f=fixture(t);change(f);assert.equal((await f.inspect()).ready,false);
  }
  const f=fixture(t);f.db.prepare("UPDATE social_accounts SET status='expired'").run();assert.equal((await f.inspect()).ready,false);assert.equal(f.state.calls.length,0);
});

test('group posts require the exact business Page, mapped group permalink and group_feed subscription',async t=>{
  const f=fixture(t);f.state.post={id:'777_900',from:{id:'100'},permalink_url:'https://www.facebook.com/groups/777/posts/900/'};
  assert.equal((await f.inspect({surface:'facebook_group',postId:'777_900',groupId:'777'})).ready,true);
  assert.equal((await f.inspect({surface:'facebook_group',postId:'777_900',groupId:'999'})).ready,false);
  assert.equal((await f.inspect({surface:'facebook_page',postId:'777_900'})).ready,false);
  f.state.subscriptions=['feed'];assert.equal((await f.inspect({surface:'facebook_group',postId:'777_900',groupId:'777'})).ready,false);
});

test('Instagram checks current Page linkage, scoped comments permission and media ownership using read-only calls',async t=>{
  const f=fixture(t),options={surface:'instagram',postId:'800'};
  assert.equal((await f.inspect(options)).ready,true);assert(f.state.calls.every(call=>call.init.method==='GET'));
  assert(!f.state.calls.some(call=>call.route==='200/subscribed_apps'||call.route==='200/media'));
  assert(!f.state.grant.scopes.includes('instagram_manage_messages'),'Private Replies do not need a broad inbox messaging grant.');
  f.state.linked='999';assert.equal((await f.inspect(options)).ready,false);f.state.linked='200';
  f.state.media=[];assert.equal((await f.inspect(options)).ready,false);f.state.media=[{id:'800'}];
  f.state.igSubscriptions=[];assert.equal((await f.inspect(options)).ready,false);f.state.igSubscriptions=['comments'];
  f.state.grant.scopes=f.state.grant.scopes.filter(scope=>scope!=='pages_read_engagement');assert.equal((await f.inspect(options)).ready,false);
});

test('Facebook Login Instagram requires the app-level comments subscription and ownership even for old media',async t=>{
  const f=fixture(t),options={surface:'instagram',postId:'800'};
  f.state.hook=async({route})=>route==='123/subscriptions'?new Response(JSON.stringify({data:[{object:'page',active:true,fields:[{name:'comments'}]}]})):undefined;
  assert.equal((await f.inspect(options)).ready,false);
  f.state.hook=async({route})=>route==='123/subscriptions'?new Response(JSON.stringify({error:{code:200}}),{status:403}):undefined;
  assert.equal((await f.inspect(options)).ready,false);
  f.state.hook=null;assert.equal((await f.inspect(options)).ready,true);
  f.state.media[0].owner.id='999';assert.equal((await f.inspect(options)).ready,false);
});

test('subscription pagination uses bounded cursors on the same Graph endpoint and never follows paging URLs',async t=>{
  const f=fixture(t);let pageReads=0;
  f.state.hook=async({route,url})=>{
    if(route!=='100/subscribed_apps')return;
    pageReads++;return new Response(JSON.stringify(url.searchParams.get('after')==='next-cursor'?{data:[{id:'123',subscribed_fields:['feed']}]}:{data:[{id:'999'}],paging:{next:'https://evil.test/steal?access_token=LEAK',cursors:{after:'next-cursor'}}}));
  };
  assert.equal((await f.inspect()).ready,true);assert.equal(pageReads,2);assert(f.state.calls.every(call=>call.url.origin==='https://graph.facebook.com'));
  f.state.calls=[];pageReads=0;f.state.hook=async({route})=>{
    if(route!=='100/subscribed_apps')return;pageReads++;return new Response(JSON.stringify({data:[],paging:{next:'https://evil.test/',cursors:{after:'cursor-'+pageReads}}}));
  };
  assert.equal((await f.inspect()).ready,false);assert.equal(pageReads,5);
});

test('invalid versions, IDs and surfaces cannot redirect tokens or trigger send requests',async t=>{
  for(const overrides of [{commentId:'https://evil.test/send'},{accountId:'1/../../evil'},{surface:'profile'},{commentId:'900\n301'},{text:'bad\u0000control'}]){
    const f=fixture(t);await assert.rejects(f.send(overrides),error=>error.definitive===true&&!error.message.includes('SECRET'));assert.equal(f.state.calls.length,0);
  }
  const f=fixture(t);f.env.META_SOCIAL_API_VERSION='../evil.test';await assert.rejects(f.send(),error=>error.definitive===true);assert.equal(f.state.calls.length,0);
});

test('send uses one official comment private-reply request and records the opaque message ID for each surface',async t=>{
  for(const surface of ['facebook_page','facebook_group','instagram']){
    const f=fixture(t),response=await f.send({surface});assert.equal(response.messageId,'opaque_message_id');assert.equal(f.state.calls.length,1);
    const call=f.state.calls[0];assert.equal(call.route,surface==='instagram'?'200/messages':'100/messages');assert.equal(call.init.method,'POST');
    assert.deepEqual(JSON.parse(call.init.body),{recipient:{comment_id:'900_301'},message:{text:'Aqui está o conteúdo que você pediu: https://vitrinecity.com/artigo/receita'}});
    assert(!call.init.body.includes('SECRET'));assert(!call.init.body.includes('recipient_id'));
  }
});

test('400/403 provider refusals are definitive; 500, timeout, malformed success and missing IDs are uncertain, with no retry',async t=>{
  const responses=[
    {status:400,body:{error:{code:190,message:'REMOTE_SECRET'}},uncertain:false},
    {status:403,body:{error:{code:200,message:'REMOTE_SECRET'}},uncertain:false},
    {status:400,body:'INVALID_JSON',uncertain:false},
    {status:500,body:{error:{code:200,message:'REMOTE_SECRET'}},uncertain:true},
    {status:502,body:{error:{message:'REMOTE_SECRET'}},uncertain:true},
    {status:200,body:'INVALID_JSON',uncertain:true},
    {status:200,body:{},uncertain:true},
    {timeout:true,uncertain:true}
  ];
  for(const outcome of responses){
    const f=fixture(t);f.state.hook=async()=>{if(outcome.timeout)throw Error('Timeout with REMOTE_SECRET');return new Response(outcome.body==='INVALID_JSON'?'not json':JSON.stringify(outcome.body),{status:outcome.status});};
    await assert.rejects(f.send(),error=>error.uncertain===outcome.uncertain&&error.definitive===!outcome.uncertain&&!error.message.includes('SECRET'));
    assert.equal(f.state.calls.length,1);
  }
});
