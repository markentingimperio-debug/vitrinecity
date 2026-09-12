import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import Database from 'better-sqlite3';
import {generateManualMediaImage,manualImageFailureMessage} from '../manual-image-generation.js';
import {mediaJobPolicy} from '../media-job-policy.js';
import {createHash} from 'node:crypto';

const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const routeSource=server.slice(server.indexOf("app.post('/api/admin/media-projects/:id/generate'"),server.indexOf("app.post('/api/admin/media-projects/:id/sync'"));
const config={provider:'openai',imageConfigured:true,imageModel:'gpt-image-2',imageOptions:['gpt-image-2']};
// The shared raster parser validates the provider's PNG signature and dimensions.
const png=Buffer.alloc(32);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.write('IHDR',12);png.writeUInt32BE(1024,16);png.writeUInt32BE(1024,20);
const image=()=>({provider:'openai',data:{data:[{b64_json:png.toString('base64')}],usage:{cost:0.02}}});
function fixture(t,request=image){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'manual-image-qa-')),dbPath=path.join(directory,'fixture.sqlite');
  let db=new Database(dbPath);const outputDir=path.join(directory,'output');let calls=0,allowed=true;
  db.exec(`CREATE TABLE admin_agent_tasks(id INTEGER PRIMARY KEY,status TEXT,title TEXT,instructions TEXT,updated_at TEXT);INSERT INTO admin_agent_tasks VALUES(1,'in_progress','Imagem de plantas','Texto original',CURRENT_TIMESTAMP);
    CREATE TABLE admin_media_projects(id INTEGER PRIMARY KEY,task_id INTEGER,format TEXT,image_provider TEXT,model TEXT,prompt TEXT,aspect_ratio TEXT,production_status TEXT,progress INTEGER,output_url TEXT,usage_cost_usd REAL,error_message TEXT,updated_at TEXT,caption TEXT,channels TEXT,source_notes TEXT,script TEXT,remote_job_id TEXT,polling_url TEXT);
    INSERT INTO admin_media_projects VALUES(1,1,'image','openai','gpt-image-2','Plantas em vasos','1:1','briefing',5,'',0,'',CURRENT_TIMESTAMP,'Legenda','VitrineSocial','fonte','roteiro','','');`);
  t.after(()=>{db.close();const resolved=path.resolve(directory);assert(resolved.startsWith(path.resolve(os.tmpdir())+path.sep+'manual-image-qa-'));fs.rmSync(resolved,{recursive:true,force:true});});
  const project=()=>db.prepare('SELECT * FROM admin_media_projects WHERE id=1').get();
  const receipt=()=>db.prepare('SELECT * FROM manual_image_generation_attempts WHERE project_id=1').get();
  const requestImage=async input=>{calls++;assert.equal(project().production_status,'editing');assert.equal(receipt().state,'submitting');return request(input);};
  const direct=(snapshot=project())=>generateManualMediaImage({db,project:snapshot,config,outputDir,requestImage,canRun:()=>allowed});
  const route=async()=>{
    let handler;const guard=()=>{};
    const context=vm.createContext({db,AI_MEDIA_CONFIG:config,mediaJobPolicy,generateManualMediaImage,manualImageFailureMessage,generatedMediaDir:outputDir,aiMediaClient:{requestImage},ecosystemCanRun:()=>allowed,mediaFactoryProject:()=>project(),requireAdmin:guard,requireEcosystemRunning:guard,app:{post:(_path,...handlers)=>{handler=handlers.at(-1);}}});
    vm.runInContext(routeSource,context);const response={code:200,body:null,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
    await handler({params:{id:'1'},user:{id:4}},response);return response;
  };
  return {get db(){return db;},project,receipt,direct,route,outputDir,get calls(){return calls;},pause(){allowed=false;},restart(){db.close();db=new Database(dbPath);}};
}

test('actual image route atomically claims one request during concurrent clicks and keeps receipt',async t=>{
  let release;const gate=new Promise(resolve=>{release=resolve;}),f=fixture(t,()=>gate);
  const first=f.route();assert.equal(f.calls,1);assert.equal((await f.route()).code,409);assert.equal(f.calls,1);
  release(image());assert.equal((await first).code,200);assert.equal(f.project().production_status,'review');assert.equal(f.receipt().state,'completed');
  assert.equal(f.db.prepare('SELECT status FROM admin_agent_tasks').get().status,'awaiting_approval');assert.equal(f.receipt().usage_cost_usd,0.02);
  assert.equal(f.receipt().sha256,createHash('sha256').update(png).digest('hex'));assert.deepEqual(fs.readFileSync(path.join(f.outputDir,path.basename(f.receipt().output_url))),png);
  assert.equal((await f.route()).code,409);assert.equal(f.calls,1);
});
test('independent stale snapshots cannot bypass the durable project reservation',async t=>{
  let release;const gate=new Promise(resolve=>{release=resolve;}),f=fixture(t,()=>gate),snapshot=f.project();
  const first=f.direct(snapshot);await assert.rejects(f.direct(snapshot),{code:'manual_image_already_started'});release(image());await first;assert.equal(f.calls,1);
});
test('timeout survives database reopen and a reset UI state without another paid request',async t=>{
  const f=fixture(t,()=>{throw Object.assign(Error('SECRET-provider-timeout'),{status:504});});
  assert.equal((await f.route()).code,504);assert.equal(f.receipt().state,'unknown');assert.equal(f.project().production_status,'editing');
  assert.doesNotMatch(f.project().error_message,/SECRET/);f.restart();f.db.exec("UPDATE admin_media_projects SET production_status='assets'");
  assert.equal((await f.route()).code,409);assert.equal(f.calls,1);assert.equal(f.receipt().state,'unknown');
});
test('an interrupted submitting reservation is never released on restart',async t=>{
  const f=fixture(t,()=>{throw Error('interrupted');});await f.route();f.db.exec("UPDATE manual_image_generation_attempts SET state='submitting',error_code=NULL");f.restart();
  const before=f.project();assert.equal((await f.route()).code,409);assert.deepEqual(f.project(),before);assert.equal(f.calls,1);
});
test('cancelled or modified projects retain received image separately without reopening task',async t=>{
  for(const sql of ["UPDATE admin_media_projects SET production_status='cancelled';UPDATE admin_agent_tasks SET status='cancelled'","UPDATE admin_media_projects SET prompt='Novo texto',production_status='script'","UPDATE admin_media_projects SET image_provider='openrouter'","UPDATE admin_agent_tasks SET title='Título alterado'","UPDATE admin_agent_tasks SET status='completed'"]){
    let release;const gate=new Promise(resolve=>{release=resolve;}),f=fixture(t,()=>gate);const pending=f.route();f.db.exec(sql);
    const before=f.project(),task=f.db.prepare('SELECT * FROM admin_agent_tasks').get();release(image());assert.equal((await pending).code,409);
    assert.deepEqual(f.project(),before);assert.deepEqual(f.db.prepare('SELECT * FROM admin_agent_tasks').get(),task);assert.equal(f.receipt().state,'received');assert.equal(fs.existsSync(path.join(f.outputDir,path.basename(f.receipt().output_url))),true);assert.equal(f.calls,1);
  }
});
test('pause after submission retains the artifact without advancing approval',async t=>{
  let release;const gate=new Promise(resolve=>{release=resolve;}),f=fixture(t,()=>gate),pending=f.route();f.pause();release(image());assert.equal((await pending).code,409);
  assert.equal(f.project().production_status,'editing');assert.equal(f.receipt().state,'received');assert.equal(f.db.prepare('SELECT status FROM admin_agent_tasks').get().status,'in_progress');
});
test('stale project, cancelled task, existing output and unsupported options reject before provider',async t=>{
  for(const sql of ["UPDATE admin_media_projects SET prompt='Changed'","UPDATE admin_agent_tasks SET status='cancelled'","UPDATE admin_media_projects SET output_url='/uploads/existing.png'"]){
    const f=fixture(t),snapshot=f.project();f.db.exec(sql);await assert.rejects(f.direct(snapshot),{code:'manual_image_project_changed'});assert.equal(f.calls,0);
  }
  const f=fixture(t);await assert.rejects(f.direct({...f.project(),model:'unknown'}),{code:'manual_image_options_invalid'});assert.equal(f.calls,0);
});
test('wrong provider or malformed response stays uncertain and cannot be retried',async t=>{
  for(const result of [{...image(),provider:'other'},{provider:'openai',data:{data:[{b64_json:'invalid'}]}}]){
    const f=fixture(t,()=>result);assert.equal((await f.route()).code,502);assert.equal(f.receipt().state,'unknown');assert.equal((await f.route()).code,409);assert.equal(f.calls,1);assert.equal(fs.existsSync(f.outputDir),false);
  }
});
test('missing cost is retained as unknown rather than invented zero in the attempt receipt',async t=>{
  const f=fixture(t,()=>({provider:'openai',data:{data:image().data.data}}));assert.equal((await f.route()).code,200);assert.equal(f.receipt().usage_cost_usd,null);
});
