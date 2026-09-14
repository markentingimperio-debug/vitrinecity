import assert from 'node:assert/strict';
import {test} from 'node:test';
import Database from 'better-sqlite3';
import {createVitrinyNeuralService} from '../vitriny-neural/service.js';
import {createOpenAICompatibleProvider} from '../vitriny-neural/providers/openai-compatible.js';

const report={score:.99,categories:Object.fromEntries(['safety','code','research','growth','commerce','support','ranking'].map(key=>[key,{score:.99}]))};
function fixture({respond,env={},qualified=true,now,db=new Database(':memory:')}={}) {
  const calls=[];
  const provider={id:'task-local',modelName:'test-local-v1',local:true,priority:10,capabilities:['code.plan','growth.content-plan'],
    invoke:async request=>{calls.push(request);return {text:typeof respond==='function'?await respond(request,calls.length):JSON.stringify(respond),model:'test-local-v1',usage:{prompt_tokens:10,completion_tokens:5}};}};
  const service=createVitrinyNeuralService({db,providers:[provider],now,env:{VITRINY_NEURAL_ENABLED:'1',VITRINY_NEURAL_MODE:'advisory',VITRINY_NEURAL_TASKS_ENABLED:'1',VITRINY_NEURAL_TASKS_STORES:'shop-a,shop-b',...env}});
  if(qualified)service.recordQualification({providerId:provider.id,modelName:provider.modelName,suite:'fixture-only',report});
  return {db,calls,service,tasks:service.tasks};
}
const submit=(tasks,scope='store:shop-a',key='request-test-0001',instruction='Crie um site para minha loja de jardinagem.')=>tasks.submit(scope,{instruction,idempotencyKey:key});
const scripted=actions=>(_request,n)=>JSON.stringify(actions[n-1]);

test('adaptador HTTP recebe contrato confiável e completa ciclo de arquivos sem rede real',async()=>{
  const db=new Database(':memory:'),requests=[];
  const actions=[{tool:'route',kind:'website',message:'Rascunho.'},{tool:'files.write',path:'index.html',content:'<!doctype html><h1>Loja teste</h1>'},{tool:'finish',message:'Revisar antes de publicar.'}];
  const provider=createOpenAICompatibleProvider({id:'adapter-local',baseUrl:'http://fixture.invalid',model:'fixture-v1',local:true,
    fetchImpl:async(url,init)=>{
      const body=JSON.parse(init.body);requests.push(body);
      assert.equal(url,'http://fixture.invalid/v1/chat/completions');
      assert.match(body.messages[0].content,/Contrato interno de tarefas/);
      assert.equal(body.max_tokens,1200);
      assert.equal(init.signal.aborted,false);
      return new Response(JSON.stringify({model:'fixture-v1',choices:[{message:{content:JSON.stringify(actions[requests.length-1])}}]}),{status:200,headers:{'content-type':'application/json'}});
    }});
  const service=createVitrinyNeuralService({db,providers:[provider],env:{VITRINY_NEURAL_ENABLED:'1',VITRINY_NEURAL_MODE:'advisory',VITRINY_NEURAL_TASKS_ENABLED:'1'}});
  try{
    service.recordQualification({providerId:provider.id,modelName:provider.modelName,report});
    const item=submit(service.tasks,'admin');service.tasks.start('admin',item.id);await service.tasks.wait(item.id);
    assert.equal(service.tasks.get('admin',item.id).status,'draft_ready');
    assert.equal(requests.length,3);
    assert.equal(JSON.parse(requests[0].messages[1].content).kind,'route_required');
    assert.equal(JSON.parse(requests[2].messages[1].content).draftFiles[0].path,'index.html');
  }finally{db.close();}
});

test('comando único roteia, cria versões e entrega site como rascunho revisável',async()=>{
  const f=fixture({respond:scripted([
    {tool:'route',kind:'website',message:'Vou preparar os arquivos do site.'},
    {tool:'files.write',path:'index.html',content:'<!doctype html><h1>Loja</h1>'},
    {tool:'files.read',path:'index.html'},
    {tool:'files.write',path:'index.html',content:'<!doctype html><h1>Jardinagem</h1>'},
    {tool:'finish',message:'Rascunho do site pronto para revisão; não publicado.'}
  ])});
  try{
    const item=submit(f.tasks);f.tasks.start('store:shop-a',item.id);await f.tasks.wait(item.id);
    const done=f.tasks.get('store:shop-a',item.id);
    assert.equal(done.status,'draft_ready');assert.equal(done.kind,'website');assert.equal(done.requiresReview,true);
    assert.equal(done.files[0].revision,2);assert.equal(done.stepCount,5);assert.equal(done.usage.inputTokens,50);
    assert.match(f.tasks.readFile('store:shop-a',item.id,'index.html').content,/Jardinagem/);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM neural_task_files').get().n,2);
    assert.equal(f.calls[0].input.kind,'route_required');
    assert.equal(f.tasks.start('store:shop-a',item.id).status,'draft_ready');assert.equal(f.calls.length,5);
  }finally{f.db.close();}
});
test('roteiro muda capacidade automaticamente; imagem indisponível não vira sucesso',async()=>{
  const content=fixture({respond:scripted([{tool:'route',kind:'content',message:'Preparar roteiro.'},{tool:'finish',message:'Cena 1: mostre o produto. Confira as informações antes de publicar.'}])});
  try{const item=submit(content.tasks);content.tasks.start('store:shop-a',item.id);await content.tasks.wait(item.id);
    assert.deepEqual(content.calls.map(call=>call.capability),['code.plan','growth.content-plan']);
    assert.equal(content.tasks.get('store:shop-a',item.id).status,'draft_ready');
  }finally{content.db.close();}
  const image=fixture({respond:{tool:'route',kind:'unsupported',message:'Gerador de imagens não conectado; nenhuma imagem foi gerada.'}});
  try{const item=submit(image.tasks,'admin','request-image-001','Quero uma imagem de cachorro.');image.tasks.start('admin',item.id);await image.tasks.wait(item.id);
    assert.equal(image.tasks.get('admin',item.id).status,'blocked');assert.equal(image.tasks.get('admin',item.id).errorCode,'task_tool_unavailable');
  }finally{image.db.close();}
});
test('loja B não lê tarefa, arquivo ou cancela tarefa de A; scope vem do servidor',async()=>{
  const f=fixture({respond:scripted([{tool:'route',kind:'website',message:'Site.'},{tool:'files.write',path:'index.html',content:'Segredo comercial A'},{tool:'finish',message:'Rascunho.'}])});
  try{const item=submit(f.tasks);f.tasks.start('store:shop-a',item.id);await f.tasks.wait(item.id);
    for(const action of [()=>f.tasks.get('store:shop-b',item.id),()=>f.tasks.readFile('store:shop-b',item.id,'index.html'),()=>f.tasks.cancel('store:shop-b',item.id),()=>f.tasks.start('store:shop-b',item.id)])assert.throws(action,{code:'task_not_found'});
    assert.deepEqual(f.tasks.list('store:shop-b'),[]);
    assert.throws(()=>f.tasks.submit('admin',{instruction:'Teste',idempotencyKey:'request-override',scope:'store:shop-a'}),{code:'task_input_invalid'});
    assert.throws(()=>submit(f.tasks,'store:not-enrolled'),{code:'task_scope_denied'});
  }finally{f.db.close();}
});
test('piloto desligado, shadow, falta de benchmark ou outro modelo bloqueiam execução',()=>{
  for(const env of [{VITRINY_NEURAL_TASKS_ENABLED:'0'},{VITRINY_NEURAL_MODE:'shadow'},{VITRINY_NEURAL_ENABLED:'0'}]){
    const f=fixture({env});try{assert.throws(()=>submit(f.tasks),{code:'task_disabled'});}finally{f.db.close();}
  }
  const f=fixture({qualified:false});try{
    const item=submit(f.tasks);assert.throws(()=>f.tasks.start('store:shop-a',item.id),{code:'task_provider_unqualified'});
    f.service.recordQualification({providerId:'task-local',modelName:'other-model',report});
    assert.throws(()=>f.tasks.start('store:shop-a',item.id),{code:'task_provider_unqualified'});
    assert.equal(f.calls.length,0);
  }finally{f.db.close();}
});
test('idempotência não cria consumo duplicado e cotas são por loja',()=>{
  const f=fixture({env:{VITRINY_NEURAL_TASKS_DAILY:'1'}});try{
    const item=submit(f.tasks);assert.equal(submit(f.tasks).id,item.id);assert.equal(submit(f.tasks).duplicate,true);
    assert.throws(()=>submit(f.tasks,'store:shop-a','request-test-0001','Outro pedido.'),{code:'task_conflict'});
    assert.throws(()=>submit(f.tasks,'store:shop-a','request-test-0002'),{code:'task_quota_exhausted'});
    assert.ok(submit(f.tasks,'store:shop-b').id);assert.equal(f.tasks.status('store:shop-a').usage.remaining,0);
  }finally{f.db.close();}
});
test('backlog respeita cota diária de execução, com start idempotente sem novo consumo',async()=>{
  let clock=Date.parse('2026-09-13T12:00:00Z');
  const f=fixture({now:()=>clock,env:{VITRINY_NEURAL_TASKS_DAILY:'2'},respond:{tool:'route',kind:'unsupported',message:'Ferramenta indisponível.'}});
  try{
    const backlog=[submit(f.tasks,'store:shop-a','backlog-test-0001'),submit(f.tasks,'store:shop-a','backlog-test-0002')];
    clock+=24*60*60*1000;
    const today=submit(f.tasks,'store:shop-a','backlog-test-0003');
    for(const item of backlog){
      f.tasks.start('store:shop-a',item.id);
      const charged=f.tasks.status('store:shop-a').usage.dailyRuns;
      assert.equal(f.tasks.start('store:shop-a',item.id).status,'running');
      assert.equal(f.tasks.status('store:shop-a').usage.dailyRuns,charged);
      await f.tasks.wait(item.id);
    }
    assert.deepEqual(f.tasks.status('store:shop-a').usage,{dailyTasks:1,remaining:1,dailyRuns:2,remainingRuns:0});
    assert.throws(()=>f.tasks.start('store:shop-a',today.id),{code:'task_quota_exhausted'});
    assert.equal(f.tasks.get('store:shop-a',today.id).status,'queued');
    assert.equal(f.tasks.start('store:shop-a',backlog[0].id).status,'blocked');
    assert.equal(f.tasks.status('store:shop-a').usage.dailyRuns,2);
    const otherStore=submit(f.tasks,'store:shop-b','backlog-test-0001');
    f.tasks.start('store:shop-b',otherStore.id);await f.tasks.wait(otherStore.id);
    assert.equal(f.tasks.status('store:shop-b').usage.dailyRuns,1);
    clock+=24*60*60*1000;
    f.tasks.start('store:shop-a',today.id);await f.tasks.wait(today.id);
    assert.deepEqual(f.tasks.status('store:shop-a').usage,{dailyTasks:0,remaining:2,dailyRuns:1,remainingRuns:1});
  }finally{f.db.close();}
});
test('cota global de execução inclui backlog de várias lojas e dias',async()=>{
  let clock=Date.parse('2026-09-12T12:00:00Z');
  const f=fixture({now:()=>clock,env:{VITRINY_NEURAL_TASKS_DAILY:'100'},respond:{tool:'route',kind:'unsupported',message:'Ferramenta indisponível.'}});
  try{
    const backlog=[];
    for(let index=0;index<100;index++){
      const scope=index%2?'store:shop-a':'store:shop-b';
      backlog.push({scope,item:submit(f.tasks,scope,`global-backlog-${index}`)});
    }
    clock+=24*60*60*1000;
    const overflow=submit(f.tasks,'admin','global-overflow-001');
    clock+=24*60*60*1000;
    for(const {scope,item} of backlog){f.tasks.start(scope,item.id);await f.tasks.wait(item.id);}
    assert.equal(f.tasks.status('store:shop-a').usage.dailyRuns,50);
    assert.equal(f.tasks.status('store:shop-b').usage.dailyRuns,50);
    assert.equal(f.tasks.status('admin').usage.dailyRuns,0);
    assert.throws(()=>f.tasks.start('admin',overflow.id),{code:'task_quota_exhausted'});
    assert.equal(f.tasks.get('admin',overflow.id).status,'queued');
    assert.equal(f.calls.length,100);
  }finally{f.db.close();}
});
test('cancelamento e falha não devolvem a cota de execução reservada',async()=>{
  for(const cancelled of [true,false]){
    let clock=Date.parse('2026-09-13T12:00:00Z');
    const f=fixture({now:()=>clock,env:{VITRINY_NEURAL_TASKS_DAILY:'1'},respond:{tool:'shell',command:'unsupported'}});
    try{
      const first=submit(f.tasks);clock+=24*60*60*1000;
      const next=submit(f.tasks,'store:shop-a','run-quota-next-001');
      f.tasks.start('store:shop-a',first.id);
      if(cancelled)f.tasks.cancel('store:shop-a',first.id);
      await f.tasks.wait(first.id);
      assert.equal(f.tasks.get('store:shop-a',first.id).status,cancelled?'cancelled':'failed');
      assert.equal(f.tasks.status('store:shop-a').usage.dailyRuns,1);
      assert.equal(f.tasks.status('store:shop-a').usage.remainingRuns,0);
      assert.throws(()=>f.tasks.start('store:shop-a',next.id),{code:'task_quota_exhausted'});
      assert.equal(f.db.prepare('SELECT started_at FROM neural_tasks WHERE id=?').get(next.id).started_at,null);
    }finally{f.db.close();}
  }
});
test('migração started_at preserva registros legados e é idempotente',()=>{
  const db=new Database(':memory:'),clock=Date.parse('2026-09-14T12:00:00Z');
  db.exec(`CREATE TABLE neural_tasks (
    id TEXT PRIMARY KEY, scope TEXT NOT NULL, idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL,
    instruction TEXT NOT NULL, kind TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'queued',
    step_count INTEGER NOT NULL DEFAULT 0, result_text TEXT NOT NULL DEFAULT '', error_code TEXT NOT NULL DEFAULT '',
    lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, UNIQUE(scope,idempotency_key));`);
  const insert=db.prepare('INSERT INTO neural_tasks(id,scope,idempotency_key,request_hash,instruction,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)');
  insert.run('00000000-0000-4000-8000-000000000001','store:shop-a','legacy-queued-001','legacy-hash','Pedido legado pendente.','queued',clock-86400000,clock-86400000);
  insert.run('00000000-0000-4000-8000-000000000002','store:shop-a','legacy-failed-001','legacy-hash','Pedido legado executado.','failed',clock-86400000,clock);
  try{
    const first=fixture({db,now:()=>clock});
    assert.equal(db.prepare('SELECT started_at FROM neural_tasks WHERE id=?').get('00000000-0000-4000-8000-000000000001').started_at,null);
    assert.equal(db.prepare('SELECT started_at FROM neural_tasks WHERE id=?').get('00000000-0000-4000-8000-000000000002').started_at,clock);
    assert.equal(first.tasks.status('store:shop-a').usage.dailyRuns,1);
    const restarted=fixture({db,now:()=>clock});
    assert.equal(restarted.tasks.status('store:shop-a').usage.dailyRuns,1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM neural_tasks').get().n,2);
    assert.equal(db.prepare('PRAGMA table_info(neural_tasks)').all().filter(column=>column.name==='started_at').length,1);
  }finally{db.close();}
});
test('ferramenta arbitrária, path traversal, segredos e falsa conclusão são rejeitados',async()=>{
  for(const [action,code] of [
    [{tool:'shell',command:'whoami'},'task_tool_unavailable'],
    [{tool:'files.write',path:'../server.js',content:'alteração'},'task_file_invalid'],
    [{tool:'files.write',path:'.env',content:'alteração'},'task_file_invalid'],
    [{tool:'files.write',path:'x.js',content:'ghp_ABCDEFGHIJK1234567890'},'task_input_invalid'],
    [{tool:'files.write',path:'x.js',content:'a'.repeat(33000)},'task_input_invalid'],
    [{tool:'finish',message:'Site publicado.'},'task_artifact_missing']
  ]){
    const f=fixture({respond:scripted([{tool:'route',kind:'website',message:'Site.'},action])});try{
      const item=submit(f.tasks);f.tasks.start('store:shop-a',item.id);await f.tasks.wait(item.id);
      assert.equal(f.tasks.get('store:shop-a',item.id).status,'failed');assert.equal(f.tasks.get('store:shop-a',item.id).errorCode,code);
      assert.equal(f.db.prepare('SELECT COUNT(*) n FROM neural_task_files').get().n,0);
    }finally{f.db.close();}
  }
});
test('concorrência por loja, cancelamento e resposta tardia não gravam arquivos',async()=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const f=fixture({respond:async()=>{await gate;return JSON.stringify({tool:'route',kind:'website',message:'Site.'});}});
  try{
    const item=submit(f.tasks),other=submit(f.tasks,'store:shop-a','request-other-001');
    f.tasks.start('store:shop-a',item.id);assert.equal(f.tasks.start('store:shop-a',item.id).status,'running');
    assert.throws(()=>f.tasks.start('store:shop-a',other.id),{code:'task_busy'});
    await new Promise(resolve=>setImmediate(resolve));
    f.tasks.cancel('store:shop-a',item.id);
    assert.equal(f.calls[0].signal.aborted,true);
    assert.throws(()=>f.tasks.start('store:shop-a',other.id),{code:'task_busy'});
    release();await f.tasks.wait(item.id);
    assert.equal(f.tasks.get('store:shop-a',item.id).status,'cancelled');assert.equal(f.calls.length,1);
    assert.equal(f.tasks.get('store:shop-a',item.id).events.length,0);
  }finally{release();await Promise.all([]);f.db.close();}
});
test('timeout da tarefa aborta inferência e não inicia outro modelo local',async()=>{
  let backupCalls=0;
  const f=fixture({env:{VITRINY_NEURAL_TASKS_TIMEOUT_MS:'1000'},respond:request=>new Promise((_,reject)=>request.signal.addEventListener('abort',()=>reject(request.signal.reason),{once:true}))});
  try{
    f.service.runtime.skills.registerProvider({id:'backup-local',modelName:'backup-v1',local:true,priority:90,capabilities:['code.plan'],invoke:async()=>{backupCalls++;return {text:'backup'};}});
    f.service.recordQualification({providerId:'backup-local',modelName:'backup-v1',report});
    const item=submit(f.tasks);f.tasks.start('store:shop-a',item.id);await f.tasks.wait(item.id);
    assert.equal(f.tasks.get('store:shop-a',item.id).errorCode,'task_timeout');assert.equal(backupCalls,0);assert.equal(f.calls.length,1);
  }finally{f.db.close();}
});
test('lease expirado é interrompido e nunca reinicia automaticamente',async()=>{
  let clock=Date.now(),release;const gate=new Promise(resolve=>{release=resolve;});
  const f=fixture({now:()=>clock,respond:async()=>{await gate;return JSON.stringify({tool:'route',kind:'website',message:'Site.'});}});
  try{const item=submit(f.tasks);f.tasks.start('store:shop-a',item.id);await new Promise(resolve=>setImmediate(resolve));
    clock+=121000;assert.equal(f.tasks.get('store:shop-a',item.id).status,'interrupted');release();await f.tasks.wait(item.id);
    assert.equal(f.tasks.start('store:shop-a',item.id).status,'interrupted');assert.equal(f.calls.length,1);
  }finally{release();f.db.close();}
});
test('loop limitado e erro remoto não vazam prompt/credencial nem fazem fallback pago',async()=>{
  const loop=fixture({respond:(_request,n)=>JSON.stringify(n===1?{tool:'route',kind:'website',message:'Site.'}:{tool:'files.list'})});
  try{const item=submit(loop.tasks);loop.tasks.start('store:shop-a',item.id);await loop.tasks.wait(item.id);
    assert.equal(loop.tasks.get('store:shop-a',item.id).errorCode,'task_step_limit');assert.equal(loop.calls.length,8);
  }finally{loop.db.close();}
  let remoteCalls=0;
  const broken=fixture({respond:()=>{throw Error('secret-provider-response ghp_ABCDEFGHIJK1234567890');}});
  try{
    broken.service.runtime.skills.registerProvider({id:'paid-remote',modelName:'paid-v1',local:false,capabilities:['code.plan'],invoke:async()=>{remoteCalls++;return {text:'paid'};}});
    broken.service.recordQualification({providerId:'paid-remote',modelName:'paid-v1',report});
    const item=submit(broken.tasks);broken.tasks.start('store:shop-a',item.id);await broken.tasks.wait(item.id);
    assert.equal(remoteCalls,0);assert.equal(broken.tasks.get('store:shop-a',item.id).errorCode,'task_provider_failed');
    assert.doesNotMatch(JSON.stringify(broken.tasks.get('store:shop-a',item.id)),/secret-provider|ghp_/);
  }finally{broken.db.close();}
});
