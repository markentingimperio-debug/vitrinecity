import assert from 'node:assert/strict';
import express from 'express';
import Database from 'better-sqlite3';
import {mountJarvis} from '../jarvis-core.js';
const db=new Database(':memory:'),app=express();app.use(express.json({limit:'16kb'}));
let searches=0;
const core=mountJarvis({app,db,env:{JARVIS_LOCAL_MODEL:'0'},researchSchedule:false,
  requireAdmin:(req,res,next)=>{if(req.get('Authorization')!=='fixture-admin')return res.status(401).json({error:'Login required'});req.user={id:1};next();},
  sameOriginOnly:(req,res,next)=>req.get('Origin')==='https://evil.example'?res.status(403).json({error:'Origin blocked'}):next(),
  researchFetchImpl:async(url,init)=>{searches++;assert.equal(new URL(url).origin,'http://127.0.0.1:3000');assert.equal(new URL(url).pathname,'/api/search/web');assert.equal(init.redirect,'error');return Response.json({status:'ready',results:[{url:'https://developers.google.com/search/docs/fundamentals/seo-starter-guide',title:'Guia de SEO',description:'Conteúdo para testar rascunhos sem aprovação automática.'}]});}});
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
const base=`http://127.0.0.1:${server.address().port}/api/admin/jarvis/research`,headers={Authorization:'fixture-admin','Content-Type':'application/json','X-Jarvis-Request':'1'};
const request=(path,method='GET',body,h=headers)=>fetch(base+path,{method,headers:h,...(body!==undefined?{body:JSON.stringify(body)}:{})});
try{
  for(const [path,method,body] of [['/status','GET'],['/settings','POST',{enabled:true,topicIds:['seo'],revision:1}],['/start','POST',{}],['/cancel','POST',{id:'fake'}]]){
    const r=await request(path,method,body,{'Content-Type':'application/json','X-Jarvis-Request':'1'});assert.equal(r.status,401);assert.equal(r.headers.get('cache-control'),'no-store');
  }
  assert.equal(searches,0);
  let r=await request('/status');assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');const initial=await r.json();assert.equal(initial.enabled,false);
  for(const h of [{Authorization:'fixture-admin','Content-Type':'application/json'},{...headers,Origin:'https://evil.example'},{...headers,'Content-Type':'text/plain'}]){
    r=await request('/settings','POST',{enabled:true,topicIds:['seo'],revision:initial.revision},h);assert.equal(r.status,403);
  }
  r=await request('/settings','POST',{enabled:true,topicIds:['seo'],revision:initial.revision});assert.equal(r.status,200);
  r=await request('/start','POST',{query:'private conversation',url:'https://evil.example',approve:true});assert.equal(r.status,400);assert.equal(searches,0);
  r=await request('/start','POST',{});assert.equal(r.status,202);assert.ok((await r.json()).id);await core.research.done();assert.equal(searches,1);
  const drafts=core.list().filter(d=>d.status==='draft');assert.equal(drafts.length,1);assert.equal(core.retrieve('rascunhos aprovação automática').some(s=>s.id===drafts[0].id),false);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM jarvis_documents WHERE status='approved'").get().n,3);
  const s=core.research.status();r=await request('/settings','POST',{enabled:false,topicIds:['seo'],revision:s.revision});assert.equal(r.status,200);assert.equal((await r.json()).enabled,false);
  for(let i=0;i<17;i++)r=await request('/start','POST',{});assert.equal(r.status,429);
  assert.equal(searches,1);console.log('jarvis-research-api: admin authentication, origin/JSON/header guards, no-store, exact inputs, async202, drafts-only and rate limits passed');
}finally{core.research.close();await core.research.done();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();}
