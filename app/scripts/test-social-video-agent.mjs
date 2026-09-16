import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {createSocialVideoAgent,directVideoPublisher,createVideoSafetyReview} from '../social-video-agent.js';
import {streamTransition} from '../media-publication-lifecycle.js';
const UID='a'.repeat(32);
function fixture(t){
 const db=new Database(':memory:');t.after(()=>db.close());
 db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,account_status TEXT);INSERT INTO users VALUES(4,'active'),(5,'active');
 CREATE TABLE social_posts(id TEXT PRIMARY KEY,user_id INTEGER,video_uid TEXT,caption TEXT,cta_label TEXT,cta_url TEXT,media_type TEXT,status TEXT,moderation_status TEXT,moderation_reason TEXT,moderated_by INTEGER,moderated_at TEXT,stream_state TEXT,updated_at TEXT,created_at TEXT);
 INSERT INTO social_posts VALUES('post',5,'${UID}','Uma horta bonita','','','video','uploading','pending','',NULL,NULL,'',NULL,'2026-09-16');
 CREATE TABLE social_account_restrictions(user_id INTEGER,status TEXT,restricted_until TEXT);
 CREATE TABLE social_reports(post_id TEXT,status TEXT);
 CREATE TABLE social_moderation_actions(post_id TEXT,author_id INTEGER,admin_id INTEGER,action TEXT,reason_code TEXT,note TEXT,previous_status TEXT,new_status TEXT);`);
 const state={reviews:0,ready:0,requests:0,paused:false,time:Date.now(),approve:true,streamReady:true,hook:null};
 const read=()=>db.prepare('SELECT * FROM social_posts').get();
 const lifecycle={applyStream(v){const p=read(),next=streamTransition(p,v);db.prepare('UPDATE social_posts SET status=?,stream_state=?,moderation_status=? WHERE id=?').run(next.status,next.streamState,next.moderationStatus,p.id);if(next.status==='ready'&&p.status!=='ready')state.ready++;},approvalStatus(){return read().stream_state==='ready'?'ready':'processing';}};
 const agent=createSocialVideoAgent({db,lifecycle,schedule:false,now:()=>state.time,canRun:()=>!state.paused,getConfig:()=>({enabled:true,accountId:'test',token:'test',directUserIds:'4'}),review:async()=>{state.reviews++;await state.hook?.();return{approved:state.approve,model:'test'};},fetchImpl:async()=>{state.requests++;return{ok:true,json:async()=>({result:{uid:UID,readyToStream:state.streamReady,status:{state:state.streamReady?'ready':'inprogress'},duration:30}})}}});
 return{db,state,read,agent};
}
test('explicit active owner only; client flags and other admins cannot bypass',()=>{
 assert.equal(directVideoPublisher({id:4,account_status:'active'},'4'),true);
 for(const u of [{id:5,is_admin:1,account_status:'active'},{id:4,account_status:'suspended'},{id:'4',account_status:'active'}])assert.equal(directVideoPublisher(u,'4'),false);
 assert.equal(directVideoPublisher({id:4,account_status:'active'},''),false);
});
test('ready ordinary video is analyzed, published and notified once',async t=>{const f=fixture(t);await f.agent.run();await f.agent.run();assert.equal(f.read().status,'ready');assert.equal(f.state.reviews,1);assert.equal(f.state.ready,1);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM social_moderation_actions').get().n,1);});
test('owner bypasses agent analysis',async t=>{const f=fixture(t);f.db.prepare('UPDATE social_posts SET user_id=4').run();await f.agent.run();assert.equal(f.read().status,'ready');assert.equal(f.state.reviews,0);});
test('unfinished processing never becomes a published video',async t=>{const f=fixture(t);f.state.streamReady=false;await f.agent.run();assert.equal(f.read().status,'processing');assert.equal(f.state.reviews,0);});
test('flagged model result goes to additional review, not automatic rejection',async t=>{const f=fixture(t);f.state.approve=false;await f.agent.run();assert.equal(f.read().status,'pending_review');assert.equal(f.read().moderation_status,'flagged');assert.equal(f.agent.status('post').state,'review');});
test('reports received while agent analyzes prevent approval',async t=>{const f=fixture(t);f.state.hook=()=>f.db.prepare("INSERT INTO social_reports VALUES('post','open')").run();await f.agent.run();assert.notEqual(f.read().moderation_status,'approved');assert.equal(f.state.ready,0);});
test('manual decision during analysis is preserved',async t=>{const f=fixture(t);f.state.hook=()=>f.db.prepare("UPDATE social_posts SET status='deleted',moderation_status='removed'").run();await f.agent.run();assert.equal(f.read().status,'deleted');assert.equal(f.state.ready,0);});
test('suspension and global pause prevent calls',async t=>{const f=fixture(t);f.state.paused=true;await f.agent.run();assert.equal(f.state.requests,0);f.state.paused=false;f.db.prepare("INSERT INTO social_account_restrictions VALUES(5,'suspended',NULL)").run();await f.agent.run();assert.equal(f.state.requests,0);});
test('analysis outages are retried with delay, never approved',async t=>{const f=fixture(t);f.state.hook=()=>{throw Error('offline')};await f.agent.run();assert.equal(f.agent.status('post').state,'retry');await f.agent.run();assert.equal(f.state.reviews,1);for(let i=0;i<3;i++){f.state.time+=300001;await f.agent.run();}assert.equal(f.agent.status('post').state,'review');assert.notEqual(f.read().moderation_status,'approved');});
test('concurrent ticks cannot double analyze',async t=>{const f=fixture(t);await Promise.all([f.agent.run(),f.agent.run()]);assert.equal(f.state.reviews,1);});
test('safety provider rejects arbitrary thumbnail host before networking',async()=>{let calls=0;const review=createVideoSafetyReview({apiKey:()=> 'key',fetchImpl:async()=>{calls++;}});await assert.rejects(review({video_uid:UID},{duration:30,thumbnail:'https://example.com/private'}));assert.equal(calls,0);});
test('safety provider requires complete valid moderation response',async()=>{let calls=0;const review=createVideoSafetyReview({apiKey:()=> 'key',fetchImpl:async(url,opts)=>{calls++;if(String(url).startsWith('https://api.openai.com')){assert.equal(JSON.parse(opts.body).input.length,6);return{ok:true,json:async()=>({id:'x',results:[]})};}return new Response(new Uint8Array([255,216,255]),{headers:{'Content-Type':'image/jpeg'}});}});await assert.rejects(review({video_uid:UID,caption:'horta'},{duration:30,thumbnail:`https://videodelivery.net/${UID}/thumbnails/thumbnail.jpg`}));assert.equal(calls,6);});
