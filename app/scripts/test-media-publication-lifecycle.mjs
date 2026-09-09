import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createMediaPublicationLifecycle, streamTransition, captureQuizMontage, commitQuizMontage } from '../media-publication-lifecycle.js';

const UID='a'.repeat(32), OTHER='b'.repeat(32), ACCOUNT='c'.repeat(32);
const reply=(result={uid:UID,status:{state:'inprogress'}}, status=200)=>({ok:status<400,status,json:async()=>({success:status<400,result})});
function fixture(t, options={}){
  const db=new Database(':memory:');t.after(()=>db.close());db.pragma('foreign_keys=ON');
  db.exec(`CREATE TABLE admin_agent_tasks(id INTEGER PRIMARY KEY,title TEXT,status TEXT DEFAULT 'in_progress',result_summary TEXT,completed_at TEXT,updated_at TEXT);
    CREATE TABLE admin_media_projects(id INTEGER PRIMARY KEY,task_id INTEGER,format TEXT,production_status TEXT,output_url TEXT,caption TEXT,published_post_id TEXT DEFAULT '',progress INTEGER,duration_seconds INTEGER,updated_at TEXT);
    CREATE TABLE admin_viral_quizzes(id INTEGER PRIMARY KEY,media_project_id INTEGER,task_id INTEGER DEFAULT 1,status TEXT,updated_at TEXT);
    CREATE TABLE viral_quiz_scenes(id INTEGER PRIMARY KEY,quiz_id INTEGER,scene_number INTEGER,status TEXT,local_path TEXT,duration_seconds INTEGER);
    CREATE TABLE viral_distribution_jobs(quiz_id INTEGER,provider TEXT,status TEXT CHECK(status IN ('pending','awaiting_connection','published','failed')),publication_id TEXT,error_message TEXT,updated_at TEXT,UNIQUE(quiz_id,provider));
    CREATE TABLE social_posts(id TEXT PRIMARY KEY,user_id INTEGER,video_uid TEXT NOT NULL UNIQUE,media_type TEXT DEFAULT 'video',image_url TEXT,caption TEXT,category TEXT,status TEXT,moderation_status TEXT DEFAULT 'pending',moderation_reason TEXT DEFAULT '',moderated_by INTEGER,moderated_at TEXT,duration_seconds REAL,error_message TEXT DEFAULT '',updated_at TEXT);
    CREATE TABLE social_account_restrictions(user_id INTEGER PRIMARY KEY,status TEXT,restricted_until TEXT);
    INSERT INTO admin_agent_tasks(id,title) VALUES(1,'Receita ilustrada');
    INSERT INTO admin_media_projects(id,task_id,format,production_status,output_url,caption) VALUES(1,1,'short_video','approved','/uploads/generated-videos/original.mp4','Conteúdo aprovado');
    INSERT INTO admin_viral_quizzes(id,media_project_id,status) VALUES(1,1,'approved');
    INSERT INTO viral_distribution_jobs(quiz_id,provider,status) VALUES(1,'vitrine_social','pending'),(1,'youtube','awaiting_connection');`);
  const state={paused:false,time:100000,config:{accountId:ACCOUNT,token:'TEST_SECRET_MUST_NOT_LEAK'},calls:[],ready:[],errors:[],handler:async()=>reply()};
  const args={db,siteUrl:'https://vitrinecity.com',canRun:()=>!state.paused,now:()=>state.time,getConfig:()=>state.config,
    fetchImpl:async(url,opts)=>{state.calls.push({url,opts});return state.handler(url,opts)},onReady:p=>state.ready.push(p.id),onError:p=>state.errors.push(p.id),...options};
  const api=createMediaPublicationLifecycle(args);
  const post=()=>db.prepare('SELECT * FROM social_posts').get(), attempt=()=>db.prepare('SELECT * FROM media_publication_attempts').get();
  return {db,state,api,args,post,attempt};
}

test('migration is additive and does not assign receipts or mutate existing rows',t=>{
  const f=fixture(t);f.db.prepare("INSERT INTO social_posts(id,video_uid,status) VALUES('legacy',?,'ready')").run(UID);
  const before=f.post();createMediaPublicationLifecycle(f.args);assert.deepEqual(f.post(),before);assert.equal(f.attempt(),undefined);
  assert.equal(f.db.prepare('PRAGMA table_info(social_posts)').all().filter(c=>c.name==='stream_state').length,1);
});
test('upload receipt means processing; approved ready callback publishes project and quiz once',async t=>{
  const f=fixture(t), first=await f.api.publish(1,9,'quiz');assert.equal(first.status,'processing');assert.equal(first.hasReceipt,true);
  assert.equal(f.post().moderation_status,'approved');assert.equal(f.post().status,'processing');assert.equal(f.db.prepare('SELECT production_status FROM admin_media_projects').get().production_status,'approved');
  assert.equal(f.db.prepare('SELECT status FROM admin_viral_quizzes').get().status,'approved');assert.deepEqual(f.state.ready,[]);
  f.api.applyStream({uid:UID,readyToStream:true,duration:36});assert.equal(f.api.snapshot(1).status,'published');assert.equal(f.post().duration_seconds,36);assert.equal(f.state.ready.length,1);
  assert.equal(f.db.prepare('SELECT status FROM admin_viral_quizzes').get().status,'published');
  assert.equal(f.db.prepare("SELECT status FROM viral_distribution_jobs WHERE provider='vitrine_social'").get().status,'published');
  assert.equal(f.db.prepare("SELECT status FROM viral_distribution_jobs WHERE provider='youtube'").get().status,'awaiting_connection');
  f.api.applyStream({uid:UID,readyToStream:true});f.api.applyStream({uid:UID,status:{state:'inprogress'}});f.api.applyStream({uid:UID,status:{state:'error'}});
  assert.equal(f.post().status,'ready');assert.equal(f.post().duration_seconds,36);assert.equal(f.state.ready.length,1);assert.equal(f.state.errors.length,0);
});
test('ordinary users and flagged content still require moderation after stream readiness',t=>{
  const f=fixture(t);f.db.prepare("INSERT INTO social_posts(id,user_id,video_uid,status,moderation_status,moderation_reason) VALUES('ordinary',4,?,'uploading','pending','')").run(UID);
  f.api.applyStream({uid:UID,status:{state:'ready'}});assert.equal(f.post().status,'pending_review');assert.equal(f.post().moderation_status,'pending');assert.equal(f.state.ready.length,0);
  f.db.prepare("UPDATE social_posts SET moderation_reason='conteúdo sinalizado'").run();f.api.applyStream({uid:UID,status:{state:'ready'}});assert.equal(f.post().moderation_status,'flagged');
});
test('approval never fabricates readiness for a submitted video; image approval is immediate',t=>{
  const f=fixture(t);assert.equal(f.api.approvalStatus({id:'x',user_id:1,status:'uploading',media_type:'video',stream_state:''}),'processing');
  assert.equal(f.api.approvalStatus({id:'x',user_id:1,status:'pending_review',media_type:'video',stream_state:'ready'}),'ready');
  assert.equal(f.api.approvalStatus({id:'x',user_id:1,status:'pending_review',media_type:'image'}),'ready');
});
test('concurrent calls and new process reuse the durable claim without a second upload',async t=>{
  const f=fixture(t);let resolve;f.state.handler=()=>new Promise(r=>resolve=r);
  const first=f.api.publish(1,9);assert.equal(f.attempt().state,'submitting');assert.equal(f.post().status,'uploading');
  const second=await createMediaPublicationLifecycle(f.args).publish(1,9);assert.equal(second.status,'submitting');assert.equal(f.state.calls.length,1);
  resolve(reply());await first;await f.api.publish(1,9);assert.equal(f.state.calls.length,1);assert.equal(f.db.prepare('SELECT count(*) n FROM social_posts').get().n,1);
});
test('timeout or missing receipt stays unknown across retries and restarts',async t=>{
  const f=fixture(t);f.state.handler=async()=>{throw new Error('TEST_SECRET_MUST_NOT_LEAK provider details')};
  const result=await f.api.publish(1,9);assert.equal(result.status,'unknown');assert.equal(result.canPublish,false);assert(!JSON.stringify(result).includes('TEST_SECRET'));
  await createMediaPublicationLifecycle(f.args).publish(1,9);await f.api.reconcile(1);assert.equal(f.state.calls.length,1);
});
test('successful HTTP without UID cannot be called published or retried',async t=>{
  const f=fixture(t);f.state.handler=async()=>reply({});assert.equal((await f.api.publish(1,9)).status,'unknown');await f.api.publish(1,9);assert.equal(f.state.calls.length,1);
});
test('stale process claim becomes visibly unknown but never triggers another copy',async t=>{
  const f=fixture(t);let resolve;f.state.handler=()=>new Promise(r=>resolve=r);const first=f.api.publish(1,9);f.state.time+=45001;
  assert.equal(f.api.snapshot(1).status,'unknown');assert.equal((await createMediaPublicationLifecycle(f.args).publish(1,9)).status,'unknown');assert.equal(f.state.calls.length,1);
  resolve(reply());await first;assert.equal(f.api.snapshot(1).status,'processing');
});
test('signed callback metadata recovers UID after timeout and cannot bind an unrelated attempt',async t=>{
  const f=fixture(t);f.state.handler=async()=>{throw Error('timeout')};await f.api.publish(1,9);
  f.api.applyStream({uid:UID,readyToStream:true,meta:{vitrinePublicationId:'unknown'}});assert.equal(f.api.snapshot(1).status,'unknown');
  f.api.applyStream({uid:UID,readyToStream:true,meta:{vitrinePublicationId:f.attempt().id}});assert.equal(f.api.snapshot(1).status,'published');assert.equal(f.attempt().stream_uid,UID);assert.equal(f.state.calls.length,1);
  f.api.applyStream({uid:OTHER,readyToStream:true,meta:{vitrinePublicationId:f.attempt().id}});assert.equal(f.post().video_uid,UID);
});
test('callback before the copy response retains ready and is not notified twice',async t=>{
  const f=fixture(t);f.state.handler=async(_url,opts)=>{f.api.applyStream({uid:UID,readyToStream:true,meta:JSON.parse(opts.body).meta});return reply()};
  assert.equal((await f.api.publish(1,9)).status,'published');assert.equal(f.state.ready.length,1);
});
for(const [status,moderation] of [['deleted','removed'],['rejected','rejected'],['pending_review','suspended']]){
  test(`${status}/${moderation} cannot reopen through callback or saved receipt reconciliation`,async t=>{
    const f=fixture(t);await f.api.publish(1,9);f.db.prepare('UPDATE social_posts SET status=?,moderation_status=?').run(status,moderation);
    f.api.applyStream({uid:UID,readyToStream:true});f.state.handler=async()=>reply({uid:UID,readyToStream:true});await f.api.reconcile(1);
    assert.equal(f.post().status,status);assert.equal(f.post().moderation_status,moderation);assert.equal(f.api.snapshot(1).status,'blocked');assert.equal(f.state.ready.length,0);
    await f.api.publish(1,9);assert.equal(f.state.calls.filter(c=>c.opts.method==='POST').length,1);
  });
}
test('changed or cancelled source blocks a ready receipt and does not approve another file',async t=>{
  const f=fixture(t);await f.api.publish(1,9);f.db.prepare("UPDATE admin_media_projects SET output_url='/uploads/another.mp4'").run();
  f.api.applyStream({uid:UID,readyToStream:true});assert.equal(f.api.snapshot(1).status,'source_changed');assert.equal(f.post().status,'pending_review');assert.equal(f.state.ready.length,0);
});
test('cancelled quiz and suspended account remain blocked even if media remains approved',async t=>{
  const f=fixture(t);await f.api.publish(1,9);f.db.prepare("UPDATE admin_viral_quizzes SET status='cancelled'").run();f.api.applyStream({uid:UID,readyToStream:true});
  assert.equal(f.api.snapshot(1).status,'source_changed');assert.equal(f.db.prepare('SELECT status FROM admin_viral_quizzes').get().status,'cancelled');
  f.db.prepare("UPDATE admin_viral_quizzes SET status='approved'").run();f.db.prepare("INSERT INTO social_account_restrictions VALUES(9,'suspended',NULL)").run();f.api.applyStream({uid:UID,readyToStream:true});
  assert.equal(f.api.snapshot(1).status,'blocked');assert.equal(f.state.ready.length,0);
});
test('pause during copy preserves receipt and waits for explicit confirmation after resume',async t=>{
  const f=fixture(t);f.state.handler=async()=>{f.state.paused=true;return reply({uid:UID,readyToStream:true})};
  assert.equal((await f.api.publish(1,9)).status,'paused');assert.equal(f.post().stream_state,'ready');assert.equal(f.state.ready.length,0);
  f.state.paused=false;f.state.handler=async()=>reply({uid:UID,readyToStream:true});assert.equal((await f.api.reconcile(1)).status,'published');
  assert.deepEqual(f.state.calls.map(c=>c.opts.method),['POST','GET']);
});
test('reconciliation is a read using saved UID, official host and no credential redirects',async t=>{
  const f=fixture(t);await f.api.publish(1,9);f.state.handler=async()=>reply({uid:UID,readyToStream:true});assert.equal((await f.api.reconcile(1)).status,'published');
  assert.equal(f.state.calls[1].url,`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/stream/${UID}`);
  assert(f.state.calls.every(c=>c.opts.redirect==='error'&&c.opts.signal instanceof AbortSignal));
  f.state.config.accountId=OTHER;await assert.rejects(f.api.reconcile(1),/conta.*mudou/);assert.equal(f.state.calls.length,2);
});
test('mismatched GET receipt never attaches another UID or fabricates availability',async t=>{
  const f=fixture(t);await f.api.publish(1,9);f.state.handler=async()=>reply({uid:OTHER,readyToStream:true});await assert.rejects(f.api.reconcile(1),/não confirmou/);
  assert.equal(f.post().video_uid,UID);assert.equal(f.api.snapshot(1).status,'processing');
});
test('legacy saved post is reused without reupload; reconciliation repairs its claimed publication',async t=>{
  const f=fixture(t);f.db.prepare("INSERT INTO social_posts(id,user_id,video_uid,status,moderation_status) VALUES('legacy',9,?,'uploading','approved')").run(UID);
  f.db.prepare("UPDATE admin_media_projects SET production_status='published',published_post_id='legacy'").run();assert.equal((await f.api.publish(1,9)).status,'processing');assert.equal(f.state.calls.length,0);
  f.state.handler=async()=>reply();await f.api.reconcile(1);assert.equal(f.db.prepare('SELECT production_status FROM admin_media_projects').get().production_status,'approved');
  f.state.handler=async()=>reply({uid:UID,readyToStream:true});await f.api.reconcile(1);assert.equal(f.api.snapshot(1).status,'published');assert.equal(f.state.calls.every(c=>c.opts.method==='GET'),true);
});
test('image publication is atomic, approved and does not call Stream',async t=>{
  const f=fixture(t);f.db.prepare("UPDATE admin_media_projects SET format='image'").run();assert.equal((await f.api.publish(1,9)).status,'published');await f.api.publish(1,9);
  assert.equal(f.state.calls.length,0);assert.equal(f.state.ready.length,1);assert.equal(f.db.prepare('SELECT count(*) n FROM social_posts').get().n,1);
});
test('no provider request before configured, approved, public source and unpaused',async t=>{
  const f=fixture(t);f.state.paused=true;await assert.rejects(f.api.publish(1,9),/pausa/);f.state.paused=false;
  f.state.config.accountId='bad/host';await assert.rejects(f.api.publish(1,9),/Configure/);f.state.config.accountId=ACCOUNT;
  f.db.prepare("UPDATE admin_media_projects SET output_url='http://127.0.0.1/private'").run();await assert.rejects(f.api.publish(1,9),/HTTPS/);
  assert.equal(f.attempt(),undefined);assert.equal(f.state.calls.length,0);
});
test('cancelled quiz is rejected before any claim or upload',async t=>{
  const f=fixture(t);f.db.prepare("UPDATE admin_viral_quizzes SET status='cancelled'").run();await assert.rejects(f.api.publish(1,9),/cancelados/);
  assert.equal(f.attempt(),undefined);assert.equal(f.state.calls.length,0);
});
test('configuration callback mutation of format, URL or quiz cancellation cannot claim mixed settings',async t=>{
  for(const sql of ["UPDATE admin_media_projects SET format='image'","UPDATE admin_media_projects SET output_url='/uploads/changed.mp4'","UPDATE admin_viral_quizzes SET status='cancelled'"]){
    const f=fixture(t);const api=createMediaPublicationLifecycle({...f.args,getConfig:()=>{f.db.prepare(sql).run();return f.state.config}});
    await assert.rejects(api.publish(1,9),/mudou/);assert.equal(f.attempt(),undefined);assert.equal(f.state.calls.length,0);
  }
});
test('error callback refunds once and delayed progress cannot clear the failed state',t=>{
  const f=fixture(t);f.db.prepare("INSERT INTO social_posts(id,user_id,video_uid,status,moderation_status) VALUES('ordinary',4,?,'uploading','pending')").run(UID);
  f.api.applyStream({uid:UID,status:{state:'error'}});f.api.applyStream({uid:UID,status:{state:'error'}});f.api.applyStream({uid:UID,status:{state:'inprogress'}});
  assert.equal(f.post().status,'error');assert.equal(f.state.errors.length,1);
});
test('only literal boolean readiness or ready state is accepted',()=>{
  assert.equal(streamTransition({status:'uploading',moderation_status:'approved'}, {readyToStream:'false'}).status,'processing');
});
for(const format of ['image','short_video'])test(`suspended author cannot claim ${format}, notify or incur an upload`,async t=>{
  const f=fixture(t);f.db.prepare('UPDATE admin_media_projects SET format=?').run(format);f.db.prepare("INSERT INTO social_account_restrictions VALUES(9,'suspended',NULL)").run();
  await assert.rejects(f.api.publish(1,9),/suspensa/);assert.equal(f.attempt(),undefined);assert.equal(f.post(),undefined);assert.equal(f.state.calls.length,0);assert.equal(f.state.ready.length,0);
});
test('author suspension and task cancellation are checked again at claim',async t=>{
  for(const sql of ["INSERT INTO social_account_restrictions VALUES(9,'suspended',NULL)","UPDATE admin_agent_tasks SET status='cancelled'"]){
    const f=fixture(t);const api=createMediaPublicationLifecycle({...f.args,getConfig:()=>{f.db.prepare(sql).run();return f.state.config}});
    await assert.rejects(api.publish(1,9),/mudou/);assert.equal(f.attempt(),undefined);assert.equal(f.state.calls.length,0);
  }
});
test('task cancelled during copy holds the receipt without making it public',async t=>{
  const f=fixture(t);f.state.handler=async()=>{f.db.prepare("UPDATE admin_agent_tasks SET status='cancelled'").run();return reply({uid:UID,readyToStream:true})};
  assert.equal((await f.api.publish(1,9)).status,'source_changed');assert.equal(f.post().status,'pending_review');assert.equal(f.state.ready.length,0);
});
const server=readFileSync(new URL('../server.js',import.meta.url),'utf8');
const montageCode=server.slice(server.indexOf('async function finishViralQuizVideo('),server.indexOf('async function publishViralToVitrine('));
function montageFixture(t){
  const f=fixture(t);f.db.prepare("UPDATE admin_viral_quizzes SET status='in_production'").run();f.db.prepare("UPDATE admin_media_projects SET production_status='script',output_url=NULL").run();
  for(let i=1;i<=9;i++)f.db.prepare("INSERT INTO viral_quiz_scenes(quiz_id,scene_number,status,local_path,duration_seconds) VALUES(1,?,'downloaded',?,?)").run(i,`scene-${i}.mp4`,i===9?4:8);
  let finish;const state={published:0,ffmpeg:0};
  const runFfmpeg=()=>{state.ffmpeg++;return new Promise(resolve=>finish=resolve)};
  const fn=new Function('db','ecosystemCanRun','captureQuizMontage','commitQuizMontage','generatedMediaDir','fs','path','runFfmpeg','publishViralToVitrine',montageCode+';return finishViralQuizVideo;')(
    f.db,()=>!f.state.paused,captureQuizMontage,commitQuizMontage,'offline-generated',{writeFileSync:()=>{},unlinkSync:()=>{}},path,runFfmpeg,async()=>{state.published++});
  return {...f,fn,montageState:state,finish:()=>finish()};
}
for(const [label,sql] of [
  ['quiz cancellation',"UPDATE admin_viral_quizzes SET status='cancelled'"],
  ['project cancellation',"UPDATE admin_media_projects SET production_status='cancelled'"],
  ['task cancellation',"UPDATE admin_agent_tasks SET status='cancelled'"],
  ['changed file',"UPDATE admin_media_projects SET output_url='/uploads/other.mp4'"],
  ['changed scene',"UPDATE viral_quiz_scenes SET local_path='replacement.mp4' WHERE scene_number=3"],
  ['changed binding',"UPDATE admin_viral_quizzes SET media_project_id=99"]
])test(`actual FFmpeg completion cannot overwrite ${label} or publish afterwards`,async t=>{
  const f=montageFixture(t),pending=f.fn(1);assert.equal(f.montageState.ffmpeg,1);f.db.prepare(sql).run();
  const before=f.db.prepare('SELECT * FROM admin_viral_quizzes').get(),projectBefore=f.db.prepare('SELECT * FROM admin_media_projects').get();
  f.finish();assert.equal(await pending,false);assert.deepEqual(f.db.prepare('SELECT * FROM admin_viral_quizzes').get(),before);assert.deepEqual(f.db.prepare('SELECT * FROM admin_media_projects').get(),projectBefore);assert.equal(f.montageState.published,0);
});
test('unchanged montage is committed once and published only after final validation',async t=>{
  const f=montageFixture(t),pending=f.fn(1);f.finish();assert.equal(await pending,true);assert.equal(f.montageState.published,1);assert.equal(f.db.prepare('SELECT status FROM admin_viral_quizzes').get().status,'approved');
  assert.match(f.db.prepare('SELECT result_summary FROM admin_agent_tasks').get().result_summary,/Montagem concluída/);assert.equal(await f.fn(1),false);assert.equal(f.montageState.ffmpeg,1);
});
