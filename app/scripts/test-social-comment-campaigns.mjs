import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import Database from 'better-sqlite3';
import {registerSocialCommentCampaigns} from '../social-comment-campaigns.js';

const API='/api/admin/social-comment-campaigns',origin='https://vitrinecity.com';
async function fixture(t,options={}){
  const db=new Database(':memory:');
  db.exec(`CREATE TABLE social_accounts(id INTEGER PRIMARY KEY,page_id TEXT,page_name TEXT,instagram_id TEXT,instagram_username TEXT,token_encrypted TEXT,status TEXT,updated_at TEXT);
    INSERT INTO social_accounts VALUES (1,'100','Página VitrineCity','200','vitrinecity','SECRET_MUST_NEVER_APPEAR','connected','2026-09-09');`);
  const state={time:Date.parse('2026-09-10T12:00:00Z'),ready:true,inspections:[],sends:[],publicReplies:[],reactions:[],sequence:[],inspectHook:null,sendHook:null,publicHook:null,reactionHook:null,sources:new Map([
    ['recipe',{key:'recipe',title:'Bolo de cenoura',summary:'Receita com ingredientes e preparo explicados.',image_url:'/assets/bolo.jpg',sourcePath:'/artigo/bolo-de-cenoura',commercial:false,facts:{category:'receitas'},body:'Ingredientes e preparo completos.'}],
    ['plant',{key:'plant',title:'Guia de plantas',summary:'Entenda os cuidados básicos.',image_url:'/uploads/guia.png',sourcePath:'/artigo/plantas',commercial:false,facts:{category:'plantas'},body:'Cuidados com plantas.'}],
    ['product',{key:'product',title:'Adubo para plantas',summary:'Conheça a apresentação e confira a oferta.',image_url:'https://http2.mlstatic.com/D_NQ_NP_2X_123-F.webp',sourcePath:'/ofertas/adubo',commercial:true,facts:{affiliate:true},body:'Descrição conferida.'}]
  ])};
  const sourceCatalog={get:key=>state.sources.get(key),list:({q='',limit=200}={})=>[...state.sources.values()].filter(source=>!q||source.title.toLowerCase().includes(q.toLowerCase())).slice(0,limit)};
  const metaAdapter={inspect:async input=>{state.inspections.push(input);if(state.inspectHook)return state.inspectHook(input);return {ready:state.ready,missing:state.ready?[]:['Falta a permissão necessária.'],postUrl:'https://www.facebook.com/100/posts/'+input.postId};},send:async input=>{state.sends.push(input);state.sequence.push('private');if(state.sendHook)return state.sendHook(input);return {messageId:'message_'+state.sends.length};},replyPublic:async input=>{state.publicReplies.push(input);state.sequence.push('public');if(state.publicHook)return state.publicHook(input);return {commentId:'900_'+state.publicReplies.length};},likeComment:async input=>{state.reactions.push(input);state.sequence.push('reaction');if(state.reactionHook)return state.reactionHook(input);return {success:true};}};
  const app=express();app.use(express.json());
  const register=app=>registerSocialCommentCampaigns({app,db,sourceCatalog,metaAdapter,canRun:()=>!state.paused,commentModerationReason:options.commentModerationReason,siteUrl:origin,now:()=>state.time,sendTimeoutMs:options.sendTimeoutMs??50,inspectTimeoutMs:options.inspectTimeoutMs??1000,
    requireAdmin:(req,res,next)=>req.headers['x-admin']==='yes'?next():res.status(401).end(),
    sameOriginOnly:(req,res,next)=>req.headers.origin===origin?next():res.status(403).end()});
  const service=register(app);
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
  async function request(path='',method='GET',body,headers={}){
    const response=await fetch('http://127.0.0.1:'+server.address().port+API+path,{method,headers:{'x-admin':'yes',origin,'content-type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const text=await response.text();return {status:response.status,body:text?JSON.parse(text):null};
  }
  async function preview(overrides={}){return request('/preview','POST',{sourceKey:'recipe',accountId:1,surface:'facebook_page',postId:'100_900',keyword:'QUERO RECEITA',caption:'Uma receita explicada passo a passo. Comente QUERO RECEITA para receber o preparo.',invite:'vip',idempotencyKey:randomUUID(),...overrides});}
  async function activate(overrides={}){const result=await preview(overrides);assert.equal(result.status,200);const active=await request('/'+result.body.id+'/activate','POST',{});assert.equal(active.status,200,JSON.stringify(active.body));state.time+=1000;return active.body;}
  function facebook({id='300_1',author='300',post='100_900',text='QUERO RECEITA',time=state.time,verb='add',...extra}={}){
    return {object:'page',entry:[{id:'100',changes:[{field:'feed',value:{item:'comment',verb,comment_id:id,post_id:post,from:{id:author},created_time:time/1000,message:text,...extra}}]}]};
  }
  function instagram({id='400_1',author='400',post='800',text='QUERO RECEITA',time=state.time,entryTime=state.time,field='comments',...extra}={}){
    return {object:'instagram',entry:[{id:'200',time:entryTime/1000,changes:[{field,value:{id,text,from:{id:author},media:{id:post},...(time===null?{}:{timestamp:time/1000}),...extra}}]}]};
  }
  const rows=()=>db.prepare('SELECT * FROM social_content_comment_events ORDER BY received_at,id').all();
  return {db,state,service,request,preview,activate,facebook,instagram,rows,secondService:()=>register(express())};
}

test('global pause during inspection retains private reply and extras without repeating confirmed sends',async t=>{
  const f=await fixture(t);await f.activate({publicReplyEnabled:true,reactEnabled:true});f.service.ingestWebhook(f.facebook());
  f.state.paused=true;await f.service.processPending();assert.equal(f.state.sends.length,0);assert.equal(f.rows()[0].status,'pending');
  f.state.paused=false;f.state.inspectHook=async()=>{f.state.paused=true;return {ready:true,missing:[]};};
  await f.service.processPending();assert.equal(f.state.sends.length,0);assert.equal(f.rows()[0].status,'pending');
  f.state.paused=false;f.state.inspectHook=null;f.state.sendHook=async()=>{f.state.paused=true;return {messageId:'confirmed'};};
  await f.service.processPending();assert.equal(f.state.sends.length,1);assert.equal(f.rows()[0].status,'sent');assert.equal(f.state.publicReplies.length,0);assert.equal(f.state.reactions.length,0);
  f.state.paused=false;await f.service.processPending();await f.service.processPending();assert.equal(f.state.sends.length,1);assert.equal(f.state.publicReplies.length,1);assert.equal(f.state.reactions.length,1);
});

test('global pause never changes an uncertain provider attempt into a retry',async t=>{
  const f=await fixture(t);await f.activate();f.service.ingestWebhook(f.facebook());
  f.state.sendHook=async()=>{f.state.paused=true;throw Object.assign(Error('timeout'),{uncertain:true});};
  await f.service.processPending();assert.equal(f.rows()[0].status,'unknown');f.state.paused=false;await f.service.processPending();assert.equal(f.state.sends.length,1);
});

test('catalog and routes require admin; mutations require origin; account tokens never leave catalog',async t=>{
  const f=await fixture(t);
  assert.equal((await f.request('/catalog','GET',undefined,{'x-admin':'no'})).status,401);
  assert.equal((await f.request('/preview','POST',{}, {origin:'https://evil.test'})).status,403);
  const catalog=await f.request('/catalog');assert.equal(catalog.status,200);assert.equal(catalog.body.items.length,3);
  assert(!JSON.stringify(catalog.body).includes('SECRET'));assert.equal(catalog.body.accounts[0].pageId,'100');
  assert.equal((await f.request('/catalog?q=cenoura')).body.items.length,1);
  f.db.prepare('INSERT INTO social_accounts VALUES (?,?,?,?,?,?,?,?)').run(2,'100','Duplicada','200','vitrinecity','SECOND_SECRET','connected','2026-09-08');
  assert.equal((await f.request('/catalog')).body.accounts.length,1);
  f.state.sources.set('bad',{key:'bad',title:'Bad',image_url:'javascript:bad',sourcePath:'https://evil.test'});
  assert.equal((await f.request('/catalog')).body.items.length,3);
});

test('draft without a post prepares photo, copy, disclosure and optional VIP invitation without publishing',async t=>{
  const f=await fixture(t),response=await f.preview({postId:'',sourceKey:'product'}),draft=response.body;
  assert.equal(response.status,200);assert.equal(draft.status,'draft');assert.equal(draft.readiness.ready,false);
  assert.match(draft.source.image,/mlstatic/);assert.match(draft.privateReply,/Publicidade/);assert.match(draft.privateReply,/grupos-whatsapp\.html/);
  assert(draft.privateReply.indexOf('/ofertas/adubo')<draft.privateReply.indexOf('/grupos-whatsapp.html'));
  assert.equal(f.state.inspections.length,0);assert.equal(f.state.sends.length,0);assert.equal(f.rows().length,0);
  assert.equal((await f.request('/'+draft.id+'/activate','POST',{})).status,409);
  assert.equal((await f.preview({surface:'facebook_group',postId:'',groupId:''})).status,200);
  assert.equal((await f.preview({surface:'facebook_group',groupId:''})).status,400);
  for(const bad of [{keyword:'curti'},{caption:'Acesse https://evil.test'},{postId:'https://facebook.com/1'},{accountId:999},{invite:'other'}])assert.notEqual((await f.preview(bad)).status,200);
});

test('preview is persistent and concurrent/idempotent; activation requires unchanged source and live readiness',async t=>{
  const f=await fixture(t),idempotencyKey=randomUUID();
  const [a,b]=await Promise.all([f.preview({idempotencyKey}),f.preview({idempotencyKey})]);assert.equal(a.status,200);assert.equal(b.body.id,a.body.id);assert.equal(f.state.inspections.length,1);
  assert.equal((await f.preview({idempotencyKey,keyword:'EU QUERO'})).status,409);
  f.state.ready=false;assert.equal((await f.request('/'+a.body.id+'/activate','POST',{})).status,409);
  assert.equal((await f.request('/'+a.body.id)).body.status,'draft');
  f.state.ready=true;f.state.sources.get('recipe').body+=' Conteúdo alterado.';
  assert.equal((await f.request('/'+a.body.id+'/activate','POST',{})).status,409);
  const current=await f.activate();assert.equal(current.status,'active');
  const duplicate=await f.preview();assert.equal((await f.request('/'+duplicate.body.id+'/activate','POST',{})).status,409);
  assert.equal((await f.request('')).body.campaigns.length,3);
});

test('only exact explicit requests on mapped posts enqueue; generic, negative, edits, likes and own authors never send',async t=>{
  const f=await fixture(t);await f.activate();
  const cases=[
    {id:'c1',author:'a1',text:' quero receita!!! '},
    {id:'c2',author:'a2',text:'não quero receita'},
    {id:'c3',author:'a3',text:'Que planta é essa?'},
    {id:'c4',author:'a4',text:'EU QUERO'},
    {id:'c5',author:'100'},
    {id:'c6',author:''},
    {id:'c7',author:'a7',verb:'edited'},
    {id:'c8',author:'a8',verb:'remove'},
    {id:'c9',author:'a9',created_time:undefined},
    {id:'c10',author:'a10',time:f.state.time-2000},
    {id:'c11',author:'a11',parent_id:'another_comment'},
    {id:'c12',author:'a12',live_video_id:'live'}
  ];
  for(const input of cases)assert(f.service.ingestWebhook(f.facebook(input)).has(input.id),'all mapped comment IDs suppress legacy AI');
  assert.equal(f.service.ingestWebhook(f.facebook({id:'other',post:'100_999'})).size,0);
  const like=f.facebook({id:'like',item:'reaction'});assert.equal(f.service.ingestWebhook(like).size,0);
  assert.equal(f.rows().filter(row=>row.status==='pending').length,1);
  await f.service.processPending();assert.equal(f.state.sends.length,1);assert.equal(f.state.sends[0].commentId,'c1');
  assert.match(f.state.sends[0].text,/utm_source=facebook/);assert.match(f.state.sends[0].text,/bolo-de-cenoura/);
  assert.equal(f.rows().find(row=>row.comment_id==='c1').provider_message_id,'message_1');
});

test('events and author requests are deduplicated per post, including webhook replay and campaign replacement',async t=>{
  const f=await fixture(t),campaign=await f.activate();
  const event=f.facebook();f.service.ingestWebhook(event);f.service.ingestWebhook(event);
  f.service.ingestWebhook(f.facebook({id:'300_2'}));assert.equal(f.rows().filter(row=>row.status==='pending').length,1);
  await f.service.processPending();await f.request('/'+campaign.id+'/pause','POST',{});
  await f.activate();f.service.ingestWebhook(f.facebook({id:'300_3'}));await f.service.processPending();assert.equal(f.state.sends.length,1);
  // An unrelated earlier comment does not spend the author's explicit-request allowance.
  f.service.ingestWebhook(f.facebook({id:'500_1',author:'500',text:'Gostei'}));f.service.ingestWebhook(f.facebook({id:'500_2',author:'500'}));
  await f.service.processPending();assert.equal(f.state.sends.length,2);
});

test('Instagram uses original event time; entry.time is the documented fallback, never receipt time',async t=>{
  const f=await fixture(t);await f.activate({surface:'instagram',postId:'800'});
  f.service.ingestWebhook(f.instagram());f.service.ingestWebhook(f.instagram({id:'401',author:'401',time:null}));
  f.service.ingestWebhook(f.instagram({id:'402',author:'402',time:null,entryTime:f.state.time-5000}));
  const missing=f.instagram({id:'403',author:'403',time:null});delete missing.entry[0].time;f.service.ingestWebhook(missing);
  f.service.ingestWebhook(f.instagram({id:'404',author:'404',field:'live_comments'}));
  f.service.ingestWebhook(f.instagram({id:'405',author:'405',verb:'remove'}));
  assert.equal(f.rows().filter(row=>row.status==='pending').length,2);
  assert(f.rows().filter(row=>row.status==='pending').every(row=>row.original_time===f.state.time&&row.instagram_id==='200'&&row.page_id==='100'));
  await f.service.processPending();assert.equal(f.state.sends.length,2);assert(f.state.sends.every(send=>send.surface==='instagram'));
});

test('Facebook group accepts only the mapped Page business group_feed envelope',async t=>{
  const f=await fixture(t);await f.activate({surface:'facebook_group',postId:'777_900',groupId:'777'});
  const payload={object:'page',entry:[{id:'100',messaging:[{field:'group_feed',recipient:{id:'100'},from:{id:'300'},group_id:'777',comment_id:'group_1',post_id:'777_900',parent_id:'777_900',created_time:f.state.time/1000,item:'comment',verb:'add',message:'QUERO RECEITA'}]}]};
  assert(f.service.ingestWebhook(payload).has('group_1'));
  const wrong=structuredClone(payload);wrong.entry[0].messaging[0].comment_id='group_2';wrong.entry[0].messaging[0].recipient.id='different';assert.equal(f.service.ingestWebhook(wrong).size,0);
  const obsolete=structuredClone(payload);obsolete.object='group';assert.equal(f.service.ingestWebhook(obsolete).size,0);
  await f.service.processPending();assert.equal(f.state.sends.length,1);assert.equal(f.rows()[0].group_id,'777');
});

test('pausing, withdrawal, changed account and expiration cancel queued work before any message',async t=>{
  for(const mode of ['pause','withdraw','changed','expired']){
    const f=await fixture(t),campaign=await f.activate();f.service.ingestWebhook(f.facebook());
    if(mode==='pause')await f.request('/'+campaign.id+'/pause','POST',{});
    if(mode==='withdraw')f.state.sources.delete('recipe');
    if(mode==='changed')f.db.prepare("UPDATE social_accounts SET page_id='999' WHERE id=1").run();
    if(mode==='expired')f.state.time+=7*86400000;
    await f.service.processPending();assert.equal(f.state.sends.length,0,mode);assert.equal(f.rows()[0].status,'cancelled',mode);
  }
});

test('pause during async provider readiness is rechecked immediately before sending',async t=>{
  const f=await fixture(t),campaign=await f.activate();f.service.ingestWebhook(f.facebook());
  f.state.inspectHook=async()=>{await f.request('/'+campaign.id+'/pause','POST',{});return {ready:true};};
  await f.service.processPending();assert.equal(f.state.sends.length,0);assert.equal(f.rows()[0].status,'cancelled');
});

test('worker enforces 3 per pass, global 30 per São Paulo calendar day, 09:00–20:00, and concurrency claims',async t=>{
  const f=await fixture(t);await f.activate();
  for(let i=0;i<35;i++)f.service.ingestWebhook(f.facebook({id:'request_'+i,author:'person_'+i}));
  const [a,b]=await Promise.all([f.service.processPending(),f.service.processPending()]);assert.equal(a.processed+b.processed,3);assert.equal(f.state.sends.length,3);
  for(let i=0;i<12;i++)await f.service.processPending();assert.equal(f.state.sends.length,30);assert.equal(f.rows().filter(row=>row.status==='pending').length,5);
  f.state.time=Date.parse('2026-09-11T11:59:00Z');await f.service.processPending();assert.equal(f.state.sends.length,30);
  f.state.time=Date.parse('2026-09-11T12:00:00Z');await f.service.processPending();assert.equal(f.state.sends.length,33);
  f.state.time=Date.parse('2026-09-11T23:00:00Z');await f.service.processPending();assert.equal(f.state.sends.length,33);
});

test('missing acknowledgment, ambiguous timeout and explicit rejection are terminal without retries',async t=>{
  for(const mode of ['missing','timeout','rejected']){
    const f=await fixture(t,{sendTimeoutMs:10});await f.activate();f.service.ingestWebhook(f.facebook());
    f.state.sendHook=mode==='missing'?async()=>({}):mode==='timeout'?()=>new Promise(()=>{}):async()=>{throw Object.assign(Error('SECRET_REMOTE_ERROR'),{definitive:true});};
    await f.service.processPending();await f.service.processPending();assert.equal(f.state.sends.length,1);assert.equal(f.rows()[0].status,mode==='rejected'?'failed':'unknown');assert(!f.rows()[0].reason.includes('SECRET'));
  }
});

test('readiness errors expose no provider secrets and failed inspection never activates',async t=>{
  const f=await fixture(t);f.state.inspectHook=async()=>{throw Error('access_token=SECRET');};
  const draft=await f.preview();assert.equal(draft.status,200);assert.equal(draft.body.readiness.ready,false);assert(!JSON.stringify(draft.body).includes('SECRET'));
  assert.equal((await f.request('/'+draft.body.id+'/activate','POST',{})).status,409);
  assert.equal(f.state.sends.length,0);
});

test('a repeated pause wins against an in-flight reactivation even within the same millisecond',async t=>{
  const f=await fixture(t),campaign=await f.activate();await f.request('/'+campaign.id+'/pause','POST',{});
  f.state.inspectHook=async()=>{await f.request('/'+campaign.id+'/pause','POST',{});return {ready:true};};
  const result=await f.request('/'+campaign.id+'/activate','POST',{});assert.equal(result.status,409);assert.equal((await f.request('/'+campaign.id)).body.status,'paused');
});

test('read-only connection checks require admin, preserve missing steps and coalesce repeated requests',async t=>{
  const f=await fixture(t);f.state.inspectHook=async input=>{assert.equal(input.postId,'');return {ready:false,missing:['Autorize pages_messaging.','Informe o ID de uma publicação existente.']};};
  assert.equal((await f.request('/connection?accountId=1&surface=facebook_page','GET',undefined,{'x-admin':'no'})).status,401);
  const [a,b]=await Promise.all([f.request('/connection?accountId=1&surface=facebook_page'),f.request('/connection?accountId=1&surface=facebook_page')]);
  assert.equal(a.status,200);assert.deepEqual(a.body,b.body);assert.equal(a.body.readiness.missing.length,2);assert.equal(f.state.inspections.length,1);assert.equal(f.state.sends.length,0);assert.equal(f.rows().length,0);
  assert.equal((await f.request('/connection?accountId=999&surface=facebook_page')).status,400);
  assert.equal((await f.request('/connection?accountId=1&surface=profile')).status,400);
});

test('edits and deletions revoke pending requests, including missing post IDs and invalidation during inspection',async t=>{
  const f=await fixture(t);await f.activate();f.service.ingestWebhook(f.facebook());
  const deletion=f.facebook({verb:'remove'});delete deletion.entry[0].changes[0].value.post_id;
  assert(f.service.ingestWebhook(deletion).has('300_1'));await f.service.processPending();assert.equal(f.state.sends.length,0);assert.equal(f.rows()[0].status,'cancelled');
  f.service.ingestWebhook(f.facebook({id:'400_1',author:'400'}));
  f.state.inspectHook=async()=>{f.service.ingestWebhook(f.facebook({id:'400_1',author:'400',verb:'edited',text:'Não quero mais'}));return {ready:true};};
  await f.service.processPending();assert.equal(f.state.sends.length,0);assert.equal(f.rows().find(row=>row.comment_id==='400_1').status,'cancelled');
});

test('stale crash claims become unknown without replay; a fresh claim remains owned by its active worker',async t=>{
  const f=await fixture(t);await f.activate();f.service.ingestWebhook(f.facebook());
  f.db.prepare("UPDATE social_content_comment_events SET status='processing',claimed_at=?").run(f.state.time-121000);
  await f.service.processPending();assert.equal(f.rows()[0].status,'unknown');assert.equal(f.state.sends.length,0);
  f.service.ingestWebhook(f.facebook({id:'400_1',author:'400'}));f.db.prepare("UPDATE social_content_comment_events SET status='processing',claimed_at=? WHERE comment_id='400_1'").run(f.state.time-10000);
  await f.service.processPending();assert.equal(f.rows().find(row=>row.comment_id==='400_1').status,'processing');assert.equal(f.state.sends.length,0);
});

test('two independent processors and duplicate Page connections cannot send a comment twice',async t=>{
  const f=await fixture(t),second=f.secondService();f.db.prepare('INSERT INTO social_accounts VALUES (?,?,?,?,?,?,?,?)').run(2,'100','Página VitrineCity','200','vitrinecity','OTHER_SECRET','connected','2026-09-10');
  await f.activate({accountId:1});const duplicate=await f.preview({accountId:2});assert.equal((await f.request('/'+duplicate.body.id+'/activate','POST',{})).status,409);
  f.service.ingestWebhook(f.facebook());second.ingestWebhook(f.facebook());await Promise.all([f.service.processPending(),second.processPending()]);assert.equal(f.state.sends.length,1);assert.equal(f.rows().length,1);
});

test('source and image URLs reject administrative, encoded and external destinations; own Instagram scoped comments are ignored',async t=>{
  const f=await fixture(t);
  for(const sourcePath of ['/admin.html','/%61dmin.html','/auth/start','/login','/api%2Fsecret','https://evil.test/path','//evil.test/path']){
    f.state.sources.get('plant').sourcePath=sourcePath;assert.equal((await f.preview({sourceKey:'plant'})).status,409,sourcePath);
  }
  f.state.sources.get('plant').sourcePath='/artigo/plantas';f.state.sources.get('plant').image_url='https://evil.test/photo.jpg';
  const draft=await f.preview({sourceKey:'plant'});assert.equal(draft.body.source.image,'');assert.equal(draft.body.readiness.ready,false);
  await f.activate({surface:'instagram',postId:'800'});f.service.ingestWebhook(f.instagram({self_ig_scoped_id:'400'}));await f.service.processPending();assert.equal(f.state.sends.length,0);
});

test('trigger and interaction options are explicit, preview-only, idempotent and checked by connection readiness',async t=>{
  const f=await fixture(t),base=(await f.preview()).body;
  assert.equal(base.triggerMode,'keyword');assert.equal(base.publicReplyEnabled,false);assert.equal(base.reactEnabled,false);assert.equal(base.publicReplyPreview,'');
  const idempotencyKey=randomUUID(),options={triggerMode:'any_comment',publicReplyEnabled:true,reactEnabled:true,idempotencyKey,caption:''};
  const draft=await f.preview(options);assert.equal(draft.status,200);assert.equal(draft.body.status,'draft');assert.match(draft.body.publicReplyPreview,/\{nome\}, obrigado/);
  assert(!draft.body.privateReply.includes('você pediu'));assert.match(draft.body.caption,/Deixe seu comentário/);assert.equal(f.state.sends.length,0);
  assert.equal((await f.preview(options)).body.id,draft.body.id);assert.equal((await f.preview({...options,reactEnabled:false})).status,409);
  for(const invalid of [{triggerMode:'all'},{publicReplyEnabled:'true'},{reactEnabled:1},{surface:'instagram',postId:'800',reactEnabled:true}])assert.equal((await f.preview(invalid)).status,400);
  assert.equal((await f.request('/connection?accountId=1&surface=instagram&reactEnabled=true')).status,400);
  assert.equal((await f.request('/connection?accountId=1&surface=facebook_page&publicReplyEnabled=true&reactEnabled=true')).status,200);
  assert.equal(f.state.inspections.at(-1).publicReplyEnabled,true);assert.equal(f.state.inspections.at(-1).reactEnabled,true);
});

test('any comment sends related content first, then named public thanks and Facebook like, all exactly once',async t=>{
  const f=await fixture(t),campaign=await f.activate({triggerMode:'any_comment',publicReplyEnabled:true,reactEnabled:true});
  const event=f.facebook({text:'Que planta bonita!',from:{id:'300',name:'Maria Silva'}});f.service.ingestWebhook(event);f.service.ingestWebhook(event);
  f.service.ingestWebhook(f.facebook({id:'300_2',text:'Também gostei',from:{id:'300',name:'Maria'}}));
  const result=await f.service.processPending();assert.equal(result.actions,3);assert.equal(result.processed,1);
  assert.deepEqual(f.state.sequence,['private','public','reaction']);assert.match(f.state.publicReplies[0].text,/^Maria, obrigado/);assert.match(f.state.publicReplies[0].text,/presente/);assert(!f.state.sends[0].text.includes('pediu'));
  await f.service.processPending();assert.equal(f.state.sequence.length,3);
  const row=f.rows().find(row=>row.status==='sent');assert.equal(row.author_name,'Maria');assert.equal(row.public_status,'sent');assert.equal(row.reaction_status,'sent');assert.equal(row.public_provider_id,'900_1');assert.equal(row.provider_message_id,'message_1');
  const dto=(await f.request('/'+campaign.id)).body;assert.equal(dto.counts.sent,1);assert.equal(dto.publicReplyCounts.sent,1);assert.equal(dto.reactionCounts.sent,1);
});

test('commercial replies disclose an offer instead of a gift and absent or unsafe names use generic thanks',async t=>{
  for(const name of [undefined,'<script>bad</script>','https://spam.test','']){
    const f=await fixture(t);await f.activate({triggerMode:'any_comment',sourceKey:'product',publicReplyEnabled:true});
    f.service.ingestWebhook(f.facebook({text:'Gostei deste produto',from:{id:'300',name}}));await f.service.processPending();
    assert.match(f.state.publicReplies[0].text,/^Obrigado pelo comentário! Enviei o link da oferta/);assert(!f.state.publicReplies[0].text.includes('presente'));assert.match(f.state.sends[0].text,/Publicidade/);
  }
});

test('any-comment mode retains moderation, opt-out, authorship, timestamp, edit and nested-comment guards',async t=>{
  const f=await fixture(t,{commentModerationReason:text=>text==='retido pelo sistema'?'retido':''});await f.activate({triggerMode:'any_comment',publicReplyEnabled:true,reactEnabled:true});
  const cases=[{text:'não quero receber mensagens'},{text:'Pare de enviar'},{text:'PARAR'},{text:'pare'},{text:'não me mande mensagem'},{text:'não me contate'},{text:'https://spam.test'},{text:'vai se foder'},{text:'retido pelo sistema'},{text:''},{author:'100'},{author:''},{verb:'edited'},{verb:'remove'},{parent_id:'another_comment'},{created_time:undefined},{time:f.state.time-5000},{live_video_id:'live'}];
  for(const [index,input] of cases.entries())f.service.ingestWebhook(f.facebook({id:'bad_'+index,author:'person_'+index,text:'Gostei',...input}));
  await f.service.processPending();assert.equal(f.state.sequence.length,0);assert(f.rows().every(row=>row.status==='ignored'&&row.public_status==='not_requested'&&row.reaction_status==='not_requested'));
});

test('private refusal, timeout or missing confirmation never announces delivery or likes the comment',async t=>{
  for(const mode of ['refused','timeout','missing']){
    const f=await fixture(t,{sendTimeoutMs:10});await f.activate({triggerMode:'any_comment',publicReplyEnabled:true,reactEnabled:true});f.service.ingestWebhook(f.facebook({text:'Gostei'}));
    f.state.sendHook=mode==='refused'?async()=>{throw Object.assign(Error('SECRET'),{definitive:true});}:mode==='timeout'?()=>new Promise(()=>{}):async()=>({});
    await f.service.processPending();await f.service.processPending();assert.deepEqual(f.state.sequence,['private']);assert.equal(f.rows()[0].status,mode==='refused'?'failed':'unknown');assert.equal(f.rows()[0].public_status,'cancelled');assert.equal(f.rows()[0].reaction_status,'cancelled');
  }
});

test('public and like failures are independent and terminal, never resending the confirmed private reply',async t=>{
  for(const prefix of ['public','reaction'])for(const mode of ['refused','timeout','missing']){
    const f=await fixture(t,{sendTimeoutMs:10});await f.activate({triggerMode:'any_comment',publicReplyEnabled:true,reactEnabled:true});f.service.ingestWebhook(f.facebook({text:'Gostei'}));
    f.state[prefix==='public'?'publicHook':'reactionHook']=mode==='refused'?async()=>{throw Object.assign(Error('SECRET'),{definitive:true});}:mode==='timeout'?()=>new Promise(()=>{}):async()=>({});
    await f.service.processPending();await f.service.processPending();assert.deepEqual(f.state.sequence,['private','public','reaction']);assert.equal(f.rows()[0].status,'sent');assert.equal(f.rows()[0][prefix+'_status'],mode==='refused'?'failed':'unknown');assert.equal(f.rows()[0][(prefix==='public'?'reaction':'public')+'_status'],'sent');assert(!JSON.stringify(f.rows()).includes('SECRET'));
  }
});

test('pause, changed source and comment removal after private confirmation cancel the remaining interactions',async t=>{
  for(const mode of ['pause','source','remove']){
    const f=await fixture(t),campaign=await f.activate({triggerMode:'any_comment',publicReplyEnabled:true,reactEnabled:true});f.service.ingestWebhook(f.facebook({text:'Gostei'}));
    f.state.sendHook=async()=>{if(mode==='pause')await f.request('/'+campaign.id+'/pause','POST',{});if(mode==='source')f.state.sources.get('recipe').body+=' Changed';if(mode==='remove')f.service.ingestWebhook(f.facebook({verb:'remove'}));return {messageId:'confirmed'};};
    await f.service.processPending();await f.service.processPending();assert.deepEqual(f.state.sequence,['private']);assert.equal(f.rows()[0].status,'sent');assert.equal(f.rows()[0].public_status,'cancelled');assert.equal(f.rows()[0].reaction_status,'cancelled');
  }
});

test('independent workers claim each public reply and like once and recover stale claims without reissuing them',async t=>{
  const f=await fixture(t),second=f.secondService();await f.activate({triggerMode:'any_comment',publicReplyEnabled:true,reactEnabled:true});f.service.ingestWebhook(f.facebook({text:'Gostei'}));
  await Promise.all([f.service.processPending(),second.processPending()]);await second.processPending();assert.equal(f.state.sends.length,1);assert.equal(f.state.publicReplies.length,1);assert.equal(f.state.reactions.length,1);
  f.db.prepare("UPDATE social_content_comment_events SET public_status='processing',public_claimed_at=?,reaction_status='processing',reaction_claimed_at=?").run(f.state.time-121000,f.state.time-1000);
  await f.service.processPending();assert.equal(f.rows()[0].public_status,'unknown');assert.equal(f.rows()[0].reaction_status,'processing');assert.equal(f.state.sequence.length,3);
  f.state.time+=121000;await second.processPending();assert.equal(f.rows()[0].reaction_status,'unknown');assert.equal(f.state.sequence.length,3);
});

test('Facebook add-ons share a three-action pass budget and Instagram supports public replies without likes',async t=>{
  const f=await fixture(t);await f.activate({triggerMode:'any_comment',publicReplyEnabled:true,reactEnabled:true});
  for(let i=0;i<4;i++)f.service.ingestWebhook(f.facebook({id:'comment_'+i,author:'author_'+i,text:'Bonito'}));
  assert.equal((await f.service.processPending()).actions,3);assert.equal(f.state.sequence.length,3);assert.equal(f.state.sends.length,1);
  const ig=await fixture(t);await ig.activate({surface:'instagram',postId:'800',triggerMode:'any_comment',publicReplyEnabled:true});ig.service.ingestWebhook(ig.instagram({text:'Adorei',from:{id:'400',username:'ana.plantas'}}));await ig.service.processPending();
  assert.deepEqual(ig.state.sequence,['private','public']);assert.match(ig.state.publicReplies[0].text,/^Obrigado pelo comentário/);assert.equal(ig.rows()[0].reaction_status,'not_requested');
});

test('a later opt-out from the same author cancels queued work, in-flight add-ons and future requests on that post',async t=>{
  for(const phase of ['before_worker','during_inspect','after_private']){
    const f=await fixture(t);await f.activate({triggerMode:'any_comment',publicReplyEnabled:true,reactEnabled:true});f.service.ingestWebhook(f.facebook({text:'Parece delicioso!'}));
    const optOut=()=>f.service.ingestWebhook(f.facebook({id:'300_2',text:'Não quero mensagens'}));
    if(phase==='before_worker')optOut();
    if(phase==='during_inspect')f.state.inspectHook=async()=>{optOut();return {ready:true};};
    if(phase==='after_private')f.state.sendHook=async()=>{optOut();return {messageId:'confirmed'};};
    await f.service.processPending();f.state.inspectHook=null;f.state.sendHook=null;
    f.service.ingestWebhook(f.facebook({id:'300_3',text:'QUERO RECEITA'}));await f.service.processPending();
    assert.deepEqual(f.state.sequence,phase==='after_private'?['private']:[]);const original=f.rows().find(row=>row.comment_id==='300_1');assert.equal(original.public_status,'cancelled');assert.equal(original.reaction_status,'cancelled');assert.notEqual(original.invalidated_at,null);
  }
  const f=await fixture(t);await f.activate({triggerMode:'any_comment'});f.service.ingestWebhook(f.facebook({text:'PARAR'}));f.service.ingestWebhook(f.facebook({id:'300_2',text:'Gostei'}));await f.service.processPending();assert.equal(f.state.sends.length,0);
});

test('public copy rejects bare domains, strips source links and omits link-like names while private links remain',async t=>{
  const f=await fixture(t);
  for(const link of ['wa.me/5511999999999','t.me/canal','bit.ly','vitrinecity.com.br','example.io','curso.dev','https://site.test','ftp://site.test','www.exemplo.com'])assert.equal((await f.preview({caption:'Comente QUERO RECEITA '+link})).status,400,link);
  const ordinary='Bolo fofinho com 1.5 xícara de farinha e preço de R$ 10,50. Comente QUERO RECEITA!';assert.equal((await f.preview({caption:ordinary})).body.caption,ordinary);
  f.state.sources.get('recipe').title='Bolo de cenoura em wa.me/123';f.state.sources.get('recipe').summary='Receita em bit.ly ou vitrinecity.com.br. Use 1.5 xícara de farinha.';
  const generated=(await f.preview({caption:''})).body;assert(!/wa\.me|bit\.ly|vitrinecity\.com\.br/.test(generated.caption));assert.match(generated.caption,/1\.5 xícara/);assert.match(generated.privateReply,/https:\/\/vitrinecity\.com\/artigo/);
  await f.activate({triggerMode:'any_comment',publicReplyEnabled:true});
  for(const [index,name] of ['bit.ly','wa.me','empresa.com.br','Maria Silva'].entries())f.service.ingestWebhook(f.facebook({id:'name_'+index,text:'Gostei!',from:{id:'person_'+index,name}}));
  for(let i=0;i<4;i++)await f.service.processPending();assert.equal(f.state.publicReplies.length,4);
  assert.equal(f.state.publicReplies.filter(item=>/^Obrigado pelo comentário/.test(item.text)).length,3);assert.equal(f.state.publicReplies.filter(item=>/^Maria, obrigado/.test(item.text)).length,1);assert(f.state.publicReplies.every(item=>!/wa\.me|bit\.ly|empresa\.com\.br|https?:\/\//.test(item.text)));
});
