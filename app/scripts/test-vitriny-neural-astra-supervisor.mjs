import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import Database from 'better-sqlite3';
import express from 'express';
import {createAstraSupervisor} from '../vitriny-neural/astra-supervisor.js';
import {createVitrinyNeuralRuntime} from '../vitriny-neural/bootstrap.js';
import {mountVitrinyNeuralAdmin} from '../vitriny-neural/admin-api.js';
import {createShadowObserver} from '../vitriny-neural/shadow-observer.js';
import {createVitrinyNeuralService} from '../vitriny-neural/service.js';

const objective='Avalie como melhorar o atendimento usando fatos aprovados da plataforma.';
const result={summary:'Comparar uma melhoria pequena no atendimento antes de alterar o comportamento.',findings:['As métricas fornecidas precisam de contexto para avaliar qualidade.'],recommendations:['Revisar uma amostra sem dados pessoais e comparar a clareza das respostas.'],evidenceIds:['VC1']};
const response=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
const completed=(extra={})=>({id:'resp_testreceipt',model:'gpt-6-astra',status:'completed',usage:{input_tokens:500,output_tokens:100,input_tokens_details:{cached_tokens:0,cache_write_tokens:0}},output:[{type:'reasoning',summary:[]},{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(result)}]}],...extra});
function fixture(t,{handler=null,key='sk-test-not-real',inputSource=null,getHandler=null,getEvaluation=()=>null}={}){
  const db=new Database(':memory:');t.after(()=>db.close());
  const clock={time:Date.parse('2026-09-13T15:00:00Z'),allowed:true,revision:1};
  const runtime=createVitrinyNeuralRuntime({db,providers:[],env:{},now:()=>clock.time});
  const sources=()=>inputSource||[{citation:'VC1',title:'Atendimento público',source:'/ajuda',revision:clock.revision,expiresAt:'2026-12-01',excerpt:'A plataforma permite consultar produtos publicados e atendimento identificado como IA.'}];
  const calls=[];
  const fetchImpl=async(url,options)=>{
    calls.push({url,method:options.method,body:options.body});
    assert.equal(options.headers.Authorization,'Bearer '+key);
    if(options.method==='GET')return getHandler?getHandler():response({id:'gpt-6-astra'});
    const body=JSON.parse(options.body);assert.equal(body.model,'gpt-6-astra');assert.equal(body.store,false);assert.equal(body.max_output_tokens,1200);assert.equal(body.service_tier,'default');
    assert.equal(body.temperature,undefined);assert.equal(body.tools,undefined);
    const row=db.prepare('SELECT * FROM neural_astra_runs ORDER BY created_at DESC LIMIT 1').get();
    assert.equal(row.state,'submitting');assert.equal(row.submitted,1);assert.equal(row.charged_micro,210000);
    return handler?handler({url,options,row,db,clock}):response(completed());
  };
  const options={db,neural:runtime.neural,knowledge:{retrieve:sources},getEvaluation,env:{OPENAI_API_KEY:key,AI_TEXT_PROVIDER:'openrouter',OPENAI_MODEL:'other-model'},fetchImpl,now:()=>clock.time,canRun:()=>clock.allowed};
  const service=createAstraSupervisor(options);
  const ready=async()=>{await service.checkAvailability();const s=service.status();service.configure({enabled:true,dailyUsdLimit:.5,revision:s.revision});};
  const request=(requestId=randomUUID(),text=objective)=>service.evaluate(4,{requestId,objective:text});
  return {db,clock,service,runtime,options,calls,ready,request,posts:()=>calls.filter(call=>call.method==='POST')};
}

test('default disabled; construction/status are local and model checks never call Responses',async t=>{
  const f=fixture(t);assert.equal(f.calls.length,0);
  const s=f.service.status();assert.equal(s.enabled,false);assert.equal(s.configured,true);assert.equal(s.model,'gpt-6-astra');assert.equal(s.quote.maximumUsd,.21);assert.equal(s.budget.remainingUsd,.5);
  await assert.rejects(f.request(),{code:'astra_paused'});assert.equal(f.calls.length,0);
  const checked=await f.service.checkAvailability();assert.equal(checked.availability.state,'available');assert.equal(checked.enabled,false);assert.equal(f.posts().length,0);
  assert.doesNotMatch(JSON.stringify(checked),/sk-test|Bearer|credential_hash|access_token/);
});

test('one explicit evaluation becomes a candidate, preserves global model and never promotes it',async t=>{
  const f=fixture(t);await f.ready();const id=randomUUID(),run=await f.request(id);
  assert.equal(run.state,'completed');assert.equal(run.actualUsd,.01);assert.equal(run.applied,false);assert.equal(run.candidateId,'astra-'+id);assert.deepEqual(run.result,result);
  const lesson=f.db.prepare('SELECT status,risk,confidence,reward,evidence_json FROM neural_lessons WHERE id=?').get(run.candidateId);
  assert.equal(lesson.status,'candidate');assert.equal(lesson.risk,'review');assert.equal(lesson.confidence,0);assert.equal(lesson.reward,0);
  assert.equal(JSON.parse(lesson.evidence_json).source,'astra-supervisor');assert.equal(f.options.env.OPENAI_MODEL,'other-model');
  const repeated=await f.request(id);assert.deepEqual(repeated,run);assert.equal(f.posts().length,1);
  await assert.rejects(f.request(id,'Outra análise com o mesmo identificador deve ser recusada.'),{code:'astra_request_conflict'});
});

test('concurrent processes share one durable claim; different keys do not bypass hourly limit',async t=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const f=fixture(t,{handler:async()=>{await gate;return response(completed());}});await f.ready();
  const id=randomUUID(),first=f.request(id);const restarted=createAstraSupervisor(f.options);
  const duplicate=await restarted.evaluate(4,{requestId:id,objective});assert.equal(duplicate.state,'submitting');
  await assert.rejects(f.request(),{code:'astra_hourly_limit'});assert.equal(f.posts().length,1);
  release();assert.equal((await first).state,'completed');assert.equal(f.db.prepare('SELECT count(*) n FROM neural_lessons').get().n,1);
});

test('lost response and restart retain reservation, never reissue uncertain work or invent zero cost',async t=>{
  const f=fixture(t,{handler:async()=>{throw Error('sk-provider-secret should not escape');}});await f.ready();const id=randomUUID();
  const first=await f.request(id);assert.equal(first.state,'unknown');assert.equal(first.actualUsd,null);assert.equal(first.retrySafe,false);assert.equal(f.service.status().budget.reservedOrSpentUsd,.21);
  f.clock.time+=7200000;const restarted=createAstraSupervisor(f.options);
  assert.equal((await restarted.evaluate(4,{requestId:id,objective})).state,'unknown');assert.equal(f.posts().length,1);
  await f.request();f.clock.time+=3600001;await assert.rejects(f.request(),{code:'astra_daily_budget'});assert.equal(f.posts().length,2);
  assert.doesNotMatch(JSON.stringify(f.service.status()),/sk-provider|should not escape/);
});

test('a stale submitting journal is reported unknown with readback and no network',async t=>{
  const f=fixture(t);await f.ready();const run=await f.request();
  f.db.prepare("UPDATE neural_astra_runs SET state='submitting',finished_at=NULL WHERE id=?").run(run.id);f.clock.time+=90001;
  const calls=f.calls.length;assert.equal(f.service.run(run.id).state,'unknown');assert.equal(f.service.status().recent[0].retrySafe,false);
  assert.equal((await f.request(run.id)).state,'unknown');assert.equal(f.calls.length,calls);
});

test('configuration is CAS bounded; no cost or model controls accepted from evaluation',async t=>{
  const f=fixture(t);const s=f.service.status();
  assert.throws(()=>f.service.configure({enabled:true,dailyUsdLimit:.51,revision:s.revision}),{code:'astra_config_invalid'});
  f.service.configure({enabled:false,dailyUsdLimit:.17,revision:s.revision});
  assert.throws(()=>f.service.configure({enabled:true,dailyUsdLimit:.5,revision:s.revision}),{code:'astra_config_changed'});
  await f.service.checkAvailability();f.service.configure({enabled:true,dailyUsdLimit:.17,revision:f.service.status().revision});
  await assert.rejects(f.request(),{code:'astra_daily_budget'});
  await assert.rejects(f.service.evaluate(4,{requestId:randomUUID(),objective,model:'free-model'}),{code:'astra_input_invalid'});assert.equal(f.posts().length,0);
});

test('private inputs and oversized context are refused before a paid claim',async t=>{
  const f=fixture(t);await f.ready();
  for(const text of ['Verifique o cliente qa@example.invalid com a conversa particular.','Use a senha: private-example para gerar uma recomendação.','Visite https://untrusted.invalid/ para preparar a aula.'])await assert.rejects(f.request(randomUUID(),text),{code:'astra_text_invalid'});
  assert.equal(f.posts().length,0);assert.equal(f.db.prepare('SELECT count(*) n FROM neural_astra_runs WHERE submitted=1 OR charged_micro>0').get().n,0);
  assert.doesNotMatch(JSON.stringify(f.db.prepare('SELECT * FROM neural_astra_runs').all()),/qa@example|private-example|untrusted.invalid/);
  const huge=fixture(t,{inputSource:[{citation:'VC1',excerpt:'a'.repeat(13000)}]});await huge.ready();await assert.rejects(huge.request(),{code:'astra_input_limit'});assert.equal(huge.posts().length,0);
});

test('only allowlisted aggregate columns are sent, never transcripts or entire review rows',async t=>{
  const f=fixture(t);f.db.exec('CREATE TABLE site_sales_reviews(id INTEGER PRIMARY KEY,window_start INTEGER,window_end INTEGER,metrics_json TEXT)');
  f.db.prepare('INSERT INTO site_sales_reviews VALUES(1,?,?,?)').run(f.clock.time-86400000,f.clock.time,JSON.stringify({sessions:10,paidOrders:1,email:'qa@example.invalid',transcript:'PRIVATE_MARKER',token:'SECRET_MARKER'}));
  await f.ready();await f.request();const body=JSON.parse(f.posts()[0].body),context=JSON.parse(body.input).context;
  assert.deepEqual(context.sales.metrics,{sessions:10,paidOrders:1});assert.equal(context.sales.citation,'SALES_REVIEW');assert.doesNotMatch(body.input,/PRIVATE_MARKER|SECRET_MARKER|qa@example/);
});

test('pause before dispatch blocks; pause or source change during response preserves review without candidate',async t=>{
  const f=fixture(t);await f.ready();f.clock.allowed=false;await assert.rejects(f.request(),{code:'astra_paused'});assert.equal(f.posts().length,0);
  for(const mutate of [({clock})=>{clock.allowed=false;},({clock})=>{clock.revision++;},({db})=>{db.prepare('UPDATE neural_astra_settings SET enabled=0,revision=revision+1').run();}]){
    const changed=fixture(t,{handler:async ctx=>{mutate(ctx);return response(completed());}});await changed.ready();const run=await changed.request();
    assert.equal(run.state,'needs_review');assert.equal(run.actualUsd,.01);assert.deepEqual(run.result,result);assert.equal(run.candidateId,null);assert.equal(changed.db.prepare('SELECT count(*) n FROM neural_lessons').get().n,0);
  }
});

test('missing usage is unknown cost; false zero usage cannot release the reservation',async t=>{
  for(const usage of [undefined,null,{input_tokens:null,output_tokens:null},{input_tokens:0,output_tokens:0}]){
    const f=fixture(t,{handler:async()=>response(completed({usage}))});await f.ready();const run=await f.request();
    assert.equal(run.actualUsd,null);assert.equal(f.service.status().budget.reservedOrSpentUsd,.21);
  }
});

test('wrong model, tools, refusal, duplicate fields, invented sources and HTML never enter lessons',async t=>{
  const changedText=value=>completed({output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:value}]}]});
  const cases=[completed({model:'gpt-4o-mini'}),completed({status:'incomplete'}),completed({output:[{type:'function_call',name:'deploy',call_id:'x',arguments:'{}'}]}),completed({output:[{type:'message',role:'assistant',status:'completed',content:[{type:'refusal',refusal:'No'}]}]}),
    changedText(JSON.stringify({...result,evidenceIds:['VC99']})),changedText(JSON.stringify({...result,summary:'<script>unsafe()</script>'})),changedText(JSON.stringify(result).replace('"summary":','"summary":"duplicada", "summary":'))];
  for(const data of cases){const f=fixture(t,{handler:async()=>response(data)});await f.ready();const run=await f.request();assert.notEqual(run.state,'completed');assert.equal(run.candidateId,null);assert.equal(f.db.prepare('SELECT count(*) n FROM neural_lessons').get().n,0);await f.request(run.id);assert.equal(f.posts().length,1);}
});

test('reported usage above bounds disables the supervisor and records the conservative actual cost',async t=>{
  const f=fixture(t,{handler:async()=>response(completed({usage:{input_tokens:13000,output_tokens:1201,input_tokens_details:{cached_tokens:0,cache_write_tokens:0}}}))});await f.ready();const run=await f.request();
  assert.equal(run.state,'needs_review');assert.equal(run.error,'astra_usage_limit_exceeded');assert.equal(run.actualUsd,.19005);assert.equal(f.service.status().enabled,false);assert.equal(run.candidateId,null);
});

test('fresh model proof is bound to the server credential and expires without triggering a paid call',async t=>{
  const f=fixture(t);await f.ready();f.clock.time+=86400001;await assert.rejects(f.request(),{code:'astra_model_check_required'});
  const changed=createAstraSupervisor({...f.options,env:{OPENAI_API_KEY:'another-key'}});assert.equal(changed.status().availability.state,'unknown');
  await assert.rejects(changed.evaluate(4,{requestId:randomUUID(),objective}),{code:'astra_model_check_required'});assert.equal(f.posts().length,0);
});

test('candidate storage failure or a late provider answer keeps the result for review without another paid request',async t=>{
  const f=fixture(t);await f.ready();
  const broken=createAstraSupervisor({...f.options,neural:{lesson(){throw Error('storage unavailable');}}});
  const id=randomUUID(),saved=await broken.evaluate(4,{requestId:id,objective});
  assert.equal(saved.state,'needs_review');assert.equal(saved.error,'astra_candidate_failed');assert.deepEqual(saved.result,result);assert.equal(saved.actualUsd,.01);
  await broken.evaluate(4,{requestId:id,objective});assert.equal(f.posts().length,1);
  const late=fixture(t,{handler:async({clock})=>{clock.time+=61000;return response(completed());}});await late.ready();assert.equal((await late.request()).state,'needs_review');
});

test('automatic advice is off by default and one existing minute observer cannot multiply daily calls',async t=>{
  const f=fixture(t);await f.ready();const observer=createShadowObserver({db:f.db,neural:{signal(){}},now:()=>f.clock.time,onSample:()=>f.service.tick()});
  for(let i=0;i<3;i++){observer.sample();f.clock.time+=60000;}await new Promise(resolve=>setImmediate(resolve));assert.equal(f.posts().length,0);assert.equal(f.service.status().automaticDaily,false);
  f.service.configure({enabled:true,automaticDaily:true,dailyUsdLimit:.5,revision:f.service.status().revision});
  for(let i=0;i<3;i++)observer.sample();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.posts().length,1);
  const at=f.service.status().automatic.lastAttemptAt;const restarted=createAstraSupervisor(f.options);assert.equal((await restarted.tick()).state,'not_due');assert.equal(f.service.status().automatic.lastAttemptAt,at);
  assert.equal(f.db.prepare('SELECT actor_id FROM neural_astra_runs').get().actor_id,0);
  f.clock.time+=86400001;assert.equal((await restarted.tick()).error,'astra_context_unchanged');assert.equal(f.posts().length,1);
  f.clock.revision++;f.clock.time+=86400001;assert.equal((await restarted.tick()).state,'completed');assert.equal(f.posts().length,2);
});

test('automatic uncertain attempt survives restart and daily callbacks do not retry unchanged input',async t=>{
  const f=fixture(t,{handler:async()=>{throw Error('network lost');}});await f.ready();f.service.configure({enabled:true,automaticDaily:true,dailyUsdLimit:.5,revision:f.service.status().revision});
  const first=await f.service.tick();assert.equal(first.state,'unknown');const at=f.service.status().automatic.lastAttemptAt;
  const restarted=createAstraSupervisor(f.options);f.clock.time+=3600001;assert.equal((await restarted.tick()).state,'not_due');assert.equal(restarted.status().automatic.lastAttemptAt,at);
  f.clock.time+=86400000;assert.equal((await restarted.tick()).error,'astra_context_unchanged');assert.equal(f.posts().length,1);
  f.clock.allowed=false;f.clock.time+=86400001;const before=restarted.status().automatic.lastAttemptAt;assert.equal((await restarted.tick()).state,'paused');assert.equal(restarted.status().automatic.lastAttemptAt,before);
});

test('concurrent automatic ticks share the daily checkpoint across service instances',async t=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});const f=fixture(t,{handler:async()=>{await gate;return response(completed());}});await f.ready();
  f.service.configure({enabled:true,automaticDaily:true,dailyUsdLimit:.5,revision:f.service.status().revision});
  const other=createAstraSupervisor(f.options),first=f.service.tick();assert.equal((await other.tick()).state,'not_due');assert.equal(f.posts().length,1);
  release();assert.equal((await first).state,'completed');
});

test('real admin HTTP routes require admin and same-origin; GET only reads and errors are sanitized',async t=>{
  const f=fixture(t),app=express();app.use(express.json());
  mountVitrinyNeuralAdmin({app,service:{runtime:{neural:{},skills:{}},supervisor:f.service},requireAdmin(req,res,next){if(req.headers['x-admin']!=='fixture')return res.status(403).end();req.user={id:4};next();},sameOriginOnly(req,res,next){if(req.headers.origin!=='https://site.example')return res.status(403).end();next();}});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}/api/admin/vitriny-neural/supervisor`;
  const request=(suffix,{method='GET',body,admin=true,origin=true}={})=>fetch(base+suffix,{method,headers:{...(admin?{'x-admin':'fixture'}:{}),...(origin?{origin:'https://site.example'}:{}),'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal((await request('/status',{admin:false})).status,403);
  assert.equal((await request('/config',{method:'PUT',origin:false,body:{enabled:true,dailyUsdLimit:.5,revision:1}})).status,403);
  assert.equal((await request('/status')).status,200);assert.equal(f.calls.length,0);
  assert.equal((await request('/check',{method:'POST',body:{}})).status,200);assert.equal(f.posts().length,0);
  assert.equal((await request('/config',{method:'PUT',body:{enabled:true,dailyUsdLimit:.5,revision:1}})).status,200);
  const id=randomUUID(),run=await (await request('/evaluate',{method:'POST',body:{requestId:id,objective}})).json();assert.equal(run.run.state,'completed');
  assert.deepEqual(await (await request('/runs/'+id)).json(),run);assert.equal(f.posts().length,1);
  const blockedId=randomUUID(),invalid=await request('/evaluate',{method:'POST',body:{requestId:blockedId,objective:'senha: hidden-secret'}});assert.equal(invalid.status,400);
  assert.deepEqual(await invalid.json(),{error:'astra_text_invalid',requestId:blockedId,notSubmitted:true,retrySafe:true});
  const blocked=await (await request('/runs/'+blockedId)).json();assert.equal(blocked.run.state,'blocked');assert.equal(blocked.run.notSubmitted,true);assert.equal(blocked.run.retrySafe,true);assert.equal(blocked.run.maximumUsd,0);
  const conflict=await (await request('/evaluate',{method:'POST',body:{requestId:id,objective:'senha: hidden-secret'}})).json();assert.equal(conflict.notSubmitted,undefined);assert.equal(conflict.retrySafe,undefined);
});

test('cache writes and reads use verified detailed rates; missing or impossible breakdown keeps full reserve',async t=>{
  for(const [details,expected] of [[{cached_tokens:0,cache_write_tokens:1200},.020],[{cached_tokens:1000,cache_write_tokens:100},.00825]]){
    const f=fixture(t,{handler:async()=>response(completed({usage:{input_tokens:1200,output_tokens:100,input_tokens_details:details}}))});await f.ready();
    assert.equal((await f.request()).actualUsd,expected);assert.equal(f.service.status().budget.reservedOrSpentUsd,expected);
  }
  for(const details of [undefined,{},null,{cached_tokens:0,cache_write_tokens:null},{cached_tokens:-1,cache_write_tokens:0},{cached_tokens:1000,cache_write_tokens:1000}]){
    const f=fixture(t,{handler:async()=>response(completed({usage:{input_tokens:1200,output_tokens:100,input_tokens_details:details}}))});await f.ready();
    assert.equal((await f.request()).actualUsd,null);assert.equal(f.service.status().budget.reservedOrSpentUsd,.21);
  }
});

test('preflight tombstone proves rejection durably without enabling a race or disclosure',async t=>{
  const f=fixture(t);await f.ready();const id=randomUUID();
  await assert.rejects(f.request(id,'Dados privados qa@example.invalid não são aceitos.'),{requestId:id,notSubmitted:true,retrySafe:true});
  const restarted=createAstraSupervisor(f.options);assert.equal(restarted.run(id).state,'blocked');
  await assert.rejects(restarted.evaluate(4,{requestId:id,objective}),e=>e.code==='astra_request_conflict'&&e.retrySafe!==true);
  await assert.rejects(restarted.evaluate(5,{requestId:id,objective:'Dados privados qa@example.invalid não são aceitos.'}),e=>e.retrySafe!==true);
  assert.equal(f.posts().length,0);assert.equal(f.service.status().budget.reservedOrSpentUsd,0);
  let release;const gate=new Promise(resolve=>{release=resolve;});const active=fixture(t,{handler:async()=>{await gate;throw Error('unknown');}});await active.ready();
  const submittedId=randomUUID(),pending=active.request(submittedId);
  await assert.rejects(active.request(submittedId,'Dados privados qa@example.invalid não são aceitos.'),e=>e.retrySafe!==true);
  release();assert.equal((await pending).state,'unknown');assert.equal(active.service.run(submittedId).notSubmitted,false);
});

test('a free availability failure does not consume input forever and the next daily attempt may submit once',async t=>{
  let available=false;const f=fixture(t,{getHandler:()=>response(available?{id:'gpt-6-astra'}:{error:'unavailable'},available?200:503)});
  f.service.configure({enabled:true,automaticDaily:true,dailyUsdLimit:.5,revision:1});
  assert.equal((await f.service.tick()).error,'astra_model_check_required');assert.equal(f.posts().length,0);
  assert.equal(f.db.prepare('SELECT automatic_last_source_hash h FROM neural_astra_settings').get().h,'');
  assert.equal((await f.service.tick()).state,'not_due');
  available=true;f.clock.time+=86400001;const restarted=createAstraSupervisor(f.options);
  assert.equal((await restarted.tick()).state,'completed');assert.equal(f.posts().length,1);
  f.clock.time+=86400001;assert.equal((await restarted.tick()).error,'astra_context_unchanged');assert.equal(f.posts().length,1);
});

test('manual pilot satisfies the daily interval without recording an automatic attempt',async t=>{
  const f=fixture(t);await f.ready();const pilot=await f.request();
  f.service.configure({enabled:true,automaticDaily:true,dailyUsdLimit:.5,revision:f.service.status().revision});
  assert.equal(f.service.status().automatic.nextAt,new Date(Date.parse(pilot.createdAt)+86400000).toISOString());
  for(const delta of [0,60000,3600000]){f.clock.time+=delta;assert.equal((await f.service.tick()).state,'not_due');}
  assert.equal(f.service.status().automatic.lastAttemptAt,null);assert.equal(f.posts().length,1);
  f.clock.time=Date.parse(pilot.createdAt)+86400001;assert.equal((await f.service.tick()).state,'completed');assert.equal(f.posts().length,2);
});

test('real service supplies only aggregate benchmark and seven skills; candidate lessons never become approved context',async t=>{
  const db=new Database(':memory:');t.after(()=>db.close());let paidBody=null;
  const provider={id:'jarvis-local',priority:1,local:true,capabilities:['support.draft-reply'],available:async()=>true,invoke:async()=>{throw Error('must not call local model');}};
  const service=createVitrinyNeuralService({db,providers:[provider],now:()=>Date.parse('2026-09-13T15:00:00Z'),env:{VITRINY_NEURAL_ENABLED:'1',VITRINY_NEURAL_MODE:'shadow',OPENAI_API_KEY:'qa-only'},fetchImpl:async(_url,options)=>{
    if(options.method==='GET')return response({id:'gpt-6-astra'});paidBody=JSON.parse(options.body);
    return response(completed({output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({...result,evidenceIds:['NEURAL_EVALUATION']})}]}]}));
  }});
  service.recordQualification({providerId:'jarvis-local',modelName:'Qwen3-1.7B',suite:'semantic-v1',report:{score:.17,categories:{safety:{score:.33}},results:[{output:'RAW_PRIVATE_OUTPUT'}]}});
  db.prepare("INSERT INTO neural_benchmark_runs(id,status,provider_id,model_name,total,passed,failed,score,report_json,created_at,completed_at) VALUES('qa','completed','jarvis-local','Qwen3-1.7B',12,2,10,.17,?,?,?)").run('{"raw":"RAW_PRIVATE_OUTPUT"}','2026-09-13T14:00:00Z','2026-09-13T14:01:00Z');
  assert.deepEqual(service.runtime.knowledge.retrieve(objective),[]);await service.supervisor.checkAvailability();service.supervisor.configure({enabled:true,dailyUsdLimit:.5,revision:1});
  const run=await service.supervisor.evaluate(4,{requestId:randomUUID(),objective});assert.equal(run.state,'completed');
  const evidence=JSON.parse(paidBody.input).context.evaluation;assert.equal(evidence.qualification.scorePercent,17);assert.equal(evidence.qualification.safetyScorePercent,33);assert.equal(evidence.qualification.scoreScale,'percent_0_to_100_rounded_1_decimal');assert.equal(evidence.qualification.productionEligible,false);
  assert.equal(evidence.benchmark.total,12);assert.equal(evidence.benchmark.passed,2);assert.equal(evidence.skills.length,7);assert.doesNotMatch(paidBody.input,/RAW_PRIVATE_OUTPUT|report_json/);
  assert.equal(db.prepare('SELECT status FROM neural_lessons WHERE id=?').get(run.candidateId).status,'candidate');
  assert.deepEqual(service.runtime.knowledge.retrieve(run.result.summary),[]);assert.equal(service.status().service.mode,'shadow');assert.equal(service.status().qualification.productionEligible,false);
});

const textResponse=text=>completed({output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text}]}]});
test('all four-key JSON permutations are accepted; duplicates including escaped names stay rejected',async t=>{
  const permutations=keys=>keys.length?keys.flatMap((key,i)=>permutations(keys.filter((_,index)=>index!==i)).map(rest=>[key,...rest])):[[]];
  for(const keys of permutations(Object.keys(result))){
    const raw=JSON.stringify(Object.fromEntries(keys.map(key=>[key,result[key]]))),f=fixture(t,{handler:async()=>response(textResponse(raw))});await f.ready();
    const run=await f.request();assert.equal(run.state,'completed');assert.equal(run.validationReason,null);assert.deepEqual(run.result,result);
  }
  for(const raw of [JSON.stringify(result).replace('"summary":','"summary":"duplicada", "summary":'),JSON.stringify(result).replace('"summary":','"su\\u006dmary":"duplicada", "summary":')]){
    const f=fixture(t,{handler:async()=>response(textResponse(raw))});await f.ready();const run=await f.request();assert.equal(run.validationReason,'json_duplicate_key');assert.equal(run.state,'failed');assert.equal(run.candidateId,null);
  }
  const literal={...result,summary:'Revisar o campo "summary": como texto literal, sem introduzir outra propriedade.'};
  const f=fixture(t,{handler:async()=>response(textResponse(JSON.stringify(literal)))});await f.ready();assert.equal((await f.request()).state,'completed');
});

test('schema bounds match local limits and percent inputs are labeled/rounded without weakening privacy',async t=>{
  const f=fixture(t,{getEvaluation:()=>({skills:['support.assistant'],qualification:{score:1/6,safetyScore:1/3,productionEligible:false}})});await f.ready();await f.request();
  const body=JSON.parse(f.posts()[0].body),properties=body.text.format.schema.properties;
  for(const [schema,min,max] of [[properties.summary,12,600],[properties.findings.items,5,350],[properties.recommendations.items,5,350]]){
    const pattern=new RegExp(schema.pattern);assert.equal(pattern.test('x'.repeat(min-1)),false);assert.equal(pattern.test('x'.repeat(min)),true);assert.equal(pattern.test('x'.repeat(max)),true);assert.equal(pattern.test('x'.repeat(max+1)),false);
  }
  for(const key of ['findings','recommendations','evidenceIds']){assert.equal(properties[key].minItems,1);assert.equal(properties[key].maxItems,4);}
  const q=JSON.parse(body.input).context.evaluation.qualification;assert.equal(q.scorePercent,16.7);assert.equal(q.safetyScorePercent,33.3);assert.equal(q.score,undefined);assert.equal(q.safetyScore,undefined);
  const unsafe=fixture(t,{handler:async()=>response(textResponse(JSON.stringify({...result,summary:'Telefone do cliente 11987654321 não pode ser reaproveitado.'})))});await unsafe.ready();assert.equal((await unsafe.request()).validationReason,'unsafe_text');
});

test('rejection diagnostics retain only enum, bounded shape, lengths and output-text hash',async t=>{
  const cases=[['summary_bounds',textResponse(JSON.stringify({...result,summary:'x'.repeat(601)}))],['findings_bounds',textResponse(JSON.stringify({...result,findings:['x'.repeat(351)]}))],['recommendations_bounds',textResponse(JSON.stringify({...result,recommendations:[]}))],
    ['unsafe_text',textResponse(JSON.stringify({...result,summary:'PRIVATE_MARKER qa@example.invalid senha: hidden-secret'}))],['json_shape',textResponse(JSON.stringify({...result,unknown:'PRIVATE_MARKER'}))],['evidence_invalid',textResponse(JSON.stringify({...result,evidenceIds:['PRIVATE_MARKER']}))],
    ['response_model',completed({model:'PRIVATE_MARKER'})],['response_status',completed({status:'incomplete'})],['message_count',completed({output:[]})],['message_shape',completed({output:[{type:'message',role:'assistant',status:'completed',content:[{type:'refusal',refusal:'PRIVATE_MARKER'}]}]})]];
  for(const [reason,data] of cases){
    data.output.unshift({type:'reasoning',summary:[{type:'summary_text',text:'REASONING_PRIVATE_MARKER'}]});
    const f=fixture(t,{handler:async()=>response(data)});await f.ready();const run=await f.request();assert.equal(run.validationReason,reason);assert.equal(run.state,'failed');assert.equal(run.result,null);
    assert.doesNotMatch(JSON.stringify(run),/PRIVATE_MARKER|qa@example|hidden-secret/);
    const stored=f.db.prepare('SELECT result_json,response_shape_json,validation_reason FROM neural_astra_runs WHERE id=?').get(run.id);assert.equal(stored.result_json,null);assert.equal(stored.validation_reason,reason);assert.doesNotMatch(JSON.stringify(stored),/PRIVATE_MARKER|qa@example|hidden-secret/);
    const raw=data.output.find(item=>item.type==='message')?.content?.[0]?.text;
    if(raw)assert.equal(run.responseShape.textSha256,createHash('sha256').update(raw).digest('hex'));
    assert.equal(run.actualUsd,.01);await f.request(run.id);assert.equal(f.posts().length,1);
  }
});

test('legacy failed receipt remains unchanged when additive diagnostics are installed',async t=>{
  const f=fixture(t,{handler:async()=>response(textResponse(JSON.stringify({...result,summary:'x'.repeat(601)})))});await f.ready();const run=await f.request();
  f.db.exec('ALTER TABLE neural_astra_runs DROP COLUMN validation_reason; ALTER TABLE neural_astra_runs DROP COLUMN response_shape_json; ALTER TABLE neural_astra_runs DROP COLUMN reviewed_at; ALTER TABLE neural_astra_runs DROP COLUMN reviewed_by;');
  const before=f.db.prepare('SELECT state,error,actual_micro,created_at,finished_at,submitted FROM neural_astra_runs WHERE id=?').get(run.id);
  const restarted=createAstraSupervisor(f.options),read=restarted.run(run.id);assert.equal(read.validationReason,null);assert.equal(read.responseShape,null);assert.equal(read.reviewed,false);
  assert.deepEqual(f.db.prepare('SELECT state,error,actual_micro,created_at,finished_at,submitted FROM neural_astra_runs WHERE id=?').get(run.id),before);assert.equal(f.posts().length,1);
});

test('explicit known-failure acknowledgement is idempotent and cannot reset state, spend or cooldown',async t=>{
  const f=fixture(t,{handler:async()=>response(textResponse(JSON.stringify({...result,summary:'x'.repeat(601)})))});await f.ready();const run=await f.request();assert.equal(run.failureReviewable,true);assert.equal(run.reviewed,false);
  const before=f.db.prepare('SELECT state,error,actual_micro,charged_micro,provider_id,input_tokens,output_tokens,created_at,finished_at FROM neural_astra_runs WHERE id=?').get(run.id);
  assert.throws(()=>f.service.acknowledgeFailure(4,run.id,{confirmed:false}),{code:'astra_review_confirmation_required'});
  const reviewed=f.service.acknowledgeFailure(4,run.id,{confirmed:true});assert.equal(reviewed.reviewed,true);assert.equal(reviewed.state,'failed');assert.equal(reviewed.result,null);
  f.clock.time+=1000;const restarted=createAstraSupervisor(f.options);assert.deepEqual(restarted.acknowledgeFailure(5,run.id,{confirmed:true}),reviewed);assert.equal(f.db.prepare('SELECT reviewed_by FROM neural_astra_runs WHERE id=?').get(run.id).reviewed_by,4);
  assert.deepEqual(f.db.prepare('SELECT state,error,actual_micro,charged_micro,provider_id,input_tokens,output_tokens,created_at,finished_at FROM neural_astra_runs WHERE id=?').get(run.id),before);
  await assert.rejects(f.request(),{code:'astra_hourly_limit'});assert.equal(f.posts().length,1);
  f.clock.time=before.created_at+3600001;const next=await f.request();assert.equal(next.state,'failed');assert.equal(f.posts().length,2);assert.equal(f.service.status().budget.reservedOrSpentUsd,.02);
  for(const handler of [async()=>{throw Error('lost');},async()=>response(completed()),async()=>response(textResponse(JSON.stringify({...result,summary:'x'.repeat(601)})) )]){
    const other=fixture(t,{handler});await other.ready();const candidate=await other.request();if(candidate.state==='failed')other.db.prepare('UPDATE neural_astra_runs SET actual_micro=NULL WHERE id=?').run(candidate.id);
    assert.throws(()=>other.service.acknowledgeFailure(4,candidate.id,{confirmed:true}),{code:'astra_failure_not_reviewable'});assert.equal(other.service.run(candidate.id).reviewed,false);
  }
});

test('failure acknowledgement HTTP requires admin, same origin and explicit confirmation, with zero additional provider calls',async t=>{
  const f=fixture(t,{handler:async()=>response(textResponse(JSON.stringify({...result,summary:'x'.repeat(601)})))});await f.ready();const run=await f.request();
  const app=express();app.use(express.json());mountVitrinyNeuralAdmin({app,service:{runtime:{neural:{},skills:{}},supervisor:f.service},requireAdmin(req,res,next){if(req.headers['x-admin']!=='fixture')return res.status(403).end();req.user={id:4};next();},sameOriginOnly(req,res,next){if(req.headers.origin!=='https://site.example')return res.status(403).end();next();}});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url=`http://127.0.0.1:${server.address().port}/api/admin/vitriny-neural/supervisor/runs/${run.id}/acknowledge-failure`;
  const send=(body,headers={})=>fetch(url,{method:'POST',headers:{'content-type':'application/json','x-admin':'fixture',origin:'https://site.example',...headers},body:JSON.stringify(body)});
  assert.equal((await send({confirmed:true},{'x-admin':'no'})).status,403);assert.equal((await send({confirmed:true},{origin:'https://foreign.example'})).status,403);assert.equal((await send({confirmed:false})).status,400);
  assert.equal(f.service.run(run.id).reviewed,false);const accepted=await send({confirmed:true});assert.equal(accepted.status,200);assert.equal((await accepted.json()).run.reviewed,true);assert.equal(f.posts().length,1);
});

test('diagnostics keep only a strict public GPT model identifier and never email, controls or arbitrary strings',async t=>{
  for(const [model,expected] of [['gpt-6-astra-preview','gpt-6-astra-preview'],['gpt-qa@example.invalid','other'],['gpt-6-astra\nprivate','other'],['Bearer sk-private-test','other'],['gpt-'+'a'.repeat(101),'other']]){
    const f=fixture(t,{handler:async()=>response(completed({model}))});await f.ready();const run=await f.request();
    assert.equal(run.state,'failed');assert.equal(run.validationReason,'response_model');assert.equal(run.responseShape.modelMatches,false);assert.equal(run.responseShape.modelId,expected);
    assert.doesNotMatch(JSON.stringify(run.responseShape),/qa@example|private|Bearer/);
  }
});
