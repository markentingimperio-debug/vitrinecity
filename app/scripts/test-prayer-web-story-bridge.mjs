import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import express from 'express';
import Database from 'better-sqlite3';
import {createPrayerWebStoryBridge,prayerStoryKey,prayerStoryPages,PRAYER_STORY_IMAGE} from '../prayer-web-story-bridge.js';
import {prayerVideoScript} from '../prayer-media.js';
import {getDailyPrayer} from '../prayer-daily.js';
import {createStoryAssets} from '../web-story-assets.js';
import {setupDailyWebStories} from '../web-story-daily.js';
import {createEcosystemCatalog} from '../ecosystem-catalog.js';

const origin='https://vitrinecity.com',day='2026-09-12',key=prayerStoryKey(day),sha=value=>createHash('sha256').update(value).digest('hex');
const shippedPublic=fileURLToPath(new URL('../public',import.meta.url));
function setup(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prayer-story-')),dataDir=path.join(dir,'data'),publicDir=path.join(dir,'public');
  fs.mkdirSync(dataDir,{recursive:true});fs.mkdirSync(path.join(publicDir,'assets','prayer'),{recursive:true});
  for(const asset of [PRAYER_STORY_IMAGE,'/assets/pwa-icon-192.png'])fs.copyFileSync(path.join(shippedPublic,asset),path.join(publicDir,asset));
  const db=new Database(':memory:');db.exec('CREATE TABLE editorial_articles(id TEXT PRIMARY KEY,slug TEXT,title TEXT,summary TEXT,body TEXT,image_url TEXT,portal TEXT,status TEXT,updated_at TEXT,published_at TEXT,sources_json TEXT)');
  let running=true,date=new Date(day+'T15:00:00Z'),intercept=null;
  function ready(forDay=day){
    const folder=path.join(dataDir,'prayer-media',forDay,'short');fs.mkdirSync(folder,{recursive:true});
    // This suite tests the ready-file/hash contract. Codec validation belongs to
    // the existing render/ready tests; these bytes are synthetic, not a video.
    const videoPath=path.join(folder,'video.mp4'),bytes=Buffer.from('offline-ready-fixture-'+forDay+'-'.repeat(40));fs.writeFileSync(videoPath,bytes);
    const script=prayerVideoScript(forDay,'short'),metadata={day:forDay,format:'short',videoPath,publicVideoUrl:origin+'/prayer-media/'+forDay+'/short.mp4',width:720,height:1280,durationSeconds:24,bytes:bytes.length,sha256:sha(bytes),binding:sha(JSON.stringify(script)),script,caption:script.text+' #Oracao'+forDay.replaceAll('-',''),createdAt:forDay+'T10:00:00Z'};
    fs.writeFileSync(path.join(folder,'ready.json'),JSON.stringify(metadata));return metadata;
  }
  const readyPath=path.join(dataDir,'prayer-media',day,'short','ready.json');ready();
  const bridge=createPrayerWebStoryBridge({db,dataDir,publicDir,canRun:()=>running,now:()=>date});
  const realAssets=createStoryAssets({publicDir,dataDir,siteUrl:origin}),calls={text:0,image:0};
  const assets={...realAssets,image:async(...args)=>{const result=await realAssets.image(...args);if(intercept)await intercept(...args);return result;},poster:async()=>'/story-assets/fixture.jpg'};
  const app=express();app.use(express.json());
  const daily=setupDailyWebStories({app,db,siteUrl:origin,dataDir,publicDir,assets,additionalSources:bridge,canRun:()=>running,schedule:false,isConfigured:()=>true,services:()=>[],courses:()=>[],
    research:{list:()=>[],get:()=>null,getEnriched:s=>s,enrich:s=>s,automaticEligible:()=>false,automaticSourceAllowed:()=>false,syncTrends:async()=>({count:0})},
    sourceFetchImpl:async()=>new Response('<invalid/>',{headers:{'content-type':'application/xml'}}),
    requireAdmin:(req,res,next)=>req.headers['x-test-admin']==='1'?next():res.sendStatus(403),sameOriginOnly:(req,res,next)=>req.headers.origin===origin?next():res.sendStatus(403),
    requestText:async()=>{calls.text++;throw Error('paid text must not run');},requestImage:async()=>{calls.image++;throw Error('paid image must not run');}});
  const story=()=>db.prepare('SELECT * FROM editorial_web_stories WHERE article_id=?').get(key);
  const run=async()=>{daily.automation.run({manual:true});await daily.automation.awaitIdle();return daily.automation.status();};
  return {dir,db,app,bridge,daily,assets,calls,dataDir,publicDir,readyPath,ready,story,run,pause:()=>{running=false;},setDate:value=>{date=new Date(value+'T15:00:00Z');},intercept:fn=>{intercept=fn;},
    enable:(limit=1)=>daily.automation.updateSettings({revision:daily.automation.status().revision,enabled:true,dailyLimit:limit,groups:['trends']}),
    close:()=>{daily.close();db.close();fs.rmSync(dir,{recursive:true,force:true});}};
}

test('dated ready media reuses the complete published prayer with no text truncation, filler or unsupported slots',()=>{
  const x=setup();try{
    const source=x.bridge.get(key);assert.equal(source.sourcePath,'/oracao-do-dia.html?dia=2026-09-12#oracao');assert.equal(source.commercial,false);
    const actual=getDailyPrayer(day);assert.equal(source.pieces.join(' '),prayerStoryPages(actual).body);assert.ok(source.pieces.length>=9);assert.ok(source.pieces.every(p=>p.length<=120));
    assert.match(source.body,/Que espaço de descanso cabe na sua rotina hoje\?/);assert.match(source.sources[1].url,/2026-09-12\/short.mp4$/);
    assert.deepEqual(x.daily.catalog.list({automatic:true,group:'trends'}).map(s=>s.key),[key]);assert.deepEqual(x.bridge.list({group:'recipes'}),[]);
    assert.equal(x.bridge.get('prayer-video:2026-09-12:11'),null);assert.equal(x.bridge.get('prayer-video:2026-09-12:18'),null);assert.throws(()=>prayerStoryKey(day,'11'));
    x.ready('2026-09-13');assert.equal(x.bridge.get(prayerStoryKey('2026-09-13')),null);assert.equal(x.bridge.list({offset:1}).length,0);
    assert.deepEqual(x.calls,{text:0,image:0});
  }finally{x.close();}
});

test('the real daily service publishes once under its existing quota, preserves provenance and serves the real public story',async()=>{
  const x=setup();let server;try{
    assert.equal(x.daily.automation.status().enabled,false);assert.equal(x.story(),undefined);x.enable();const state=await x.run();
    assert.equal(state.quota.attempted,1);assert.equal(state.quota.published,1,JSON.stringify(state.history));
    const first=x.story(),draft=JSON.parse(first.published_json);assert.equal(draft.generation,'editorial-local');assert.equal(first.reviewed_by,'source-editorial-check');
    assert.equal(draft.reuseBinding,x.bridge.get(key).reuseBinding);assert.equal(draft.reuseContentHash,x.bridge.get(key).facts.reuseContentHash);assert.equal(draft.pages.length,11);
    assert.equal(draft.pages.slice(1).map(p=>p.text).join(' '),x.bridge.get(key).body);assert.ok(draft.pages.every(p=>p.imageCredit==='Ilustração IA'));
    assert.equal(draft.cta,'Ler oração completa');assert.equal(x.db.prepare('SELECT count(*) n FROM editorial_articles').get().n,0,'no near-copy companion article');
    const events=x.db.prepare('SELECT event FROM editorial_web_story_events ORDER BY id').all().map(x=>x.event);assert.deepEqual(events,['generated_automatic','published_automatic']);
    await x.run();assert.deepEqual(x.story(),first);assert.equal(x.daily.automation.status().quota.attempted,1);assert.deepEqual(x.calls,{text:0,image:0});
    server=x.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
    const response=await fetch(base+'/stories/'+first.slug);assert.equal(response.status,200);const html=await response.text();assert.match(html,/amp-story/);assert.match(html,/Uma pausa com Deus/);assert.match(html,/2026-09-12#oracao/);assert.match(html,/Ilustração IA/);assert.doesNotMatch(html,/Publicidade|Link de afiliado/);
    assert.ok(x.daily.sitemapPaths().includes('/stories/'+first.slug));
    fs.unlinkSync(x.readyPath);assert.equal((await fetch(base+'/stories/'+first.slug)).status,404);assert.ok(!x.daily.sitemapPaths().includes('/stories/'+first.slug));assert.deepEqual(x.story(),first,'withdrawal hides but preserves audit data');
  }finally{if(server)await new Promise(r=>server.close(r));x.close();}
});

test('changed media, caption, script, source path or illustration is held before quota or paid fallback',async()=>{
  for(const mutate of [r=>r.sha256='f'.repeat(64),r=>r.caption='different',r=>r.script.text+=' invented',r=>r.publicVideoUrl='https://unrelated.test/video.mp4',r=>r.videoPath+='-other']){
    const x=setup();try{const r=JSON.parse(fs.readFileSync(x.readyPath));mutate(r);fs.writeFileSync(x.readyPath,JSON.stringify(r));assert.equal(x.bridge.get(key),null);x.enable();const state=await x.run();assert.equal(state.quota.attempted,0);assert.equal(x.story(),undefined);assert.deepEqual(x.calls,{text:0,image:0});}finally{x.close();}
  }
  const x=setup();try{fs.appendFileSync(path.join(x.publicDir,PRAYER_STORY_IMAGE),'changed');assert.equal(x.bridge.get(key),null);x.enable();await x.run();assert.equal(x.daily.automation.status().quota.attempted,0);}finally{x.close();}
});

test('global pause and exhausted quota do not claim reused content; prayer stays in its selected category',async()=>{
  const x=setup();try{x.enable();x.pause();assert.equal((await x.run()).quota.attempted,0);assert.equal(x.story(),undefined);}finally{x.close();}
  const y=setup();try{
    y.enable();const today=y.daily.automation.status().quota.date;
    y.db.prepare("INSERT INTO web_story_automation_jobs(source_key,fingerprint,group_name,day,status,owner,settings_revision,actor,started_at) VALUES('prior-source','prior','trends',?,'review','fixture',2,'fixture',?)").run(today,Date.now());
    assert.equal((await y.run()).quota.attempted,1);assert.equal(y.story(),undefined);assert.deepEqual(y.calls,{text:0,image:0});
  }finally{y.close();}
  const z=setup();try{z.daily.automation.updateSettings({revision:1,enabled:true,dailyLimit:1,groups:['recipes']});assert.equal((await z.run()).quota.attempted,0);}finally{z.close();}
});

test('a model-held source or manual edition cannot become automatically approved or overwritten',async()=>{
  const x=setup();try{
    x.db.prepare("INSERT INTO web_story_automation_jobs(source_key,fingerprint,group_name,day,status,owner,settings_revision,actor,started_at) VALUES(?,'old-hash','trends',?,'review','fixture',1,'fixture',?)").run(key,day,Date.now()-86400000);
    assert.equal(x.bridge.eligible(x.bridge.get(key)),false);x.enable();await x.run();assert.equal(x.story(),undefined);assert.deepEqual(x.calls,{text:0,image:0});
  }finally{x.close();}
  const y=setup();try{
    const source=y.bridge.get(key),generated=await y.bridge.generate(source,{},y.assets);const manual=await y.daily.createManualDraft({sourceKey:key,draft:generated.draft},{actor:'human-curator'});
    const before=y.story();assert.equal(manual.published_json,undefined);assert.equal(before.published_json,null);assert.equal(JSON.parse(before.draft_json).reuseContentHash,source.facts.reuseContentHash);
    y.enable();await y.run();assert.deepEqual(y.story(),before);assert.equal(y.daily.automation.status().quota.attempted,0);assert.deepEqual(y.calls,{text:0,image:0});
  }finally{y.close();}
});

test('pause or replacement during local image validation prevents the publication transaction',async()=>{
  for(const action of ['pause','source-change']){
    const x=setup();try{
      x.intercept(async()=>{x.intercept(null);if(action==='pause')x.pause();else{const r=JSON.parse(fs.readFileSync(x.readyPath));r.caption='replaced';fs.writeFileSync(x.readyPath,JSON.stringify(r));}});
      x.enable();await x.run();assert.equal(x.story(),undefined);assert.equal(x.daily.automation.status().quota.published,0);assert.deepEqual(x.calls,{text:0,image:0});
    }finally{x.close();}
  }
});

test('another dated key with the same complete copy reuses the canonical story instead of making a near-copy',async()=>{
  const x=setup();try{
    x.enable();await x.run();const first=x.story(),source=x.bridge.get(key);
    // The editorial calendar is cyclical; locate the same actual source, not a fabricated draft.
    let next;
    for(let i=1;i<=200;i++){const d=new Date(Date.parse(day+'T12:00:00Z')+i*86400000).toISOString().slice(0,10);try{if(prayerStoryPages(getDailyPrayer(d)).body===source.body){next=d;break;}}catch{}}
    assert.ok(next);x.setDate(next);x.ready(next);const candidate=x.bridge.get(prayerStoryKey(next));assert.ok(candidate);assert.equal(candidate.facts.reuseContentHash,source.facts.reuseContentHash);
    assert.equal(x.bridge.canonicalFor(candidate).url,'/stories/'+first.slug);assert.equal(x.bridge.eligible(candidate),false);assert.deepEqual(x.daily.catalog.list({group:'trends',automatic:true}),[]);
    // A legacy manual regeneration may have lost its draft metadata. The
    // published snapshot still owns the canonical copy and must win.
    const altered=JSON.parse(first.draft_json);delete altered.reuseContentHash;delete altered.reuseBinding;altered.sourcePath='/oracao-do-dia.html';
    x.db.prepare('UPDATE editorial_web_stories SET draft_json=? WHERE id=?').run(JSON.stringify(altered),first.id);
    assert.equal(x.bridge.canonicalFor(candidate).url,'/stories/'+first.slug);assert.equal(x.bridge.eligible(candidate),false);
    assert.equal(x.db.prepare('SELECT count(*) n FROM editorial_web_stories').get().n,1);assert.deepEqual(x.calls,{text:0,image:0});
  }finally{x.close();}
});

test('ecosystem catalog hides a reused story when its source binding changes, without changing ordinary-story hashes',async()=>{
  const x=setup();try{
    x.enable();await x.run();const source=x.bridge.get(key),row=x.story();let binding=source.reuseBinding;
    const catalog=createEcosystemCatalog({db:x.db,siteUrl:origin,sourceCatalog:{get:k=>k===key?{...source,reuseBinding:binding}:null}});
    const current=()=>catalog.list({kind:'pages',q:row.slug}).items.find(i=>i.id==='story:'+row.id);
    assert.equal(current().status,'published');assert.equal(current().url,'/stories/'+row.slug);
    binding='f'.repeat(64);assert.equal(current().status,'pending');assert.equal(current().url,'');assert.equal(x.story().published_json,row.published_json);
    const ordinary={...source,reuseBinding:undefined};delete ordinary.reuseBinding;
    const oldHash=sha(JSON.stringify([ordinary.title,ordinary.summary,ordinary.body,ordinary.image_url,ordinary.updated_at]));
    x.db.prepare('UPDATE editorial_web_stories SET published_source_hash=? WHERE id=?').run(oldHash,row.id);
    const legacy=createEcosystemCatalog({db:x.db,siteUrl:origin,sourceCatalog:{get:()=>ordinary}});
    assert.equal(legacy.list({kind:'pages',q:row.slug}).items[0].status,'published');
  }finally{x.close();}
});

test('source binding rejects stale input and concurrent automatic creation commits at most one copy',async()=>{
  const x=setup();try{
    const source=x.bridge.get(key);assert.equal((await x.bridge.generate({...source,reuseBinding:'a'.repeat(64)},{},x.assets)).approved,false);
    const results=await Promise.allSettled([x.daily.generateAndPublish(source),x.daily.generateAndPublish(source)]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(x.db.prepare('SELECT count(*) n FROM editorial_web_stories').get().n,1);
    assert.equal(x.db.prepare("SELECT count(*) n FROM editorial_web_story_events WHERE event='published_automatic'").get().n,1);assert.deepEqual(x.calls,{text:0,image:0});
  }finally{x.close();}
});
