import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {teachingSources,teachingSourceRevision} from '../vitriny-neural/admin-teaching-sources.js';
import {teachingLessons,teachingHoldout} from '../vitriny-neural/admin-teaching-curriculum.js';
import {planTeaching,reviewerMessages,validateTeacherResponse,validateReviewerResponse,parseTeachingJson,parseTeachingArgs,runTeachingCli,validateTeachingPaths} from './run-admin-teaching-pilot.mjs';

const NOW=Date.parse('2026-09-22T17:30:00.000Z');
const planning={sources:teachingSources,sourceRevision:teachingSourceRevision,now:()=>NOW};
const plan=domain=>planTeaching({...planning,domain});
const teacher=p=>({lessons:p.lessons.map(q=>({id:q.id,answer:'Resposta candidata de teste, limitada à fonte pública. Não executa ações.',sourceIds:[q.sourceIds[0]]}))});
const review=p=>({reviews:p.lessons.map(q=>({id:q.id,decision:'accept',reason:'Exemplo sintético compatível; ainda requer revisão humana.'}))});
function temporary(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'vitrine-teaching-cli-'));
  t.after(()=>{assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('vitrine-teaching-cli-'));fs.rmSync(directory,{recursive:true,force:true});});
  return directory;
}
function fixture(t,extra={}){
  const directory=temporary(t),ledger=path.join(directory,'pilot.sqlite'),report=path.join(directory,'platform.json'),calls=[],output=[];
  const options={...planning,args:['--execute','--domain=platform','--ledger='+ledger,'--report='+report],env:{DEEPSEEK_API_KEY:'synthetic-deepseek-key',OPENAI_API_KEY:'synthetic-openai-key'},stdout:value=>output.push(value),fetchImpl:async(url,init)=>{
    const body=JSON.parse(init.body),role=body.model==='deepseek-flash'?'teacher':'reviewer';calls.push({url,body,role});
    const content=JSON.stringify(role==='teacher'?teacher(plan('platform')):review(plan('platform')));
    const data={id:'cli-fixture-'+calls.length,object:'chat.completion',model:body.model,created:Math.floor(NOW/1000),choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content}}],usage:{prompt_tokens:2000,prompt_cache_hit_tokens:0,prompt_cache_miss_tokens:2000,completion_tokens:400,total_tokens:2400,prompt_tokens_details:{cached_tokens:0,cache_write_tokens:0}}};
    return extra.respond?extra.respond({data,role,calls}):new Response(JSON.stringify(data),{status:200});
  }};
  return{directory,ledger,report,calls,output,options,run:overrides=>runTeachingCli({...options,...overrides})};
}

test('real sources produce five bounded plans; holdouts never enter prompts or curriculum hash',()=>{
  for(const domain of ['platform','commerce','operations','growth','search']){
    const p=plan(domain);assert.equal(p.lessons.length,10);assert.ok(p.teacherMessages.every(m=>m.content.length<=16000));assert.ok(Buffer.byteLength(JSON.stringify(p.teacherMessages))<=60*1024);
    const json=JSON.stringify(p);for(const hidden of teachingHoldout){assert.ok(!json.includes(hidden.id));assert.ok(!json.includes(hidden.question));}
    assert.doesNotMatch(json,/CANARIO_TREINO_PRIVADO/);assert.ok(reviewerMessages(p,teacher(p)).every(m=>m.content.length<=16000));
    const unchanged=planTeaching({...planning,domain,lessons:[...teachingLessons,...teachingHoldout.map(q=>({...q,domain:'holdout'}))]});assert.equal(unchanged.planHash,p.planHash);
  }
});

test('dry-run default performs no model calls, creates no ledger/report and never prints teaching texts or keys',async t=>{
  const f=fixture(t),r=await f.run({args:['--ledger='+f.ledger,'--report='+f.report],fetchImpl:()=>{throw Error('must not fetch');}});
  assert.equal(r.mode,'dry-run');assert.equal(r.lessons,50);assert.equal(r.modelCalls,0);assert.equal(f.calls.length,0);assert.equal(fs.existsSync(f.ledger),false);assert.equal(fs.existsSync(f.report),false);
  assert.doesNotMatch(JSON.stringify(f.output),/Resposta candidata|synthetic|Como apresentar|Fontes públicas/);
});

test('both server keys are required before opening the ledger or paying the teacher',async t=>{
  const f=fixture(t);for(const env of [{},{DEEPSEEK_API_KEY:'synthetic-key'},{OPENAI_API_KEY:'synthetic-key'}])await assert.rejects(f.run({env}),{code:'teaching_provider_keys_missing'});
  assert.equal(f.calls.length,0);assert.equal(fs.existsSync(f.ledger),false);assert.equal(fs.existsSync(f.report),false);
});

test('one domain executes teacher then reviewer, writes private candidates only and reruns/inspect never call again',async t=>{
  const f=fixture(t),r=await f.run();assert.equal(r.state,'completed');assert.equal(f.calls.length,2);assert.deepEqual(f.calls.map(c=>c.role),['teacher','reviewer']);
  const report=JSON.parse(fs.readFileSync(f.report,'utf8'));assert.equal(report.format,'vitrinecity-admin-teaching-report-v1');assert.equal(report.lessons.length,10);assert.equal(report.reviews.length,10);
  assert.equal(report.approval,'candidate');assert.equal(report.applied,false);assert.equal(report.datasetIngested,false);assert.equal(report.weightTraining,false);
  assert.doesNotMatch(JSON.stringify(f.output),/Resposta candidata|revisão humana|synthetic-deepseek-key|synthetic-openai-key/);
  assert.equal((await f.run()).state,'completed');assert.equal(f.calls.length,2);
  const inspect=await f.run({args:f.options.args.map(a=>a==='--execute'?'--inspect':a),env:{},fetchImpl:()=>{throw Error('inspect must not fetch');}});
  assert.equal(inspect.state,'completed');assert.equal(f.calls.length,2);
  if(process.platform!=='win32'){assert.equal(fs.statSync(f.ledger).mode&0o777,0o600);assert.equal(fs.statSync(f.report).mode&0o777,0o600);}
});

test('teacher held or invalid JSON prevents reviewer and preserves safe partial report',async t=>{
  for(const mode of ['unknown','invalid','pii']){
    const f=fixture(t,{respond:({data})=>{if(mode==='unknown')throw Error('PRIVATE key');data.choices[0].message.content=mode==='pii'?'Contacte pessoa@example.test':'{"lessons":[]}';return new Response(JSON.stringify(data));}});
    const r=await f.run();assert.equal(r.state,'partial');assert.equal(f.calls.length,1);assert.equal(r.reviewer.state,'not_started');
    const saved=JSON.parse(fs.readFileSync(f.report,'utf8'));assert.deepEqual(saved.lessons,[]);assert.deepEqual(saved.reviews,[]);assert.doesNotMatch(JSON.stringify(saved),/pessoa@example|PRIVATE key/);
    assert.equal((await f.run()).state,'partial');assert.equal(f.calls.length,1);
  }
});

test('reviewer unknown stays pending across repeat and inspect, without losing teacher candidates',async t=>{
  const f=fixture(t,{respond:({data,role})=>{if(role==='reviewer')throw Error('PRIVATE');return new Response(JSON.stringify(data));}});
  const r=await f.run();assert.equal(r.state,'partial');assert.equal(r.reviewer.state,'held');assert.equal(r.budget.actualMicroBrl,null);assert.equal(f.calls.length,2);
  const saved=JSON.parse(fs.readFileSync(f.report,'utf8'));assert.equal(saved.lessons.length,10);assert.equal(saved.reviews.length,0);assert.equal(saved.approval,'candidate');
  assert.equal((await f.run()).state,'partial');assert.equal(f.calls.length,2);
});

test('explicit review profile resumes only reviewer under a new ID and preserves the uncertain record/report',async t=>{
  const f=fixture(t,{respond:({data,role,calls})=>{
    if(role==='reviewer'&&calls.at(-1).body.modalities)return new Response(JSON.stringify({error:{type:'invalid_request_error',param:'modalities'}}),{status:400});
    return new Response(JSON.stringify(data));
  }});
  assert.equal((await f.run()).state,'partial');assert.equal(f.calls.length,2);
  const original=fs.readFileSync(f.report,'utf8'),check=new Database(f.ledger,{readonly:true});
  const old=check.prepare('SELECT * FROM admin_teaching_pilot_runs WHERE id=?').get(plan('platform').reviewerId);check.close();
  const newReport=path.join(f.directory,'platform-plain-text-v1.json');
  const args=f.options.args.map(a=>a.startsWith('--report=')?'--report='+newReport:a).concat('--review-profile=plain-text-v1');
  const resumed=await f.run({args});assert.equal(resumed.state,'completed');assert.equal(f.calls.length,3);
  assert.equal(f.calls[2].role,'reviewer');assert.equal(f.calls[2].body.modalities,undefined);assert.deepEqual(f.calls[2].body.prompt_cache_options,{mode:'explicit'});
  assert.ok(resumed.reviewer.id.endsWith('-plain-text-v1'));assert.equal(resumed.budget.actualMicroBrl,null);
  assert.equal(fs.readFileSync(f.report,'utf8'),original);assert.equal(JSON.parse(fs.readFileSync(newReport,'utf8')).reviewProfile,'plain-text-v1');
  const after=new Database(f.ledger,{readonly:true});assert.deepEqual(after.prepare('SELECT * FROM admin_teaching_pilot_runs WHERE id=?').get(old.id),old);after.close();
  await f.run({args});await f.run({args:args.map(a=>a==='--execute'?'--inspect':a),env:{}});assert.equal(f.calls.length,3);
  await assert.rejects(f.run({args:f.options.args.concat('--review-profile=plain-text-v1')}),{code:'teaching_report_conflict'});
  assert.throws(()=>parseTeachingArgs(['--review-profile=unknown']),{code:'teaching_args_invalid'});
});

test('strict JSON accepts only exact IDs/fields and optional full fence, never duplicate keys or PII',()=>{
  const p=plan('platform'),valid=teacher(p);assert.equal(validateTeacherResponse('```json\n'+JSON.stringify(valid)+'\n```',p).lessons.length,10);
  assert.equal(validateReviewerResponse(JSON.stringify(review(p)),p).reviews.length,10);
  for(const raw of ['{"lessons":[],"\\u006cessons":[]}','{"__proto__":{}}','{"lessons":[]} trailing','{"lessons":null}','[true]','{"x":[[[[[[["deep"]]]]]]]}'])assert.throws(()=>parseTeachingJson(raw),{code:'teaching_response_invalid'});
  for(const answer of ['cliente@example.test','11999998888','sk-'+ 'x'.repeat(24),'DEEPSEEK_API_KEY=privatevalue','CPF 123.456.789-00','linha\ncontrole','zero\u200bwidth','x'.repeat(601)]){const bad=teacher(p);bad.lessons[0].answer=answer;assert.throws(()=>validateTeacherResponse(JSON.stringify(bad),p));}
  for(const mutate of [x=>x.lessons[0].id='holdout-platform-01',x=>x.lessons[1].id=x.lessons[0].id,x=>x.lessons[0].sourceIds=['UNKNOWN'],x=>x.lessons[0].sourceIds=[],x=>x.lessons[0].approved='yes']){const bad=teacher(p);mutate(bad);assert.throws(()=>validateTeacherResponse(JSON.stringify(bad),p));}
  const badReview=review(p);badReview.reviews[0].decision='approved';assert.throws(()=>validateReviewerResponse(JSON.stringify(badReview),p));
});

test('only exact reviewed numeric documentation URL avoids phone false positive; answer and other provenance PII remain blocked',()=>{
  assert.ok(plan('growth').sources.find(s=>s.id==='MEASUREMENT').source.includes('/10917952?hl=pt-BR'));
  for(const source of ['Telefone 11999998888','https://support.google.com/analytics/answer/11999998888','https://support.google.com/analytics/answer/10917952?hl=pt-BR&token=private-secret']){
    const sources=teachingSources.map(s=>s.id==='MEASUREMENT'?{...s,source}:s);assert.throws(()=>planTeaching({...planning,domain:'growth',sources}),{code:'teaching_unsafe_text'});
  }
  assert.throws(()=>planTeaching({...planning,domain:'platform',now:()=>Date.parse('2026-10-16T00:00:00Z')}),{code:'teaching_source_expired'});
});

test('arguments, private targets, operational database env and foreign reports fail before any model call',async t=>{
  for(const args of [['--execute'],['--execute','--inspect'],['--domain=unknown'],['--execute','--ledger=a','--ledger=b'],['--surprise']])assert.throws(()=>parseTeachingArgs(args),{code:'teaching_args_invalid'});
  const f=fixture(t);for(const key of ['SQLITE_PATH','DATABASE_PATH','DB_PATH'])await assert.rejects(f.run({env:{...f.options.env,[key]:f.ledger}}),{code:'teaching_operational_database_forbidden'});
  assert.throws(()=>validateTeachingPaths({ledger:'relative.sqlite',report:f.report}),{code:'teaching_private_path_required'});
  fs.writeFileSync(f.report,'{"unrelated":"preserve me"}');await assert.rejects(f.run(),{code:'teaching_report_conflict'});assert.equal(fs.readFileSync(f.report,'utf8'),'{"unrelated":"preserve me"}');assert.equal(f.calls.length,0);
  const g=fixture(t),operational=new Database(g.ledger);operational.exec('CREATE TABLE customer_data(id INTEGER)');operational.close();await assert.rejects(g.run(),{code:'teaching_dedicated_ledger_required'});assert.equal(g.calls.length,0);
  const h=fixture(t),other=path.join(h.directory,'existing.sqlite');fs.writeFileSync(other,'preserved');fs.linkSync(other,h.ledger);assert.throws(()=>validateTeachingPaths({ledger:h.ledger,report:h.report}),{code:'teaching_private_path_required'});
});

test('resolved parent symlinks or junctions cannot redirect ledger or report into public directories',async t=>{
  const f=fixture(t);
  for(const segment of ['public','uploads','static']){
    const target=path.join(f.directory,segment),alias=path.join(f.directory,'alias-'+segment);fs.mkdirSync(target);
    fs.symlinkSync(target,alias,process.platform==='win32'?'junction':'dir');
    fs.writeFileSync(path.join(target,'existing.sqlite'),'preserved-ledger');fs.writeFileSync(path.join(target,'existing.json'),'preserved-report');
    for(const name of ['new','existing']){
      assert.throws(()=>validateTeachingPaths({ledger:path.join(alias,name+'.sqlite'),report:f.report}),{code:'teaching_private_path_required'});
      assert.throws(()=>validateTeachingPaths({ledger:f.ledger,report:path.join(alias,name+'.json')}),{code:'teaching_private_path_required'});
    }
    await assert.rejects(f.run({args:['--execute','--domain=platform','--ledger='+path.join(alias,'new.sqlite'),'--report='+f.report]}),{code:'teaching_private_path_required'});
    assert.deepEqual(fs.readdirSync(target).sort(),['existing.json','existing.sqlite']);
    assert.equal(fs.readFileSync(path.join(target,'existing.sqlite'),'utf8'),'preserved-ledger');
  }
  assert.equal(f.calls.length,0);assert.equal(fs.existsSync(f.ledger),false);assert.equal(fs.existsSync(f.report),false);
});
