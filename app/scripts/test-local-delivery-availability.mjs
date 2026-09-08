// Complete HTTP server, temporary fixture database and no production credentials.
// Outbound fetch is disabled, including Google Routes and payment providers.
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import Database from 'better-sqlite3';

const endpoint='/api/marketplace/local-delivery/availability';
const routeFixture='test-only-routes-key-never-sent';
const publicCities=[{city:'Anápolis',state:'GO'},{city:'Silvânia',state:'GO'}];
for(const routesConfigured of [false,true]){
  const dataDir=mkdtempSync(path.join(tmpdir(),'vitriny-delivery-availability-'));
  const port=43000+Math.floor(Math.random()*1000),origin=`http://127.0.0.1:${port}`;
  const guard=path.join(dataDir,'outbound-guard.mjs');
  writeFileSync(guard,"globalThis.fetch=async()=>{throw Error('External fetch disabled in isolated availability test')};");
  const env=Object.fromEntries(['PATH','SystemRoot','WINDIR','TEMP','TMP'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
  Object.assign(env,{DATA_DIR:dataDir,PORT:String(port),SITE_URL:origin});
  if(routesConfigured)env.GOOGLE_MAPS_ROUTES_API_KEY=routeFixture;
  const child=spawn(process.execPath,['--import',pathToFileURL(guard).href,'server.js'],{cwd:new URL('..',import.meta.url),env,stdio:['ignore','pipe','pipe']});
  let output='',db;
  child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
  const request=(pathname=endpoint,options={})=>fetch(origin+pathname,{...options,redirect:'manual'});
  try{
    let ready=false;
    for(let attempt=0;attempt<100;attempt++){
      try{if((await request('/api/health')).ok){ready=true;break;}}catch{}
      if(child.exitCode!==null)break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.ok(ready,output.slice(-2500));
    db=new Database(path.join(dataDir,'vitrinecity.db'));
    assert.deepEqual(await (await request()).json(),{enabled:false,cities:[]});
    db.exec(`INSERT INTO local_delivery_cities(city,state,active) VALUES ('Silvânia','GO',1),('Anápolis','GO',1),('Goiânia','GO',0);
      INSERT INTO local_delivery_couriers(name,whatsapp,city,state,status,password_hash)
      VALUES ('PRIVATE_COURIER_FIXTURE','PRIVATE_CONTACT_FIXTURE','Silvânia','GO','active','PRIVATE_HASH_FIXTURE');`);
    for(const enabled of [false,true]){
      db.prepare('UPDATE local_delivery_settings SET enabled=?,base_fee_cents=98765,platform_commission_bps=1234 WHERE id=1').run(Number(enabled));
      const snapshot=()=>JSON.stringify(['local_delivery_settings','local_delivery_cities','local_delivery_couriers','local_delivery_jobs','local_delivery_offers','courier_applications'].map(table=>db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()));
      const before=snapshot();
      const response=await request(endpoint+'?city=Goiânia&include=secrets');
      assert.equal(response.status,200,'No visitor session is required to inspect service coverage');
      assert.equal(response.headers.get('cache-control'),'no-store');
      assert.match(response.headers.get('content-type'),/^application\/json/);
      const body=await response.text();
      assert.deepEqual(JSON.parse(body),{enabled:enabled&&routesConfigured,cities:publicCities},'Only enabled capability and active city/state pairs are public');
      for(const privateValue of [routeFixture,'PRIVATE_COURIER_FIXTURE','PRIVATE_CONTACT_FIXTURE','PRIVATE_HASH_FIXTURE','98765','1234','routesConfigured','baseFee','couriers'])assert.equal(body.includes(privateValue),false,privateValue);
      const head=await request(endpoint,{method:'HEAD'});
      assert.equal(head.status,200);assert.equal(head.headers.get('cache-control'),'no-store');assert.equal(await head.text(),'');
      assert.equal((await request(endpoint,{method:'POST'})).status,404,'The capability endpoint cannot change settings');
      assert.equal(snapshot(),before,'Public reads and unsupported methods cannot mutate operational tables');
    }
    assert.equal((await request('/api/admin/local-delivery')).status,401,'Detailed operational data remains private');
  }finally{
    db?.close();
    if(child.exitCode===null&&child.signalCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}
    const resolved=path.resolve(dataDir);
    if(path.dirname(resolved)===path.resolve(tmpdir())&&path.basename(resolved).startsWith('vitriny-delivery-availability-'))rmSync(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
}
console.log('local-delivery-availability: public capability, active cities, no sensitive fields, no mutations and configuration gating passed');
