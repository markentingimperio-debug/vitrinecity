import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import Database from 'better-sqlite3';
import {createStoryAutomation,STORY_AUTOMATION_GROUPS} from '../web-story-automation.js';

const beginning=Date.parse('2026-09-08T12:00:00Z');
const source=(key,group='products',fingerprint='v1')=>({key,group,fingerprint,title:'Fonte local '+key});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
async function fixture(t,{sources=[source('product:1')],processor,configured=true,file=false}={}){
  const folder=file?mkdtempSync(path.join(tmpdir(),'vc-story-automation-')):null,dbPath=folder?path.join(folder,'fixture.db'):':memory:';
  const db=new Database(dbPath);let time=beginning,ready=configured;const called=[],engines=[],databases=[db],queries=[];
  const processSource=processor||(async(item,{isCurrent})=>{assert.ok(isCurrent());called.push(item.key);return {status:'published',storyId:'story:'+item.key,summary:'Publicado na fixture.'};});
  const getCandidates=({group,limit,offset})=>{queries.push({group,limit,offset});return sources.filter(item=>item.group===group).slice(offset,offset+limit);};
  const make=(options={})=>{const engine=createStoryAutomation({db,getCandidates,processSource,isConfigured:()=>ready,now:()=>time,...options});engines.push(engine);return engine;};
  const engine=make();
  t.after(async()=>{for(const item of engines)item.close();await Promise.all(engines.map(item=>item.awaitIdle()));for(const item of databases)item.close();if(folder){assert.equal(path.dirname(path.resolve(folder)),path.resolve(tmpdir()));assert.ok(path.basename(folder).startsWith('vc-story-automation-'));rmSync(folder,{recursive:true,force:true});}});
  return {db,engine,sources,called,queries,make,advance:ms=>{time+=ms;},setTime:value=>{time=Date.parse(value);},setConfigured:value=>{ready=value;},
    second:options=>{const other=new Database(dbPath);databases.push(other);return make({db:other,...options});}};
}
const update=(engine,input,actor)=>engine.updateSettings({revision:engine.status().revision,...input},actor);

test('global pause gates claims and publication while central coordination suppresses only automatic ticks',async t=>{
  const f=await fixture(t);let paused=true,central=true;
  const engine=f.make({canRun:()=>!paused,autoRunAllowed:()=>!central});update(engine,{enabled:true});
  engine.run({manual:true});await engine.awaitIdle();assert.equal(f.called.length,0);assert.equal(engine.status().reason,'global_paused');
  paused=false;engine.run();await engine.awaitIdle();assert.equal(f.called.length,0);assert.equal(engine.status().reason,'centrally_coordinated');
  engine.run({manual:true});await engine.awaitIdle();assert.equal(f.called.length,1);
  f.sources.push(source('paused-publication'));const wait=deferred();let started=false,published=0;
  const second=f.make({canRun:()=>!paused,processSource:async(_source,context)=>{started=true;await wait.promise;if(context.isCurrent())published++;return {status:'published',storyId:'second'};}});
  second.run({manual:true});await new Promise(r=>setImmediate(r));assert(started);paused=true;wait.resolve();await second.awaitIdle();assert.equal(published,0);assert.equal(second.status().quota.interrupted,1);
});
const run=async(engine,options={manual:true})=>{engine.run(options);return engine.awaitIdle();};

test('defaults disabled, no automatic timer or provider activity, strict configurable bounds',async t=>{
  const f=await fixture(t),s=f.engine.status();assert.equal(s.enabled,false);assert.equal(s.dailyLimit,6);assert.equal(s.hour,9);assert.equal(s.timeZone,'America/Sao_Paulo');assert.equal(s.nextAt,null);
  assert.equal((await run(f.engine)).reason,'disabled');assert.equal(f.called.length,0);
  for(const input of [{enabled:'true'},{dailyLimit:0},{dailyLimit:25},{dailyLimit:1.5},{hour:-1},{hour:24},{hour:1.5}])assert.throws(()=>update(f.engine,input));
  update(f.engine,{enabled:true,dailyLimit:1,hour:9},'admin-fixture');f.advance(2*86400000);await new Promise(setImmediate);assert.equal(f.called.length,0);
  assert.equal(f.engine.status().revision,2);assert.equal(f.db.prepare('SELECT count(*) n FROM web_story_automation_events').get().n,1);
});

test('manual runs still require enabled configuration and respect the daily attempt cap',async t=>{
  const f=await fixture(t,{configured:false,sources:[source('a'),source('b'),source('c')]});update(f.engine,{enabled:true,dailyLimit:2});
  assert.equal((await run(f.engine)).reason,'not_configured');assert.equal(f.called.length,0);
  f.setConfigured(true);const s=await run(f.engine);assert.equal(s.quota.attempted,2);assert.equal(s.quota.published,2);
  await run(f.engine);assert.equal(f.called.length,2);assert.equal(f.engine.status().quota.remaining,0);
});

test('daily scheduling uses São Paulo local day/hour and runs once without catch-up',async t=>{
  const f=await fixture(t,{sources:[source('a'),source('b'),source('c')]});update(f.engine,{enabled:true,dailyLimit:1});
  f.setTime('2026-09-08T11:59:00Z');assert.equal(f.engine.status().nextAt,'2026-09-08T12:00:00.000Z');assert.equal((await run(f.engine,{manual:false})).reason,'before_schedule');
  f.setTime('2026-09-08T12:00:00Z');await run(f.engine,{manual:false});assert.equal(f.called.length,1);assert.equal(f.engine.status().nextAt,'2026-09-09T12:00:00.000Z');
  f.setTime('2026-09-12T18:00:00Z');await run(f.engine,{manual:false});assert.equal(f.called.length,2,'A four-day jump creates only one current-day attempt');
  f.setTime('2026-09-13T02:59:00Z');assert.equal(f.engine.status().quota.date,'2026-09-12');await run(f.engine,{manual:false});assert.equal(f.called.length,2);
  f.setTime('2026-09-13T03:00:00Z');assert.equal(f.engine.status().quota.date,'2026-09-13');assert.equal((await run(f.engine,{manual:false})).reason,'before_schedule');
});

test('identical successful source fingerprints are never repeated across days or instances',async t=>{
  const f=await fixture(t,{file:true});update(f.engine,{enabled:true});await run(f.engine);f.advance(86400000);
  const second=f.second();await run(second);assert.deepEqual(f.called,['product:1']);assert.equal(second.status().quota.attempted,0);
});

test('changed published sources update the same story ID, after unpublished sources',async t=>{
  const f=await fixture(t);update(f.engine,{enabled:true,dailyLimit:2});await run(f.engine);f.advance(86400000);
  f.sources[0].fingerprint='v2';f.sources.push(source('service:2','services'));await run(f.engine);
  assert.deepEqual(f.called,['product:1','service:2','product:1']);
  const ids=f.db.prepare("SELECT story_id FROM web_story_automation_jobs WHERE source_key='product:1' AND status='published'").all();assert.deepEqual(ids.map(row=>row.story_id),['story:product:1','story:product:1']);
  f.advance(86400000);await run(f.engine);assert.equal(f.called.length,3);
  f.sources[0].fingerprint='v1';await run(f.engine);assert.equal(f.called.length,4,'A source correction back to earlier content updates its current story');
  assert.deepEqual(f.db.prepare("SELECT story_id FROM web_story_automation_jobs WHERE source_key='product:1' AND status='published' ORDER BY id").all().map(row=>row.story_id),['story:product:1','story:product:1','story:product:1']);
});

test('review holds do not repeat unchanged content but retry when source fingerprint changes',async t=>{
  let count=0;const f=await fixture(t,{processor:async()=>({status:'review',storyId:'review:1',summary:`Revisão ${++count}`})});update(f.engine,{enabled:true});
  await run(f.engine);f.advance(86400000);await run(f.engine);assert.equal(count,1);
  f.sources[0].fingerprint='v2';await run(f.engine);assert.equal(count,2);assert.equal(f.engine.status().quota.review,1);
});

test('failed attempts consume quota and unchanged failures wait a full 24 hours across midnight',async t=>{
  let count=0;const f=await fixture(t,{processor:async()=>{count++;throw Error('SECRET_PROVIDER_TOKEN_DO_NOT_EXPOSE');}});update(f.engine,{enabled:true,dailyLimit:2});
  f.setTime('2026-09-09T02:30:00Z');await run(f.engine);assert.equal(f.engine.status().quota.failed,1);
  f.advance(23*3600000);await run(f.engine);assert.equal(count,1);assert.equal(f.engine.status().quota.attempted,0);
  f.advance(3600000);await run(f.engine);assert.equal(count,2);
  assert.equal(JSON.stringify(f.engine.status()).includes('SECRET_PROVIDER_TOKEN'),false);
});

test('errors count toward the total daily budget even when every candidate fails',async t=>{
  let count=0;const f=await fixture(t,{sources:Array.from({length:8},(_,i)=>source('p:'+i)),processor:async()=>{count++;throw Error('fixture');}});update(f.engine,{enabled:true,dailyLimit:3});
  const s=await run(f.engine);assert.equal(count,3);assert.equal(s.quota.attempted,3);assert.equal(s.quota.failed,3);await run(f.engine);assert.equal(count,3);
});

test('round-robin fairness persists across days with a smaller quota than the category count',async t=>{
  const f=await fixture(t,{sources:STORY_AUTOMATION_GROUPS.flatMap(group=>[source(group+':1',group),source(group+':2',group)])});update(f.engine,{enabled:true,dailyLimit:2});
  for(let day=0;day<3;day++){await run(f.engine);f.advance(86400000);}
  assert.deepEqual(f.called,STORY_AUTOMATION_GROUPS.map(group=>group+':1'));
});

test('a category with updates keeps its fair turn despite an unlimited backlog of new sources elsewhere',async t=>{
  const f=await fixture(t,{sources:[source('recipe:1','recipes')]});update(f.engine,{enabled:true,dailyLimit:2,groups:['recipes','products']});await run(f.engine);
  f.sources[0].fingerprint='v2';f.sources.push(...Array.from({length:8},(_,i)=>source('product:'+i)));f.advance(86400000);
  await run(f.engine);assert.deepEqual(f.called,['recipe:1','product:0','recipe:1']);assert.equal(f.engine.status().quota.attempted,2);
  assert.deepEqual(f.db.prepare("SELECT story_id FROM web_story_automation_jobs WHERE source_key='recipe:1' ORDER BY id").all().map(row=>row.story_id),['story:recipe:1','story:recipe:1']);
});

test('new sources precede updates within one category without resetting consumed quota',async t=>{
  const f=await fixture(t,{sources:[source('recipe:1','recipes')]});update(f.engine,{enabled:true,dailyLimit:2,groups:['recipes']});await run(f.engine);
  f.sources[0].fingerprint='v2';f.sources.push(source('recipe:2','recipes'));f.advance(86400000);await run(f.engine);
  assert.deepEqual(f.called,['recipe:1','recipe:2','recipe:1']);assert.equal(f.engine.status().quota.remaining,0);
  await run(f.engine);assert.equal(f.called.length,3);
});

test('pagination reaches candidates after hundreds of previously reviewed sources',async t=>{
  const sources=Array.from({length:420},(_,i)=>source('p:'+i)),f=await fixture(t,{sources});update(f.engine,{enabled:true,dailyLimit:1});
  const fingerprint=(await import('node:crypto')).createHash('sha256').update('v1').digest('hex');
  const add=f.db.prepare("INSERT INTO web_story_automation_jobs(source_key,fingerprint,group_name,day,status,owner,settings_revision,actor,started_at) VALUES (?,?,'products','2026-09-01','review','fixture',1,'fixture',1)");
  f.db.transaction(()=>{for(let i=0;i<419;i++)add.run('p:'+i,fingerprint);})();
  await run(f.engine);assert.deepEqual(f.called,['p:419']);assert.ok(f.queries.some(q=>q.offset>=400));
});

test('a single atomic lease across independent SQLite connections prevents concurrent workers',async t=>{
  const entered=deferred(),finish=deferred();let calls=0;
  const f=await fixture(t,{file:true,processor:async()=>{calls++;entered.resolve();await finish.promise;return {status:'published',storyId:'story:1'};}});update(f.engine,{enabled:true,dailyLimit:1});
  f.engine.run();await entered.promise;const other=f.second();assert.equal(other.run({manual:true}).running,true);await other.awaitIdle();assert.equal(calls,1);
  finish.resolve();await f.engine.awaitIdle();assert.equal(f.engine.status().quota.published,1);
});

test('expired lease recovery resumes remaining budget; stale completion cannot publish or overwrite history',async t=>{
  const entered=deferred(),release=deferred();let oldCurrent;
  const f=await fixture(t,{file:true,sources:[source('a'),source('b')],processor:async(item,{isCurrent})=>{oldCurrent=isCurrent;entered.resolve();await release.promise;return {status:'published',storyId:'stale-story'};}});update(f.engine,{enabled:true,dailyLimit:2});
  f.engine.run();await entered.promise;f.advance(121000);
  const processed=[];const other=f.second({processSource:async item=>{processed.push(item.key);return {status:'published',storyId:'story:'+item.key};}});
  await run(other,{manual:false});assert.deepEqual(processed,['b']);assert.equal(oldCurrent(),false);
  release.resolve();await f.engine.awaitIdle();const state=other.status();assert.equal(state.quota.attempted,2);assert.equal(state.quota.interrupted,1);assert.equal(state.quota.published,1);
  assert.equal(state.history.some(job=>job.storyId==='stale-story'),false);
});

test('pause aborts in-flight processing, keeps its cost, and prevents any subsequent publication',async t=>{
  const entered=deferred();let signal,current;
  const f=await fixture(t,{sources:[source('a'),source('b')],processor:async(_item,ctx)=>{signal=ctx.signal;current=ctx.isCurrent;entered.resolve();await new Promise(()=>{});}});update(f.engine,{enabled:true});
  f.engine.run({manual:true});await entered.promise;update(f.engine,{enabled:false},'admin');await f.engine.awaitIdle();
  assert.equal(signal.aborted,true);assert.equal(current(),false);assert.equal(f.engine.status().quota.interrupted,1);assert.equal(f.engine.status().quota.attempted,1);assert.equal(f.engine.status().running,false);
});

test('settings revision from another instance and configuration loss invalidate publication immediately',async t=>{
  const entered=deferred(),release=deferred();let current;
  const f=await fixture(t,{file:true,processor:async(_item,ctx)=>{current=ctx.isCurrent;entered.resolve();await release.promise;return {status:'published',storyId:'stale'};}});update(f.engine,{enabled:true});
  f.engine.run({manual:true});await entered.promise;const other=f.second();update(other,{hour:10});assert.equal(current(),false);release.resolve();await f.engine.awaitIdle();assert.equal(other.status().quota.published,0);
  f.setConfigured(false);assert.equal((await run(other)).reason,'not_configured');
});

test('clock rollback cannot reopen a consumed previous day; closing cancels own worker only',async t=>{
  const f=await fixture(t,{sources:[source('a'),source('b')]});update(f.engine,{enabled:true,dailyLimit:1});await run(f.engine);
  f.setTime('2026-09-07T12:00:00Z');assert.equal((await run(f.engine)).reason,'clock_behind');assert.equal(f.called.length,1);
  assert.equal(f.engine.status().nextAt,'2026-09-09T12:00:00.000Z');
  f.engine.close();assert.equal(f.engine.run({manual:true}).reason,'closed');assert.throws(()=>update(f.engine,{enabled:true}));
});

test('missing fingerprints use stable object hashing and repeated empty automatic cycles do not spin',async t=>{
  const item={key:'plain',group:'products',title:'Original',details:{a:1,b:2}},f=await fixture(t,{sources:[item]});update(f.engine,{enabled:true});await run(f.engine);
  f.advance(86400000);f.sources[0]={details:{b:2,a:1},title:'Original',group:'products',key:'plain'};await run(f.engine,{manual:false});assert.equal(f.called.length,1);
  const previous=f.queries.length;await run(f.engine,{manual:false});assert.equal(f.queries.length,previous);assert.equal(f.engine.status().reason,'already_scheduled');
});

test('settings use atomic optimistic revision checks and never overwrite a newer tab',async t=>{
  const f=await fixture(t,{file:true}),other=f.second(),before=f.engine.status();
  const changed=f.engine.updateSettings({revision:before.revision,enabled:true,hour:10,groups:['recipes']},'first-admin');
  assert.equal(changed.revision,before.revision+1);
  for(const revision of [undefined,before.revision,'2',null])assert.throws(()=>other.updateSettings({revision,enabled:false,hour:17,groups:['products']}),{status:409,code:'settings_revision_conflict'});
  assert.equal(other.status().enabled,true);assert.equal(other.status().hour,10);assert.deepEqual(other.status().groups,['recipes']);
  assert.equal(f.db.prepare('SELECT count(*) n FROM web_story_automation_events').get().n,1);
  const updated=other.updateSettings({revision:changed.revision,dailyLimit:4},'second-admin');assert.equal(updated.dailyLimit,4);assert.deepEqual(updated.groups,['recipes']);
});

test('selected categories persist across restart and candidates are queried only for those categories',async t=>{
  const f=await fixture(t,{file:true,sources:STORY_AUTOMATION_GROUPS.map(group=>source(group+':1',group))});
  update(f.engine,{enabled:true,dailyLimit:6,groups:['recipes','services']});
  assert.deepEqual(f.engine.status().groups,['services','recipes']);await run(f.engine);
  assert.deepEqual(f.called,['services:1','recipes:1']);assert.deepEqual([...new Set(f.queries.map(query=>query.group))],['services','recipes']);
  const other=f.second();assert.deepEqual(other.status().groups,['services','recipes']);assert.equal(other.status().quota.attempted,2);
  update(other,{groups:['news']});f.queries.length=0;await run(other);assert.deepEqual(f.called,['services:1','recipes:1','news:1']);assert.ok(f.queries.every(query=>query.group==='news'));
});

test('invalid category selections do not alter settings or their revision',async t=>{
  const f=await fixture(t),revision=f.engine.status().revision;
  for(const groups of [[],null,'products',['unknown'],['products','products'],[1]])assert.throws(()=>f.engine.updateSettings({revision,groups}),{status:400,code:'invalid_automation_settings'});
  assert.equal(f.engine.status().revision,revision);assert.deepEqual(f.engine.status().groups,STORY_AUTOMATION_GROUPS);
});

test('additive category migration preserves existing settings and revisions',async t=>{
  const db=new Database(':memory:');
  db.exec(`CREATE TABLE web_story_automation_settings(id INTEGER PRIMARY KEY,enabled INTEGER NOT NULL,daily_limit INTEGER NOT NULL,hour INTEGER NOT NULL,revision INTEGER NOT NULL,next_group INTEGER NOT NULL,lease_owner TEXT NOT NULL,lease_until INTEGER NOT NULL,max_day TEXT NOT NULL,last_auto_day TEXT NOT NULL,last_reason TEXT NOT NULL,updated_by TEXT NOT NULL,updated_at INTEGER NOT NULL);
    INSERT INTO web_story_automation_settings VALUES(1,0,3,14,8,0,'',0,'','','disabled','existing-admin',123);`);
  const engine=createStoryAutomation({db,getCandidates:()=>[],processSource:async()=>({status:'review'}),now:()=>beginning});
  t.after(async()=>{engine.close();await engine.awaitIdle();db.close();});
  const state=engine.status();assert.equal(state.dailyLimit,3);assert.equal(state.hour,14);assert.equal(state.revision,8);assert.deepEqual(state.groups,STORY_AUTOMATION_GROUPS);
});

test('catalog failures back off durably across instances and stop after three failed scans without using a slot',async t=>{
  const f=await fixture(t,{file:true});let broken=true,lookups=0;
  const getCandidates=()=>{lookups++;if(broken)throw Error('private catalog detail');return f.sources;};
  const engine=f.make({getCandidates});update(engine,{enabled:true,groups:['products']});await run(engine,{manual:false});
  assert.equal(engine.status().reason,'candidate_error');assert.equal(engine.status().quota.attempted,0);assert.deepEqual(engine.status().catalogRetry,{pending:true,attempts:1,remaining:2,nextAt:'2026-09-08T12:15:00.000Z'});
  const lookupsFirst=lookups,other=f.second({getCandidates});await run(other);assert.equal(lookups,lookupsFirst);assert.equal(other.status().reason,'candidate_retry_wait');
  f.advance(15*60000);await run(other,{manual:false});assert.equal(other.status().catalogRetry.attempts,2);assert.equal(other.status().catalogRetry.nextAt,'2026-09-08T12:45:00.000Z');
  f.advance(30*60000);await run(engine,{manual:false});assert.equal(engine.status().catalogRetry.remaining,0);const max=lookups;
  broken=false;f.advance(5*3600000);await run(other);assert.equal(lookups,max);assert.equal(other.status().reason,'candidate_retry_limit');assert.equal(other.status().quota.attempted,0);assert.equal(other.status().nextAt,null);assert.doesNotMatch(JSON.stringify(other.status()),/private catalog detail/);
  f.advance(24*3600000);await run(other,{manual:false});assert.equal(other.status().quota.published,1);assert.equal(other.status().catalogRetry.pending,false);
});

test('a recovered catalog resumes after the first wait, preserves prior review jobs and does not rerun on every tick',async t=>{
  const f=await fixture(t);let broken=true;
  const engine=f.make({getCandidates:()=>{if(broken)throw Error('unavailable');return f.sources;}});update(engine,{enabled:true,groups:['products']});
  await run(engine,{manual:false});assert.equal(f.db.prepare('SELECT last_auto_day FROM web_story_automation_settings').get().last_auto_day,'');
  broken=false;f.advance(15*60000);await run(engine,{manual:false});assert.equal(engine.status().quota.published,1);assert.equal(engine.status().catalogRetry.pending,false);
  f.sources.push(source('later'));await run(engine,{manual:false});assert.equal(engine.status().quota.published,1);assert.equal(engine.status().reason,'already_scheduled');
});
