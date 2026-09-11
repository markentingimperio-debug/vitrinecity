import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,rmSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Database from 'better-sqlite3';
import {createVitrinyNeuralSqliteStore} from '../vitriny-neural/sqlite-store.js';
import {createSpatialEventProcessor} from '../vitriny-neural/spatial-event-processor.js';

const historical='2026-09-10T13:00:00.000Z',clock=Date.parse('2026-09-11T20:00:00.000Z');
const district={activeCount:3,eventCount:8,windowMinutes:60,channel:'multiverse'};
const render={renderSamples:4,fpsPoor:1,fpsConstrained:2,fpsGood:3,fpsExcellent:4,windowMinutes:30,channel:'spatial-render'};
function fixture(){
  const db=new Database(':memory:');
  createVitrinyNeuralSqliteStore(db).init({version:1,nodeId:'unit-fixture'});
  const logs=[],options={db,enabled:true,now:()=>clock,logger:{warn:value=>logs.push(value)}};
  const worker=()=>createSpatialEventProcessor(options);
  let index=0;
  const add=(changes={})=>{
    const row={id:'fixture-'+(++index),type:'spatial.aggregate',source:'spatial',entity_type:'district',entity_id:'central',
      payload_json:JSON.stringify(district),occurred_at:historical,received_at:historical,status:'pending',...changes};
    db.prepare(`INSERT INTO neural_events(id,type,source,entity_type,entity_id,payload_json,occurred_at,received_at,status)
      VALUES(@id,@type,@source,@entity_type,@entity_id,@payload_json,@occurred_at,@received_at,@status)`).run(row);
    return row.id;
  };
  return{db,logs,options,worker,add,rows:()=>db.prepare('SELECT * FROM neural_events ORDER BY id').all(),signals:()=>db.prepare('SELECT * FROM neural_signals ORDER BY id').all()};
}

test('projects historical gauges only, discards extra payload, and never produces ratios or lessons',()=>{
  const f=fixture();try{
    f.add({payload_json:JSON.stringify({...district,privateText:'DO_NOT_COPY'})});
    f.add({entity_type:'city',entity_id:'silvania',payload_json:JSON.stringify({...district,channel:'multiverse-city'})});
    f.add({entity_type:'runtime',entity_id:'multiverse-render',payload_json:JSON.stringify(render)});
    f.add({entity_type:'runtime',entity_id:'multiverse-render',payload_json:JSON.stringify({...render,fpsPoor:1,fpsConstrained:1,fpsGood:1,fpsExcellent:1})});
    const p=f.worker();assert.deepEqual(p.tick(),{processed:4,review:0,signals:14});
    const signals=f.signals();
    assert.equal(signals.find(s=>s.metric==='spatial.presence.current').value,3);
    assert.equal(signals.find(s=>s.metric==='spatial.events.rolling_window').value,8);
    assert.deepEqual(signals.filter(s=>s.metric.startsWith('spatial.fps.')).slice(0,4).map(s=>s.value),[1,2,3,4]);
    assert.ok(signals.every(s=>s.window_start===historical&&s.window_end===historical&&s.created_at===new Date(clock).toISOString()));
    assert.ok(signals.every(s=>!s.metric.includes('ratio')&&!s.metric.includes('delta')));
    const presence=JSON.parse(signals[0].metadata_json),events=JSON.parse(signals[1].metadata_json);
    assert.equal(presence.semantics,'point_in_time');assert.equal(events.semantics,'rolling_bucket_snapshot');
    assert.equal(events.nominalWindowMinutes,60);assert.equal(events.notAdditive,true);
    assert.equal(JSON.parse(signals[5].metadata_json).universe,'all_telemetry_events');
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM neural_lessons').get().n,0);
    assert.doesNotMatch(JSON.stringify(signals)+JSON.stringify(f.rows().map(r=>r.outcome_json))+JSON.stringify(f.logs),/DO_NOT_COPY/);
    assert.equal(p.status().automaticLearning,false);assert.equal(p.status().processed,4);
    const receipts=f.rows().map(r=>JSON.parse(r.outcome_json));
    assert.deepEqual(receipts.flatMap(r=>r.signalIds).sort((a,b)=>a-b),signals.map(s=>s.id));
    assert.ok(receipts.every(r=>r.signalIds.length===r.observationCount));
    assert.equal(new Set(receipts.flatMap(r=>r.signalIds)).size,signals.length);
  }finally{f.db.close();}
});

test('missing, coercible, unsafe, malformed and unknown spatial fields fail once with sanitized receipts',()=>{
  const f=fixture();try{
    for(const value of [undefined,null,'0',false,-1,0.5,Number.MAX_SAFE_INTEGER+1,Infinity])
      f.add({payload_json:JSON.stringify({...district,activeCount:value})});
    for(const field of ['eventCount','windowMinutes','channel']){const payload={...district};delete payload[field];f.add({payload_json:JSON.stringify(payload)});}
    for(const field of Object.keys(render)){const payload={...render};delete payload[field];f.add({entity_type:'runtime',entity_id:'multiverse-render',payload_json:JSON.stringify(payload)});}
    for(const payload of ['{SECRET', 'null', '[]', '"SECRET"'])f.add({payload_json:payload});
    f.add({entity_id:'SECRET'});f.add({entity_type:'__proto__'});f.add({occurred_at:'SECRET'});
    f.add({payload_json:JSON.stringify({...district,channel:'SECRET'})});
    const p=createSpatialEventProcessor({...f.options,limit:200}),n=f.rows().length;
    assert.deepEqual(p.tick(),{processed:0,review:n,signals:0});
    assert.ok(f.rows().every(r=>r.status==='failed'&&r.attempt_count===1&&JSON.parse(r.outcome_json).status==='needs_review'));
    assert.doesNotMatch(JSON.stringify(f.rows().map(r=>[r.outcome_json,r.error_message]))+JSON.stringify(f.logs),/SECRET/);
    const before=f.db.serialize();assert.deepEqual(p.tick(),{processed:0,review:0,signals:0});assert.deepEqual(f.db.serialize(),before);
    assert.equal(p.status().review,n);assert.equal(p.status().pending,0);
  }finally{f.db.close();}
});

test('zero and max-safe integers are valid; other types, sources and all nonpending states stay byte-identical',()=>{
  const f=fixture();try{
    for(let i=0;i<5;i++)f.add({type:'skill.observation'});
    f.add({source:'admin-neural'});
    for(const status of ['processing','processed','failed','dead_letter'])f.add({status});
    f.db.prepare("UPDATE neural_events SET lease_owner='existing-worker',lease_until=1 WHERE status='processing'").run();
    const before=f.rows();f.add({payload_json:JSON.stringify({...district,activeCount:0,eventCount:Number.MAX_SAFE_INTEGER,windowMinutes:0})});
    assert.deepEqual(f.worker().tick(),{processed:1,review:0,signals:2});
    assert.deepEqual(f.rows().filter(r=>before.some(b=>b.id===r.id)),before);
    assert.equal(f.signals()[1].value,Number.MAX_SAFE_INTEGER);
  }finally{f.db.close();}
});

for(const fault of ['signal','ack'])test('transaction rolls back every signal and receipt after '+fault+' failure',()=>{
  const f=fixture();try{
    f.add();f.add();const before=f.rows();
    f.db.exec(fault==='signal'?`CREATE TRIGGER inject_failure BEFORE INSERT ON neural_signals WHEN NEW.metric='spatial.events.rolling_window' BEGIN SELECT RAISE(ABORT,'PRIVATE_DB_ERROR'); END;`:
      `CREATE TRIGGER inject_failure BEFORE UPDATE OF status ON neural_events BEGIN SELECT RAISE(ABORT,'PRIVATE_DB_ERROR'); END;`);
    assert.equal(f.worker().tick().error,'spatial_observation_transaction_failed');
    assert.deepEqual(f.rows(),before);assert.equal(f.signals().length,0);assert.deepEqual(f.logs,['spatial_observation_transaction_failed']);
    f.db.exec('DROP TRIGGER inject_failure');assert.equal(f.worker().tick().processed,2);
  }finally{f.db.close();}
});

test('two instances and recreated workers are idempotent; batches are bounded and timer start is guarded',()=>{
  const f=fixture();const a=createSpatialEventProcessor({...f.options,limit:1}),b=f.worker();try{
    f.add();f.add();assert.equal(a.tick().processed,1);assert.equal(a.status().pending,1);
    assert.equal(b.tick().processed,1);assert.equal(f.worker().tick().processed,0);assert.equal(f.signals().length,4);
    assert.equal(a.start(),true);assert.equal(a.start(),false);assert.equal(a.status().running,true);
    assert.equal(a.stop(),true);assert.equal(a.stop(),false);assert.equal(a.status().running,false);
  }finally{a.stop();b.stop();f.db.close();}
});

test('default off creates no timer, processing transition or serialized DB change',()=>{
  const f=fixture();try{
    f.add();const before=f.db.serialize(),p=createSpatialEventProcessor({db:f.db});
    assert.equal(p.status().enabled,false);assert.equal(p.start(),false);assert.equal(p.tick().skipped,true);
    assert.equal(p.status().pending,1);assert.equal(p.status().processed,0);assert.equal(p.status().running,false);
    assert.deepEqual(f.db.serialize(),before);assert.equal(f.signals().length,0);
  }finally{f.db.close();}
});

test('scheduled tick processes exactly once without an immediate drain at start',async()=>{
  const f=fixture(),p=createSpatialEventProcessor({...f.options,intervalMs:5});
  try {
    f.add();p.start();assert.equal(f.rows()[0].status,'pending');
    for(let i=0;i<200&&f.rows()[0].status==='pending';i++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(f.rows()[0].status,'processed');
    p.stop();assert.equal(f.signals().length,2);assert.equal(f.rows()[0].attempt_count,1);
  } finally {p.stop();f.db.close();}
});

test('separate SQLite connections honor the write lock and retain receipts after reopening',()=>{
  const directory=mkdtempSync(join(tmpdir(),'vitriny-spatial-test-')),file=join(directory,'fixture.db');
  let first=new Database(file,{timeout:1}),second;
  try {
    const store=createVitrinyNeuralSqliteStore(first);store.init({version:1,nodeId:'file-fixture'});
    store.enqueueEvent({id:'persistent-event',type:'spatial.aggregate',source:'spatial',entityType:'district',entityId:'central',payload:district,priority:1,occurredAt:historical,receivedAt:historical,nodeId:'fixture'});
    second=new Database(file,{timeout:1});
    const options={enabled:true,now:()=>clock,logger:{warn(){}}};
    const a=createSpatialEventProcessor({...options,db:first}),b=createSpatialEventProcessor({...options,db:second});
    first.exec('BEGIN IMMEDIATE');
    assert.equal(b.tick().error,'spatial_observation_transaction_failed');
    first.exec('ROLLBACK');
    assert.equal(a.tick().processed,1);first.close();first=null;
    assert.equal(b.tick().processed,0);second.close();second=null;
    first=new Database(file);
    assert.equal(createSpatialEventProcessor({...options,db:first}).tick().processed,0);
    const receipt=JSON.parse(first.prepare('SELECT outcome_json FROM neural_events').get().outcome_json);
    assert.deepEqual(receipt.signalIds,first.prepare('SELECT id FROM neural_signals ORDER BY id').all().map(r=>r.id));
    assert.equal(receipt.signalIds.length,2);
  } finally {
    if(first?.inTransaction)first.exec('ROLLBACK');
    first?.close();second?.close();
    // Only this test's known file and then its empty temporary directory.
    rmSync(file,{force:true});rmdirSync(directory);
  }
});
