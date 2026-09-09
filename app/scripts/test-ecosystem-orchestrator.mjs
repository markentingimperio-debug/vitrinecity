import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import {createEcosystemOrchestrator,registerEcosystemRoutes,ecosystemLocalWindow,ecosystemProviderIssue} from '../ecosystem-orchestrator.js';

const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(t){
  const db=new Database(':memory:'),state={time:Date.parse('2026-09-09T12:00:00Z'),calls:[],updates:[],distributed:0,syncHook:null,workHook:null,configured:true,enabled:false,quota:6,history:[]};
  let revision=1,working=null;
  const automation={status:()=>({enabled:state.enabled,configured:state.configured,revision,dailyLimit:6,hour:9,groups:['products'],running:!!working,closed:false,nextAt:'2026-09-09T12:00:00Z',quota:{remaining:state.quota,published:state.history.filter(x=>x.status==='published').length,review:state.history.filter(x=>x.status==='review').length},history:state.history}),
    updateSettings:(body,actor)=>{state.updates.push({body,actor});state.enabled=body.enabled;revision++;},
    run:options=>{state.calls.push(options);working=Promise.resolve().then(async()=>{await state.workHook?.();state.quota--;}).finally(()=>working=null);},awaitIdle:async()=>{await working;}};
  const options={db,now:()=>state.time,schedule:false,getStories:()=>({automation,sync:async()=>{await state.syncHook?.();}}),catalog:{snapshot:()=>({inventory:[],connections:[],metrics:{items:[]}}),list:options=>({items:[],...options})},runInternalSocial:async({isCurrent})=>{assert(isCurrent());state.distributed++;return {published:1,held:0,items:[{id:'one',status:'published',url:'/social',reason:'Confirmado'}]};}};
  const engines=[],create=()=>{const service=createEcosystemOrchestrator(options);engines.push(service);return service;},service=create();
  const update=body=>service.updatePolicy({revision:service.policy().revision,...body},7);
  t.after(async()=>{engines.forEach(x=>x.close());await Promise.all(engines.map(x=>x.awaitIdle()));db.close();});
  return {db,state,service,update,create};
}

test('defaults preserve independent workers, GET is read-only, and configuration identifies the authenticated publisher',t=>{
  const f=fixture(t);assert.equal(f.service.policy().enabled,false);assert.equal(f.service.policy().paused,false);assert.equal(f.service.policy().internalSocialEnabled,false);assert(f.service.canRun());
  const changes=f.db.prepare('SELECT total_changes() count').get().count;
  f.service.snapshot();f.service.snapshot();assert.equal(f.db.prepare('SELECT total_changes() count').get().count,changes);
  f.update({enabled:true,internalSocialEnabled:true});assert.equal(f.service.policy().publisherUserId,7);assert.equal(f.state.updates.length,1);assert.equal(f.state.quota,6);
  f.service.updatePolicy({revision:f.service.policy().revision,paused:true},8);assert.equal(f.service.policy().publisherUserId,7);assert.equal(f.state.updates.length,1);assert.equal(f.service.canRun(),false);assert.equal(f.state.enabled,true);
  f.update({paused:false,enabled:false});assert.equal(f.state.enabled,true);assert.equal(f.service.policy().publisherUserId,7);assert(f.service.canRun());
  f.service.updatePolicy({revision:f.service.policy().revision,enabled:true},8);assert.equal(f.service.policy().publisherUserId,7);
});

test('stale revisions, invented publisher, invalid configuration and missing AI fail without side effects',t=>{
  const f=fixture(t),before=f.service.policy();
  for(const patch of [{revision:0,enabled:true},{revision:1,publisherUserId:999},{revision:1,dailyLimit:100},{revision:1,groups:['bad']},{revision:1,paused:'false'}])assert.throws(()=>f.service.updatePolicy(patch,7));
  assert.deepEqual(f.service.policy(),before);assert.equal(f.state.updates.length,0);
  assert.throws(()=>f.service.updatePolicy({revision:1,enabled:true},'scheduler'),/Administrador/);
  f.state.configured=false;assert.throws(()=>f.update({enabled:true}),/Configure/);assert.equal(f.service.policy().revision,1);
});

test('concurrent coordinators share a lease and use the existing daily quota without forcing another factory',async t=>{
  const f=fixture(t),block=defer();f.state.syncHook=()=>block.promise;f.update({enabled:true,internalSocialEnabled:true});
  const other=f.create();f.service.run({actor:7});other.run({actor:7});f.service.run({actor:7});await Promise.resolve();
  assert.equal(f.state.calls.length,0);assert.equal(f.service.snapshot().plan.items[0].status,'planned');
  block.resolve();await f.service.awaitIdle();await other.awaitIdle();
  assert.equal(f.state.calls.length,1);assert.deepEqual(f.state.calls[0],{manual:true,actor:'7'});assert.equal(f.state.distributed,1);assert.equal(f.state.quota,5);
  assert.equal(f.service.snapshot().plan.nextAt,'2026-09-10T12:00:00.000Z');
  f.service.run({manual:false});await f.service.awaitIdle();assert.equal(f.state.calls.length,1);
  f.state.quota=0;f.service.run({actor:7});await f.service.awaitIdle();assert.equal(f.state.calls.length,1);assert.equal(f.state.distributed,2);assert.equal(f.state.quota,0);assert.match(f.service.snapshot().plan.items.find(x=>x.kind==='content').reason,/limite diário/);
  f.update({internalSocialEnabled:false});assert.throws(()=>f.service.run({actor:7}),/limite diário/);
});

test('global pause before claim, during preparation and during production blocks subsequent publication',async t=>{
  const f=fixture(t);f.update({enabled:true,internalSocialEnabled:true,paused:true});assert.throws(()=>f.service.run(),/pausa/);assert.equal(f.state.calls.length,0);
  f.update({paused:false});const prepare=defer();f.state.syncHook=()=>prepare.promise;f.service.run({actor:7});await Promise.resolve();f.update({paused:true});prepare.resolve();await f.service.awaitIdle();
  assert.equal(f.state.calls.length,0);assert.equal(f.service.snapshot().plan.items[0].status,'interrupted');
  f.update({paused:false});f.state.syncHook=null;const work=defer();f.state.workHook=()=>work.promise;f.service.run({actor:7});await new Promise(r=>setImmediate(r));f.update({paused:true});work.resolve();await f.service.awaitIdle();
  assert.equal(f.state.calls.length,1);assert.equal(f.state.distributed,0);assert.equal(f.service.snapshot().plan.items[0].status,'interrupted');
});

test('review-only rounds remain explicit, preserve their quota, and do not invent successful publications',async t=>{
  const f=fixture(t);f.update({enabled:true});f.state.history=[{id:1,day:'2026-09-09',status:'review',summary:'Precisa de fonte verificável.',sourceKey:'article:1',sourceGroup:'news',startedAt:f.state.time,finishedAt:f.state.time}];
  f.service.run({actor:7});await f.service.awaitIdle();const snapshot=f.service.snapshot();
  assert(snapshot.plan.items.some(x=>x.kind==='content'&&x.status==='review'));assert(snapshot.exceptions.some(x=>x.detail==='Precisa de fonte verificável.'));assert.equal(snapshot.agents[0].status,'review');assert.equal(snapshot.automation.quota.published,0);assert.equal(f.state.quota,5);
});

test('an expired coordinator lease becomes interrupted without clearing the underlying jobs or quota',async t=>{
  const f=fixture(t);f.update({enabled:true});f.db.prepare("UPDATE ecosystem_policy SET lease_owner='crashed',lease_until=?").run(f.state.time-1);
  f.db.prepare("INSERT INTO ecosystem_daily_plan(id,day,item_key,kind,label,status) VALUES('old','2026-09-08','production','content','Ontem','running')").run();
  f.service.run({actor:7});await f.service.awaitIdle();assert.equal(f.db.prepare("SELECT status FROM ecosystem_daily_plan WHERE id='old'").get().status,'interrupted');assert.equal(f.state.calls.length,1);assert.equal(f.state.quota,5);
});

test('São Paulo windows cover local day and business hours independently of process time zone',()=>{
  assert.deepEqual(ecosystemLocalWindow(Date.parse('2026-09-09T02:59:59Z')),{day:'2026-09-08',hour:23,start:'2026-09-08T03:00:00.000Z',end:'2026-09-09T03:00:00.000Z'});
  assert.equal(ecosystemLocalWindow(Date.parse('2026-09-09T03:00:00Z')).hour,0);
  assert.equal(ecosystemLocalWindow(Date.parse('2026-09-09T12:00:00Z')).hour,9);
  assert.equal(ecosystemLocalWindow(Date.parse('2026-09-09T23:00:00Z')).hour,20);
});

test('existing worker failures are counted truthfully and provider secrets never enter the central snapshot',t=>{
  const f=fixture(t);f.db.exec(`CREATE TABLE admin_viral_quizzes(id INTEGER,status TEXT);INSERT INTO admin_viral_quizzes VALUES(1,'in_production');
    CREATE TABLE viral_quiz_scenes(id INTEGER,status TEXT,error_message TEXT,updated_at TEXT);INSERT INTO viral_quiz_scenes VALUES(1,'failed','No endpoints found matching ZDR data policy Bearer SECRET_VALUE','2026-09-09');
    CREATE TABLE whatsapp_qr_schedules(id TEXT,status TEXT,confirmation_state TEXT DEFAULT '',claimed_at INTEGER,provider_message_id TEXT);INSERT INTO whatsapp_qr_schedules(id,status) VALUES('1','pending'),('2','failed');
    CREATE TABLE admin_agent_tasks(id INTEGER,status TEXT);INSERT INTO admin_agent_tasks VALUES(1,'awaiting_approval');`);
  const state=f.service.snapshot();assert.equal(state.modules.videos.scenes.failed,1);assert.equal(state.modules.videos.projects.in_production,1);assert.equal(state.modules.videos.issue.code,'provider_data_policy');assert.equal(state.modules.whatsapp.pending,1);assert.equal(state.modules.gestora.weightTraining,false);assert(!JSON.stringify(state).includes('SECRET_VALUE'));assert(state.exceptions.some(x=>x.id==='video-production'));assert.equal(state.agents.find(x=>x.id==='videos').status,'blocked');
});

test('central separates account blocks from data policy and never replaces recorded failures with retries',t=>{
  assert.equal(ecosystemProviderIssue('Geração bloqueada na conta do provedor. Não foi agendado novo envio.').code,'provider_account_block');
  assert.equal(ecosystemProviderIssue('Provedor indisponível sob a política de dados atual. Não foi agendado novo envio.').code,'provider_data_policy');
  assert.equal(ecosystemProviderIssue('Provedor recusou por saldo ou limite. Não foi agendado novo envio.').code,'provider_balance');
  const f=fixture(t);f.db.exec(`CREATE TABLE viral_quiz_scenes(id INTEGER,status TEXT,error_message TEXT,updated_at TEXT)`);
  const insert=f.db.prepare('INSERT INTO viral_quiz_scenes VALUES(?,?,?,?)');
  insert.run(1,'failed','Inference is blocked on this account Bearer PRIVATE_KEY','2026-09-08');
  insert.run(2,'failed','Inference is blocked on this account token: OTHER_SECRET','2026-09-08');
  insert.run(3,'failed','No endpoints found matching ZDR data policy','2026-09-09');
  insert.run(4,'downloaded','','2026-09-09');
  const before=f.db.prepare('SELECT * FROM viral_quiz_scenes').all(),state=f.service.snapshot();
  assert.deepEqual(state.modules.videos.issues.map(({code,count})=>({code,count})),[{code:'provider_account_block',count:2},{code:'provider_data_policy',count:1}]);
  assert.equal(state.modules.videos.issue.code,'provider_account_block');
  const detail=state.exceptions.find(x=>x.id==='video-production').detail;
  assert.match(detail,/2 cenas:.*conta/);assert.match(detail,/1 cena:.*política de dados/);
  assert(!/PRIVATE_KEY|OTHER_SECRET|Bearer/.test(JSON.stringify(state)));
  assert.deepEqual(f.db.prepare('SELECT * FROM viral_quiz_scenes').all(),before);assert.equal(f.state.calls.length,0);
});

test('central counts uncertain WhatsApp results separately without rewriting legacy state',t=>{
  const f=fixture(t);f.db.exec(`CREATE TABLE whatsapp_qr_schedules(id TEXT,status TEXT,confirmation_state TEXT DEFAULT '',claimed_at INTEGER,provider_message_id TEXT);
    INSERT INTO whatsapp_qr_schedules(id,status,confirmation_state,provider_message_id) VALUES
      ('legacy-unverified','sent','',''),('known','sent','confirmed','ACK1'),('unknown','failed','unknown',NULL),('rejected','failed','not_submitted',NULL);`);
  const before=f.db.prepare('SELECT * FROM whatsapp_qr_schedules ORDER BY id').all(),state=f.service.snapshot();
  assert.deepEqual(state.modules.whatsapp,{pending:0,processing:0,sent:1,failed:1,unknown:2,cancelled:0});
  assert.equal(state.agents.find(x=>x.id==='whatsapp').status,'review');
  assert.match(state.agents.find(x=>x.id==='whatsapp').detail,/2 sem confirmação/);
  assert.deepEqual(f.db.prepare('SELECT * FROM whatsapp_qr_schedules ORDER BY id').all(),before);
});

test('routes require admin and same-origin mutation; run is asynchronous and never accepts a body publisher',async t=>{
  const f=fixture(t),app=express();app.use(express.json());
  registerEcosystemRoutes({app,service:f.service,requireAdmin:(req,res,next)=>{if(req.headers['x-admin']!=='yes')return res.sendStatus(401);req.user={id:7};next();},sameOriginOnly:(req,res,next)=>req.headers.origin==='https://vitrinecity.com'?next():res.sendStatus(403)});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
  const request=(path='',method='GET',body,headers={})=>fetch('http://127.0.0.1:'+server.address().port+'/api/admin/ecosystem'+path,{method,headers:{'x-admin':'yes',origin:'https://vitrinecity.com','Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal((await request('','GET',null,{'x-admin':'no'})).status,401);assert.equal((await request('/policy','POST',{revision:1,paused:true},{origin:'https://evil.test'})).status,403);
  assert.equal((await request('/policy','POST',{revision:1,enabled:true,publisherUserId:999})).status,400);
  const enabled=await request('/policy','POST',{revision:1,enabled:true});assert.equal(enabled.status,200);assert.equal((await enabled.json()).policy.publisherUserId,7);
  const gate=defer();f.state.syncHook=()=>gate.promise;const run=await request('/run','POST',{});assert.equal(run.status,202);assert.equal(f.state.calls.length,0);gate.resolve();await f.service.awaitIdle();
  assert.equal((await request('/catalog?limit=999')).status,400);assert.equal((await request('/catalog?kind=products&offset=0&limit=24')).status,200);
});
