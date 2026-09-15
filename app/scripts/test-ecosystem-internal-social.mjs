import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {createHash} from 'node:crypto';
import express from 'express';
import {createEcosystemInternalSocial} from '../ecosystem-internal-social.js';
import {setupWebStories} from '../web-stories.js';

function fixture(options={}) {
 const db=new Database(':memory:');
 db.exec(`CREATE TABLE editorial_web_stories(id TEXT PRIMARY KEY,article_id TEXT,slug TEXT,published_json TEXT,published_source_hash TEXT,published_at TEXT);
 CREATE TABLE editorial_articles(id TEXT,status TEXT);
 CREATE TABLE social_posts(id TEXT PRIMARY KEY,user_id INTEGER,video_uid TEXT UNIQUE,media_type TEXT,image_url TEXT,caption TEXT,category TEXT,cta_label TEXT,cta_url TEXT,status TEXT,moderation_status TEXT,moderated_by INTEGER,moderated_at TEXT);`);
 let policy={enabled:true,paused:false,internalSocialEnabled:true,revision:1,publisherUserId:7,dailyLimit:2};
 const sources=new Map();
 const add=(id='1',overrides={})=>{const source={title:'Uma história útil '+id,summary:'Conheça o conteúdo completo.',body:'Texto conferido',image_url:'/assets/real.jpg',updated_at:'2026-09-09',commercial:false,sourcePath:'/artigo/teste-'+id,...overrides};sources.set(id,source);const fingerprint=createHash('sha256').update(JSON.stringify([source.title,source.summary,source.body,source.image_url,source.updated_at,...(source.commercial?[source.facts,source.sourcePath]:[]),...(source.reuseBinding?[source.reuseBinding]:[])])).digest('hex');db.prepare('INSERT INTO editorial_web_stories VALUES (?,?,?,?,?,?)').run(id,id,'historia-'+id,JSON.stringify({title:source.title,description:source.summary,poster:'/story-assets/'+'a'.repeat(32)+'.jpg'}),fingerprint,'2026-09-09T10:00:00Z');};
 const create=()=>createEcosystemInternalSocial({db,siteUrl:'https://vitrinecity.com',sourceCatalog:{get:key=>sources.get(key)},getPolicy:()=>policy,isPublisherAllowed:id=>id===7,now:()=>new Date('2026-09-09T14:00:00Z'),...options});
 return {db,sources,add,create,setPolicy:p=>{policy={...policy,...p};},getPolicy:()=>policy};
}
test('confirmed current story creates one real post, restart does not duplicate',async()=>{const f=fixture();f.add();const first=await f.create().run();assert.equal(first.published,1);const post=f.db.prepare('SELECT * FROM social_posts').get();assert.equal(post.status,'ready');assert.equal(post.moderation_status,'approved');assert.equal(post.user_id,7);assert.match(post.cta_url,/^\/stories\/historia-1\?utm_source=vitriny_social/);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM ecosystem_distribution_outbox WHERE status='published'").get().n,1);assert.equal((await f.create().run()).published,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM social_posts').get().n,1);});
test('missing source, changed stock/facts, external poster and moderation cannot publish',async()=>{for(const scenario of ['missing','changed','poster','moderation']){const f=fixture(scenario==='moderation'?{moderationReason:()=> 'blocked'}:{});f.add();if(scenario==='missing')f.sources.clear();if(scenario==='changed')f.sources.get('1').body='Alteração após aprovação';if(scenario==='poster')f.db.prepare('UPDATE editorial_web_stories SET published_json=?').run(JSON.stringify({title:'Título',poster:'https://elsewhere.test/photo.jpg'}));const result=await f.create().run();assert.equal(result.held,1,scenario);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM social_posts').get().n,0);}});
test('disabled, paused, no configured publisher, unauthorized publisher and obsolete policy stop writes',async()=>{for(const policy of [{enabled:false},{paused:true},{internalSocialEnabled:false},{publisherUserId:null},{publisherUserId:12}]){const f=fixture();f.add();f.setPolicy(policy);assert.equal((await f.create().run()).published,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM ecosystem_distribution_outbox').get().n,0);}const f=fixture();f.add();let calls=0;await f.create().run({isCurrent:()=>{calls++;if(calls===3)f.setPolicy({revision:2,paused:true});return true;}});assert.equal(f.db.prepare('SELECT COUNT(*) n FROM social_posts').get().n,0);});
test('daily limit is shared across instances and retries',async()=>{const f=fixture();['1','2','3','4'].forEach(f.add);const a=f.create(),b=f.create();const outcomes=await Promise.all([a.run(),b.run()]);assert.equal(outcomes.reduce((s,r)=>s+r.published,0),2);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM social_posts').get().n,2);});
test('failed post insertion rolls back its queue transition for a later retry',async()=>{const f=fixture();f.add();const service=f.create();f.db.exec("CREATE TRIGGER reject_test BEFORE INSERT ON social_posts BEGIN SELECT RAISE(ABORT,'test unavailable'); END;");await assert.rejects(service.run(),/test unavailable/);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM ecosystem_distribution_outbox').get().n,0);f.db.exec('DROP TRIGGER reject_test');assert.equal((await service.run()).published,1);});
test('hidden story and withdrawn companion never produce a post',async()=>{const f=fixture();f.add();f.db.prepare('UPDATE editorial_web_stories SET published_json=NULL').run();assert.equal((await f.create().run()).published,0);const g=fixture();g.add();g.db.prepare('UPDATE editorial_web_stories SET published_json=?').run(JSON.stringify({title:'História',companionHash:'hash',poster:'/story-assets/'+'a'.repeat(32)+'.jpg'}));assert.equal((await g.create().run()).held,1);});
test('withdrawal between discovery and the write transaction prevents publication',async()=>{const f=fixture();f.add();let calls=0;const result=await f.create().run({isCurrent:()=>{if(++calls===3)f.db.prepare('UPDATE editorial_web_stories SET published_json=NULL').run();return true;}});assert.equal(result.published,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM social_posts').get().n,0);});
test('more than 200 stories advance across days without starving the oldest or duplicating posts',async()=>{let clock=new Date('2026-09-09T14:00:00Z');const f=fixture({now:()=>clock});for(let i=1;i<=201;i++)f.add(String(i));f.setPolicy({dailyLimit:24});const service=f.create();for(let day=0;day<10;day++){await service.run();clock=new Date(clock.getTime()+86400000);}assert.equal(f.db.prepare('SELECT COUNT(*) n FROM social_posts').get().n,201);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM ecosystem_distribution_outbox WHERE status='published'").get().n,201);});

function heldSource(f,id) {
 const story=f.db.prepare('SELECT * FROM editorial_web_stories WHERE id=?').get(id);
 const key=createHash('sha256').update([story.article_id,story.published_source_hash,'vitriny_social',7].join('|')).digest('hex');
 f.db.prepare(`INSERT INTO ecosystem_distribution_outbox(id,source_key,source_hash,story_id,publisher_user_id,status,reason,day,policy_revision,created_at,updated_at)
 VALUES (?,?,?,?,7,'held','source_changed','2026-09-08',1,'2026-09-08T14:00:00Z','2026-09-08T14:00:00Z')`).run(key,story.article_id,story.published_source_hash,id);
 return key;
}

test('legacy and reuse-bound publication hashes remain compatible without rewriting approved stories',async t=>{
 for(const [label,overrides] of Object.entries({legacy:{},commercial:{commercial:true,facts:{stock:2,price:10}},reused:{reuseBinding:'a'.repeat(64)},commercialReuse:{commercial:true,facts:{stock:2,price:10},reuseBinding:'b'.repeat(64)}})) {
  const f=fixture();t.after(()=>f.db.close());f.add('1',overrides);
  const before=f.db.prepare('SELECT * FROM editorial_web_stories').get();
  assert.equal((await f.create().run()).published,1,label);
  assert.deepEqual(f.db.prepare('SELECT * FROM editorial_web_stories').get(),before,label);
 }
});

test('existing reuse holds resume under the same outbox ID, shared quota and restart deduplication',async t=>{
 let clock=new Date('2026-09-09T14:00:00Z');const f=fixture({now:()=>clock});t.after(()=>f.db.close());
 f.add('12',{reuseBinding:'a'.repeat(64)});f.add('13',{reuseBinding:'b'.repeat(64)});f.setPolicy({dailyLimit:1});f.create();
 const keys=[heldSource(f,'12'),heldSource(f,'13')].sort();
 const before=f.db.prepare('SELECT * FROM editorial_web_stories ORDER BY id').all();
 assert.equal((await f.create().run()).published,1);
 assert.equal((await f.create().run()).published,0,'a second instance cannot bypass today\'s quota');
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM ecosystem_distribution_outbox WHERE status='held'").get().n,1);
 clock=new Date('2026-09-10T14:00:00Z');assert.equal((await f.create().run()).published,1);
 assert.equal((await f.create().run()).published,0);
 assert.deepEqual(f.db.prepare('SELECT id FROM ecosystem_distribution_outbox ORDER BY id').all().map(row=>row.id),keys);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM social_posts').get().n,2);
 assert.deepEqual(f.db.prepare('SELECT * FROM editorial_web_stories ORDER BY id').all(),before);
});

test('reuse hold recovery still obeys pause, publisher authorization, moderation and the final policy guard',async t=>{
 for(const scenario of ['paused','publisher','moderation','pause-during-prepare']) {
  const f=fixture({...(scenario==='publisher'?{isPublisherAllowed:()=>false}:{}),moderationReason:()=>{if(scenario==='pause-during-prepare')f.setPolicy({paused:true,revision:2});return scenario==='moderation'?'blocked':'';}});
  t.after(()=>f.db.close());f.add('1',{reuseBinding:'a'.repeat(64)});f.create();const id=heldSource(f,'1');
  if(scenario==='paused')f.setPolicy({paused:true});
  const before=f.db.prepare('SELECT * FROM editorial_web_stories').get();
  assert.equal((await f.create().run()).published,0,scenario);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM social_posts').get().n,0,scenario);
  assert.equal(f.db.prepare('SELECT status FROM ecosystem_distribution_outbox WHERE id=?').get(id).status,'held',scenario);
  assert.deepEqual(f.db.prepare('SELECT * FROM editorial_web_stories').get(),before,scenario);
 }
});

test('changed or missing reuse binding and real source changes remain held with no legacy-hash fallback',async t=>{
 for(const scenario of ['binding','removed-binding','body','image','timestamp','title','facts','destination','legacy-hash']) {
  const f=fixture();t.after(()=>f.db.close());f.add('1',{reuseBinding:'a'.repeat(64),commercial:true,facts:{stock:2,price:10}});f.create();heldSource(f,'1');
  const source=f.sources.get('1');
  if(scenario==='binding')source.reuseBinding='b'.repeat(64);
  if(scenario==='removed-binding')delete source.reuseBinding;
  if(scenario==='body')source.body+=' Mudança real.';
  if(scenario==='image')source.image_url='/assets/changed.jpg';
  if(scenario==='timestamp')source.updated_at='2026-09-10';
  if(scenario==='title')source.title+=' novo';
  if(scenario==='facts')source.facts.stock=0;
  if(scenario==='destination')source.sourcePath='/artigo/outro';
  if(scenario==='legacy-hash')f.db.prepare('UPDATE editorial_web_stories SET published_source_hash=?').run(createHash('sha256').update(JSON.stringify([source.title,source.summary,source.body,source.image_url,source.updated_at,source.facts,source.sourcePath])).digest('hex'));
  const before=f.db.prepare('SELECT * FROM editorial_web_stories').get();
  const result=await f.create().run();assert.equal(result.published,0,scenario);assert.equal(result.items[0].reason,'source_changed',scenario);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM social_posts').get().n,0,scenario);
  assert.deepEqual(f.db.prepare('SELECT * FROM editorial_web_stories').get(),before,scenario);
 }
});

test('a real reviewed and published reuse Story distributes once without an independently recomputed hash',async t=>{
 const f=fixture();f.db.exec('DROP TABLE editorial_web_stories');
 const key='prayer-video:2026-09-13:07',source={key,kind:'page',portal:'oracao',slug:'oracao-2026-09-13',title:'Oração de domingo',summary:'Uma oração completa para acompanhar este domingo com serenidade.',body:'Texto original aprovado. '.repeat(30),image_url:'/assets/prayer.jpg',sourcePath:'/oracao-do-dia/2026-09-13',updated_at:'2026-09-13T10:00:00Z',reuseBinding:'a'.repeat(64),facts:{reuseContentHash:'b'.repeat(64)}};
 f.sources.set(key,source);const app=express();app.use(express.json());
 const producer=setupWebStories({app,db:f.db,siteUrl:'https://vitrinecity.test',publicDir:process.cwd(),dataDir:process.cwd(),sourceCatalog:{get:id=>f.sources.get(id),list:()=>[]},assets:{outputDir:process.cwd(),image:async url=>({url,width:720,height:1280}),poster:async()=>'/story-assets/'+'a'.repeat(32)+'.jpg'},requireAdmin:(_req,_res,next)=>next(),sameOriginOnly:(_req,_res,next)=>next()});
 const server=await new Promise(resolve=>{const active=app.listen(0,'127.0.0.1',()=>resolve(active));});
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));f.db.close();});
 const story=await producer.createManualDraft({sourceKey:key,draft:{title:source.title,description:source.summary,pages:Array.from({length:10},(_,i)=>({text:`Preserve este momento de oração e serenidade na etapa ${i+1}.`,alt:'Ilustração da oração',image:source.image_url}))}});
 const call=(action,body)=>fetch('http://127.0.0.1:'+server.address().port+'/api/admin/web-stories/'+story.id+'/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await call('preview',{revision:1})).status,200);
 assert.equal((await call('publish',{revision:1,reviewed:true,rightsConfirmed:true})).status,200);
 const before=f.db.prepare('SELECT * FROM editorial_web_stories').get();assert.equal(JSON.parse(before.published_json).reuseBinding,source.reuseBinding);
 const consumer=f.create();assert.equal((await consumer.run()).published,1);assert.equal((await f.create().run()).published,0);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM social_posts').get().n,1);
 assert.deepEqual(f.db.prepare('SELECT * FROM editorial_web_stories').get(),before);
});
