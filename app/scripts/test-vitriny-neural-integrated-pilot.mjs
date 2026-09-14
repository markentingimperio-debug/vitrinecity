import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import Database from 'better-sqlite3';
import {createVitrinyNeuralService} from '../vitriny-neural/service.js';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');

test('integrated service preserves supervisor and adds tasks, credits and diagnostics without activation',async()=>{
  const db=new Database(':memory:');let requests=0;
  try{
    const service=createVitrinyNeuralService({db,env:{},providers:[],fetchImpl:async()=>{requests++;throw Error('Unexpected network');}});
    const status=service.status();
    assert.equal(status.service.enabled,false);
    assert.equal(service.billing.enabled,false);
    assert.equal(status.tasks.enabled,false);
    assert.equal(status.supervisor.enabled,false);
    assert.equal(typeof service.supervisor.tick,'function');
    assert.equal(typeof service.tasks.submit,'function');
    assert.equal(typeof service.taskDiagnostics.check,'function');
    const diagnostic=await service.taskDiagnostics.check();
    assert.equal(diagnostic.noInference,true);
    assert.equal(diagnostic.readyForTaskAttempt,false);
    assert.equal(requests,0);
  }finally{db.close();}
});

test('merged console and boot share the existing Jarvis instance and retain both operator panels',()=>{
  const html=read('../public/admin-vitriny-neural.html'),server=read('../server.js');
  for(const id of ['supervisor-panel','supervisor-title','model-preflight','model-preflight-result']){
    assert.equal([...html.matchAll(new RegExp(`id="${id}"`,'g'))].length,1,id);
  }
  assert.match(server,/const jarvisCore\s*=\s*mountJarvis\(/);
  assert.match(server,/mountNeuralTasksApi\(\{app,tasks:jarvisCore\.neural\?\.service\?\.tasks/);
  assert.match(server,/mountNeuralBillingApi\(\{app,billing:jarvisCore\.neural\?\.service\?\.billing/);
  assert.doesNotMatch(server,/platformJarvis/);
});

test('deployable image includes the explicit opt-in acceptance runner',()=>{
  const docker=read('../Dockerfile');
  assert.match(docker,/COPY scripts\/run-vitriny-neural-task-acceptance\.mjs \.\/scripts\/run-vitriny-neural-task-acceptance\.mjs/);
  assert.doesNotMatch(docker,/RUN[^\n]*(?:acceptance:neural|--run-local)/);
});
