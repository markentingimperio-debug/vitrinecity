import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {createInstagramMessaging,normalizeInstagramMessages} from '../instagram-messaging.js';
import {createFacebookMessenger} from '../facebook-messenger.js';
import {validateServiceReply} from '../service-reply-format.js';
import {readFileSync} from 'node:fs';
import {createHmac,timingSafeEqual} from 'node:crypto';
import vm from 'node:vm';

const NOW=Date.parse('2026-09-12T15:00:00Z'),DAY=86400000;
const event=(patch={})=>({sender:{id:'200'},recipient:{id:'900'},timestamp:NOW,message:{mid:'mid-1',text:'Onde encontro o adubo para rosa do deserto?'},...patch});
const direct=(message=event(),actor='900')=>({object:'instagram',entry:[{id:actor,messaging:[message]}]});
const live=(value={},entry={})=>({object:'instagram',entry:[{id:'900',time:NOW/1000,changes:[{field:'live_comments',value:{id:'456',text:'Onde encontro o adubo para rosa do deserto?',from:{id:'555'},media:{id:'789'},...value}}],...entry}]});
const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
const product={key:'product:11',title:'Adubo para Rosa do Deserto',body:'Produto da loja Agrotécnica.',sourcePath:'/produto/11/adubo-rosa-do-deserto',commercial:true};
function fixture(t,{enabled=true}={}){
  const db=new Database(':memory:');t.after(()=>db.close());
  db.exec(`CREATE TABLE social_accounts(id INTEGER PRIMARY KEY,user_id INTEGER,page_id TEXT,instagram_id TEXT,token_encrypted TEXT,status TEXT);
    INSERT INTO social_accounts VALUES(7,42,'100','900','offline-protected-token','connected'),(4,41,'100','900','old-offline-token','connected'),(5,42,'300','901','other-offline-token','connected');
    CREATE TABLE omnichannel_automation_jobs(id TEXT PRIMARY KEY,channel TEXT,external_id TEXT UNIQUE,destination TEXT,source_text TEXT,account_id INTEGER,source_kind TEXT DEFAULT '',media_id TEXT DEFAULT '',status TEXT DEFAULT 'pending',reply_text TEXT DEFAULT '',error TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,processed_at TEXT);`);
  const state={now:NOW,run:true,textCalls:[],requests:[],posts:[],sources:new Map([[product.key,product]]),reply:'Você pode ver esse adubo aqui:',sourceIndex:1,payload:null,textHook:null,getHook:null,postHook:null};
  const opts={db,siteUrl:'https://vitrinecity.com',now:()=>state.now,canRun:()=>state.run,decryptToken:token=>token,encryptToken:token=>'encrypted:'+token,
    sourceCatalog:{list:({q,limit})=>[...state.sources.values()].filter(item=>q.split(' ').every(word=>(item.title+' '+item.body).toLowerCase().includes(word))).slice(0,limit),get:key=>state.sources.get(key)},
    requestText:async input=>{state.textCalls.push(input);if(state.textHook)await state.textHook();return state.payload||{output_text:JSON.stringify({reply:state.reply,sourceIndex:state.sourceIndex})};},
    fetchImpl:async(url,options)=>{state.requests.push({url,options});if(options.method!=='POST'){if(state.getHook)return state.getHook(url,options);return response({data:[{id:'789'}]});}state.posts.push({url,options});if(state.postHook)return state.postHook(url,options);return response({recipient_id:'200',message_id:'confirmed-'+state.posts.length});}};
  const service=createInstagramMessaging(opts);service.saveConnections({userId:42,pages:[{id:'100',instagram_business_account:{id:'900'},access_token:'ig-only-token'},{id:'300',instagram_business_account:{id:'901'},access_token:'other-ig-token'}]});if(enabled)service.configure({enabled:true,autoReply:true,liveCommentsEnabled:true,accountIds:[7,5]});
  const enqueue=(payload=direct())=>service.ingestWebhook(payload).jobIds.map(id=>db.prepare('SELECT * FROM omnichannel_automation_jobs WHERE id=?').get(id));
  return {db,opts,state,service,enqueue,row:job=>db.prepare('SELECT * FROM instagram_messaging_messages WHERE job_id=?').get(job.id),async ready(payload){const [job]=enqueue(payload);job.reply_text=await service.generateReply(job);return job;}};
}

test('Instagram receives only original text DMs addressed to the exact IG account within 24 hours',()=>{
  assert.deepEqual(normalizeInstagramMessages(direct(),NOW),[{instagramId:'900',recipientId:'200',eventId:'mid-1',receivedAt:NOW,text:event().message.text,sourceKind:'instagram_message',mediaId:''}]);
  for(const value of [direct(event({message:{mid:'x',text:'hi',is_echo:true}})),direct(event({message:{mid:'x',text:'hi',is_deleted:true}})),direct(event({delivery:{mids:['a']}})),direct(event({read:{mid:'a'}})),direct(event({reaction:{mid:'a'}})),direct(event({postback:{payload:'x'}})),direct(event({recipient:{id:'100'}})),direct(event({sender:{id:'900'}})),direct(event({sender:{id:'comment_1'}})),direct(event({message:{mid:'x',attachments:[{type:'image'}]}})),direct(event({timestamp:NOW-DAY})),direct(event({timestamp:NOW+60001})),direct(event({timestamp:String(NOW)})),{...direct(),object:'page'}])assert.deepEqual(normalizeInstagramMessages(value,NOW),[]);
  assert.equal(normalizeInstagramMessages(direct(event({timestamp:NOW-DAY+1})),NOW).length,1);
});

test('live comments keep comment/media identities and never convert an author ID into a Direct recipient',()=>{
  assert.deepEqual(normalizeInstagramMessages(live(),NOW),[{instagramId:'900',recipientId:'',eventId:'456',receivedAt:NOW,text:live().entry[0].changes[0].value.text,sourceKind:'instagram_live_comment',mediaId:'789'}]);
  for(const value of [live({from:{id:'900'}}),live({media:{id:'../x'}}),live({}, {time:undefined}),live({}, {time:NOW}),live({}, {time:(NOW-DAY)/1000}),live({text:''}),live({id:'comment_1'})])assert.deepEqual(normalizeInstagramMessages(value,NOW),[]);
  const post=live();post.entry[0].changes[0].field='comments';assert.deepEqual(normalizeInstagramMessages(post,NOW),[]);
});

test('new settings are disabled and explicit connected account IDs resolve duplicate old connections',t=>{
  const f=fixture(t,{enabled:false});assert.deepEqual(f.service.settings(),{enabled:false,autoReply:false,liveCommentsEnabled:false,accountIds:[],startHour:0,endHour:24,dailyLimit:30});assert.equal(f.enqueue().length,0);
  for(const accountIds of [[],[4,7],[999],['7']])assert.throws(()=>f.service.configure({enabled:true,autoReply:true,accountIds}));
  f.service.configure({enabled:true,autoReply:true,accountIds:[7]});assert.equal(f.enqueue()[0].account_id,7);
  assert.equal(f.enqueue(direct(event({recipient:{id:'901'}}),'901')).length,0);
  f.db.exec("UPDATE social_accounts SET status='disconnected' WHERE id=7");assert.equal(f.service.configure({enabled:false,autoReply:false}).enabled,false);
});

test('the non-secret login configuration persists without enabling messages or replacing credentials',t=>{
  const f=fixture(t,{enabled:false});assert.equal(f.service.loginConfigId(),'');const before=f.service.connectionStatus();
  for(const configId of ['',12345,'1234','0'.repeat(10),'12345&scope=x'])assert.throws(()=>f.service.configureLogin({configId}));
  assert.throws(()=>f.service.configureLogin({configId:'123456'},{readOnlyConfigId:'123456'}));assert.throws(()=>f.service.configureLogin({configId:'123456'},{commentConfigId:'123456'}));
  assert.deepEqual(f.service.configureLogin({configId:'1234567'}),{configId:'1234567'});assert.equal(createInstagramMessaging(f.opts).loginConfigId(),'1234567');assert.equal(f.service.settings().enabled,false);assert.deepEqual(f.service.connectionStatus(),before);
});

test('Instagram OAuth saves an isolated encrypted credential without replacing Facebook tokens or inventing accounts',async t=>{
  const f=fixture(t),before=f.db.prepare('SELECT id,token_encrypted FROM social_accounts ORDER BY id').all();
  assert.deepEqual(f.service.connectionStatus(),[{accountId:4,credentialSaved:false},{accountId:5,credentialSaved:true},{accountId:7,credentialSaved:true}]);
  assert.deepEqual(f.service.saveConnections({userId:42,pages:[{id:'100',instagram_business_account:{id:'900'},access_token:'new-ig-grant'}]}),{saved:1});
  assert.deepEqual(f.db.prepare('SELECT id,token_encrypted FROM social_accounts ORDER BY id').all(),before);
  assert.equal(f.db.prepare('SELECT token_encrypted FROM instagram_messaging_accounts WHERE account_id=7').get().token_encrypted,'encrypted:new-ig-grant');
  for(const input of [{userId:43,pages:[{id:'100',instagram_business_account:{id:'900'},access_token:'wrong-owner'}]},{userId:42,pages:[{id:'100',instagram_business_account:{id:'999'},access_token:'wrong-instagram'}]},{userId:42,pages:[{id:'999',instagram_business_account:{id:'900'},access_token:'new-page'}]}])assert.deepEqual(f.service.saveConnections(input),{saved:0});
  const job=await f.ready();await f.service.send(job,job.reply_text);assert.equal(f.state.posts[0].options.headers.Authorization,'Bearer encrypted:new-ig-grant');assert.ok(!JSON.stringify(f.service.connectionStatus()).includes('grant'));
});

test('missing or identity-stale private credentials cannot fall back to a shared Facebook token',async t=>{
  for(const change of [f=>f.db.exec('DELETE FROM instagram_messaging_accounts WHERE account_id=7'),f=>f.db.exec("UPDATE instagram_messaging_accounts SET instagram_id='999' WHERE account_id=7"),f=>f.db.exec('UPDATE instagram_messaging_accounts SET user_id=43 WHERE account_id=7')]){
    const f=fixture(t);change(f);const job=await f.ready();assert.equal(f.service.connectionStatus().find(item=>item.accountId===7).credentialSaved,false);await assert.rejects(f.service.send(job,job.reply_text),/token_unavailable/);assert.equal(f.state.posts.length,0);assert.equal(f.row(job).claimed_at,null);
  }
});

test('all live IDs are reserved from legacy dispatch when paused, disabled or malformed',t=>{
  const f=fixture(t,{enabled:false});for(const payload of [live(),live({}, {time:undefined}),live({from:{id:'900'}})]){
    const result=f.service.ingestWebhook(payload);assert.deepEqual(result.jobIds,[]);assert.deepEqual([...result.handledLiveCommentIds],['456']);
  }
  assert.equal(f.service.ingestWebhook({...live(),object:'page'}).handledLiveCommentIds.size,0);
});

test('durable dedupe namespaces Direct/live/IG accounts separately and never changes Facebook configuration',t=>{
  const f=fixture(t),dm=direct(event({message:{mid:'456',text:event().message.text}}));assert.equal(f.enqueue(dm).length,1);assert.equal(f.enqueue(dm).length,0);assert.equal(f.enqueue(live()).length,1);
  assert.equal(createInstagramMessaging(f.opts).ingestWebhook(dm).jobIds.length,0);
  assert.equal(f.enqueue(direct(event({recipient:{id:'901'},message:{mid:'456',text:event().message.text}}),'901')).length,1);
  const facebook=createFacebookMessenger(f.opts);assert.equal(facebook.settings().enabled,false);assert.deepEqual(facebook.ingestWebhook(direct()),[]);
});

test('Direct sends to the linked Page with the received IGSID and persists a matching receipt',async t=>{
  const f=fixture(t),job=await f.ready();assert.deepEqual(await f.service.send(job,job.reply_text,{automatic:true}),{messageId:'confirmed-1'});
  assert.equal(f.state.posts[0].url,'https://graph.facebook.com/v26.0/100/messages');assert.deepEqual(JSON.parse(f.state.posts[0].options.body),{recipient:{id:'200'},messaging_type:'RESPONSE',message:{text:job.reply_text}});
  assert.equal(f.row(job).provider_message_id,'confirmed-1');assert.ok(!f.state.posts[0].url.includes('token'));await assert.rejects(f.service.send(job,job.reply_text),/already_attempted/);assert.equal(f.state.posts.length,1);
});

test('a live comment gets one private reply only after its owned live media is confirmed active',async t=>{
  const f=fixture(t),job=await f.ready(live());assert.equal(f.row(job).recipient_id,'');await f.service.send(job,job.reply_text);
  assert.equal(f.state.requests.length,2);assert.equal(f.state.requests[0].url,'https://graph.facebook.com/v26.0/900/live_media?fields=id&limit=100');
  assert.equal(f.state.posts[0].url,'https://graph.facebook.com/v26.0/900/messages');assert.deepEqual(JSON.parse(f.state.posts[0].options.body),{recipient:{comment_id:'456'},message:{text:job.reply_text}});
  assert.equal(f.db.prepare('SELECT job_id FROM instagram_live_direct_attempts WHERE comment_id=?').get('456').job_id,job.id);assert.equal(f.row(job).state,'sent');
});

test('live GET errors, ended broadcasts and pauses during GET cannot spend a send claim',async t=>{
  for(const change of [f=>{f.state.getHook=async()=>response({data:[]});},f=>{f.state.getHook=async()=>response({error:{code:1}},503);},f=>{f.state.getHook=async()=>{throw Error('offline-token');};},f=>{f.state.getHook=async()=>{f.state.run=false;return response({data:[{id:'789'}]});};}]){
    const f=fixture(t),job=await f.ready(live());change(f);await assert.rejects(f.service.send(job,job.reply_text));assert.equal(f.state.posts.length,0);assert.equal(f.row(job).state,'pending');assert.equal(f.row(job).claimed_at,null);assert.equal(f.db.prepare('SELECT count(*) n FROM instagram_live_direct_attempts').get().n,0);
  }
});

test('live revalidates changed credentials, catalog, account, consent setting and 24h before POST',async t=>{
  for(const change of [f=>f.db.exec("UPDATE instagram_messaging_accounts SET token_encrypted='new-account-token' WHERE account_id=7"),f=>f.state.sources.clear(),f=>f.service.configure({enabled:true,autoReply:true,accountIds:[5]}),f=>f.service.configure({enabled:true,autoReply:false}),f=>f.service.configure({enabled:true,autoReply:true,liveCommentsEnabled:false}),f=>f.state.now+=DAY]){
    const f=fixture(t),job=await f.ready(live());f.state.getHook=async()=>{change(f);return response({data:[{id:'789'}]});};await assert.rejects(f.service.send(job,job.reply_text,{automatic:true}));assert.equal(f.state.posts.length,0);assert.equal(f.row(job).claimed_at,null);
  }
});

test('legacy attempted live comments never get another response through the new module',async t=>{
  const f=fixture(t);f.db.prepare('INSERT INTO instagram_live_direct_attempts(comment_id,job_id) VALUES (?,?)').run('456','legacy-job');assert.equal(f.enqueue(live()).length,0);
  const next=live({id:'457'}),job=await f.ready(next);f.db.prepare('INSERT INTO instagram_live_direct_attempts(comment_id,job_id) VALUES (?,?)').run('457','racing-legacy');await assert.rejects(f.service.send(job,job.reply_text),/already_attempted/);assert.equal(f.state.posts.length,0);assert.equal(f.row(job).claimed_at,null);
});

test('the durable Direct claim blocks concurrent calls and a second module after restart',async t=>{
  const f=fixture(t),job=await f.ready();let finish;f.state.postHook=()=>{assert.equal(f.row(job).state,'submitting');return new Promise(resolve=>finish=resolve);};
  const first=f.service.send(job,job.reply_text);await assert.rejects(createInstagramMessaging(f.opts).send(job,job.reply_text),/already_attempted/);assert.equal(f.state.posts.length,1);finish(response({recipient_id:'200',message_id:'late-receipt'}));await first;assert.equal(f.row(job).provider_message_id,'late-receipt');
});

test('timeout, malformed or contradictory receipts remain unknown without retry for both message kinds',async t=>{
  for(const payload of [direct(),live()])for(const hook of [async()=>{throw Error('offline-protected-token');},async()=>response({},503),async()=>response({}),async()=>response({recipient_id:'200',message_id:7}),async()=>response({recipient_id:'200',message_id:'contradiction',error:{code:1}},400)]){
    const f=fixture(t),job=await f.ready(payload);f.state.postHook=hook;await assert.rejects(f.service.send(job,job.reply_text),error=>!error.message.includes('protected-token'));assert.equal(f.row(job).state,'held_unknown');await assert.rejects(f.service.send(job,job.reply_text),/already_attempted/);assert.equal(f.state.posts.length,1);
  }
  const f=fixture(t),job=await f.ready();f.state.postHook=async()=>response({recipient_id:'999',message_id:'wrong-person'});await assert.rejects(f.service.send(job,job.reply_text),/unknown/);assert.equal(f.row(job).state,'held_unknown');
});

test('confirmed permission rejection is terminal and never leaks provider detail',async t=>{
  for(const payload of [direct(),live()]){const f=fixture(t),job=await f.ready(payload);f.state.postHook=async()=>response({error:{code:200,message:'offline-protected-token'}},403);await assert.rejects(f.service.send(job,job.reply_text),error=>!error.message.includes('token'));assert.equal(f.row(job).state,'failed');await assert.rejects(f.service.send(job,job.reply_text),/already_attempted/);assert.equal(f.state.posts.length,1);}
});

test('startup recovery distinguishes before POST, unknown POST and durable confirmed receipt without sending',async t=>{
  const f=fixture(t),pending=await f.ready(),unknown=await f.ready(direct(event({message:{mid:'unknown',text:event().message.text}}))),sent=await f.ready(live());await f.service.send(sent,sent.reply_text);
  f.db.prepare("UPDATE instagram_messaging_messages SET state='submitting',claimed_at=? WHERE job_id=?").run(NOW,unknown.id);f.db.exec("UPDATE omnichannel_automation_jobs SET status='processing'");
  const restart=createInstagramMessaging(f.opts);restart.configure({enabled:true,autoReply:true});assert.equal(f.db.prepare('SELECT status FROM omnichannel_automation_jobs WHERE id=?').get(pending.id).status,'processing');
  assert.deepEqual(restart.recoverInterrupted(),{pending:1,unknown:1,sent:1,failed:0});assert.equal(f.row(unknown).state,'held_unknown');assert.equal(f.db.prepare('SELECT status FROM omnichannel_automation_jobs WHERE id=?').get(sent.id).status,'sent');assert.equal(f.state.posts.length,1);
});

test('Direct opt-out is respected without treating public live authors as the same conversation',async t=>{
  const f=fixture(t),job=await f.ready();f.state.now++;assert.equal(f.enqueue(direct(event({timestamp:f.state.now,message:{mid:'stop',text:'Pare de enviar mensagens'}}))).length,0);await assert.rejects(f.service.send(job,job.reply_text),/declined/);assert.equal(f.state.posts.length,0);
  const liveJob=await f.ready(live({from:{id:'200'}}));assert.deepEqual(JSON.parse(f.state.textCalls.at(-1).input).history,[]);assert.equal(JSON.parse(f.state.textCalls.at(-1).input).origin,'live_comment');assert.equal(f.row(liveJob).recipient_id,'');
});

test('Direct history is account+IGSID scoped and includes only confirmed assistant messages',async t=>{
  const f=fixture(t),first=await f.ready();await f.service.send(first,first.reply_text);f.state.now++;
  f.enqueue(direct(event({timestamp:f.state.now,sender:{id:'777'},message:{mid:'other',text:'OTHER_PERSON_PRIVATE'}})));
  const next=await f.ready(direct(event({timestamp:f.state.now,message:{mid:'next',text:'Pode enviar esse link?'}})));
  const input=JSON.parse(f.state.textCalls.at(-1).input);assert.deepEqual(input.history,[{role:'user',content:first.source_text},{role:'assistant',content:first.reply_text}]);assert.ok(!JSON.stringify(input).includes('OTHER_PERSON_PRIVATE'));assert.ok(!JSON.stringify(input).includes('token'));assert.ok(next.reply_text.endsWith('/produto/11/adubo-rosa-do-deserto'));
});

test('sourceIndex yields one server URL and invalid links, source changes and incomplete envelopes stay blocked',async t=>{
  const f=fixture(t),job=await f.ready();assert.equal((job.reply_text.match(/https:\/\//g)||[]).length,1);assert.ok(!Object.hasOwn(JSON.parse(f.state.textCalls[0].input).catalog[0],'url'));f.state.sources.clear();await assert.rejects(f.service.send(job,job.reply_text),/source_changed/);
  for(const payload of [{output_text:'{"reply":"Veja https://evil.test","sourceIndex":null}'},{output_text:'{"reply":"Oi","sourceIndex":99}'},{output_text:'{"reply":"Oi","sourceIndex":1,"sourceIndex":null}'},{status:'incomplete',output_text:'{"reply":"Oi","sourceIndex":null}'},{output:[{type:'reasoning',text:'PRIVATE'}]}]){const g=fixture(t);g.state.payload=payload;const [item]=g.enqueue();await assert.rejects(g.service.generateReply(item));assert.equal(g.state.posts.length,0);}
  const missing=fixture(t);missing.state.sources.clear();missing.state.sourceIndex=null;missing.state.reply='Qual conteúdo você procura?';const item=await missing.ready();assert.equal(item.reply_text,missing.state.reply);assert.equal(missing.row(item).sources_json,'[]');
});

test('daily cap reserves uncertain attempts across Direct and live replies on the Brasília day',async t=>{
  const f=fixture(t),job=await f.ready();const insert=f.db.prepare("INSERT INTO instagram_messaging_messages(job_id,instagram_id,page_id,recipient_id,event_id,source_kind,account_id,received_at,state,claimed_at) VALUES (?,'900','100','200',?,'instagram_message',7,?,'held_unknown',?)");for(let n=0;n<30;n++)insert.run('old-'+n,'old-'+n,NOW,NOW);
  await assert.rejects(f.service.send(job,job.reply_text),/daily_limit/);assert.equal(f.row(job).claimed_at,null);f.state.now=Date.parse('2026-09-13T02:59:59Z');await assert.rejects(f.service.send(job,job.reply_text),/daily_limit/);f.state.now=Date.parse('2026-09-13T03:00:00Z');await f.service.send(job,job.reply_text);assert.equal(f.state.posts.length,1);
});

test('identity tampering, global pause and disabling automatic replies block Direct before POST',async t=>{
  for(const change of [(f,job)=>job.destination='555',(f,job)=>job.source_kind='instagram_live_comment',f=>f.db.exec("UPDATE social_accounts SET page_id='999' WHERE id=7"),f=>f.state.run=false,f=>f.service.configure({enabled:true,autoReply:false}),f=>f.state.now+=DAY]){const f=fixture(t),job=await f.ready();change(f,job);await assert.rejects(f.service.send(job,job.reply_text,{automatic:true}));assert.equal(f.state.posts.length,0);assert.equal(f.row(job).claimed_at,null);}
});

const server=readFileSync(new URL('../server.js',import.meta.url),'utf8');
function serverHarness(f){
  f.db.exec(`CREATE TABLE omnichannel_automation_settings(channel TEXT PRIMARY KEY,enabled INTEGER,instructions TEXT,campaign_mode TEXT,site_url TEXT,whatsapp_group_url TEXT,daily_limit INTEGER,start_hour INTEGER,end_hour INTEGER,approval_required INTEGER);
    INSERT INTO omnichannel_automation_settings VALUES('instagram',1,'','site','https://vitrinecity.com/oracao-do-dia','',30,9,20,1),('facebook',1,'','site','','',30,9,20,1);
    CREATE TABLE social_webhook_events(object_type TEXT,object_id TEXT,field_name TEXT,payload_json TEXT);`);
  const facebook=createFacebookMessenger(f.opts),legacy=[],timers=[];let handler;
  const fail=()=>{throw Error('Legacy send/AI must not be used by these jobs');};
  const context=vm.createContext({db:f.db,instagramMessaging:f.service,facebookMessenger:facebook,validateServiceReply,
    app:{post:(_path,callback)=>{handler=callback;}},socialCommentCampaigns:{ingestWebhook:()=>new Set()},enqueueOmnichannelJob:(...args)=>legacy.push(args),
    process:{env:{META_SOCIAL_APP_SECRET:'offline-signing-secret'}},Buffer,createHmac,timingSafeEqual,
    ecosystemCanRun:()=>f.state.run,ecosystemLocalWindow:()=>({hour:23,start:'2026-09-12T03:00:00Z',end:'2026-09-13T03:00:00Z'}),discoverWhatsAppQrAutomationJobs:async()=>{},
    requestOpenAI:fail,fetch:fail,sendInstagramLiveDirect:fail,decryptSocialToken:fail,setTimeout:(callback,delay)=>{timers.push({callback,delay});return {unref(){}};},console:{error:fail}});
  const routingStart=server.indexOf('const isInstagramMessageJob='),routingEnd=server.indexOf('async function discoverWhatsAppQrAutomationJobs()',routingStart);
  const workerStart=server.indexOf('async function processOmnichannelAutomation()'),workerEnd=server.indexOf("app.get('/api/admin/marketplace/payments/setup'",workerStart);
  const hookStart=server.indexOf("app.post('/api/webhooks/social'"),hookEnd=server.indexOf('function saveSocialPages(',hookStart);
  assert.ok(routingStart>0&&routingEnd>routingStart&&workerEnd>workerStart&&hookEnd>hookStart);
  vm.runInContext('let omnichannelAutomationRunning=false;'+server.slice(routingStart,routingEnd)+server.slice(workerStart,workerEnd)+server.slice(hookStart,hookEnd),context);
  return {legacy,timers,facebook,async work(){await vm.runInContext('processOmnichannelAutomation()',context);},receive(payload,valid=true){const rawBody=Buffer.from(JSON.stringify(payload));let status;handler({body:payload,rawBody,get:()=>valid?'sha256='+createHmac('sha256','offline-signing-secret').update(rawBody).digest('hex'):'invalid'},{sendStatus:value=>status=value});return status;}};
}

test('the real signed webhook and worker route both Instagram event kinds using private credentials, never legacy sends',async t=>{
  const f=fixture(t),h=serverHarness(f),payload=direct();payload.entry[0].time=NOW/1000;payload.entry[0].changes=live().entry[0].changes;
  assert.equal(h.receive(payload,false),401);assert.equal(f.db.prepare('SELECT count(*) n FROM omnichannel_automation_jobs').get().n,0);
  assert.equal(h.receive(payload),200);assert.equal(h.receive(payload),200);assert.equal(f.db.prepare('SELECT count(*) n FROM omnichannel_automation_jobs').get().n,2);assert.equal(h.legacy.length,0);assert.equal(h.timers.length,2);assert.equal(f.state.posts.length,0);
  await h.work();assert.equal(f.state.posts.length,2);assert.deepEqual(f.state.posts.map(item=>JSON.parse(item.options.body).recipient).sort((a,b)=>String(a.id).localeCompare(String(b.id))),[{id:'200'},{comment_id:'456'}]);
  for(const item of f.state.posts)assert.equal(item.options.headers.Authorization,'Bearer encrypted:ig-only-token');
  assert.equal(f.db.prepare("SELECT count(*) n FROM omnichannel_automation_jobs WHERE status='sent'").get().n,2);assert.equal(f.db.prepare('SELECT count(*) n FROM facebook_messenger_messages').get().n,0);assert.equal(h.facebook.settings().enabled,false);
});

test('a paused Instagram channel cannot fall through the real webhook/worker to enabled legacy comments',async t=>{
  const f=fixture(t),h=serverHarness(f);f.service.configure({enabled:false,autoReply:false});const payload=direct();payload.entry[0].time=NOW/1000;payload.entry[0].changes=live().entry[0].changes;
  assert.equal(h.receive(payload),200);await h.work();assert.equal(h.legacy.length,0);assert.equal(f.state.posts.length,0);assert.equal(f.state.textCalls.length,0);assert.equal(f.db.prepare('SELECT count(*) n FROM omnichannel_automation_jobs').get().n,0);
});
