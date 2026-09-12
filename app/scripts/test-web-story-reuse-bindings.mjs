import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import Database from 'better-sqlite3';
import {setupWebStories} from '../web-stories.js';

async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'web-story-reuse-')),db=new Database(':memory:'),app=express();
  db.exec('CREATE TABLE editorial_articles(id TEXT,status TEXT)');app.use(express.json());
  const body=Array.from({length:10},(_,index)=>`Observe este cuidado completo e preserve o conteúdo da etapa ${index+1}.`).join(' '),source={key:'reused:one',kind:'page',slug:'conteudo-reutilizado',title:'Conteúdo reutilizado',summary:'Uma descrição completa para acompanhar este conteúdo já revisado.',body,image_url:'/assets/public.jpg',sourcePath:'/artigo/conteudo-reutilizado',portal:'conteudo',reuseBinding:'a'.repeat(64),facts:{reuseContentHash:'b'.repeat(64)}};
  let imageHook=null,images=0;
  const assets={outputDir:path.join(root,'assets'),image:async url=>{images++;if(imageHook)imageHook();return {url,width:720,height:1280};},poster:async()=>'/story-assets/'+'f'.repeat(32)+'.jpg'};
  const service=setupWebStories({app,db,siteUrl:'https://vitrinecity.test',publicDir:root,dataDir:root,assets,sourceCatalog:{get:key=>key===source.key?source:null,list:()=>[]},requireAdmin:(_req,_res,next)=>next(),sameOriginOnly:(_req,_res,next)=>next()});
  const server=await new Promise(resolve=>{const active=app.listen(0,'127.0.0.1',()=>resolve(active));});
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();await fs.rm(root,{recursive:true,force:true});});
  const call=(url,data)=>fetch('http://127.0.0.1:'+server.address().port+url,data?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:{});
  const draft={title:source.title,description:source.summary,pages:Array.from({length:10},(_,index)=>({text:`Observe este cuidado completo e preserve o conteúdo da etapa ${index+1}.`,alt:'Imagem pública',image:source.image_url}))};
  return {db,source,service,call,draft,setHook:fn=>imageHook=fn,images:()=>images};
}

test('manual reuse draft checks isCurrent before assets and again before its transaction',async t=>{
  const f=await fixture(t),input={sourceKey:f.source.key,draft:f.draft};
  await assert.rejects(f.service.createManualDraft(input,{isCurrent:()=>false}),{status:409});assert.equal(f.images(),0);
  let current=true;f.setHook(()=>current=false);await assert.rejects(f.service.createManualDraft(input,{isCurrent:()=>current}),{status:409});assert.equal(f.db.prepare('SELECT COUNT(*) count FROM editorial_web_stories').get().count,0);
});

test('manual regeneration retains reuse identity and changed source binding hides the published snapshot',async t=>{
  const f=await fixture(t),item=await f.service.createManualDraft({sourceKey:f.source.key,draft:f.draft});assert.equal(item.draft.reuseBinding,f.source.reuseBinding);assert.equal(item.draft.reuseContentHash,f.source.facts.reuseContentHash);
  assert.equal((await f.call('/api/admin/web-stories/'+item.id+'/preview',{revision:1})).status,200);assert.equal((await f.call('/api/admin/web-stories/'+item.id+'/publish',{revision:1,reviewed:true,rightsConfirmed:true})).status,200);assert.equal((await f.call(item.url)).status,200);
  f.source.reuseBinding='c'.repeat(64);assert.equal((await f.call(item.url)).status,404);
  const regenerated=await f.call('/api/admin/web-stories/'+item.id+'/regenerate',{revision:1,confirmed:true});assert.equal(regenerated.status,200);const data=await regenerated.json();assert.equal(data.draft.reuseBinding,'c'.repeat(64));assert.equal(data.draft.reuseContentHash,'b'.repeat(64));assert.equal(data.previewed_revision,0);
  assert.equal(JSON.parse(f.db.prepare('SELECT published_json FROM editorial_web_stories').get().published_json).reuseBinding,'a'.repeat(64),'regeneration preserves the old public snapshot until reviewed');
});
