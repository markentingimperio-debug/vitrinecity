import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import Database from 'better-sqlite3';
import * as receipts from '../video-provider-receipts.js';
const {videoReceipt,videoPollingUrl,videoPollState,videoFailureMessage,videoDownloadTarget,downloadVideo}=receipts;
const job='job-abc123',poll=`https://openrouter.ai/api/v1/videos/${job}`,mp4=Buffer.from([0,0,0,20,102,116,121,112,105,115,111,109,0,0,0,0]);
test('accepts documented relative and absolute receipts, keeps exact job binding',()=>{
  for(const value of [poll,`/api/v1/videos/${job}`])assert.deepEqual(videoReceipt({id:job,polling_url:value}),{jobId:job,pollingUrl:poll});
  for(const value of ['//evil.com/x',poll+'?x=1',poll+'#hash',poll+'/content','https://openrouter.ai.evil.com/api/v1/videos/'+job,'https://user@openrouter.ai/api/v1/videos/'+job,'http://openrouter.ai/api/v1/videos/'+job,poll.replace(job,'other'),'/api/v1/videos/x/../'+job,'/api/v1/videos/%6aob-abc123'])assert.equal(videoPollingUrl(value,job),'',value);
  assert.deepEqual(videoReceipt({id:job,polling_url:'https://evil.com'}),{jobId:job,pollingUrl:''});
  assert.deepEqual(videoReceipt({id:{},polling_url:poll}),{jobId:'',pollingUrl:''});
});
test('poll binds ID and distinguishes in progress, completed and terminal expiration',()=>{
  assert.equal(videoPollState({id:job,status:'in_progress'},job),'processing');
  assert.equal(videoPollState({id:job,status:'completed'},job),'completed');
  for(const status of ['failed','cancelled','expired'])assert.throws(()=>videoPollState({id:job,status},job),new RegExp('video_job_'+status));
  assert.throws(()=>videoPollState({id:'other',status:'completed'},job),/mismatch/);
  assert.throws(()=>videoPollState({id:job,status:'unexpected'},job),/unknown/);
});
test('bearer is confined to the same job content endpoint, CDN receives none',()=>{
  assert.equal(videoDownloadTarget({unsigned_urls:['https://cdn.vendor.com/a.mp4?signature=public-signed-link']},job,'secret').headers.Authorization,undefined);
  assert.equal(videoDownloadTarget({},job,'secret').headers.Authorization,'Bearer secret');
  assert.equal(videoDownloadTarget({unsigned_urls:[`/api/v1/videos/${job}/content?index=0`]},job,'secret').headers.Authorization,'Bearer secret');
  for(const url of ['https://127.0.0.1/a','https://[::1]/a','http://cdn.vendor.com/a','https://cdn.vendor.com:444/a','https://user:secret@cdn.vendor.com/a','https://local/a','https://x.internal/a','https://openrouter.ai/api/v1/key',poll.replace(job,'other')+'/content',poll+'/content?redirect=https://evil.com'])assert.throws(()=>videoDownloadTarget({unsigned_urls:[url]},job,'secret'),/invalid/);
});
function transport({address='8.8.8.8',status=200,type='video/mp4',body=mp4,length,never=false}={}){
  const seen=[];
  const request=(url,options,callback)=>{
    const req=new EventEmitter();req.destroy=()=>{};seen.push({url,options});
    queueMicrotask(()=>options.lookup(new URL(url).hostname,{all:true},(error,addresses)=>{
      if(error){req.emit('error',error);return;}seen[0].addresses=addresses;if(never)return;
      const response=Readable.from([body]);response.statusCode=status;response.headers={'content-type':type,...(length===undefined?{}:{'content-length':String(length)})};callback(response);
    }));return req;
  };
  return {seen,request,lookupImpl:async()=>[{address,family:4}]};
}
test('downloads bounded MP4 through pinned DNS with no third-party authentication',async()=>{
  const t=transport();assert.deepEqual(await downloadVideo({unsigned_urls:['https://cdn.vendor.com/video.mp4']},job,{...t,apiKey:'secret'}),mp4);
  assert.equal(t.seen[0].options.headers.Authorization,undefined);assert.equal(t.seen[0].options.agent,false);assert.deepEqual(t.seen[0].addresses,[{address:'8.8.8.8',family:4}]);
});
test('blocks private DNS, redirects, invalid files, oversized and stalled responses',async()=>{
  for(const args of [{address:'127.0.0.1'},{address:'169.254.169.254'},{address:'10.0.0.1'},{status:302},{type:'text/html'},{body:Buffer.from('not a video')},{length:300000000},{body:Buffer.alloc(25)}]){
    const t=transport(args);await assert.rejects(downloadVideo({unsigned_urls:['https://cdn.vendor.com/video.mp4']},job,{...t,maxBytes:20,timeoutMs:100}),/video_download_/);assert.equal(t.seen.length,1);
  }
  await assert.rejects(downloadVideo({},job,{...transport({never:true}),apiKey:'secret',timeoutMs:5}),/timeout/);
});
test('diagnostics classify account and policy blocks without leaking raw provider payloads',()=>{
  assert.match(videoFailureMessage(Error('Inference is blocked on this account. secret=https://private.example/foo')),/conta/);
  assert.match(videoFailureMessage(Error('ZDR violation account secret=hidden')),/política/);
  assert.doesNotMatch(videoFailureMessage(Error('Bearer extremely-private-value https://private.example')),/private|Bearer/);
});
const server=readFileSync(new URL('../server.js',import.meta.url),'utf8');
function fixture(request,download=async()=>mp4){
  const db=new Database(':memory:');
  db.exec(`CREATE TABLE admin_viral_quizzes(id INTEGER PRIMARY KEY,status TEXT);
    INSERT INTO admin_viral_quizzes VALUES(1,'in_production');
    CREATE TABLE viral_quiz_scenes(id INTEGER PRIMARY KEY,quiz_id INTEGER DEFAULT 1,scene_number INTEGER DEFAULT 1,status TEXT DEFAULT 'pending',prompt TEXT DEFAULT 'safe',duration_seconds INTEGER DEFAULT 8,attempt_count INTEGER DEFAULT 0,remote_job_id TEXT DEFAULT '',polling_url TEXT DEFAULT '',model TEXT DEFAULT '',error_message TEXT DEFAULT '',local_path TEXT DEFAULT '',output_url TEXT DEFAULT '',updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE admin_media_projects(id INTEGER PRIMARY KEY,task_id INTEGER DEFAULT 1,format TEXT DEFAULT 'short_video',production_status TEXT DEFAULT 'script',progress INTEGER DEFAULT 0,remote_job_id TEXT DEFAULT '',polling_url TEXT DEFAULT '',error_message TEXT DEFAULT '',updated_at TEXT DEFAULT CURRENT_TIMESTAMP,model TEXT DEFAULT 'test',prompt TEXT DEFAULT 'safe',duration_seconds INTEGER DEFAULT 8,aspect_ratio TEXT DEFAULT '9:16',output_url TEXT DEFAULT '',usage_cost_usd REAL DEFAULT 0);
    CREATE TABLE admin_agent_tasks(id INTEGER PRIMARY KEY,status TEXT,updated_at TEXT);INSERT INTO admin_agent_tasks VALUES(1,'running','before');`);
  const routes=new Map(),calls=[],writes=[];
  const context=vm.createContext({...receipts,db,ecosystemCanRun:()=>true,aiConfigured:()=>true,AI_PROVIDER:'openrouter',AI_API_KEY:'test-key',OPENROUTER_VIDEO_MODEL:'test-model',MEDIA_VIDEO_MODELS:[],finishViralQuizVideo:async()=>{},openRouterRequest:async(url,options)=>{calls.push({url,options});return request(url,options);},downloadVideo:download,generatedMediaDir:'/tmp',fs:{writeFileSync:(...args)=>writes.push(args)},path:{join:(...parts)=>parts.join('/')},Buffer,requireAdmin(){},requireEcosystemRunning(){},app:{post:(route,...handlers)=>routes.set(route,handlers.at(-1))},mediaFactoryProject:id=>db.prepare('SELECT * FROM admin_media_projects WHERE id=?').get(id)});
  vm.runInContext(server.slice(server.indexOf('let viralVideoFactoryRunning=false;'),server.indexOf("app.get('/api/admin/viral-factory/automation'")),context);
  vm.runInContext(server.slice(server.indexOf("app.post('/api/admin/media-projects/:id/generate'"),server.indexOf("app.post('/api/admin/media-projects/:id/approve'")),context);
  const run=()=>vm.runInContext('processViralVideoFactory()',context),scene=()=>db.prepare('SELECT * FROM viral_quiz_scenes WHERE id=1').get();
  const route=async action=>{const res={code:200,status(n){this.code=n;return this;},json(body){this.body=body;return this;}};await routes.get('/api/admin/media-projects/:id/'+action)({params:{id:'1'}},res);return res;};
  return {db,calls,writes,run,scene,route};
}
test('worker consumes relative receipt once and never resubmits after successful completion',async()=>{
  const f=fixture((_u,o)=>({data:o.method==='POST'?{id:job,polling_url:'/api/v1/videos/'+job}:{id:job,status:'completed'}}));f.db.exec('INSERT INTO viral_quiz_scenes(id) VALUES(1)');
  await f.run();await f.run();assert.equal(f.scene().status,'downloaded');assert.equal(f.scene().remote_job_id,job);assert.equal(f.scene().attempt_count,1);assert.deepEqual(f.calls.map(x=>x.options.method),['POST','GET']);assert.ok(f.calls.every(x=>x.options.redirect==='error'));f.db.close();
});
test('unrecognized poll result preserves receipt and requires investigation without resubmitting',async()=>{
  const f=fixture(()=>{throw Error('unrecognized secret-token')});f.db.prepare("INSERT INTO viral_quiz_scenes(id,status,remote_job_id,polling_url,attempt_count) VALUES(1,'generating',?,?,1)").run(job,poll);
  await f.run();await f.run();assert.equal(f.scene().status,'failed');assert.equal(f.scene().remote_job_id,job);assert.equal(f.scene().polling_url,poll);assert.equal(f.scene().attempt_count,1);assert.deepEqual(f.calls.map(x=>x.options.method),['GET']);assert.doesNotMatch(f.scene().error_message,/secret-token/);f.db.close();
});
test('transient poll timeout retries only GET for the same job and can later complete',async()=>{
  let polls=0;const f=fixture(()=>{if(++polls<3)throw Object.assign(Error('timeout private'),{status:504});return {data:{id:job,status:'completed'}};});f.db.prepare("INSERT INTO viral_quiz_scenes(id,status,remote_job_id,polling_url,attempt_count) VALUES(1,'generating',?,?,1)").run(job,poll);
  await f.run();assert.equal(f.scene().status,'generating');await f.run();assert.equal(f.scene().status,'generating');await f.run();assert.equal(f.scene().status,'downloaded');assert.equal(f.scene().attempt_count,1);assert.ok(f.calls.every(x=>x.options.method==='GET'&&x.url===poll));assert.equal(f.calls.length,3);f.db.close();
});
test('transient download failure keeps job generating; a later GET completes without a new POST',async()=>{
  let downloads=0;const f=fixture(()=>({data:{id:job,status:'completed'}}),async()=>{if(++downloads===1)throw Object.assign(Error('download timed out'),{code:'video_download_timeout'});return mp4;});f.db.prepare("INSERT INTO viral_quiz_scenes(id,status,remote_job_id,polling_url) VALUES(1,'generating',?,?)").run(job,poll);
  await f.run();assert.equal(f.scene().status,'generating');assert.equal(f.scene().remote_job_id,job);await f.run();assert.equal(f.scene().status,'downloaded');assert.deepEqual(f.calls.map(x=>x.options.method),['GET','GET']);f.db.close();
});
test('failed and submitting legacy rows remain untouched, no startup retry',async()=>{
  const f=fixture(()=>{throw Error('unexpected network')});f.db.exec("INSERT INTO viral_quiz_scenes(id,status,error_message) VALUES(1,'failed','legacy blocked'),(2,'submitting','unknown old result')");const before=f.db.prepare('SELECT * FROM viral_quiz_scenes').all();await f.run();assert.deepEqual(f.db.prepare('SELECT * FROM viral_quiz_scenes').all(),before);assert.equal(f.calls.length,0);f.db.close();
});
test('invalid polling URL preserves known job ID without contacting untrusted host',async()=>{
  const f=fixture(()=>({data:{id:job,polling_url:'https://evil.com/poll'}}));f.db.exec('INSERT INTO viral_quiz_scenes(id) VALUES(1)');await f.run();await f.run();assert.equal(f.scene().status,'failed');assert.equal(f.scene().remote_job_id,job);assert.equal(f.scene().polling_url,'');assert.equal(f.calls.length,1);f.db.close();
});
test('manual timeout blocks duplicate clicks; result is uncertain and no secret is returned',async()=>{
  let release;const wait=new Promise((_,reject)=>{release=()=>reject(Error('secret token timeout'));});const f=fixture(()=>wait);f.db.exec('INSERT INTO admin_media_projects(id) VALUES(1)');const first=f.route('generate');
  const second=await f.route('generate');assert.equal(second.code,409);release();const result=await first;assert.equal(result.code,502);assert.doesNotMatch(JSON.stringify(result.body),/secret token/);assert.equal((await f.route('generate')).code,409);assert.equal(f.calls.length,1);f.db.close();
});
test('manual relative receipt syncs original job without generating again',async()=>{
  const f=fixture((_u,o)=>({data:o.method==='POST'?{id:job,polling_url:'/api/v1/videos/'+job}:{id:job,status:'completed'}}));f.db.exec('INSERT INTO admin_media_projects(id) VALUES(1)');assert.equal((await f.route('generate')).code,202);assert.equal((await f.route('sync')).code,200);assert.equal((await f.route('sync')).code,409);assert.equal((await f.route('generate')).code,409);assert.deepEqual(f.calls.map(x=>x.options.method),['POST','GET']);assert.equal(f.db.prepare('SELECT production_status FROM admin_media_projects').get().production_status,'review');f.db.close();
});
test('expired provider job and failed download never erase or resubmit scene receipts',async()=>{
  for(const mode of ['expired','download']){
    const f=fixture(()=>({data:{id:job,status:mode==='expired'?'expired':'completed'}}),async()=>{throw Error('download expired-url secret');});f.db.prepare("INSERT INTO viral_quiz_scenes(id,status,remote_job_id,polling_url) VALUES(1,'generating',?,?)").run(job,poll);
    await f.run();await f.run();assert.equal(f.scene().status,'failed');assert.equal(f.scene().remote_job_id,job);assert.equal(f.scene().polling_url,poll);assert.equal(f.calls.length,1);assert.equal(f.calls[0].options.method,'GET');assert.doesNotMatch(f.scene().error_message,/secret/);f.db.close();
  }
});
test('manual malformed receipt preserves a valid ID and remains blocked from another submit',async()=>{
  const f=fixture(()=>({data:{id:job,polling_url:'https://evil.com/poll'}}));f.db.exec('INSERT INTO admin_media_projects(id) VALUES(1)');assert.equal((await f.route('generate')).code,502);assert.equal(f.db.prepare('SELECT remote_job_id FROM admin_media_projects').get().remote_job_id,job);assert.equal((await f.route('generate')).code,409);assert.equal((await f.route('sync')).code,409);assert.equal(f.calls.length,1);f.db.close();
});
test('cancel during manual submission preserves the returned receipt without reopening the project',async()=>{
  let release;const pending=new Promise(resolve=>{release=resolve;});const f=fixture(()=>pending);f.db.exec('INSERT INTO admin_media_projects(id) VALUES(1)');const sending=f.route('generate');f.db.exec("UPDATE admin_media_projects SET production_status='cancelled'");release({data:{id:job,polling_url:poll}});assert.equal((await sending).code,409);const saved=f.db.prepare('SELECT * FROM admin_media_projects').get();assert.equal(saved.production_status,'cancelled');assert.equal(saved.remote_job_id,job);assert.equal(saved.polling_url,poll);assert.equal((await f.route('generate')).code,409);assert.equal(f.calls.length,1);f.db.close();
});
test('cancel during status GET prevents download and final publication state',async()=>{
  let release,downloads=0;const pending=new Promise(resolve=>{release=resolve;});const f=fixture(()=>pending,async()=>{downloads++;return mp4;});f.db.prepare("INSERT INTO admin_media_projects(id,production_status,remote_job_id,polling_url) VALUES(1,'editing',?,?)").run(job,poll);const syncing=f.route('sync');f.db.exec("UPDATE admin_media_projects SET production_status='cancelled'");release({data:{id:job,status:'completed'}});assert.equal((await syncing).code,409);assert.equal(downloads,0);assert.equal(f.writes.length,0);assert.equal(f.db.prepare('SELECT production_status FROM admin_media_projects').get().production_status,'cancelled');f.db.close();
});
test('cancel, receipt replacement, output/format edit and approval during download win transactionally',async()=>{
  for(const update of ["production_status='cancelled'","remote_job_id='new-job'","output_url='https://cdn.vendor.com/manually-edited.mp4'","production_status='approved'","prompt='changed briefing'","format='image'"]){
    let release,started;const pending=new Promise(resolve=>{release=resolve;}),entered=new Promise(resolve=>{started=resolve;});const f=fixture(()=>({data:{id:job,status:'completed'}}),async()=>{started();return pending;});f.db.prepare("INSERT INTO admin_media_projects(id,production_status,remote_job_id,polling_url) VALUES(1,'editing',?,?)").run(job,poll);const syncing=f.route('sync');await entered;f.db.exec('UPDATE admin_media_projects SET '+update);const before=f.db.prepare('SELECT * FROM admin_media_projects').get();release(mp4);assert.equal((await syncing).code,409);assert.deepEqual(f.db.prepare('SELECT * FROM admin_media_projects').get(),before);assert.equal(f.db.prepare('SELECT status FROM admin_agent_tasks').get().status,'running');assert.equal(f.writes.length,0);f.db.close();
  }
});
