import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import Database from 'better-sqlite3';
import express from 'express';
import {createLocalEditorialStories} from '../web-story-local.js';
import {createWebStorySources} from '../web-story-sources.js';
import {setupDailyWebStories} from '../web-story-daily.js';
import {storyDiagnostics} from '../web-story-diagnostics.js';
import {createStoryAutomation} from '../web-story-automation.js';
import {renderWebStory,storyPageVisibleText} from '../web-story-render.js';

// Read only the literal checked-in data, never execute its database seeder.
const file=fs.readFileSync(new URL('./seed-editorial-starters.mjs',import.meta.url),'utf8'),start=file.indexOf('const articles=')+'const articles='.length,end=file.indexOf('\n];',start)+2;
const seeds=vm.runInNewContext('('+file.slice(start,end)+')').filter(row=>row.portal==='receitas');
function fixture(seed=seeds[0]){
  const db=new Database(':memory:');db.exec(`CREATE TABLE editorial_articles(id TEXT PRIMARY KEY,slug TEXT,title TEXT,summary TEXT,body TEXT,image_url TEXT,portal TEXT,status TEXT,updated_at TEXT,published_at TEXT,sources_json TEXT);
  CREATE TABLE editorial_agent_reviews(article_id TEXT,agent_code TEXT,approved INTEGER,created_at TEXT);`);
  const add=row=>db.prepare('INSERT INTO editorial_articles VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(row.id,row.slug,row.title,row.summary,row.body,row.image,row.portal,'published','2026-09-01T12:00:00Z','2026-09-01T12:00:00Z','[]');add(seed);
  const calls={image:0,poster:0,text:0,generatedImage:0};
  const assets={image:async(url,{logo=false}={})=>{calls.image++;return {url,width:logo?192:1080,height:logo?192:1920,hash:'a'.repeat(64)};},poster:async()=>{calls.poster++;return '/story-assets/'+ 'a'.repeat(32)+'.jpg';},library:async()=>[],outputDir:'.'};
  const catalog=createWebStorySources({db}),local=createLocalEditorialStories({db,assets}),source=()=>catalog.get(seed.id);
  return {db,add,assets,calls,catalog,local,source,close:()=>db.close()};
}
for(const seed of seeds)test('preserves every ingredient/instruction and reviewed image: '+seed.id,async()=>{
  const x=fixture(seed);try{const result=await x.local.generate(x.source());assert.equal(result.approved,true);const d=result.draft;
    assert.ok(d.pages.length>=10&&d.pages.length<=20);assert.equal(d.pages.slice(1,-1).map(p=>p.text).join(' '),seed.body.replace(/\s+/g,' ').trim());
    assert.ok(d.pages.every(p=>p.image===seed.image));assert.equal(d.aiGenerated,false);assert.ok(d.pages.every((_,i)=>storyPageVisibleText(d,i).length<=180));
    assert.match(renderWebStory(d,{origin:'https://vitrinecity.test',slug:'recipe'}),/class="editorial-layout"/);assert.equal(x.calls.generatedImage,0);
  }finally{x.close();}
});
test('same seed ID cannot attest changed content, metadata or image',()=>{
  for(const column of ['body','title','summary','image_url']){const x=fixture();try{x.db.prepare(`UPDATE editorial_articles SET ${column}=${column}||' changed'`).run();assert.equal(x.local.eligible(x.source()),false);}finally{x.close();}}
});
test('timestamp-only reviews never attest a custom source or same-second content change',()=>{
  const x=fixture({...seeds[0],id:'new-recipe'});try{assert.equal(x.local.eligible(x.source()),false);
    for(const agent of ['redacao','fontes','midia','editora','diretoria'])x.db.prepare('INSERT INTO editorial_agent_reviews VALUES(?,?,1,?)').run('new-recipe',agent,'2026-09-01T12:00:00Z');
    assert.equal(x.local.eligible(x.source()),false);x.db.prepare("UPDATE editorial_articles SET body=replace(body,'600 g','900 g')").run();assert.equal(x.local.eligible(x.source()),false);
  }finally{x.close();}
});
test('negative article review and prior story review prohibit local approval',()=>{
  const x=fixture();try{x.db.prepare("INSERT INTO editorial_agent_reviews VALUES(?,'diretoria',0,'2026-09-01T12:00:00Z')").run(seeds[0].id);assert.equal(x.local.eligible(x.source()),false);
    x.db.exec('DELETE FROM editorial_agent_reviews; CREATE TABLE web_story_automation_jobs(source_key TEXT,status TEXT);');x.db.prepare("INSERT INTO web_story_automation_jobs VALUES(?,'review')").run(seeds[0].id);assert.equal(x.local.eligible(x.source()),false);
  }finally{x.close();}
});
test('existing manual or automatic story is never replaced by local workflow',()=>{
  const x=fixture();try{x.db.exec('CREATE TABLE editorial_web_stories(article_id TEXT);');x.db.prepare('INSERT INTO editorial_web_stories VALUES(?)').run(seeds[0].id);assert.equal(x.local.eligible(x.source()),false);}finally{x.close();}
});
test('withdrawal, remote image, commercial/news and source spoofing fail closed',async()=>{
  const x=fixture();try{const s=x.source();for(const patch of [{commercial:true},{portal:'noticias'},{kind:'product'},{image_url:'https://remote.test/image.jpg'},{sourcePath:'/api/private'}])assert.equal(await x.local.generate({...s,...patch}),null);
    x.db.prepare("UPDATE editorial_articles SET status='draft'").run();assert.equal(await x.local.generate(s),null);
  }finally{x.close();}
});
test('pause or source change after async asset read prevents publication',async()=>{
  const x=fixture();try{let current=true;x.assets.image=async url=>{current=false;return {url,width:1080,height:1920}};
    await assert.rejects(x.local.generate(x.source(),{isCurrent:()=>current}),e=>e.code==='ai_source_changed');assert.equal(x.calls.poster,0);
  }finally{x.close();}
});
test('invalid original image holds source and does not request a replacement',async()=>{
  const x=fixture();try{x.assets.image=async()=>{throw Error('invalid image')};const r=await x.local.generate(x.source());assert.equal(r.approved,false);assert.equal(r.notes,'local_source_image_invalid');assert.equal(x.calls.poster,0);}finally{x.close();}
});
test('real daily pipeline publishes locally once, persists method, preserves quota and source',async()=>{
  const x=fixture();const app=express();app.use(express.json());const daily=setupDailyWebStories({app,db:x.db,siteUrl:'https://vitrinecity.test',publicDir:'.',dataDir:'.',schedule:false,assets:x.assets,requireAdmin:(_q,_r,n)=>n(),sameOriginOnly:(_q,_r,n)=>n(),isConfigured:()=>true,research:{list:()=>[],get:()=>null,syncTrends:async()=>({}),getEnriched:s=>s},requestText:async()=>{x.calls.text++;throw Error('must not generate');},requestImage:async()=>{x.calls.generatedImage++;throw Error('must not generate');}});
  try{daily.automation.updateSettings({revision:1,enabled:true,dailyLimit:1,groups:['recipes']});daily.automation.run({manual:true});await daily.automation.awaitIdle();
    const first=daily.automation.status();assert.equal(first.quota.published,1);assert.equal(first.history[0].diagnostics.method,'local_editorial');assert.equal(first.history[0].diagnostics.code,'local_editorial_preserved');assert.equal(x.calls.text,0);assert.equal(x.calls.generatedImage,0);
    const saved=x.db.prepare('SELECT published_json FROM editorial_web_stories').get();const story=JSON.parse(saved.published_json);assert.equal(story.pages.slice(1,-1).map(p=>p.text).join(' '),seeds[0].body.replace(/\s+/g,' ').trim());assert.ok(story.pages.some(p=>p.layout==='editorial'));
    daily.automation.run({manual:true});await daily.automation.awaitIdle();assert.equal(daily.automation.status().quota.attempted,1);assert.equal(x.db.prepare('SELECT COUNT(*) n FROM editorial_web_stories').get().n,1);
  }finally{daily.close();x.close();}
});
test('diagnostics retain only known criteria and sanitize contacts/credentials',()=>{
  const d=storyDiagnostics({notes:'ai_review_held',qualityFailures:['grounded','invented'],review:{risk:'high',notes:'Texto precisa revisão <b> https://example.test secret@example.test token: abc123'},repair:{attempted:true,kind:'editorial',outcome:'held'},request:'secret',draft:{private:'secret'}});
  assert.deepEqual(d.qualityFailures,['grounded']);assert.equal(d.code,'ai_review_held');assert.doesNotMatch(JSON.stringify(d),/abc123|example\.test|<b>|private/);assert.equal(storyDiagnostics({notes:'secret-provider-data'}).code,'review_details_unavailable');
});
test('late editorial rejection during publication asset validation wins over local approval',async()=>{
  const x=fixture();let reads=0;const originalImage=x.assets.image;x.assets.image=async(...args)=>{const result=await originalImage(...args);if(++reads===4)x.db.prepare("INSERT INTO editorial_agent_reviews VALUES(?,'diretoria',0,'2026-09-09T12:00:00Z')").run(seeds[0].id);return result;};
  const app=express();const daily=setupDailyWebStories({app,db:x.db,siteUrl:'https://vitrinecity.test',publicDir:'.',dataDir:'.',schedule:false,assets:x.assets,requireAdmin:(_q,_r,n)=>n(),sameOriginOnly:(_q,_r,n)=>n(),isConfigured:()=>true,research:{list:()=>[],get:()=>null,syncTrends:async()=>({}),getEnriched:s=>s},requestText:async()=>{throw Error('no provider')},requestImage:async()=>{throw Error('no provider')}});
  try{daily.automation.updateSettings({revision:1,enabled:true,dailyLimit:1,groups:['recipes']});daily.automation.run({manual:true});await daily.automation.awaitIdle();assert.equal(x.db.prepare('SELECT COUNT(*) n FROM editorial_web_stories').get().n,0);assert.equal(daily.automation.status().quota.failed,1);}finally{daily.close();x.close();}
});
test('diagnostic migration preserves all six legacy holds and never reopens today quota',async()=>{
  const db=new Database(':memory:');const now=Date.parse('2026-09-09T16:00:00Z');let calls=0;
  const make=()=>createStoryAutomation({db,now:()=>now,isConfigured:()=>true,getCandidates:()=>{calls++;return []},processSource:()=>{throw Error('no generation')},schedule:false});
  let automation=make();automation.updateSettings({revision:1,enabled:true,dailyLimit:6});automation.close();
  const add=db.prepare("INSERT INTO web_story_automation_jobs(source_key,fingerprint,group_name,day,status,reason,summary,owner,settings_revision,actor,started_at,finished_at) VALUES(?,?,'recipes','2026-09-09','review','needs_review','Original hold','legacy',1,'legacy',?,?)");
  for(let n=0;n<6;n++)add.run('legacy-'+n,'hash-'+n,now-1000,now);
  db.exec('ALTER TABLE web_story_automation_jobs DROP COLUMN diagnostics_json');
  const previous=db.prepare('SELECT id,source_key,fingerprint,status,summary FROM web_story_automation_jobs ORDER BY id').all();
  automation=make();try{assert.deepEqual(db.prepare('SELECT id,source_key,fingerprint,status,summary FROM web_story_automation_jobs ORDER BY id').all(),previous);automation.run({manual:true});await automation.awaitIdle();assert.equal(automation.status().quota.attempted,6);assert.equal(automation.status().quota.remaining,0);assert.equal(calls,0);assert.equal(automation.status().history[0].diagnostics.code,'review_details_unavailable');}finally{automation.close();db.close();}
});
test('review detail is sanitized in both persisted summary and structured diagnostics',async()=>{
  const x=fixture({...seeds[0],id:'unattested-recipe'});let textCalls=0;
  const daily=setupDailyWebStories({app:express(),db:x.db,siteUrl:'https://vitrinecity.test',publicDir:'.',dataDir:'.',schedule:false,assets:x.assets,requireAdmin:(_q,_r,n)=>n(),sameOriginOnly:(_q,_r,n)=>n(),isConfigured:()=>true,research:{list:()=>[],get:()=>null,syncTrends:async()=>({}),getEnriched:s=>s},requestText:async()=>++textCalls===1?JSON.stringify({title:seeds[0].title,description:seeds[0].summary,imagePrompt:'Prato de fricassê'}):JSON.stringify({approved:false,grounded:false,original:true,complete:true,nonRepetitive:true,commerceBalanced:true,risk:'high',notes:'Revisar referência. token: private-secret-value'}),requestImage:async()=>assert.fail('Rejected copy must not request images')});
  try{daily.automation.updateSettings({revision:1,enabled:true,dailyLimit:1,groups:['recipes']});daily.automation.run({manual:true});await daily.automation.awaitIdle();const row=daily.automation.status().history[0];assert.equal(row.status,'review');assert.equal(row.diagnostics.code,'ai_review_held');assert.doesNotMatch(JSON.stringify(row),/private-secret-value/);assert.match(row.summary,/removido/);}finally{daily.close();x.close();}
});
