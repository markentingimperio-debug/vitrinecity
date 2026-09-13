import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import express from 'express';
import Database from 'better-sqlite3';
import {createWebStorySources} from '../web-story-sources.js';
import {originalCourse} from '../course-content.js';
import {COURSE_LANDING_SLUGS} from '../course-demonstrations.js';
import {setupWebStories} from '../web-stories.js';
import {webStorySourceHash} from '../web-story-source-hash.js';
import {storyPageVisibleText} from '../web-story-render.js';

const titles={'logo-no-canva':'Criação de Logo no Canva','precificacao-e-lucro':'Precificação e Lucro para Pequenos Negócios'};
function fixture(t){
 const db=new Database(':memory:');t.after(()=>db.close());
 db.exec(`CREATE TABLE managed_courses(slug TEXT PRIMARY KEY,title TEXT,description TEXT,audience TEXT,price_cents INTEGER,modules INTEGER,cover_url TEXT,status TEXT,updated_at TEXT,material_url TEXT,video_url TEXT);
 CREATE TABLE web_story_automation_jobs(id INTEGER PRIMARY KEY,day TEXT,status TEXT);
 INSERT INTO web_story_automation_jobs VALUES(33,'2026-09-13','review'),(34,'2026-09-13','review'),(35,'2026-09-13','review'),(36,'2026-09-13','review'),(37,'2026-09-13','review'),(38,'2026-09-13','published');`);
 const courses=[];
 for(const slug of COURSE_LANDING_SLUGS){
  const original=originalCourse(slug),item={slug,title:titles[slug]||slug,description:original.description,audience:original.audience,modules:original.lessons.length,priceCents:2399,coverUrl:original.coverUrl,available:true,status:'active',materialUrl:'PRIVATE_PAID_MATERIAL',videoUrl:'PRIVATE_VIDEO',lessons:[{title:'INJECTED_PRIVATE_LESSON',secret:'PRIVATE_SECRET'}]};
  courses.push(item);db.prepare('INSERT INTO managed_courses VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(slug,item.title,item.description,item.audience,item.priceCents,item.modules,item.coverUrl,'active','2026-09-13T15:00:00Z','PRIVATE_PAID_MATERIAL','PRIVATE_VIDEO');
 }
 const sourceCatalog=createWebStorySources({db,courses:()=>courses});
 return {db,courses,sourceCatalog,quota:()=>db.prepare('SELECT * FROM web_story_automation_jobs ORDER BY id').all()};
}

async function studio(t){
 const f=fixture(t),app=express();app.use(express.json());
 let aiCalls=0,paused=false,imageHook=null;
 const assets={outputDir:process.cwd(),image:async url=>{if(imageHook)imageHook();return {url,width:url.includes('pwa-icon')?192:1672,height:url.includes('pwa-icon')?192:941};},poster:async()=>'/story-assets/'+'a'.repeat(32)+'.jpg'};
 setupWebStories({app,db:f.db,sourceCatalog:f.sourceCatalog,assets,siteUrl:'https://vitrinecity.test',publicDir:process.cwd(),dataDir:process.cwd(),requireAdmin:(_q,_s,next)=>next(),sameOriginOnly:(_q,_s,next)=>next(),canRun:()=>!paused,generateStory:async()=>{aiCalls++;throw Error('paid_generation_must_not_run');}});
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const call=async(path='',body)=>{
  const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/admin/web-stories'+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  return {status:response.status,body:await response.json()};
 };
 return {...f,call,aiCalls:()=>aiCalls,setPaused:value=>paused=value,setImageHook:value=>imageHook=value};
}

test('ready public original courses expose only the curriculum already shown on their public landing',t=>{
 const f=fixture(t);
 for(const slug of COURSE_LANDING_SLUGS){
  const source=f.sourceCatalog.get('course:'+slug),original=originalCourse(slug);
  const expected=original.lessons.map(l=>[l.title,l.objective,'Na prática: '+l.activity].join('\n\n')).join('\n\n');
  assert.equal(source.body.split('Programa público do curso: objetivos e atividades\n\n')[1],expected);
  assert.ok(source.body.length>=400);assert.equal(source.summary,original.description);assert.equal(source.commercial,true);
  assert.equal(source.facts.priceCents,2399);assert.equal(source.sourcePath,'/centro-educacional#'+slug);
  assert.deepEqual(source.sources,[{title:source.title,url:source.sourcePath},{title:'Programa público: '+source.title,url:'/cursos/'+slug}]);
  assert.doesNotMatch(JSON.stringify(source),/PRIVATE_|INJECTED_|"sections"|"answers"|"paragraphs"|"materialUrl"|"videoUrl"/);
  const privateParagraph=original.lessons.flatMap(l=>l.sections||[]).flatMap(s=>s.paragraphs||[]).find(p=>p.length>130);
  if(privateParagraph)assert.ok(!source.body.includes(privateParagraph),'paid lesson paragraphs are not added');
 }
});

test('licensed, unpublished, unready and withdrawn courses never inherit another course program',t=>{
 const f=fixture(t),slug='licensed-course';
 f.db.prepare('INSERT INTO managed_courses(slug,title,description,status) VALUES(?,?,?,?)').run(slug,'Curso licenciado','Resumo curto.','active');
 f.courses.push({slug,title:'Curso licenciado',available:true,lessons:originalCourse('logo-no-canva').lessons});
 const source=f.sourceCatalog.get('course:'+slug);assert.equal(source.body,'Resumo curto.');assert.equal(source.sources.length,1);
 f.courses.find(c=>c.slug==='logo-no-canva').available=false;assert.equal(f.sourceCatalog.get('course:logo-no-canva'),null);
 f.db.prepare("UPDATE managed_courses SET status='draft' WHERE slug='precificacao-e-lucro'").run();assert.equal(f.sourceCatalog.get('course:precificacao-e-lucro'),null);
 f.courses.splice(f.courses.findIndex(c=>c.slug==='canva-para-lojas'),1);assert.equal(f.sourceCatalog.get('course:canva-para-lojas'),null);
});

test('curriculum participates in the existing source hash while unchanged licensed sources keep the legacy hash',t=>{
 const f=fixture(t),source=f.sourceCatalog.get('course:logo-no-canva');
 const previous={...source,body:source.body.split('\n\nPrograma público do curso:')[0]};
 assert.notEqual(webStorySourceHash(source),webStorySourceHash(previous));
 const oldFormula=s=>createHash('sha256').update(JSON.stringify([s.title,s.summary,s.body,s.image_url,s.updated_at,s.facts,s.sourcePath])).digest('hex');
 assert.equal(webStorySourceHash(previous),oldFormula(previous));
 f.db.prepare("UPDATE managed_courses SET price_cents=2499 WHERE slug='logo-no-canva'").run();
 const updated=f.sourceCatalog.get('course:logo-no-canva');assert.notEqual(webStorySourceHash(updated),webStorySourceHash(source));assert.match(updated.body,/24,99/);
 assert.equal(updated.body.split('Programa público')[1],source.body.split('Programa público')[1]);
});

test('ordinary editor POST creates both course drafts with complete pages, zero AI and unchanged six-attempt quota',async t=>{
 const f=await studio(t),quota=f.quota();
 for(const slug of Object.keys(titles)){
  // This is the existing UI's exact request: no manual-draft payload is needed.
  const created=await f.call('',{articleId:'course:'+slug});assert.equal(created.status,201,JSON.stringify(created.body));
  const item=created.body;assert.equal(item.published_at,null);assert.equal(item.previewed_revision,0);assert.equal(item.revision,1);
  assert.ok(item.draft.pages.length>=10&&item.draft.pages.length<=40);assert.ok(item.draft.pages.slice(1).map(p=>p.text).join(' ').length>=400);
  assert.ok(item.draft.pages.every((p,i)=>p.text.length<=130&&[...storyPageVisibleText(item.draft,i)].length<=180));
  assert.equal(item.source_hash,webStorySourceHash(f.sourceCatalog.get('course:'+slug)));assert.equal(item.draft.cta,'Ver curso');assert.equal(item.draft.commercial,true);
  const replay=await f.call('',{articleId:'course:'+slug});assert.equal(replay.status,200);assert.equal(replay.body.id,item.id);assert.deepEqual(replay.body.draft,item.draft);
 }
 assert.equal(f.aiCalls(),0);assert.deepEqual(f.quota(),quota);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM editorial_web_stories').get().n,2);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM editorial_web_stories WHERE published_json IS NOT NULL').get().n,0);
});

test('normal course creation never bypasses preview, explicit review or publication pause',async t=>{
 const f=await studio(t),item=(await f.call('',{articleId:'course:logo-no-canva'})).body;
 const publish='/'+item.id+'/publish',confirmation={revision:1,reviewed:true,rightsConfirmed:true};
 assert.equal((await f.call(publish,confirmation)).status,409,'no preview');
 assert.equal((await f.call('/'+item.id+'/preview',{revision:1})).status,200);
 assert.equal((await f.call(publish,{revision:1})).status,400,'no editorial or rights confirmation');
 f.setPaused(true);assert.equal((await f.call(publish,confirmation)).status,409);
 assert.equal(f.db.prepare('SELECT published_json FROM editorial_web_stories').get().published_json,null);assert.equal(f.aiCalls(),0);
});

test('source changes during template creation abort with no draft or quota change',async t=>{
 const f=await studio(t),quota=f.quota();let once=false;
 f.setImageHook(()=>{if(!once){once=true;f.db.prepare("UPDATE managed_courses SET price_cents=2499 WHERE slug='logo-no-canva'").run();}});
 const result=await f.call('',{articleId:'course:logo-no-canva'});assert.equal(result.status,409);assert.match(result.body.error,/mudou/);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM editorial_web_stories').get().n,0);assert.deepEqual(f.quota(),quota);assert.equal(f.aiCalls(),0);
});

test('existing legacy draft is returned unchanged and requires explicit regeneration after a source change',async t=>{
 const f=await studio(t),item=(await f.call('',{articleId:'course:logo-no-canva'})).body;
 const source=f.sourceCatalog.get('course:logo-no-canva'),legacy={...source,body:source.body.split('\n\nPrograma público do curso:')[0]};
 f.db.prepare('UPDATE editorial_web_stories SET source_hash=?,draft_json=? WHERE id=?').run(webStorySourceHash(legacy),JSON.stringify({...item.draft,title:'Curadoria manual anterior'}),item.id);
 const before=f.db.prepare('SELECT * FROM editorial_web_stories').get();
 const reopened=await f.call('',{articleId:'course:logo-no-canva'});assert.equal(reopened.status,200);assert.equal(reopened.body.id,item.id);assert.equal(reopened.body.draft.title,'Curadoria manual anterior');
 assert.equal((await f.call('/'+item.id+'/preview',{revision:1})).status,409);
 assert.deepEqual(f.db.prepare('SELECT * FROM editorial_web_stories').get(),before);assert.equal(f.aiCalls(),0);
});

test('a short licensed description still fails the unchanged 400-character requirement',async t=>{
 const f=await studio(t),slug='licensed-short';f.courses.push({slug,title:'Curso curto',available:true});
 f.db.prepare('INSERT INTO managed_courses(slug,title,description,status) VALUES(?,?,?,?)').run(slug,'Curso curto','Resumo insuficiente.','active');
 const result=await f.call('',{articleId:'course:'+slug});assert.equal(result.status,400);assert.match(result.body.error,/400 caracteres/);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM editorial_web_stories').get().n,0);assert.equal(f.aiCalls(),0);
});
