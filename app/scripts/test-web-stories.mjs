import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import Database from 'better-sqlite3';
import express from 'express';
import {setupWebStories,splitStoryText} from '../web-stories.js';
import {createStoryAssets,rasterSize,normalizeStoryImagePath} from '../web-story-assets.js';
import {renderWebStory} from '../web-story-render.js';

const appDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),publicDir=path.join(appDir,'public');
const body='Este é um artigo de teste sobre preparação de receitas. Separe os ingredientes antes de começar, confira a quantidade indicada e mantenha a bancada limpa. Use utensílios adequados e acompanhe cada etapa com cuidado. Higienize as mãos e lave os vegetais. Cozinhe os alimentos completamente e evite misturar utensílios usados com ingredientes crus e alimentos prontos. Ao terminar, guarde as sobras em recipientes limpos e refrigerados. Confira novamente os passos e organize a cozinha. Esta narrativa de teste não é publicada no site real.';
async function fixture(t){
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'vc-web-story-test-')),db=new Database(':memory:'),app=express();
  db.exec("CREATE TABLE editorial_articles(id TEXT PRIMARY KEY,slug TEXT,title TEXT,summary TEXT,body TEXT,image_url TEXT,portal TEXT,status TEXT,published_at TEXT,updated_at TEXT)");
  db.prepare('INSERT INTO editorial_articles VALUES(?,?,?,?,?,?,?,?,?,?)').run('fixture','guia-de-teste','Guia de teste: conteúdo completo','Uma descrição de teste com contexto completo para acompanhar cada uma das páginas.',body,'/assets/recipes/bolo-cenoura.jpg','receitas','published','2026-09-08','2026-09-08');
  const realAssets=createStoryAssets({publicDir,dataDir,siteUrl:'https://vitrinecity.test'});await fs.mkdir(realAssets.outputDir,{recursive:true});
  const state={beforeImage:null};const assets={...realAssets,image:async(...args)=>{if(state.beforeImage)await state.beforeImage();return realAssets.image(...args);},poster:async()=>'/story-assets/0123456789abcdef0123456789abcdef.jpg'};
  app.use(express.json());app.use((_req,res,next)=>{res.set('X-Frame-Options','SAMEORIGIN');res.set('Content-Security-Policy',"base-uri 'self'; object-src 'none'; frame-ancestors 'self'");const send=res.send.bind(res);res.send=html=>send(typeof html==='string'&&html.startsWith('<!doctype')&&!res.locals.vcAmpStory?html.replace('</body>','<script src="/ordinary-site-script.js"></script></body>'):html);next();});
  const auth=(req,res,next)=>{if(req.get('x-test-admin')!=='yes')return res.status(401).json({error:'auth'});req.user={id:'admin-test'};next();};
  const same=(req,res,next)=>req.get('origin')==='https://vitrinecity.test'?next():res.status(403).json({error:'origin'});
  const instance=setupWebStories({app,db,requireAdmin:auth,sameOriginOnly:same,siteUrl:'https://vitrinecity.test',publicDir,dataDir,assets});
  const server=await new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server));});
  const url='http://127.0.0.1:'+server.address().port;
  const call=async(endpoint,{method='GET',data,admin=true,origin=true}={})=>{const response=await fetch(url+endpoint,{method,headers:{...(admin?{'x-test-admin':'yes'}:{}),...(origin?{origin:'https://vitrinecity.test'}:{}),'content-type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});const raw=await response.text();return {status:response.status,headers:response.headers,raw,json:()=>JSON.parse(raw)};};
  const create=async()=>{const res=await call('/api/admin/web-stories',{method:'POST',data:{articleId:'fixture'}});assert.equal(res.status,201,res.raw);return res.json();};
  const preview=item=>call('/api/admin/web-stories/'+item.id+'/preview',{method:'POST',data:{revision:item.revision}});
  const publish=item=>call('/api/admin/web-stories/'+item.id+'/publish',{method:'POST',data:{revision:item.revision,reviewed:true,rightsConfirmed:true}});
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();const resolved=path.resolve(dataDir);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('vc-web-story-test-'));await fs.rm(resolved,{recursive:true,force:true});});
  return {call,create,preview,publish,db,instance,state,assets,realAssets};
}
test('admin and same-origin are required for the page and every write',async t=>{
  const f=await fixture(t);
  assert.equal((await f.call('/admin-web-stories',{admin:false})).status,401);
  assert.equal((await f.call('/api/admin/web-stories',{admin:false})).status,401);
  assert.equal((await f.call('/api/admin/web-stories',{method:'POST',data:{articleId:'fixture'},origin:false})).status,403);
  const story=await f.create();for(const action of ['preview','publish','unpublish','regenerate'])assert.equal((await f.call('/api/admin/web-stories/'+story.id+'/'+action,{method:'POST',data:{revision:1},origin:false})).status,403);
  assert.equal((await f.call('/api/admin/web-stories/'+story.id,{method:'PUT',data:{revision:1,draft:story.draft},admin:false})).status,401);
});
test('template preserves all source words; draft and preview stay out of public pages and sitemap',async t=>{
  const f=await fixture(t),story=await f.create();
  assert.equal(story.draft.pages.slice(1).map(p=>p.text).join(' '),body);
  assert.ok(story.draft.pages.every(p=>p.text.length<=130));
  assert.equal(story.draft.cta,'Ver modo de preparo');assert.equal(story.draft.homeCta,'');
  assert.equal((await f.call(story.url,{admin:false})).status,404);
  assert.ok(!(await f.call('/sitemap-stories.xml',{admin:false})).raw.includes(story.slug));
  const preview=await f.preview(story);assert.equal(preview.status,200);assert.match(preview.json().html,/noindex,nofollow/);
  const screens=[...preview.json().html.matchAll(/<amp-story-page id="[^"]+">([\s\S]*?)<\/amp-story-page>/g)];
  assert.match(screens.at(-1)[1],/href="https:\/\/vitrinecity.test\/artigo\/guia-de-teste">Ver modo de preparo/);assert.ok(!screens.at(-2)[1].includes('amp-story-page-outlink'));
  assert.equal((await f.call(preview.json().url,{admin:false})).status,401);
  const framed=await f.call(preview.json().url);assert.equal(framed.status,200);assert.equal(framed.headers.get('x-robots-tag'),'noindex,nofollow');assert.ok(!framed.raw.includes('ordinary-site-script'));
  assert.equal(framed.headers.get('x-frame-options'),'SAMEORIGIN');assert.match(framed.headers.get('content-security-policy'),/frame-ancestors 'self'/);
  assert.ok(!(await f.call('/stories',{admin:false})).raw.includes(story.slug));
  assert.equal((await f.call('/api/admin/web-stories',{method:'POST',data:{articleId:'fixture'}})).json().id,story.id);
});

test('manual sources survive save and publication; regeneration uses current references without trusting injected draft URLs',async t=>{
  const f=await fixture(t);f.db.exec("ALTER TABLE editorial_articles ADD COLUMN sources_json TEXT NOT NULL DEFAULT '[]'");
  const references=[{title:'Origem oficial de contexto',url:'https://www.nist.gov/ai/context'},{title:'Segunda referência',url:'https://www.unesco.org/ai/reference'}];
  f.db.prepare('UPDATE editorial_articles SET sources_json=?').run(JSON.stringify(references));
  const story=await f.create();assert.deepEqual(story.draft.sources.slice(1),references);assert.equal(story.draft.sources[0].url,'/artigo/guia-de-teste');assert.ok(story.draft.pages.every(page=>!page.imageCredit));
  const response=await f.call('/api/admin/web-stories/'+story.id,{method:'PUT',data:{revision:1,draft:{...story.draft,sources:[{title:'Injected',url:'https://evil.test'}],pages:story.draft.pages.map((page,i)=>({...page,imageCredit:i===0?'Imagem do artigo':'Ilustração IA',layout:'editorial'}))}}});assert.equal(response.status,200,response.raw);const saved=response.json();assert.deepEqual(saved.draft.sources,story.draft.sources);assert.equal(saved.draft.pages[0].imageCredit,'Imagem do artigo');assert.ok(saved.draft.pages.every(page=>page.layout==='editorial'));
  assert.equal((await f.publish(saved)).status,409);const preview=await f.preview(saved);assert.match(preview.json().html,/>Fontes<\/a>/);assert.match(preview.json().html,/Imagem do artigo/);assert.equal((await f.publish(saved)).status,200);
  const publicSources=await f.call(saved.url+'/fontes',{admin:false});assert.equal(publicSources.status,200);assert.match(publicSources.raw,/www.nist.gov\/ai\/context/);assert.ok(!publicSources.raw.includes('evil.test'));
  const updated=[{title:'Nova referência oficial',url:'https://www.nist.gov/ai/new'}];f.db.prepare('UPDATE editorial_articles SET sources_json=?,updated_at=?').run(JSON.stringify(updated),'2026-09-09');
  const regenerated=await f.call('/api/admin/web-stories/'+story.id+'/regenerate',{method:'POST',data:{revision:saved.revision,confirmed:true}});assert.equal(regenerated.status,200);assert.deepEqual(regenerated.json().draft.sources.slice(1),updated);assert.equal(regenerated.json().previewed_revision,0);assert.ok((await f.call(saved.url+'/fontes',{admin:false})).raw.includes('www.nist.gov/ai/context'));
});

test('editing and regenerating preserve explicit legacy buttons and explicit opt-out',async t=>{
  const f=await fixture(t),story=await f.create();
  const put=(item,draft)=>f.call('/api/admin/web-stories/'+item.id,{method:'PUT',data:{revision:item.revision,draft}});
  const saved=(await put(story,{...story.draft,cta:'Consultar a receita',homeCta:'Explorar a VitrineCity'})).json();
  const partial={...saved.draft,title:'Título com botões preservados'};delete partial.cta;delete partial.homeCta;
  const edited=(await put(saved,partial)).json();assert.equal(edited.draft.cta,'Consultar a receita');assert.equal(edited.draft.homeCta,'Explorar a VitrineCity');
  const regenerate=item=>f.call('/api/admin/web-stories/'+item.id+'/regenerate',{method:'POST',data:{revision:item.revision,confirmed:true}});
  const again=(await regenerate(edited)).json();assert.equal(again.draft.cta,'Consultar a receita');assert.equal(again.draft.homeCta,'Explorar a VitrineCity');
  const optedOut=(await put(again,{...again.draft,cta:'',homeCta:''})).json();const final=(await regenerate(optedOut)).json();assert.equal(final.draft.cta,'');assert.equal(final.draft.homeCta,'');
});
test('manual preview and both editorial confirmations gate publication',async t=>{
  const f=await fixture(t),story=await f.create();assert.equal((await f.publish(story)).status,409);await f.preview(story);
  assert.equal((await f.call('/api/admin/web-stories/'+story.id+'/publish',{method:'POST',data:{revision:1,reviewed:true}})).status,400);
  assert.equal((await f.publish(story)).status,200);
  const publicPage=await f.call(story.url,{admin:false});assert.equal(publicPage.status,200);assert.ok(!publicPage.raw.includes('ordinary-site-script'));assert.equal(publicPage.headers.get('x-frame-options'),null);
  assert.equal(publicPage.headers.get('content-security-policy'),"base-uri 'self'; object-src 'none'");
  const directory=await f.call('/stories',{admin:false});assert.match(directory.headers.get('content-security-policy'),/frame-ancestors 'self'/);assert.equal(directory.headers.get('x-frame-options'),'SAMEORIGIN');
  const missing=await f.call('/stories/unknown',{admin:false});assert.equal(missing.status,404);assert.match(missing.headers.get('content-security-policy'),/frame-ancestors 'self'/);
  assert.match(publicPage.raw,/<html amp lang="pt-BR">/);assert.match(publicPage.raw,/poster-portrait-src=/);assert.match(publicPage.raw,/rel="canonical" href="https:\/\/vitrinecity.test\/stories\//);
  assert.ok((await f.call('/stories',{admin:false})).raw.includes(story.slug));
  assert.ok((await f.call('/sitemap-stories.xml',{admin:false})).raw.includes('<lastmod>'));assert.ok(f.instance.sitemapPaths().includes(story.url));
  assert.match((await f.call('/sitemap-index.xml',{admin:false})).raw,/<sitemapindex/);
});
test('draft edits preserve published snapshot and invalidate the preview',async t=>{
  const f=await fixture(t),story=await f.create();await f.preview(story);await f.publish(story);
  const edited=(await f.call('/api/admin/web-stories/'+story.id,{method:'PUT',data:{revision:1,draft:{...story.draft,title:'Novo título em revisão',cta:false,homeCta:false}}})).json();
  assert.equal(edited.revision,2);assert.equal((await f.publish(edited)).status,409);assert.ok(!(await f.call(story.url)).raw.includes('Novo título em revisão'));
  const preview=await f.preview(edited);assert.ok(!preview.json().html.includes('amp-story-page-outlink'));await f.publish(edited);
  assert.ok((await f.call(story.url)).raw.includes('Novo título em revisão'));
});
test('source changes require regeneration; unpublishing source removes story visibility',async t=>{
  const f=await fixture(t),story=await f.create();await f.preview(story);await f.publish(story);
  f.db.prepare('UPDATE editorial_articles SET summary=?').run('Uma descrição atualizada e completa para este artigo de teste.');
  assert.equal((await f.preview(story)).status,409);assert.equal((await f.publish(story)).status,409);
  const next=await f.call('/api/admin/web-stories/'+story.id+'/regenerate',{method:'POST',data:{revision:1,confirmed:true}});assert.equal(next.status,200);assert.equal(next.json().revision,2);
  assert.equal((await f.call(story.url,{admin:false})).status,200);
  f.db.prepare("UPDATE editorial_articles SET status='draft'").run();
  assert.equal((await f.call(story.url,{admin:false})).status,404);assert.ok(!(await f.call('/sitemap-stories.xml')).raw.includes(story.slug));assert.equal((await f.preview(next.json())).status,409);
});
test('XSS is escaped and CTA destination cannot be changed to an external or affiliate URL',async t=>{
  const f=await fixture(t),story=await f.create();story.draft.title='<script>alert("x")</script>';story.draft.sourcePath='https://evil.test';story.draft.cta='Veja "mais"';
  const saved=(await f.call('/api/admin/web-stories/'+story.id,{method:'PUT',data:{revision:1,draft:story.draft}})).json();const preview=(await f.preview(saved)).json().html;
  assert.ok(!preview.includes('<script>alert'));assert.ok(preview.includes('&lt;script&gt;'));assert.ok(!preview.includes('evil.test'));assert.ok(preview.includes('/artigo/guia-de-teste'));
});
test('invalid and remote images, short teasers and stale edits are rejected',async t=>{
  const f=await fixture(t),story=await f.create();
  for(const image of ['https://evil.test/x.jpg','//evil.test/a.jpg','/assets/%2e%2e/package.json','/assets/../server.js','/assets/pwa-icon-192.png']){const changed=structuredClone(story.draft);changed.pages[0].image=image;assert.equal((await f.call('/api/admin/web-stories/'+story.id,{method:'PUT',data:{revision:1,draft:changed}})).status,400);}
  assert.equal((await f.call('/api/admin/web-stories/'+story.id,{method:'PUT',data:{revision:20,draft:story.draft}})).status,409);
  assert.equal((await f.call('/api/admin/web-stories/'+story.id,{method:'PUT',data:{revision:1,draft:{...story.draft,pages:story.draft.pages.map(p=>({...p,text:'Compre agora.'}))}}})).status,400);
});
test('a publication waiting for image validation cannot undo a concurrent withdrawal',async t=>{
  const f=await fixture(t),story=await f.create();await f.preview(story);await f.publish(story);
  let release,entered;const wait=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
  f.state.beforeImage=()=>{entered();return wait;};const pending=f.publish(story);await started;
  const withdrawn=await f.call('/api/admin/web-stories/'+story.id+'/unpublish',{method:'POST',data:{revision:1}});assert.equal(withdrawn.status,200);release();assert.equal((await pending).status,409);
  assert.equal((await f.call(story.url)).status,404);
});
test('source listing excludes unpublished articles and the template bounds long content',async t=>{
  const f=await fixture(t);f.db.prepare("UPDATE editorial_articles SET status='draft'").run();assert.deepEqual((await f.call('/api/admin/web-stories/sources')).json().items,[]);assert.equal((await f.call('/api/admin/web-stories',{method:'POST',data:{articleId:'fixture'}})).status,404);
  assert.throws(()=>splitStoryText('a '.repeat(4000)),/textos muito longos/);assert.throws(()=>splitStoryText('a'.repeat(146)),/sem espaços/);
});
test('local raster validation reads actual JPEG/WebP/PNG dimensions',async t=>{
  const f=await fixture(t);
  assert.deepEqual(rasterSize(await fs.readFile(path.join(publicDir,'assets/pwa-icon-192.png'))),{width:192,height:192,type:'png'});
  assert.equal((await f.assets.image('/assets/recipes/bolo-cenoura.jpg')).width,1200);
  assert.equal((await f.assets.image('/assets/agrotecnica-premium-v2.webp')).type,'webp');
  assert.throws(()=>rasterSize(Buffer.from('<svg/>')),/PNG, JPEG ou WebP/);
  for(const invalid of ['/assets/a?x=1','/assets/a#x','/assets\\pwa-icon-192.png','data:image/png;base64,AA'])await assert.rejects(f.assets.image(invalid));
});
test('own absolute cover URLs normalize locally; alternate origins and ambiguous paths stay blocked',async t=>{
  const f=await fixture(t);
  f.db.prepare('UPDATE editorial_articles SET image_url=?').run('https://vitrinecity.test/assets/recipes/bolo-cenoura.jpg');
  const story=await f.create();assert.equal(story.draft.pages[0].image,'/assets/recipes/bolo-cenoura.jpg');
  assert.equal(normalizeStoryImagePath('https://VITRINECITY.test:443/assets/recipes/bolo-cenoura.jpg','https://vitrinecity.test'),'/assets/recipes/bolo-cenoura.jpg');
  for(const url of ['https://vitrinecity.test.evil/assets/a.jpg','http://vitrinecity.test/assets/a.jpg','https://user:pass@vitrinecity.test/assets/a.jpg','//vitrinecity.test/assets/a.jpg','https://vitrinecity.test/assets/../a.jpg','https://vitrinecity.test/assets/%2e%2e/a.jpg','https://vitrinecity.test/assets/a.jpg?x=1','https://vitrinecity.test/assets/a.jpg#x'])assert.throws(()=>normalizeStoryImagePath(url,'https://vitrinecity.test'));
});
test('visual library contains validated published/shipped images and excludes draft/private uploads',async t=>{
  const f=await fixture(t);
  assert.equal((await f.call('/api/admin/web-stories/images',{admin:false})).status,401);
  f.db.prepare('INSERT INTO editorial_articles VALUES(?,?,?,?,?,?,?,?,?,?)').run('draft-only','draft-only','Título privado de teste','Resumo privado',body,'/assets/agrotecnica-premium-v2.webp','privado','draft','2026-09-08','2026-09-08');
  const result=(await f.call('/api/admin/web-stories/images?articleId=fixture')).json();
  assert.ok(result.items.length>3);assert.ok(result.items.every(item=>item.width>=640&&item.height>=640&&item.url.startsWith('/')));
  assert.equal(result.items[0].url,'/assets/recipes/bolo-cenoura.jpg');assert.equal(result.items[0].category,'Deste artigo');
  assert.ok(!result.items.some(item=>item.title.includes('privado')));
  assert.deepEqual((await f.call('/api/admin/web-stories/images?q=privado&articleId=draft-only')).json().items,[]);
  assert.ok((await f.call('/api/admin/web-stories/images?q=cinema')).json().items.some(item=>item.title==='Noite de cinema'));
});
test('server preserves explicit AMP exemption alongside the scoped Cultiva app',async()=>{
  const source=await fs.readFile(path.join(appDir,'server.js'),'utf8');assert.match(source,/if \(res\.locals\.vcAmpStory === true \|\| isGamesAppPath\(req\.path\) \|\| req\.method/);assert.match(source,/\.\.\.webStories\.sitemapPaths\(\)/);
});
test('FFmpeg prepares and reuses a real 900×1200 portrait cover',{skip:process.env.WEB_STORY_FFMPEG_TEST!=='1'},async t=>{
  const f=await fixture(t),asset=await f.realAssets.image('/assets/recipes/bolo-cenoura.jpg'),url=await f.realAssets.poster(asset);
  assert.match(url,/^\/story-assets\/[a-f0-9]{32}\.jpg$/);
  const file=path.join(f.realAssets.outputDir,path.basename(url));assert.deepEqual(rasterSize(await fs.readFile(file)),{width:900,height:1200,type:'jpeg'});
  assert.equal(await f.realAssets.poster(asset),url);
});

// Optional reproducible fixture for the official AMP validator; never publishes anything.
if(process.env.WEB_STORY_VALIDATOR_FIXTURE){const story={title:'Guia editorial de teste',description:'Descrição completa de teste para validar o documento AMP.',logo:'/assets/pwa-icon-192.png',poster:'/story-assets/0123456789abcdef0123456789abcdef.jpg',category:'receitas',sourcePath:'/artigo/guia-de-teste',cta:'Artigo e fontes',pages:['Uma descrição de teste.',...splitStoryText(body)].map(text=>({text,image:'/assets/recipes/bolo-cenoura.jpg',width:1200,height:675,alt:'Fotografia do artigo de teste'}))};await fs.writeFile(process.env.WEB_STORY_VALIDATOR_FIXTURE,renderWebStory(story,{origin:'https://vitrinecity.com',slug:'guia-editorial-de-teste',publishedAt:'2026-09-08T12:00:00.000Z'}));}
