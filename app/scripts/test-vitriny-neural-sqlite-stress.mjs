import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {createVitrinyNeural} from '../vitriny-neural/core.js';
import {createVitrinyNeuralSqliteStore} from '../vitriny-neural/sqlite-store.js';

let clock=Date.parse('2026-09-07T02:10:00.000Z');
const now=()=>clock++;
const db=new Database(':memory:');
const store=createVitrinyNeuralSqliteStore(db);
const neural=createVitrinyNeural({store,nodeId:'sqlite-stress',now});
const UNIQUE=3000,DUPLICATES=600;
const started=Date.now();
try{
  const insert=db.transaction(()=>{
    for(let i=0;i<UNIQUE;i++)assert.equal(neural.ingest({type:'commerce.metric',source:'sqlite-stress',entityType:'seller',entityId:`s${i}`,dedupeKey:`sqlite:${i}`,priority:i%5,payload:{value:i}}).accepted,true);
  });
  insert();
  for(let i=0;i<DUPLICATES;i++)assert.equal(neural.ingest({type:'commerce.metric',source:'sqlite-stress',entityType:'seller',entityId:`s${i}`,dedupeKey:`sqlite:${i}`,payload:{value:-1}}).duplicate,true);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM neural_events').get().n,UNIQUE);

  let rounds=0;
  while(db.prepare("SELECT COUNT(*) n FROM neural_events WHERE status='pending'").get().n){
    await neural.workBatch(async event=>{
      const id=Number(event.entityId.slice(1));
      if(id<2)throw new Error('permanent');
      if(id>=2&&id<12&&event.attemptCount<3)throw new Error('transient');
      return{ok:true};
    },{workerId:'sqlite-worker',limit:200,leaseMs:5000});
    if(++rounds>100)throw new Error('SQLite stress did not converge');
  }
  const processed=db.prepare("SELECT COUNT(*) n FROM neural_events WHERE status='processed'").get().n;
  const dead=db.prepare("SELECT COUNT(*) n FROM neural_events WHERE status='dead_letter'").get().n;
  const retried=db.prepare("SELECT COUNT(*) n FROM neural_events WHERE status='processed' AND attempt_count=3").get().n;
  assert.equal(processed,UNIQUE-2);assert.equal(dead,2);assert.equal(retried>=10,true);
  const elapsedMs=Date.now()-started;
  console.log(JSON.stringify({ok:true,sqliteStress:{uniqueEvents:UNIQUE,duplicatesRejected:DUPLICATES,processed,deadLetters:dead,retried,rounds,elapsedMs}}));
}finally{db.close();}
