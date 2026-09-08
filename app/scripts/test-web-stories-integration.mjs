// Exercise the real middleware order with a disposable database and no providers.
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {createHash,randomBytes} from 'node:crypto';
import Database from 'better-sqlite3';

const dataDir=mkdtempSync(path.join(tmpdir(),'vitriny-stories-integration-'));
const port=46200+Math.floor(Math.random()*700),origin=`http://127.0.0.1:${port}`;
const guard=path.join(dataDir,'outbound-guard.mjs');
writeFileSync(guard,"globalThis.fetch=async()=>{throw Error('External fetch disabled in Web Stories test')};");
const env=Object.fromEntries(['PATH','SystemRoot','WINDIR','TEMP','TMP'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
Object.assign(env,{DATA_DIR:dataDir,PORT:String(port),SITE_URL:origin});
const child=spawn(process.execPath,['--import',pathToFileURL(guard).href,'server.js'],{cwd:new URL('..',import.meta.url),env,stdio:['ignore','pipe','pipe']});
let output='',db;child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
const digest=value=>createHash('sha256').update(value).digest('hex');
const request=(url,{method='GET',body,cookie,foreign=false}={})=>fetch(origin+url,{method,redirect:'manual',headers:{origin:foreign?'https://other.example':origin,'content-type':'application/json',...(cookie?{cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
try {
  let ready=false;for(let i=0;i<100;i++){try{if((await request('/api/health')).ok){ready=true;break;}}catch{}if(child.exitCode!==null)break;await new Promise(resolve=>setTimeout(resolve,100));}assert.ok(ready,output.slice(-2500));
  db=new Database(path.join(dataDir,'vitrinecity.db'));
  const adminId=Number(db.prepare("INSERT INTO users(name,email,password_hash,is_admin,totp_enabled,adult_confirmed) VALUES ('Story fixture admin','story-admin@example.test','unused',1,1,1)").run().lastInsertRowid);
  const memberId=Number(db.prepare("INSERT INTO users(name,email,password_hash,adult_confirmed) VALUES ('Story fixture member','story-member@example.test','unused',1)").run().lastInsertRowid);
  const session=id=>{const token=randomBytes(32).toString('base64url');db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)').run(digest(token),id,Date.now()+3600000);return {token,cookie:`vc_session=${token}`};};
  const admin=session(adminId),member=session(memberId);
  for(const url of ['/admin-web-stories','/admin-web-stories.html']){
    const anonymous=await request(url);assert.equal(anonymous.status,302);assert.equal(anonymous.headers.get('location'),'/admin-login.html');
  }
  assert.equal((await request('/api/admin/web-stories')).status,401);
  assert.equal((await request('/api/admin/web-stories',{cookie:member.cookie})).status,403);
  assert.equal((await request('/api/admin/web-stories',{cookie:admin.cookie})).status,401,'Real second factor must apply');
  db.prepare("INSERT INTO privileged_sessions(token_hash,user_id,scope,expires_at) VALUES (?,?,'admin',?)").run(digest(admin.token),adminId,Date.now()+300000);
  const page=await request('/admin-web-stories',{cookie:admin.cookie});assert.equal(page.status,200);assert.equal(page.headers.get('cache-control'),'no-store');
  assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'self'/);
  assert.equal((await request('/api/admin/web-stories',{cookie:admin.cookie})).status,200);
  assert.equal((await request('/api/admin/web-stories',{method:'POST',cookie:admin.cookie,foreign:true,body:{articleId:'fixture'}})).status,403);
  const article={title:'Guia completo de teste',summary:'Uma história de teste criada apenas no ambiente isolado da verificação.',body:'Conteúdo da história de teste, sem publicação no site real. '.repeat(12),image_url:'/assets/recipes/bolo-cenoura.jpg',updated_at:'2026-09-08T00:00:00Z'};
  db.prepare("INSERT INTO editorial_articles(id,slug,portal,title,summary,body,image_url,status,updated_at) VALUES ('story-fixture','story-fixture','receitas',?,?,?,?, 'published',?)").run(article.title,article.summary,article.body,article.image_url,article.updated_at);
  const draft={title:article.title,description:article.summary,category:'receitas',logo:'/assets/pwa-icon-192.png',poster:'/assets/recipes/bolo-cenoura.jpg',sourcePath:'/artigo/story-fixture',cta:'Artigo e fontes',pages:[{text:article.summary,image:article.image_url,width:1024,height:1024,alt:'Ilustração de teste'}]};
  const sourceHash=digest(JSON.stringify([article.title,article.summary,article.body,article.image_url,article.updated_at]));
  db.prepare("INSERT INTO editorial_web_stories(id,slug,article_id,source_hash,draft_json,revision,previewed_revision,created_at,updated_at) VALUES ('fixture','fixture','story-fixture',?,?,1,1,?,?)").run(sourceHash,JSON.stringify(draft),article.updated_at,article.updated_at);
  assert.equal((await request('/stories/fixture')).status,404);
  assert.ok(!(await (await request('/sitemap-stories.xml')).text()).includes('/stories/fixture'));
  const previewUrl='/admin-web-stories/preview/fixture?revision=1';
  assert.equal((await request(previewUrl)).status,401);
  const preview=await request(previewUrl,{cookie:admin.cookie});assert.equal(preview.status,200);assert.equal(preview.headers.get('cache-control'),'no-store');assert.equal(preview.headers.get('x-robots-tag'),'noindex,nofollow');assert.match(preview.headers.get('content-security-policy'),/frame-ancestors 'self'/);
  const previewHtml=await preview.text();assert.match(previewHtml,/<html amp /);assert.doesNotMatch(previewHtml,/global-market-banner|public-measurement|googletagmanager|vitriny-pwa/);
  db.prepare("UPDATE editorial_web_stories SET published_json=?,published_at=?,published_updated_at=?,published_revision=1 WHERE id='fixture'").run(JSON.stringify(draft),article.updated_at,article.updated_at);
  const published=await request('/stories/fixture');assert.equal(published.status,200);assert.equal(published.headers.get('x-frame-options'),null);
  assert.equal(published.headers.get('content-security-policy'),"base-uri 'self'; object-src 'none'");
  const html=await published.text();assert.match(html,/poster-portrait-src=/);assert.doesNotMatch(html,/global-market-banner|public-measurement|googletagmanager|vitriny-pwa/);
  const sitemap=await (await request('/sitemap.xml')).text();assert.ok(sitemap.includes('/stories/fixture'));
  const index=await request('/sitemap-index.xml');assert.equal(index.status,200);assert.match(await index.text(),/sitemap-stories.xml/);
  assert.match((await request('/stories')).headers.get('content-security-policy'),/frame-ancestors 'self'/);
  assert.match((await request('/stories/not-available')).headers.get('content-security-policy'),/frame-ancestors 'self'/);
  db.prepare("UPDATE editorial_articles SET status='draft' WHERE id='story-fixture'").run();
  assert.equal((await request('/stories/fixture')).status,404);
  assert.ok(!(await (await request('/sitemap-stories.xml')).text()).includes('/stories/fixture'));
  console.log('web-stories-integration: real admin/2FA, same-origin, draft privacy, protected preview, public AMP headers, clean rendering and sitemaps passed');
} finally {
  db?.close();if(child.exitCode===null&&child.signalCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}
  const resolved=path.resolve(dataDir);if(path.dirname(resolved)===path.resolve(tmpdir())&&path.basename(resolved).startsWith('vitriny-stories-integration-'))rmSync(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
