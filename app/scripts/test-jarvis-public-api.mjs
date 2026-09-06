import assert from 'node:assert/strict';import express from 'express';import Database from 'better-sqlite3';import fs from 'node:fs';
import {mountJarvisPublic} from '../jarvis-public.js';
const db=new Database(':memory:'),app=express();app.use(express.json({limit:'16kb'}));let calls=0;
const core=mountJarvisPublic({app,db,env:{SITE_URL:'https://vitrinecity.com',JARVIS_LOCAL_MODEL:'0'},
  requireAdmin:(req,res,next)=>{if(req.get('Authorization')!=='fixture-admin')return res.status(401).json({error:'Login required'});req.user={id:7};next();},
  sameOriginOnly:(req,res,next)=>req.get('Origin')==='https://vitrinecity.com'?next():res.status(403).json({error:'Origin rejected'}),
  lookup:async()=>{calls++;return {results:[{title:'SEO para conteúdo útil',url:'https://developers.google.com/search/docs/fundamentals/seo-starter-guide',description:'Crie conteúdo útil e verifique a clareza das páginas do seu site.',type:'web'}]};}});
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin=`http://127.0.0.1:${server.address().port}`;
const publicHeaders={'Content-Type':'application/json','X-Jarvis-Public':'1',Origin:'https://vitrinecity.com'},adminHeaders={'Content-Type':'application/json','X-Jarvis-Request':'1',Origin:'https://vitrinecity.com',Authorization:'fixture-admin'};
const request=(path,method='GET',body,headers={})=>fetch(origin+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
try{
  for(const path of ['/status','/knowledge']){const r=await request('/api/admin/jarvis-public'+path);assert.equal(r.status,401);assert.equal(r.headers.get('Cache-Control'),'no-store');}
  for(const[path,method,body]of [['/settings','POST',{enabled:true,revision:1}],['/knowledge/1','PUT',{title:'hack',body:'nothing',revision:1}],['/knowledge/1/status','POST',{status:'approved',confirmedPublic:true,revision:1}]])assert.equal((await request('/api/admin/jarvis-public'+path,method,body,publicHeaders)).status,401);
  const status=await request('/api/jarvis/public/status');assert.equal(status.status,200);assert.equal((await status.json()).enabled,false);assert.equal(status.headers.get('cache-control'),'no-store');
  let r=await request('/api/admin/jarvis-public/settings','POST',{enabled:true,revision:1},{...adminHeaders,Origin:'https://evil.example'});assert.equal(r.status,403);
  r=await request('/api/admin/jarvis-public/settings','POST',{enabled:true,revision:1},adminHeaders);assert.equal(r.status,200);
  const body={question:'Como criar conteúdo útil para SEO?',searchConsent:true};
  for(const h of [{...publicHeaders,Origin:'https://evil.example'},{...publicHeaders,Origin:''},{...publicHeaders,'X-Jarvis-Public':''},{...publicHeaders,'Content-Type':'text/plain'}])assert.equal((await request('/api/jarvis/public/ask','POST',body,h)).status,403);
  assert.equal(calls,0);assert.equal((await request('/api/jarvis/public/ask?question=leak','POST',body,publicHeaders)).status,403);
  assert.equal((await request('/api/jarvis/public/ask','POST',{...body,memory:'private'},publicHeaders)).status,400);
  r=await request('/api/jarvis/public/ask','POST',body,publicHeaders);assert.equal(r.status,200);const answer=await r.json();assert.equal(answer.mode,'excerpts');assert.equal(answer.knowledge.draftsCreated,1);assert.equal(calls,1);assert.equal(r.headers.get('cache-control'),'no-store');
  let item=core.list()[0];r=await request(`/api/admin/jarvis-public/knowledge/${item.id}/status`,'POST',{status:'approved',confirmedPublic:true,revision:item.revision},adminHeaders);assert.equal(r.status,400,'Raw preview must not be approved unchanged');
  r=await request(`/api/admin/jarvis-public/knowledge/${item.id}`,'PUT',{title:item.title,body:'Crie conteúdo útil e verifique a clareza das páginas. Texto revisado para publicação.',revision:item.revision},adminHeaders);assert.equal(r.status,200);item=(await r.json()).item;
  r=await request(`/api/admin/jarvis-public/knowledge/${item.id}/status`,'POST',{status:'approved',confirmedPublic:true,revision:item.revision},adminHeaders);assert.equal(r.status,200);
  r=await request('/api/jarvis/public/ask','POST',body,publicHeaders);assert.equal(r.status,200);assert.equal((await r.json()).mode,'approved_memory');assert.equal(calls,1);
  const source=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');assert.match(source,/app\.get\('\/admin-jarvis-public\.html',requireAdmin/);assert.match(source,/ADMIN_HTML_PATHS\.add\('\/admin-jarvis-public\.html'\)/);
  assert.ok(!db.prepare("SELECT name FROM sqlite_master WHERE name IN ('jarvis_documents','jarvis_runs','jarvis_settings')").get());
  console.log('jarvis-public-api PASS: auth separation, required origin/header/JSON, input allowlist, preview-review gate, approved reuse, no private tables');
}finally{core.close();server.closeAllConnections();await new Promise(r=>server.close(r));db.close();}
