import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {createAdminTeachingPilot} from '../vitriny-neural/admin-teaching-pilot.js';
import {teachingPilotConfig} from './run-admin-teaching-pilot.mjs';
import {diagnoseOpenAi,DIAGNOSTIC_ID} from './diagnose-admin-teaching-openai.mjs';

const now=()=>Date.parse('2026-09-22T17:30:00Z');
function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lia-diag-test-'));
  t.after(()=>fs.rmSync(dir,{recursive:true}));
  const ledger=path.join(dir,'pilot.sqlite');
  const db=new Database(ledger);createAdminTeachingPilot({db,config:teachingPilotConfig(),now});db.close();
  return{ledger,args:['--execute','--ledger='+ledger],env:{OPENAI_API_KEY:'fixture-key-not-real'},now};
}
test('diagnostic defaults dry-run; unknown args and missing key cannot call provider',async t=>{
  let calls=0;const fetchImpl=()=>{calls++;throw Error('must-not-run');};
  assert.equal((await diagnoseOpenAi({fetchImpl})).modelCalls,0);
  assert.equal((await diagnoseOpenAi({args:['--dry-run'],fetchImpl})).modelCalls,0);
  await assert.rejects(diagnoseOpenAi({args:['--execute'],fetchImpl}),{code:'teaching_args_invalid'});
  const f=fixture(t);await assert.rejects(diagnoseOpenAi({...f,env:{},fetchImpl}),{code:'teaching_provider_keys_missing'});assert.equal(calls,0);
});
test('one tiny request reserves original ledger before dispatch; subsequent run reuses receipt without HTTP',async t=>{
  const f=fixture(t);let calls=0;
  const fetchImpl=async(url,init)=>{
    calls++;assert.equal(url,'https://api.openai.com/v1/chat/completions');
    const body=JSON.parse(init.body);assert.equal(body.max_completion_tokens,64);assert.equal(body.store,false);
    const db=new Database(f.ledger,{readonly:true});const r=db.prepare('SELECT state,maximum_micro FROM admin_teaching_pilot_runs WHERE id=?').get(DIAGNOSTIC_ID);db.close();
    assert.equal(r.state,'dispatching');assert.ok(r.maximum_micro<10000);
    return new Response(JSON.stringify({id:'diagnostic-fixture-001',object:'chat.completion',model:'gpt-5.6-luna',service_tier:'default',choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:'OK'}}],usage:{prompt_tokens:100,completion_tokens:1,total_tokens:101,prompt_tokens_details:{cached_tokens:0,cache_write_tokens:0}}}),{status:200});
  };
  const first=await diagnoseOpenAi({...f,fetchImpl});assert.equal(first.state,'completed');assert.equal(first.budget.budgetMicroBrl,'20000000');
  assert.deepEqual(await diagnoseOpenAi({...f,fetchImpl}),first);assert.equal(calls,1);assert.doesNotMatch(JSON.stringify(first),/fixture-key/);
});
test('uncertain reviewer stays held; new diagnostic never rewrites or replays it and itself is idempotent',async t=>{
  const f=fixture(t),db=new Database(f.ledger);
  const pilot=createAdminTeachingPilot({db,config:teachingPilotConfig(),providerKeys:{openai:'fixture-key-not-real'},now,fetchImpl:async()=>{throw Error('uncertain');}});
  await pilot.executeLesson({id:'original-reviewer-fixture',providerId:'openai',model:'gpt-5.6-luna',role:'reviewer',messages:[{role:'user',content:'Original reviewer.'}]});
  const before=db.prepare('SELECT * FROM admin_teaching_pilot_runs WHERE id=?').get('original-reviewer-fixture');db.close();
  let calls=0;const fetchImpl=async()=>{calls++;return new Response(JSON.stringify({error:{code:'unsupported_parameter',type:'invalid_request_error',param:'modalities',message:'fixture-key-not-real PRIVATE'}}),{status:400});};
  const first=await diagnoseOpenAi({...f,fetchImpl});assert.equal(first.state,'held');assert.equal(first.actualMicroBrl,null);assert.equal(first.httpStatus,400);assert.equal(first.providerError.param,'modalities');
  assert.deepEqual(await diagnoseOpenAi({...f,fetchImpl}),first);assert.equal(calls,1);assert.doesNotMatch(JSON.stringify(first),/PRIVATE|fixture-key/);
  const check=new Database(f.ledger,{readonly:true});assert.deepEqual(check.prepare('SELECT * FROM admin_teaching_pilot_runs WHERE id=?').get('original-reviewer-fixture'),before);check.close();
});
test('operational database is rejected without sending',async t=>{
  const f=fixture(t),db=new Database(f.ledger);db.exec('CREATE TABLE customer_wallets(id TEXT)');db.close();
  let calls=0;await assert.rejects(diagnoseOpenAi({...f,fetchImpl:async()=>{calls++;}}),{code:'teaching_dedicated_ledger_required'});assert.equal(calls,0);
});
