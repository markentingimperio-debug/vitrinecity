import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import Database from 'better-sqlite3';

const appDir=fileURLToPath(new URL('..',import.meta.url));
const serverPath=path.join(appDir,'multiversal-server.js');
const dataDir=mkdtempSync(path.join(tmpdir(),'vitrinecity-multiversal-'));
const port=43000+(process.pid%1000);
const base=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,[serverPath],{
  cwd:appDir,
  env:{...process.env,DATA_DIR:dataDir,PORT:String(port),MULTIVERSAL_PORT:String(port),NODE_ENV:'test'},
  stdio:['ignore','pipe','pipe']
});

let output='';
child.stdout.on('data',chunk=>{output+=chunk.toString();});
child.stderr.on('data',chunk=>{output+=chunk.toString();});

async function waitForHealth(){
  const deadline=Date.now()+8000;
  while(Date.now()<deadline){
    if(child.exitCode!==null)throw new Error(`Multiversal encerrou antes do healthcheck.\n${output}`);
    try{
      const response=await fetch(`${base}/api/multiversal/health`);
      if(response.ok)return response;
    }catch{}
    await new Promise(resolve=>setTimeout(resolve,80));
  }
  throw new Error(`Timeout aguardando Multiversal Core.\n${output}`);
}

async function json(pathname,options={}){
  const response=await fetch(base+pathname,options);
  const body=await response.json();
  return {response,body};
}

try{
  const health=await waitForHealth();
  assert.equal(health.headers.get('x-powered-by'),null);
  const healthBody=await health.json();
  assert.equal(healthBody.ok,true);
  assert.equal(healthBody.service,'vitrinecity-multiversal-core');

  const cities=await json('/api/multiversal/cities');
  assert.equal(cities.response.status,200);
  assert.equal(cities.body.defaultCity,'silvania-go');
  assert.deepEqual(cities.body.items.map(item=>item.slug),['silvania-go','anapolis-go','vianopolis-go']);
  assert.equal(cities.body.items[0].status,'pilot');

  const realms=await json('/api/multiversal/realms?cidade=vianopolis-go');
  assert.equal(realms.response.status,200);
  assert.equal(realms.body.city.slug,'vianopolis-go');
  assert.equal(realms.body.items.length,8);
  assert.ok(realms.body.items.every(item=>item.href.includes('cidade=vianopolis-go')));
  assert.ok(realms.body.items.every(item=>item.href.startsWith('/')));
  assert.ok(realms.body.items.every(item=>!item.href.startsWith('//')));
  assert.ok(realms.body.items.every(item=>item.entryPath.startsWith('/')));
  assert.ok(realms.body.items.every(item=>item.imagePath.startsWith('/')));
  assert.ok(realms.body.items.some(item=>item.slug==='vitriny-social'));
  assert.ok(realms.body.items.some(item=>item.slug==='mercado'));

  const fallback=await json('/api/multiversal/context?cidade=cidade-inexistente&universo=centro-25d');
  assert.equal(fallback.response.status,200);
  assert.equal(fallback.body.city.slug,'silvania-go');
  assert.equal(fallback.body.realm.slug,'centro-25d');
  assert.match(fallback.body.multiversalPath,/cidade=silvania-go/);

  const noOrigin=await json('/api/multiversal/transition',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({citySlug:'anapolis-go',toRealm:'mercado',sourcePath:'/multiversal.html'})
  });
  assert.equal(noOrigin.response.status,403);

  const invalidCity=await json('/api/multiversal/transition',{
    method:'POST',headers:{'Content-Type':'application/json',Origin:base},
    body:JSON.stringify({citySlug:'cidade-inexistente',toRealm:'mercado',sourcePath:'/multiversal.html'})
  });
  assert.equal(invalidCity.response.status,400);

  const invalidRealm=await json('/api/multiversal/transition',{
    method:'POST',headers:{'Content-Type':'application/json',Origin:base},
    body:JSON.stringify({citySlug:'anapolis-go',toRealm:'nao-existe',sourcePath:'/multiversal.html'})
  });
  assert.equal(invalidRealm.response.status,400);

  const crossOrigin=await json('/api/multiversal/transition',{
    method:'POST',headers:{'Content-Type':'application/json',Origin:'https://example.invalid'},
    body:JSON.stringify({citySlug:'anapolis-go',toRealm:'mercado',sourcePath:'/multiversal.html'})
  });
  assert.equal(crossOrigin.response.status,403);

  const transition=await json('/api/multiversal/transition',{
    method:'POST',headers:{'Content-Type':'application/json',Origin:base},
    body:JSON.stringify({citySlug:'anapolis-go',fromRealm:'vitriny-social',toRealm:'mercado',sourcePath:'/multiversal.html?cidade=anapolis-go'})
  });
  assert.equal(transition.response.status,201);
  assert.equal(transition.body.ok,true);
  assert.equal(transition.body.city.slug,'anapolis-go');
  assert.equal(transition.body.fromRealm,'vitriny-social');
  assert.equal(transition.body.toRealm,'mercado');
  assert.equal(transition.body.href,'/loja.html?cidade=anapolis-go');

  const db=new Database(path.join(dataDir,'vitrinecity.db'),{readonly:true});
  const saved=db.prepare(`SELECT city_slug citySlug,from_realm fromRealm,to_realm toRealm,source_path sourcePath
    FROM multiversal_transitions ORDER BY id DESC LIMIT 1`).get();
  db.close();
  assert.deepEqual(saved,{
    citySlug:'anapolis-go',
    fromRealm:'vitriny-social',
    toRealm:'mercado',
    sourcePath:'/multiversal.html?cidade=anapolis-go'
  });

  console.log(JSON.stringify({ok:true,cities:cities.body.items.length,realms:realms.body.items.length,transition:saved,originGuard:true,localPaths:true}));
} finally {
  if(child.exitCode===null)child.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve=>child.once('exit',resolve)),
    new Promise(resolve=>setTimeout(resolve,1500))
  ]);
  if(child.exitCode===null)child.kill('SIGKILL');
  rmSync(dataDir,{recursive:true,force:true});
}
