import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import Database from 'better-sqlite3';
import * as receipts from '../video-provider-receipts.js';
import {googleVideoReceipt,googleVideoPollingUrl} from '../google-video-provider.js';
import {klingStudioReceipt,klingStudioPollingUrl} from '../kling-studio-provider.js';
import {mediaJobPolicy, requireMediaJob} from '../media-job-policy.js';
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
function fixture(request,download=async()=>mp4,{mediaConfig={provider:'openrouter',configured:true,imageConfigured:true,videoEnabled:true},account={connected:true,availableCredits:660}}={}){
  const db=new Database(':memory:');
  db.exec(`CREATE TABLE admin_viral_quizzes(id INTEGER PRIMARY KEY,status TEXT,task_id INTEGER,media_project_id INTEGER);
    INSERT INTO admin_viral_quizzes(id,status) VALUES(1,'in_production');
    CREATE TABLE viral_quiz_scenes(id INTEGER PRIMARY KEY,quiz_id INTEGER DEFAULT 1,scene_number INTEGER DEFAULT 1,status TEXT DEFAULT 'pending',video_provider TEXT DEFAULT 'openrouter',prompt TEXT DEFAULT 'safe',duration_seconds INTEGER DEFAULT 8,attempt_count INTEGER DEFAULT 0,remote_job_id TEXT DEFAULT '',polling_url TEXT DEFAULT '',model TEXT DEFAULT '',error_message TEXT DEFAULT '',local_path TEXT DEFAULT '',output_url TEXT DEFAULT '',updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE admin_media_projects(id INTEGER PRIMARY KEY,task_id INTEGER DEFAULT 1,format TEXT DEFAULT 'short_video',production_status TEXT DEFAULT 'script',image_provider TEXT DEFAULT 'openrouter',video_provider TEXT DEFAULT 'openrouter',progress INTEGER DEFAULT 0,remote_job_id TEXT DEFAULT '',polling_url TEXT DEFAULT '',error_message TEXT DEFAULT '',updated_at TEXT DEFAULT CURRENT_TIMESTAMP,model TEXT DEFAULT 'test',prompt TEXT DEFAULT 'safe',duration_seconds INTEGER DEFAULT 8,aspect_ratio TEXT DEFAULT '9:16',output_url TEXT DEFAULT '',usage_cost_usd REAL DEFAULT 0);
    CREATE TABLE admin_agent_tasks(id INTEGER PRIMARY KEY,status TEXT,updated_at TEXT);INSERT INTO admin_agent_tasks VALUES(1,'running','before');`);
  const routes=new Map(),calls=[],writes=[],downloads=[],config={videoModel:'test-model',...mediaConfig},provider=config.videoProvider||config.provider;
  const client={
    requestImage:async input=>{calls.push({image:input});return request('image',{method:'POST',body:JSON.stringify(input)});},
    createVideo:async input=>{const url=provider==='kling_studio'?'kling-studio-cli:generate':provider==='google'?'https://generativelanguage.googleapis.com/v1beta/models/'+input.model+':predictLongRunning':'https://openrouter.ai/api/v1/videos';const options={method:'POST',redirect:'error',body:JSON.stringify(input)};calls.push({url,options});return request(url,options);},
    getVideo:async job=>{assert.equal(job.provider,provider);const options={method:'GET',redirect:'error'};calls.push({url:job.pollingUrl,options,job});return request(job.pollingUrl,options);},
    downloadVideo:async(data,job)=>{assert.equal(job.provider,provider);downloads.push(job);return download(data,job);},
    videoReceipt:provider==='kling_studio'?klingStudioReceipt:provider==='google'?googleVideoReceipt:videoReceipt,
    videoPollingUrl:provider==='kling_studio'?klingStudioPollingUrl:provider==='google'?googleVideoPollingUrl:videoPollingUrl,
    getVideoAccountCapabilities:async()=>typeof account==='function'?account():account
  };
  const context=vm.createContext({...receipts,mediaJobPolicy,requireMediaJob,AI_MEDIA_CONFIG:config,db,ecosystemCanRun:()=>true,aiConfigured:()=>true,finishViralQuizVideo:async()=>{},openRouterRequest:()=>{throw Error('legacy server routing forbidden');},aiMediaClient:client,generatedMediaDir:'/tmp',fs:{writeFileSync:(...args)=>writes.push(args)},path:{join:(...parts)=>parts.join('/')},Buffer,requireAdmin(){},requireEcosystemRunning(){},app:{post:(route,...handlers)=>routes.set(route,handlers.at(-1))},mediaFactoryProject:id=>db.prepare('SELECT * FROM admin_media_projects WHERE id=?').get(id)});
  vm.runInContext(server.slice(server.indexOf('function videoGenerationIssue('),server.indexOf("app.get('/api/admin/media-factory'")),context);
  vm.runInContext(server.slice(server.indexOf('let viralVideoFactoryRunning=false;'),server.indexOf("app.get('/api/admin/viral-factory/automation'")),context);
  vm.runInContext(server.slice(server.indexOf("app.post('/api/admin/media-projects/:id/generate'"),server.indexOf("app.post('/api/admin/media-projects/:id/approve'")),context);
  const run=()=>vm.runInContext('processViralVideoFactory()',context),scene=()=>db.prepare('SELECT * FROM viral_quiz_scenes WHERE id=1').get();
  const route=async action=>{const res={code:200,status(n){this.code=n;return this;},json(body){this.body=body;return this;}};await routes.get('/api/admin/media-projects/:id/'+action)({params:{id:'1'}},res);return res;};
  return {db,calls,writes,downloads,run,scene,route};
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
test('cancel, provider/receipt replacement, output/format edit and approval during download win transactionally',async()=>{
  for(const update of ["production_status='cancelled'","video_provider='openai'","remote_job_id='new-job'","output_url='https://cdn.vendor.com/manually-edited.mp4'","production_status='approved'","prompt='changed briefing'","format='image'"]){
    let release,started;const pending=new Promise(resolve=>{release=resolve;}),entered=new Promise(resolve=>{started=resolve;});const f=fixture(()=>({data:{id:job,status:'completed'}}),async()=>{started();return pending;});f.db.prepare("INSERT INTO admin_media_projects(id,production_status,remote_job_id,polling_url) VALUES(1,'editing',?,?)").run(job,poll);const syncing=f.route('sync');await entered;f.db.exec('UPDATE admin_media_projects SET '+update);const before=f.db.prepare('SELECT * FROM admin_media_projects').get();release(mp4);assert.equal((await syncing).code,409);assert.deepEqual(f.db.prepare('SELECT * FROM admin_media_projects').get(),before);assert.equal(f.db.prepare('SELECT status FROM admin_agent_tasks').get().status,'running');assert.equal(f.writes.length,0);f.db.close();
  }
});

test('OpenAI selection leaves queued, processing and completed legacy scenes untouched across worker runs',async()=>{
  const f=fixture(()=>{throw Error('Unexpected provider request');},async()=>{throw Error('Unexpected download');},{mediaConfig:{provider:'openai',configured:true,imageConfigured:true,videoEnabled:false,videoReason:'Vídeo indisponível.'}});
  f.db.exec("INSERT INTO viral_quiz_scenes(id,status,remote_job_id,polling_url,output_url,error_message) VALUES(1,'pending','','','',''),(2,'generating','job-old','https://openrouter.ai/api/v1/videos/job-old','',''),(3,'failed','job-failed','https://openrouter.ai/api/v1/videos/job-failed','','review'),(4,'submitting','','','','uncertain'),(5,'downloaded','job-ready','https://openrouter.ai/api/v1/videos/job-ready','/uploads/generated-videos/existing.mp4','')");
  const before=f.db.prepare('SELECT * FROM viral_quiz_scenes ORDER BY id').all();
  await f.run();await f.run();
  assert.deepEqual(f.db.prepare('SELECT * FROM viral_quiz_scenes ORDER BY id').all(),before);
  assert.deepEqual(f.calls,[]);assert.deepEqual(f.writes,[]);f.db.close();
});

test('OpenAI manual generation and sync reject old-provider jobs or unavailable videos before mutation or network',async()=>{
  for(const [provider,action,status,expectedCode,expectedReason] of [
    ['openrouter','generate','script',409,'ai_media_job_provider_mismatch'],
    ['openrouter','sync','editing',409,'ai_media_job_provider_mismatch'],
    ['openai','generate','script',503,'ai_video_unavailable'],
    ['openai','sync','editing',503,'ai_video_unavailable']
  ]){
    const f=fixture(()=>{throw Error('Unexpected provider request');},async()=>{throw Error('Unexpected download');},{mediaConfig:{provider:'openai',configured:true,imageConfigured:true,videoEnabled:false,videoReason:'Vídeo indisponível.'}});
    f.db.prepare("INSERT INTO admin_media_projects(id,production_status,video_provider,remote_job_id,polling_url,output_url) VALUES(1,?,?,?,?,'/uploads/generated-videos/existing.mp4')").run(status,provider,status==='editing'?job:'',status==='editing'?poll:'');
    const before=f.db.prepare('SELECT * FROM admin_media_projects').all(),tasks=f.db.prepare('SELECT * FROM admin_agent_tasks').all();
    const result=await f.route(action);
    assert.equal(result.code,expectedCode);assert.equal(result.body.code,expectedReason);
    assert.deepEqual(f.db.prepare('SELECT * FROM admin_media_projects').all(),before);
    assert.deepEqual(f.db.prepare('SELECT * FROM admin_agent_tasks').all(),tasks);
    assert.deepEqual(f.calls,[]);assert.deepEqual(f.writes,[]);f.db.close();
  }
});

test('OpenAI cannot generate an old-provider image project or replace its saved asset',async()=>{
  const f=fixture(()=>{throw Error('Unexpected image request');},async()=>mp4,{mediaConfig:{provider:'openai',configured:true,imageConfigured:true,videoEnabled:false}});
  f.db.exec("INSERT INTO admin_media_projects(id,format,production_status,image_provider,output_url) VALUES(1,'image','assets','openrouter','/uploads/generated-videos/original.png')");
  const before=f.db.prepare('SELECT * FROM admin_media_projects').get();
  const result=await f.route('generate');assert.equal(result.code,409);assert.equal(result.body.code,'ai_media_job_provider_mismatch');
  assert.deepEqual(f.db.prepare('SELECT * FROM admin_media_projects').get(),before);
  assert.deepEqual(f.calls,[]);assert.deepEqual(f.writes,[]);f.db.close();
});

test('provider change during manual status GET prevents download and finalization',async()=>{
  let release,downloads=0;const pending=new Promise(resolve=>{release=resolve;});
  const f=fixture(()=>pending,async()=>{downloads++;return mp4;});
  f.db.prepare("INSERT INTO admin_media_projects(id,production_status,remote_job_id,polling_url) VALUES(1,'editing',?,?)").run(job,poll);
  const syncing=f.route('sync');f.db.exec("UPDATE admin_media_projects SET video_provider='openai'");
  const before=f.db.prepare('SELECT * FROM admin_media_projects').get();
  release({data:{id:job,status:'completed'}});
  assert.equal((await syncing).code,409);assert.equal(downloads,0);assert.deepEqual(f.writes,[]);
  assert.deepEqual(f.db.prepare('SELECT * FROM admin_media_projects').get(),before);
  assert.equal(f.db.prepare('SELECT status FROM admin_agent_tasks').get().status,'running');f.db.close();
});

const googleModel='veo-3.1-lite-generate-preview',googleJob='models/'+googleModel+'/operations/job-google',googlePoll='https://generativelanguage.googleapis.com/v1beta/'+googleJob;
const googleConfig={provider:'openai',videoProvider:'google',configured:true,imageConfigured:true,videoEnabled:true,videoModel:googleModel,videoOptions:[googleModel],videoDurationOptions:[4,6,8],videoAspectRatioOptions:['9:16','16:9'],videoAudioAlwaysOn:true};
const googleResponse=(_url,options)=>({provider:'google',data:options.method==='POST'?{id:googleJob,polling_url:googlePoll,status:'queued'}:{id:googleJob,status:'completed',content_url:'https://generativelanguage.googleapis.com/v1beta/files/video-test:download?alt=media'}});
test('Google manual generation persists the full original operation and uses audio for all supported durations',async()=>{
  for(const duration of [4,6,8]){
    const f=fixture(googleResponse,async()=>mp4,{mediaConfig:googleConfig});
    f.db.prepare("INSERT INTO admin_media_projects(id,video_provider,model,duration_seconds) VALUES(1,'google',?,?)").run(googleModel,duration);
    assert.equal((await f.route('generate')).code,202);assert.equal((await f.route('generate')).code,409);
    assert.equal((await f.route('sync')).code,200);
    const row=f.db.prepare('SELECT * FROM admin_media_projects').get();assert.equal(row.video_provider,'google');assert.equal(row.image_provider,'openrouter');assert.equal(row.remote_job_id,googleJob);assert.equal(row.polling_url,googlePoll);assert.equal(row.production_status,'review');
    const input=JSON.parse(f.calls[0].options.body);assert.equal(input.durationSeconds,duration);assert.equal(input.generateAudio,true);assert.equal(input.model,googleModel);
    assert.deepEqual(f.calls.map(call=>call.options.method),['POST','GET']);assert(f.calls.every(call=>call.url.startsWith('https://generativelanguage.googleapis.com/')));assert.equal(f.downloads[0].jobId,googleJob);assert.equal(f.downloads[0].provider,'google');f.db.close();
  }
});

test('unsupported Google duration, ratio or model is rejected before claim, network and changes',async()=>{
  for(const update of ["duration_seconds=5","duration_seconds=65","aspect_ratio='1:1'","model='google/veo-3.1-lite'"]){
    const f=fixture(googleResponse,async()=>mp4,{mediaConfig:googleConfig});
    f.db.prepare("INSERT INTO admin_media_projects(id,video_provider,model) VALUES(1,'google',?)").run(googleModel);f.db.exec('UPDATE admin_media_projects SET '+update);
    const before=f.db.prepare('SELECT * FROM admin_media_projects').get(),result=await f.route('generate');assert.equal(result.code,400);assert.equal(result.body.code,'ai_media_video_options_invalid');assert.deepEqual(f.db.prepare('SELECT * FROM admin_media_projects').get(),before);assert.deepEqual(f.calls,[]);assert.deepEqual(f.writes,[]);f.db.close();
  }
});

test('Google queued scene behind an old OpenRouter scene runs once without touching the old queue',async()=>{
  const f=fixture(googleResponse,async()=>mp4,{mediaConfig:googleConfig});
  f.db.exec("INSERT INTO viral_quiz_scenes(id,status,video_provider) VALUES(1,'pending','openrouter'),(2,'pending','google'),(3,'generating','openrouter')");
  const before=f.db.prepare("SELECT * FROM viral_quiz_scenes WHERE video_provider='openrouter'").all();
  await f.run();await f.run();assert.deepEqual(f.db.prepare("SELECT * FROM viral_quiz_scenes WHERE video_provider='openrouter'").all(),before);
  const current=f.db.prepare('SELECT * FROM viral_quiz_scenes WHERE id=2').get();assert.equal(current.status,'downloaded');assert.equal(current.video_provider,'google');assert.equal(current.attempt_count,1);assert.equal(current.remote_job_id,googleJob);assert.deepEqual(f.calls.map(call=>call.options.method),['POST','GET']);assert.equal(JSON.parse(f.calls[0].options.body).generateAudio,true);f.db.close();
});

test('Google timeout preserves an uncertain claim and never resubmits it',async()=>{
  const f=fixture(()=>{throw Object.assign(Error('google_video_timeout'),{status:504});},async()=>mp4,{mediaConfig:googleConfig});
  f.db.prepare("INSERT INTO admin_media_projects(id,video_provider,model) VALUES(1,'google',?)").run(googleModel);
  assert.equal((await f.route('generate')).code,504);assert.equal((await f.route('generate')).code,409);assert.equal(f.calls.length,1);assert.equal(f.db.prepare('SELECT production_status FROM admin_media_projects').get().production_status,'editing');f.db.close();
});

test('a provider change during Google scene polling preserves the scene without download or finalization',async()=>{
  let release;const pending=new Promise(resolve=>{release=resolve;});const f=fixture(()=>pending,async()=>mp4,{mediaConfig:googleConfig});
  f.db.prepare("INSERT INTO viral_quiz_scenes(id,status,video_provider,remote_job_id,polling_url) VALUES(1,'generating','google',?,?)").run(googleJob,googlePoll);
  const running=f.run();f.db.exec("UPDATE viral_quiz_scenes SET video_provider='openrouter'");const before=f.scene();release(googleResponse('',{method:'GET'}));await running;
  assert.deepEqual(f.scene(),before);assert.deepEqual(f.downloads,[]);assert.deepEqual(f.writes,[]);f.db.close();
});

test('quiz approval creates nine Google scenes with supported durations without generating or duplicating jobs',()=>{
  const db=new Database(':memory:');
  db.exec(`CREATE TABLE admin_viral_quizzes(id INTEGER PRIMARY KEY,status TEXT,task_id INTEGER,media_project_id INTEGER,updated_at TEXT);INSERT INTO admin_viral_quizzes(id,status) VALUES(1,'awaiting_approval');
    CREATE TABLE admin_specialist_agents(id INTEGER PRIMARY KEY,code TEXT,status TEXT);INSERT INTO admin_specialist_agents VALUES(1,'midia','active');
    CREATE TABLE admin_agent_tasks(id INTEGER PRIMARY KEY,agent_id INTEGER,created_by_user_id TEXT,title TEXT,instructions TEXT,priority TEXT,status TEXT);
    CREATE TABLE admin_media_projects(id INTEGER PRIMARY KEY,task_id INTEGER,format TEXT,channels TEXT,source_notes TEXT,prompt TEXT,aspect_ratio TEXT,duration_seconds INTEGER,caption TEXT,production_status TEXT,progress INTEGER,script TEXT,video_provider TEXT,model TEXT);
    CREATE TABLE viral_quiz_scenes(id INTEGER PRIMARY KEY,quiz_id INTEGER,scene_number INTEGER,duration_seconds INTEGER,prompt TEXT,video_provider TEXT,model TEXT);`);
  const quiz={id:1,theme:'Plantas',script:'Roteiro existente',voice:'br-feminina-energica',channels:'VitrineCity',destination_label:'Agrotecnica',destination_url:'https://vitrinecity.com/oracao-do-dia.html',questions:[]};
  const context=vm.createContext({db,AI_MEDIA_CONFIG:googleConfig,requireMediaJob,viralQuizRow:()=>({...quiz,...db.prepare('SELECT * FROM admin_viral_quizzes WHERE id=1').get()})});
  vm.runInContext(server.slice(server.indexOf('function approveViralQuiz('),server.indexOf("app.post('/api/admin/viral-quizzes/:id/approve'")),context);
  vm.runInContext("approveViralQuiz(1,'local-admin')",context);
  const project=db.prepare('SELECT * FROM admin_media_projects').get(),scenes=db.prepare('SELECT * FROM viral_quiz_scenes ORDER BY scene_number').all();assert.equal(project.video_provider,'google');assert.equal(project.model,googleModel);assert.equal(project.duration_seconds,65);assert.equal(scenes.length,9);assert(scenes.every(scene=>scene.video_provider==='google'&&scene.model===googleModel));assert.deepEqual(scenes.map(scene=>scene.duration_seconds),[8,8,8,8,8,8,8,8,4]);
  assert.throws(()=>vm.runInContext("approveViralQuiz(1,'local-admin')",context),/não está aguardando aprovação/);assert.equal(db.prepare('SELECT count(*) n FROM viral_quiz_scenes').get().n,9);db.close();
});

const studioModel='kling-video-v3_0',studioJob='studio-generation-1',studioPoll='https://kling.ai/mcp#'+'a'.repeat(64)+'/'+studioJob;
const studioConfig={provider:'openai',videoProvider:'kling_studio',configured:true,imageConfigured:true,videoEnabled:true,videoManualOnly:true,videoModel:studioModel,videoOptions:[studioModel],videoDurationOptions:Array.from({length:13},(_,i)=>i+3),videoAspectRatioOptions:['9:16','16:9','1:1'],videoAudioAlwaysOn:false,videoCreditsPerSecond:8,videoDefaultDuration:5,videoResolution:'1080p'};
const studioResponse=(_url,options)=>({provider:'kling_studio',data:{id:studioJob,polling_url:studioPoll,status:options.method==='POST'?'queued':'completed'}});
test('Kling manual clips accept 3 to 15 seconds, preserve exact receipts and never add audio',async()=>{
  for(const duration of [3,5,15]){
    const f=fixture(studioResponse,async()=>mp4,{mediaConfig:studioConfig});
    f.db.prepare("INSERT INTO admin_media_projects(id,video_provider,model,duration_seconds) VALUES(1,'kling_studio',?,?)").run(studioModel,duration);
    assert.equal((await f.route('generate')).code,202);assert.equal((await f.route('generate')).code,409);assert.equal((await f.route('sync')).code,200);
    const input=JSON.parse(f.calls[0].options.body);assert.equal(input.durationSeconds,duration);assert.equal(input.generateAudio,false);assert.equal(input.manual,true);
    const row=f.db.prepare('SELECT * FROM admin_media_projects').get();assert.equal(row.remote_job_id,studioJob);assert.equal(row.polling_url,studioPoll);assert.equal(row.video_provider,'kling_studio');assert.equal(row.production_status,'review');assert.equal(f.calls.length,2);f.db.close();
  }
});

test('Kling automatic scenes and quiz approval are blocked before database claims or requests',async()=>{
  let accounts=0;const f=fixture(()=>{throw Error('No generation permitted');},async()=>mp4,{mediaConfig:studioConfig,account:()=>{accounts++;return {connected:true,availableCredits:660};}});
  f.db.exec("INSERT INTO viral_quiz_scenes(id,status,video_provider) VALUES(1,'pending','kling_studio'),(2,'generating','kling_studio'),(3,'pending','google'),(4,'pending','openrouter')");
  const before=f.db.prepare('SELECT * FROM viral_quiz_scenes').all();await f.run();await f.run();assert.deepEqual(f.db.prepare('SELECT * FROM viral_quiz_scenes').all(),before);assert.deepEqual(f.calls,[]);assert.equal(accounts,0);
  const context=vm.createContext({AI_MEDIA_CONFIG:studioConfig,db:{prepare(){throw Error('No SQL should be accessed');}}});vm.runInContext(server.slice(server.indexOf('function approveViralQuiz('),server.indexOf("app.post('/api/admin/viral-quizzes/:id/approve'")),context);assert.throws(()=>vm.runInContext("approveViralQuiz(1,'admin')",context),error=>error.code==='ai_video_manual_only');f.db.close();
});

test('manual endpoint cannot turn a linked viral source into a Kling paid clip',async()=>{
  let accounts=0;const f=fixture(studioResponse,async()=>mp4,{mediaConfig:studioConfig,account:()=>{accounts++;return {connected:true,availableCredits:660};}});
  f.db.prepare("INSERT INTO admin_media_projects(id,video_provider,model,duration_seconds) VALUES(1,'kling_studio',?,5)").run(studioModel);f.db.exec('UPDATE admin_viral_quizzes SET media_project_id=1');
  const before=f.db.prepare('SELECT * FROM admin_media_projects').get(),result=await f.route('generate');assert.equal(result.code,409);assert.equal(result.body.code,'ai_video_manual_only');assert.deepEqual(f.db.prepare('SELECT * FROM admin_media_projects').get(),before);assert.equal(accounts,0);assert.deepEqual(f.calls,[]);f.db.close();
});

test('insufficient credits, invalid duration and old provider jobs cannot create a Kling claim',async()=>{
  for(const [provider,duration,credits,status] of [['kling_studio',5,39,402],['kling_studio',2,660,400],['kling_studio',16,660,400],['google',5,660,409],['openrouter',5,660,409]]){
    const f=fixture(studioResponse,async()=>mp4,{mediaConfig:studioConfig,account:{connected:true,availableCredits:credits}});
    f.db.prepare('INSERT INTO admin_media_projects(id,video_provider,model,duration_seconds) VALUES(1,?,?,?)').run(provider,studioModel,duration);
    const before=f.db.prepare('SELECT * FROM admin_media_projects').get();assert.equal((await f.route('generate')).code,status);assert.deepEqual(f.db.prepare('SELECT * FROM admin_media_projects').get(),before);assert.deepEqual(f.calls,[]);f.db.close();
  }
});

test('Kling account read never generates and admin config omits private credential fields',async()=>{
  let reads=0,generated=0,handler;const admin=()=>{};
  const context=vm.createContext({AI_MEDIA_CONFIG:studioConfig,db:{prepare:()=>({all:()=>[]})},requireAdmin:admin,
    app:{get:(route,guard,fn)=>{assert.equal(route,'/api/admin/media-factory');assert.equal(guard,admin);handler=fn;}},
    aiMediaClient:{getVideoAccountCapabilities:async()=>{reads++;return {connected:true,availableCredits:660,usablePaidCredits:null,accessToken:'DO_NOT_EXPOSE',home:'PRIVATE_PATH'};},createVideo(){generated++;}},mediaJobPolicy});
  vm.runInContext(server.slice(server.indexOf("app.get('/api/admin/media-factory'"),server.indexOf("app.post('/api/admin/media-factory'")),context);
  let body;await handler({}, {json:value=>{body=value;}});assert.equal(reads,1);assert.equal(generated,0);assert.equal(body.videoAccount.connected,true);assert.equal(body.videoAccount.availableCredits,660);assert.equal(body.videoAccount.usablePaidCredits,null);assert.equal(body.videoManualOnly,true);assert.equal(body.videoCreditsPerSecond,8);assert.doesNotMatch(JSON.stringify(body),/DO_NOT_EXPOSE|PRIVATE_PATH/);
});
