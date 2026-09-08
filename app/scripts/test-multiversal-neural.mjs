import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import Database from 'better-sqlite3';

const appDir=fileURLToPath(new URL('..',import.meta.url));
const dataDir=mkdtempSync(path.join(tmpdir(),'vitrinecity-multiversal-neural-'));
const port=44000+(process.pid%900);
const base=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,[path.join(appDir,'multiversal-server.js')],{
  cwd:appDir,
  env:{...process.env,DATA_DIR:dataDir,PORT:String(port),MULTIVERSAL_PORT:String(port),NODE_ENV:'test',VITRINY_NEURAL_ENABLED:'1',VITRINY_NEURAL_MODE:'shadow',VITRINY_NEURAL_PSEUDONYM_SALT:'multiversal-neural-integration-test'},
  stdio:['ignore','pipe','pipe']
});
let output='';child.stdout.on('data',chunk=>{output+=chunk.toString();});child.stderr.on('data',chunk=>{output+=chunk.toString();});
async function wait(){const end=Date.now()+9000;while(Date.now()<end){if(child.exitCode!==null)throw new Error(output);try{const r=await fetch(`${base}/api/multiversal/health`);if(r.ok)return await r.json();}catch{}await new Promise(resolve=>setTimeout(resolve,90));}throw new Error(`timeout\n${output}`);}
async function post(pathname,body){const response=await fetch(base+pathname,{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify(body)});return{status:response.status,body:await response.json()};}
try{
  const health=await wait();assert.equal(health.neuralCapture,true);

  const enter=await post('/api/multiversal/event',{kind:'enter',citySlug:'silvania-go',realmSlug:'neural'});
  assert.equal(enter.status,202);assert.equal(enter.body.neural,true);assert.equal(enter.body.accepted,true);

  const cityChange=await post('/api/multiversal/event',{kind:'city-change',citySlug:'anapolis-go',fromCitySlug:'silvania-go'});
  assert.equal(cityChange.status,202);assert.equal(cityChange.body.accepted,true);

  const visit=await post('/api/multiversal/event',{kind:'place-visit',citySlug:'anapolis-go',realmSlug:'mercado',placeSlug:'mercado',placeType:'realm'});
  assert.equal(visit.status,202);assert.equal(visit.body.accepted,true);

  const transition=await post('/api/multiversal/transition',{citySlug:'anapolis-go',fromRealm:'vitriny-social',toRealm:'mercado',sourcePath:'/cidade-multiversal-3d.html?cidade=anapolis-go'});
  assert.equal(transition.status,201);assert.equal(transition.body.neuralCapture,true);

  const db=new Database(path.join(dataDir,'vitrinecity.db'),{readonly:true});
  const events=db.prepare(`SELECT type,source,entity_type entityType,entity_id entityId,payload_json payloadJson
    FROM neural_events WHERE source='multiversal' ORDER BY id`).all().map(row=>({...row,payload:JSON.parse(row.payloadJson)}));
  db.close();
  assert.equal(events.length,4);
  assert.deepEqual(events.map(event=>event.type),['multiversal.enter','multiversal.city-change','multiversal.place-visit','multiversal.realm-transition']);
  assert.ok(events.every(event=>event.source==='multiversal'));
  assert.equal(events[1].payload.fromCitySlug,'silvania-go');
  assert.equal(events[1].payload.toCitySlug,'anapolis-go');
  assert.equal(events[3].payload.fromRealm,'vitriny-social');
  assert.equal(events[3].payload.toRealm,'mercado');
  assert.equal('sourcePath' in events[3].payload,false);
  assert.equal('actorHash' in events[3].payload,false);

  console.log(JSON.stringify({ok:true,events:events.map(({type,entityType,entityId})=>({type,entityType,entityId}))}));
}finally{
  if(child.exitCode===null)child.kill('SIGTERM');
  await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,1500))]);
  if(child.exitCode===null)child.kill('SIGKILL');
  rmSync(dataDir,{recursive:true,force:true});
}
