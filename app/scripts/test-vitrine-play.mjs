import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createPlayStore,setupVitrinePlay,mediaUrl,buildAdDraft,STAGES} from '../vitrine-play.js';

function fixture(){
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
  db.transaction=fn=>(...args)=>{db.exec('BEGIN IMMEDIATE');try{const result=fn(...args);db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}};
  let clock=Date.parse('2026-09-25T12:00:00Z');
  const store=createPlayStore({db,siteUrl:'https://vitrinecity.com',mediaHosts:['media.example.com'],now:()=>clock});
  const s=store.saveSeries({title:'Uma história original',slug:'uma-historia',synopsis:'História original.',plannedEpisodes:3,status:'live',bible:'SEGREDO-INTERNO',characters:[]});
  const input={seriesId:s.id,number:1,title:'O jantar',targetSeconds:80,releaseAt:'2026-09-25T16:00:00-03:00',budgetBrl:0};
  const e=store.saveEpisode(input);
  return {db,store,s,e,input,now:()=>clock,setNow:t=>clock=Date.parse(t)};
}
const ready=(f,extra={})=>f.store.saveEpisode({...f.e,revision:f.e.revision,budgetBrl:20,mediaUrl:'/generated-videos/master.mp4',duration:80,...extra},f.e.id);
const approve=(f,e)=>f.store.approve(e.id,{revision:e.revision,reviewed:true,rightsConfirmed:true});

test('media URLs: allowlisted hosts/local generated media only',()=>{
  assert.equal(mediaUrl('/generated-videos/a.mp4','https://vitrinecity.com'),'/generated-videos/a.mp4');
  assert.equal(mediaUrl('https://media.example.com/a.mp4','https://vitrinecity.com',['media.example.com']),'https://media.example.com/a.mp4');
  for(const bad of ['javascript:alert(1)','data:text/html,hi','file:///etc/passwd','https://evil.example/a.mp4','/admin.html','//evil.example/a','/generated-videos/../admin.html','/generated-videos/%2e%2e/admin.html','https://user:pass@media.example.com/a.mp4','https://media.example.com:444/a.mp4','https://[:::]/a'])assert.throws(()=>mediaUrl(bad,'https://vitrinecity.com',['media.example.com']));
});
test('drafts, scripts, voice IDs and production metadata are not public',()=>{
  const f=fixture();assert.deepEqual(f.store.catalog()[0].episodes,[]);
  assert.ok(!JSON.stringify(f.store.catalog()).includes('SEGREDO-INTERNO'));
  f.store.saveSeries({...f.s,status:'draft'},f.s.id);assert.deepEqual(f.store.catalog(),[]);
});
test('episode duration, dates, money and duplicate numbers are validated',()=>{
  const f=fixture();for(const targetSeconds of [59,91,NaN])assert.throws(()=>f.store.saveEpisode({...f.input,number:2,targetSeconds}));
  assert.throws(()=>f.store.saveEpisode({...f.input,number:2,releaseAt:'2026-10-01T19:00'}));
  assert.throws(()=>f.store.saveEpisode({...f.input,number:2,budgetBrl:-1}));
  assert.throws(()=>f.store.saveEpisode(f.input),/já cadastrado/);
});
test('planning is idempotent and zero budget blocks any paid claim',()=>{
  const f=fixture();f.store.plan(f.e.id);f.store.plan(f.e.id);assert.equal(f.store.jobs(f.e.id).length,STAGES.length);
  assert.equal(f.store.claim('script',0.01),null);assert.equal(f.store.claim('video',0),null);
});
test('claims serialize and incorrect lease tokens cannot complete',()=>{
  const f=fixture(),e=ready(f);f.store.plan(e.id);const j=f.store.claim('script',2);assert.ok(j);
  assert.equal(f.store.claim('script',2),null);assert.throws(()=>f.store.complete(j.id,{leaseToken:'bad',actualCostBrl:0,result:{script:'x'.repeat(100)}}),/Reserva/);
  assert.throws(()=>f.store.saveEpisode({...e,revision:e.revision},e.id),/andamento/);
});
test('completed results are idempotent and capped by reserved cost',()=>{
  const f=fixture(),e=ready(f);f.store.plan(e.id);const j=f.store.claim('script',2);
  assert.throws(()=>f.store.complete(j.id,{leaseToken:j.leaseToken,actualCostBrl:3,result:{script:'a'.repeat(100)}}),/limite/);
  const payload={leaseToken:j.leaseToken,actualCostBrl:1,result:{script:'Roteiro original: '+ 'a'.repeat(100)}};
  assert.deepEqual(f.store.complete(j.id,payload),{duplicate:false});assert.deepEqual(f.store.complete(j.id,payload),{duplicate:true});assert.ok(f.store.claim('scenes',1));
});
test('expired paid requests become uncertain and are not re-run',()=>{
  const f=fixture(),e=ready(f);f.store.plan(e.id);const j=f.store.claim('script',2);
  f.setNow('2026-09-25T13:00:01Z');assert.equal(f.store.claim('script',2),null);
  assert.equal(f.store.jobs(e.id)[0].status,'uncertain');assert.throws(()=>f.store.reconcile(j.id,{}),/Confirme/);
  f.store.reconcile(j.id,{confirmNotExecuted:true});assert.ok(f.store.claim('script',2));
});
test('a late receipt can resolve uncertainty without another charge',()=>{
  const f=fixture(),e=ready(f);f.store.plan(e.id);const j=f.store.claim('script',2);f.store.block(j.id,{leaseToken:j.leaseToken,error:'timeout'});
  assert.equal(f.store.claim('script',2),null);
  f.store.complete(j.id,{leaseToken:j.leaseToken,actualCostBrl:1,result:{script:'Roteiro: '+ 'a'.repeat(100)}});
  assert.equal(f.store.jobs(e.id)[0].status,'completed');
});
test('scene timings must sum to 60–90 seconds',()=>{
  const f=fixture(),e=ready(f);f.store.plan(e.id);const j=f.store.claim('script',0);f.store.complete(j.id,{leaseToken:j.leaseToken,actualCostBrl:0,result:{script:'a'.repeat(100)}});
  const scenes=f.store.claim('scenes',0);assert.throws(()=>f.store.complete(scenes.id,{leaseToken:scenes.leaseToken,actualCostBrl:0,result:{scenes:[{seconds:20,description:'Cena'}]}}),/somar/);
});
test('only reviewed, licensed, due chapters in visible series publish',()=>{
  const f=fixture();assert.throws(()=>approve(f,f.e),/vídeo final/);
  const e=ready(f);assert.throws(()=>f.store.approve(e.id,{revision:e.revision,reviewed:true}),/direitos/);
  approve(f,e);assert.equal(f.store.release(),0);f.setNow('2026-09-25T19:00:00Z');assert.equal(f.store.release(),1);assert.equal(f.store.release(),0);
  assert.equal(f.store.catalog()[0].episodes.length,1);assert.ok(!JSON.stringify(f.store.catalog()).includes('budgetCents'));
});
test('hidden series does not publish; compilation waits for entire season',()=>{
  const f=fixture(),e=ready(f);approve(f,e);f.store.saveSeries({...f.s,status:'draft',compilationUrl:'/generated-videos/season.mp4'},f.s.id);f.setNow('2026-09-26T00:00:00Z');assert.equal(f.store.release(),0);
  f.store.saveSeries({...f.s,compilationUrl:'/generated-videos/season.mp4'},f.s.id);assert.equal(f.store.release(),1);assert.equal(f.store.catalog()[0].compilationUrl,'');
});
test('editing published media invalidates approval and preserves stable links',()=>{
  const f=fixture(),e=ready(f);approve(f,e);f.setNow('2026-09-26T00:00:00Z');f.store.release();
  const updated=f.store.saveEpisode({...e,revision:e.revision,title:'Novo título',budgetBrl:20},e.id);
  assert.equal(updated.status,'draft');assert.equal(updated.approvedRevision,0);assert.equal(f.store.catalog()[0].episodes.length,0);
  assert.throws(()=>f.store.saveEpisode({...e,revision:e.revision},e.id),/atualizado/);
  assert.throws(()=>f.store.saveSeries({...f.s,slug:'outro'},f.s.id),/identificador/);
});
test('manual master satisfies production steps but social requires clip approval',()=>{
  const f=fixture(),e=ready(f,{clipUrl:'/generated-videos/clip.mp4'});f.store.plan(e.id);approve(f,e);
  assert.equal(f.store.claim('video',0),null);const clip=f.store.claim('clips',0);assert.ok(clip);
  f.store.complete(clip.id,{leaseToken:clip.leaseToken,actualCostBrl:0,result:{clipUrl:'/generated-videos/new-clip.mp4'}});
  f.setNow('2026-09-26T00:00:00Z');f.store.release();assert.equal(f.store.claim('social',0),null);
  assert.throws(()=>f.store.approveSocial(e.id,{revision:e.revision,reviewed:true,clipUrl:e.clipUrl}),/mudou/);
  f.store.approveSocial(e.id,{revision:e.revision,reviewed:true,clipUrl:'/generated-videos/new-clip.mp4'});assert.ok(f.store.claim('social',0));
});
test('campaign packet has attribution links but cannot spend money',()=>{
  const f=fixture(),draft=buildAdDraft(f.s,f.e,'https://vitrinecity.com');assert.equal(draft.enabled,false);assert.equal(draft.budgetCents,0);
  assert.equal(new URL(draft.destination).searchParams.get('utm_campaign'),f.s.slug);
});

function harness(){
  const f=fixture(),routes=[];const app={};for(const method of ['get','post','put'])app[method]=(route,...handlers)=>routes.push({method,route,handlers});
  let allowed=false,origin=true;
  const mounted=setupVitrinePlay({app,db:f.db,siteUrl:'https://vitrinecity.com',now:f.now,env:{VITRINE_PLAY_SCHEDULER:'off',VITRINE_PLAY_WORKER_TOKEN:'z'.repeat(40)},requireAdmin:(req,res,next)=>allowed?next():res.status(401).json({error:'auth'}),sameOriginOnly:(req,res,next)=>origin?next():res.status(403).json({error:'origin'})});
  function run(method,route,body={},params={},headers={}){
    const r=routes.find(x=>x.method===method&&x.route===route);assert.ok(r,'route '+route);
    const res={statusCode:200,body:null,set(){return this;},type(){return this;},status(n){this.statusCode=n;return this;},json(b){this.body=b;return this;},send(b){this.body=b;return this;},redirect(n,to){this.statusCode=n;this.body=to;return this;}};
    const req={body,params,get:k=>headers[k],is:t=>t==='application/json'};let i=0;const next=()=>r.handlers[i++]?.(req,res,next);next();return res;
  }
  return {...f,run,allow:()=>allowed=true,cross:()=>origin=false,mounted};
}
test('admin read/write and same-origin checks are mounted, worker token is distinct',()=>{
  const h=harness();assert.equal(h.run('get','/api/admin/series').statusCode,401);assert.equal(h.run('get','/admin-series.html').statusCode,401);
  h.allow();assert.equal(h.run('get','/api/admin/series').statusCode,200);h.cross();assert.equal(h.run('post','/api/admin/series',{}).statusCode,403);
  assert.equal(h.run('post','/api/worker/vitrine-play/claim',{stage:'script',maxCostBrl:0}).statusCode,401);
  assert.equal(h.run('post','/api/worker/vitrine-play/claim',{stage:'script',maxCostBrl:0},{},{authorization:'Bearer '+'z'.repeat(40)}).statusCode,200);
});
test('public HTML escapes text and unavailable chapters return 404',()=>{
  const h=harness();h.store.saveSeries({...h.s,title:'<script>alert(1)</script>'},h.s.id);
  const out=h.run('get','/series');assert.equal(out.statusCode,200);assert.ok(out.body.includes('&lt;script&gt;'));assert.ok(!out.body.includes('<script>alert(1)'));
  assert.equal(h.run('get','/series/:slug/:chapter',{}, {slug:h.s.slug,chapter:'1'}).statusCode,404);
});
