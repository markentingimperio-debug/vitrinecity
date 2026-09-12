import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {createYouTubeOAuth,createYouTubeLiveChatOAuth,setupYouTubeLiveChatOAuth,YOUTUBE_PRAYER_CHANNEL as CHANNEL,YOUTUBE_UPLOAD_SCOPES,YOUTUBE_LIVE_CHAT_SCOPES} from '../youtube-oauth.js';
import {createYouTubeLiveChat} from '../youtube-live-chat.js';

const DAY=86400000,epoch=Date.parse('2026-09-12T17:00:00Z'),VIEWER='UC'+'A'.repeat(22),OTHER='UC'+'B'.repeat(22),BROADCAST='AbCdEf12345',CHAT='Chat_ID+/==';
const response=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json',...headers}});
const encode=text=>'enc:'+Buffer.from(text).toString('base64'),decode=value=>Buffer.from(value.slice(4),'base64').toString();
const product={key:'product:11',title:'Adubo para Rosa do Deserto',summary:'Produto disponível na loja.',body:'Detalhes sobre o adubo para rosa do deserto.',sourcePath:'/produto/11/adubo-para-rosa-do-deserto',commercial:true};

function fixture(t,{replyLimit=30,requestText=true}={}){
  const db=new Database(':memory:');t.after(()=>db.close());
  const state={time:epoch,run:true,oauth:{intent:'live-chat',connected:true,channelId:CHANNEL,revision:'connection-v1',scopes:[...YOUTUBE_LIVE_CHAT_SCOPES]},studio:{online:true,streaming:true,recording:false,continuous:false,durationSeconds:7200,commandId:'session-2h-fixture',startedAt:epoch/1000,deadline:epoch/1000+7200,networks:{youtube:{state:'sending'}},updatedAt:epoch},calls:[],tokenCalls:0,textCalls:[],sources:new Map([[product.key,product]]),items:[],pageToken:'page+/=1',pollingInterval:12000,networkHook:null,textHook:null,tokenHook:null,payload:null,remote:{id:BROADCAST,snippet:{channelId:CHANNEL,liveChatId:CHAT},status:{lifeCycleStatus:'live'}}};
  const options={db,oauth:{status:()=>({...state.oauth}),accessToken:async()=>{state.tokenCalls++;if(state.tokenHook)await state.tokenHook();return 'PRIVATE_ACCESS_FIXTURE';}},getStudioSession:()=>state.studio,canRun:()=>state.run,now:()=>state.time,replyLimit,
    sourceCatalog:{get:key=>state.sources.get(key),list:({q,limit})=>[...state.sources.values()].filter(item=>q.split(' ').every(term=>(item.title+' '+item.body).toLowerCase().includes(term))).slice(0,limit)},
    requestText:requestText?async payload=>{state.textCalls.push(payload);if(state.textHook)await state.textHook();return state.payload||{status:'completed',output_text:JSON.stringify({reply:'Confira esta opção no catálogo:',sourceIndex:1})};}:null,
    fetchImpl:async(url,opts)=>{
      state.calls.push({url,opts});assert.equal(new URL(url).origin,'https://www.googleapis.com');assert.equal(opts.redirect,'error');assert.equal(opts.credentials,'omit');assert.equal(opts.headers.Authorization,'Bearer PRIVATE_ACCESS_FIXTURE');assert.ok(!url.includes('PRIVATE_'));
      if(state.networkHook){const result=await state.networkHook(url,opts);if(result)return result;}
      if(url.includes('/liveBroadcasts?'))return response({items:[state.remote]});
      if(opts.method==='POST'){const sent=JSON.parse(opts.body);return response({id:'sent-receipt-1',snippet:{...sent.snippet,authorChannelId:CHANNEL}});}
      return response({items:state.items,nextPageToken:state.pageToken,pollingIntervalMillis:state.pollingInterval});
    }};
  const service=createYouTubeLiveChat(options);
  const advance=ms=>{state.time+=ms;state.studio.updatedAt=state.time;};
  const item=(id='LCC.EhwK:incoming-1',text='Onde encontro adubo para rosa do deserto?',patch={})=>({id,snippet:{type:'textMessageEvent',liveChatId:CHAT,authorChannelId:VIEWER,publishedAt:new Date(state.time).toISOString(),textMessageDetails:{messageText:text}},authorDetails:{channelId:VIEWER,isChatOwner:false},...patch});
  const connect=autoReply=>service.connectBroadcast({broadcastId:BROADCAST,autoReply:!!autoReply});
  const receive=async()=>{await connect(false);advance(1000);state.items=[item()];await service.poll();return service.status().items[0];};
  const ready=async()=>service.prepareReply({messageId:(await receive()).id});
  return {db,state,options,service,item,advance,connect,receive,ready,row:id=>db.prepare('SELECT * FROM youtube_live_chat_messages WHERE id=?').get(id),posts:()=>state.calls.filter(c=>c.opts.method==='POST')};
}

test('live-chat OAuth has its own client, state, tokens and refresh while uploads remain byte-for-byte unchanged',async t=>{
  const db=new Database(':memory:');t.after(()=>db.close());const calls=[];let requested=YOUTUBE_UPLOAD_SCOPES;
  const deps={db,encrypt:encode,decrypt:decode,siteUrl:'https://vitrinecity.com',now:()=>epoch,fetchImpl:async(url,opts)=>{calls.push({url,opts});return response(url.includes('/channels?')?{items:[{id:CHANNEL,snippet:{title:'Agrotécnica'}}]}:{access_token:'ACCESS',refresh_token:'REFRESH',token_type:'Bearer',expires_in:3600,scope:requested.join(' ')});}};
  const upload=createYouTubeOAuth(deps),chat=createYouTubeLiveChatOAuth(deps),identity={adminId:4,sessionKey:'PRIVATE_ADMIN_SESSION'},client={clientId:'123456789-test.apps.googleusercontent.com',clientSecret:'PRIVATE_CLIENT'};
  assert.equal(calls.length,0);upload.configure(client);let state=new URL(upload.begin(identity).authorizationUrl).searchParams.get('state');await upload.complete({...identity,state,code:'CODE'});
  const previous=db.prepare('SELECT * FROM youtube_upload_account').get(),previousApp=db.prepare('SELECT * FROM youtube_upload_app').get();
  chat.configure(client);requested=YOUTUBE_LIVE_CHAT_SCOPES;const consent=new URL(chat.begin(identity).authorizationUrl);state=consent.searchParams.get('state');
  assert.equal(consent.searchParams.get('redirect_uri'),'https://vitrinecity.com/api/admin/live-studio/youtube-chat/oauth/callback');assert.deepEqual(consent.searchParams.get('scope').split(' '),YOUTUBE_LIVE_CHAT_SCOPES);assert.equal(consent.searchParams.get('code_challenge_method'),'S256');
  const callCount=calls.length;await assert.rejects(upload.complete({...identity,state,code:'CROSS_PURPOSE'}),/state_invalid/);await assert.rejects(chat.complete({...identity,adminId:5,state,code:'BAD'}),/state_invalid/);await assert.rejects(chat.complete({...identity,sessionKey:'OTHER',state,code:'BAD'}),/state_invalid/);assert.equal(calls.length,callCount);
  await chat.complete({...identity,state,code:'CHAT_CODE'});assert.equal(chat.status().connected,true);assert.equal(chat.status().intent,'live-chat');assert.equal(await chat.accessToken(),'ACCESS');assert.deepEqual(db.prepare('SELECT * FROM youtube_upload_account').get(),previous);assert.deepEqual(db.prepare('SELECT * FROM youtube_upload_app').get(),previousApp);
  chat.disconnect();assert.equal(chat.status().connected,false);assert.equal(upload.status().connected,true);assert.deepEqual(db.prepare('SELECT * FROM youtube_upload_account').get(),previous);assert.doesNotMatch(JSON.stringify(chat.status()),/PRIVATE_|REFRESH|ACCESS/);
});

test('chat OAuth rejects missing force-ssl and protects its actual admin routes and callback return',async t=>{
  const db=new Database(':memory:');t.after(()=>db.close());const routes=new Map(),admin=()=>{},origin=()=>{};
  const service=setupYouTubeLiveChatOAuth({app:{get:(p,...h)=>routes.set('GET '+p,h),post:(p,...h)=>routes.set('POST '+p,h)},requireAdmin:admin,sameOriginOnly:origin,getSessionKey:()=> 'session',db,encrypt:encode,decrypt:decode,siteUrl:'https://vitrinecity.com',fetchImpl:async()=>response({access_token:'A',refresh_token:'R',token_type:'Bearer',expires_in:3600,scope:YOUTUBE_UPLOAD_SCOPES.join(' ')})});
  for(const [key,handlers]of routes){assert.equal(handlers[0],admin);if(key.startsWith('POST'))assert.equal(handlers[1],origin);assert.ok(key.includes('/live-studio/youtube-chat/oauth/'));}
  service.configure({clientId:'123456789-test.apps.googleusercontent.com',clientSecret:'SECRET'});const state=new URL(service.begin({adminId:4,sessionKey:'session'}).authorizationUrl).searchParams.get('state');
  await assert.rejects(service.complete({state,code:'CODE',adminId:4,sessionKey:'session'}),/scopes_or_token_invalid/);assert.equal(service.status().connected,false);
  let redirected;await routes.get('GET /api/admin/live-studio/youtube-chat/oauth/callback').at(-1)({user:{id:4},query:{state:'bad',code:'bad'}},{redirect:(code,to)=>{assert.equal(code,303);redirected=to;}});assert.equal(redirected,'/admin-live.html?youtubeChat=needs_review');
});

test('construction/status have no network and only a fresh, active two-hour YouTube session can bind',async t=>{
  const f=fixture(t);assert.equal(f.service.status().connected,false);assert.equal(f.state.calls.length,0);assert.equal(f.state.tokenCalls,0);
  const baseline=structuredClone(f.state.studio);
  for(const change of [{streaming:false},{recording:true},{continuous:true},{durationSeconds:36000},{updatedAt:epoch-20000},{deadline:epoch/1000+36000},{networks:{youtube:{state:'connecting'}}},{commandId:''}]){Object.assign(f.state.studio,baseline,change);await assert.rejects(f.connect(),/live_session_required/);assert.equal(f.state.calls.length,0);}
  f.state.studio=baseline;f.state.oauth.intent='upload';await assert.rejects(f.connect(),/oauth_required/);f.state.oauth.intent='live-chat';await f.connect();assert.equal(f.service.status().connected,true);assert.equal(f.service.status().deadline,epoch+7200000);assert.equal(f.state.calls.length,1);
  await f.connect();assert.equal(f.state.calls.length,1);await assert.rejects(f.service.connectBroadcast({broadcastId:'OtherID1234'}),/binding_changed/);
});

test('only the exact live channel/broadcast/chat binds and a stop or reconnect during GET cannot bind later',async t=>{
  for(const change of [f=>f.state.remote.id='WrongId1234',f=>f.state.remote.snippet.channelId=OTHER,f=>f.state.remote.status.lifeCycleStatus='complete',f=>f.state.remote.snippet.actualEndTime='2026-09-12T17:00:00Z',f=>f.state.remote.snippet.liveChatId='']){const f=fixture(t);change(f);await assert.rejects(f.connect(),/broadcast_invalid/);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM youtube_live_chat_sessions').get().n,0);}
  for(const change of [f=>f.state.studio.streaming=false,f=>f.state.oauth.revision='new-connection',f=>f.state.studio.commandId='new-session']){const f=fixture(t);f.state.networkHook=async()=>{change(f);};await assert.rejects(f.connect());assert.equal(f.db.prepare('SELECT COUNT(*) n FROM youtube_live_chat_sessions').get().n,0);}
});

test('poll stores only fresh viewer text, skips history/self/nontext, honors interval and persists dedupe/cursor across restart',async t=>{
  const f=fixture(t);await f.connect();const old=f.item('old');f.advance(1000);old.snippet.publishedAt=new Date(epoch-1000).toISOString();
  const self=f.item('self');self.snippet.authorChannelId=CHANNEL;self.authorDetails.channelId=CHANNEL;
  const nontext=f.item('gift');nontext.snippet.type='superChatEvent';const foreign=f.item('foreign');foreign.snippet.liveChatId='other-chat';const mismatch=f.item('mismatch');mismatch.authorDetails.channelId=OTHER;
  f.state.items=[old,self,nontext,foreign,mismatch,f.item(),f.item()];await f.service.poll();assert.equal(f.service.status().items.length,1);assert.equal(f.state.textCalls.length,0);assert.equal(f.posts().length,0);
  const count=f.state.calls.length;await createYouTubeLiveChat(f.options).poll();assert.equal(f.state.calls.length,count);f.advance(12000);await createYouTubeLiveChat(f.options).poll();assert.equal(f.service.status().items.length,1);
  assert.equal(new URL(f.state.calls.at(-1).url).searchParams.get('pageToken'),'page+/=1');assert.equal(new URL(f.state.calls.at(-1).url).searchParams.get('liveChatId'),CHAT);
  assert.doesNotMatch(JSON.stringify(f.service.status()),/PRIVATE_ACCESS|author_channel_id|profileImage|displayName/);
});

test('poll concurrency has one GET, transient errors preserve cursor with durable backoff and no generation',async t=>{
  const f=fixture(t);await f.connect();f.advance(1000);let release;
  f.state.networkHook=(url)=>url.includes('/liveChat/messages?')?new Promise(resolve=>{release=resolve;}):null;
  const first=f.service.poll();await Promise.resolve();await Promise.resolve();await createYouTubeLiveChat(f.options).poll();assert.equal(f.state.calls.filter(c=>c.url.includes('/liveChat/messages?')).length,1);
  release(response({error:{code:429,errors:[{reason:'rateLimitExceeded'}]}},429,{'Retry-After':'120'}));await first;
  const row=f.db.prepare('SELECT * FROM youtube_live_chat_sessions').get();assert.equal(row.page_token,'');assert.equal(row.claim_owner,'');assert.equal(row.next_poll_at,f.state.time+120000);const count=f.state.calls.length;f.advance(119999);await f.service.poll();assert.equal(f.state.calls.length,count);
  f.advance(2);f.state.networkHook=null;f.state.items=[f.item()];await f.service.poll();assert.equal(f.service.status().items.length,1);assert.equal(f.state.textCalls.length,0);
});

test('late poll response after deadline or disconnect cannot insert text, and ended chat disables automatic replies',async t=>{
  for(const change of [f=>f.advance(7200000),f=>f.service.disconnect(),f=>f.state.oauth.revision='new']){const f=fixture(t);await f.connect(true);f.advance(1000);f.state.items=[f.item()];f.state.networkHook=async()=>{change(f);};await f.service.poll();assert.equal(f.db.prepare('SELECT COUNT(*) n FROM youtube_live_chat_messages').get().n,0);assert.equal(f.posts().length,0);}
  const f=fixture(t);await f.connect(true);f.state.networkHook=async()=>response({items:[],pollingIntervalMillis:10000,nextPageToken:'p',offlineAt:new Date(epoch).toISOString()});await f.service.poll();assert.equal(f.service.status().state,'ended');assert.equal(f.service.status().autoReply,false);
});

test('reply is grounded, identifies Lia as IA and appends only the exact server-selected URL',async t=>{
  const f=fixture(t),ready=await f.ready();assert.equal(ready.state,'prepared');assert.equal(ready.reply,'Lia (IA): Confira esta opção no catálogo:\nhttps://vitrinecity.com/produto/11/adubo-para-rosa-do-deserto');
  const input=JSON.parse(f.state.textCalls[0].input);assert.equal(input.catalog[0].sourceIndex,1);for(const key of ['url','binding','key'])assert.equal(Object.hasOwn(input.catalog[0],key),false);assert.equal(f.posts().length,0);
  const receipt=await f.service.send({messageId:ready.id,expectedHash:ready.expectedHash});assert.equal(receipt.state,'sent');assert.equal(receipt.providerReplyId,'sent-receipt-1');assert.equal(f.posts().length,1);assert.deepEqual(JSON.parse(f.posts()[0].opts.body),{snippet:{liveChatId:CHAT,type:'textMessageEvent',textMessageDetails:{messageText:ready.reply}}});
  await createYouTubeLiveChat(f.options).send({messageId:ready.id,expectedHash:ready.expectedHash});assert.equal(f.posts().length,1);
});

test('model URLs, malformed/partial/multiple outputs and out-of-catalog indices cannot become chat replies',async t=>{
  const raw=JSON.stringify({reply:'Confira:',sourceIndex:1}),message={type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:raw}]};
  for(const payload of [{output_text:JSON.stringify({reply:'Veja https://vitrinecity.com/produto/11/adubo-para-rosa-do-deserto',sourceIndex:1})},{output_text:JSON.stringify({reply:'Confira',sourceIndex:9})},{output_text:'{"reply":"Olá","sourceIndex":1,"sourceIndex":null}'},{status:'incomplete',output_text:raw},{output:[message,message]},{output_text:JSON.stringify({reply:'Análise: preciso responder ao usuário.',sourceIndex:null})}]){const f=fixture(t),item=await f.receive();f.state.payload=payload;await assert.rejects(f.service.prepareReply({messageId:item.id}));assert.equal(f.row(item.id).state,'generation_unknown');assert.equal(f.posts().length,0);await assert.rejects(createYouTubeLiveChat(f.options).prepareReply({messageId:item.id}));assert.equal(f.state.textCalls.length,1);}
});

test('changed source, account, deadline or pause after AI prevents a saved reply and before POST prevents any submission',async t=>{
  for(const change of [f=>f.state.sources.clear(),f=>f.state.oauth.revision='new',f=>f.state.run=false,f=>f.advance(7200000)]){const f=fixture(t),item=await f.receive();f.state.textHook=()=>change(f);await assert.rejects(f.service.prepareReply({messageId:item.id}));assert.equal(f.row(item.id).reply,'');assert.equal(f.posts().length,0);}
  for(const change of [f=>f.state.sources.clear(),f=>f.state.oauth.revision='new',f=>f.state.run=false,f=>f.advance(7200000)]){const f=fixture(t),ready=await f.ready();f.state.networkHook=async(url)=>{if(url.includes('/liveBroadcasts?'))change(f);};await assert.rejects(f.service.send({messageId:ready.id,expectedHash:ready.expectedHash}));assert.equal(f.row(ready.id).send_claim_at,null);assert.equal(f.posts().length,0);}
});

test('send claim precedes POST, receipt loss never resends across restart and mismatched receipts stay unknown',async t=>{
  for(const mode of ['timeout','missing','wrong-chat','wrong-author','wrong-text']){const f=fixture(t),ready=await f.ready();f.state.networkHook=async(_url,opts)=>{if(opts.method!=='POST')return null;assert.equal(f.row(ready.id).state,'submitting');assert.ok(f.row(ready.id).send_claim_at);if(mode==='timeout')throw Error('PRIVATE_ACCESS_FIXTURE');const data={id:'receipt',snippet:{...JSON.parse(opts.body).snippet,authorChannelId:CHANNEL}};if(mode==='missing')delete data.id;if(mode==='wrong-chat')data.snippet.liveChatId='other';if(mode==='wrong-author')data.snippet.authorChannelId=OTHER;if(mode==='wrong-text')data.snippet.textMessageDetails.messageText='different';return response(data);};await assert.rejects(f.service.send({messageId:ready.id,expectedHash:ready.expectedHash}),/send_unknown/);assert.equal(f.row(ready.id).state,'held_unknown');f.advance(30000);await assert.rejects(createYouTubeLiveChat(f.options).send({messageId:ready.id,expectedHash:ready.expectedHash}),/already_attempted/);assert.equal(f.posts().length,1);assert.doesNotMatch(JSON.stringify(f.service.status()),/PRIVATE_ACCESS/);}
});

test('concurrent sends and preflight backoff never duplicate POST, and no new POST occurs after autoReply is disabled',async t=>{
  const f=fixture(t),ready=await f.ready();let release;
  f.state.networkHook=async(_url,opts)=>opts.method==='POST'?new Promise(resolve=>{release=resolve;}):null;
  const first=f.service.send({messageId:ready.id,expectedHash:ready.expectedHash});await new Promise(resolve=>setImmediate(resolve));await assert.rejects(createYouTubeLiveChat(f.options).send({messageId:ready.id,expectedHash:ready.expectedHash}));assert.equal(f.posts().length,1);release(response({id:'receipt',snippet:{...JSON.parse(f.posts()[0].opts.body).snippet,authorChannelId:CHANNEL}}));await first;
  const g=fixture(t),item=await g.ready();g.state.networkHook=async url=>url.includes('/liveBroadcasts?')?response({error:{code:503}},503):null;await assert.rejects(g.service.send({messageId:item.id,expectedHash:item.expectedHash}));const count=g.state.calls.length;await assert.rejects(g.service.send({messageId:item.id,expectedHash:item.expectedHash}),/send_wait/);assert.equal(g.state.calls.length,count);assert.equal(g.posts().length,0);
  const h=fixture(t),prepared=await h.ready();h.service.setAutoReply(true);h.state.networkHook=async()=>{h.service.setAutoReply(false);};await assert.rejects(h.service.send({messageId:prepared.id,expectedHash:prepared.expectedHash,automatic:true}),/approval_required/);assert.equal(h.posts().length,0);
});

test('automatic tick requires opt-in, coalesces, respects operation caps and never starts voice or live',async t=>{
  const f=fixture(t,{replyLimit:1});await f.connect(false);f.advance(1000);f.state.items=[f.item()];await f.service.tick();assert.equal(f.state.textCalls.length,0);assert.equal(f.posts().length,0);
  f.service.setAutoReply(true);await Promise.all([f.service.tick(),f.service.tick()]);assert.equal(f.state.textCalls.length,1);assert.equal(f.posts().length,1);
  f.advance(30000);f.state.items=[f.item('second')];await f.service.tick();assert.equal(f.state.textCalls.length,1);assert.equal(f.posts().length,1);assert.ok(f.state.calls.every(c=>/\/(?:liveBroadcasts|liveChat\/messages)\?/.test(c.url)));
});

test('turning off automatic replies during the first generation prevents a second AI call and every send',async t=>{
  const f=fixture(t);await f.connect(true);f.advance(1000);f.state.items=[f.item('first'),f.item('second')];
  f.state.textHook=()=>f.service.setAutoReply(false);
  await f.service.tick();
  assert.equal(f.state.textCalls.length,1);assert.equal(f.posts().length,0);assert.equal(f.service.status().autoReply,false);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM youtube_live_chat_messages WHERE generation_claim_at IS NULL AND state='pending'").get().n,1);
  await f.service.tick();assert.equal(f.state.textCalls.length,1);assert.equal(f.posts().length,0);
});

test('a later refusal stops earlier queued replies and conversation context never crosses viewer/session',async t=>{
  const f=fixture(t),ready=await f.ready();await f.service.send({messageId:ready.id,expectedHash:ready.expectedHash});f.advance(13000);
  const foreign=f.item('other-user','PRIVATE_OTHER_VIEWER');foreign.snippet.authorChannelId=OTHER;foreign.authorDetails.channelId=OTHER;f.state.items=[foreign,f.item('followup')];await f.service.poll();const next=f.service.status().items.find(item=>item.text.includes('adubo')&&item.id!==ready.id);await f.service.prepareReply({messageId:next.id});const history=JSON.parse(f.state.textCalls.at(-1).input).history;assert.equal(history.length,2);assert.ok(!JSON.stringify(history).includes('PRIVATE_OTHER_VIEWER'));
  f.advance(13000);f.state.items=[f.item('decline','Pare de responder')];await f.service.poll();await assert.rejects(f.service.send({messageId:next.id,expectedHash:f.row(next.id).reply_hash}),/customer_declined/);assert.equal(f.posts().length,1);
  f.advance(13000);f.state.items=[f.item('normal-after-decline','adubo para rosa do deserto')];await f.service.poll();assert.equal(f.service.status().items[0].state,'declined');await assert.rejects(f.service.prepareReply({messageId:f.service.status().items[0].id}),/customer_declined/);assert.equal(f.posts().length,1);
  f.advance(7200000+DAY);f.service.cleanup();assert.equal(f.db.prepare('SELECT COUNT(*) n FROM youtube_live_chat_messages').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM youtube_live_chat_sessions').get().n,0);
});
