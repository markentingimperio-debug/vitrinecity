import assert from 'node:assert/strict';
import express from 'express';
import Database from 'better-sqlite3';
import {setupAffiliateCatalog} from '../affiliate-catalog.js';
const db=new Database(':memory:'),app=express();app.use(express.json());
const catalog=setupAffiliateCatalog({app,db,siteUrl:'https://vitrinecity.com',publicDir:'/tmp',startMonitor:false,
 requireAdmin:(req,res,next)=>req.headers['x-admin']==='test'?next():res.sendStatus(401),
 sameOriginOnly:(req,res,next)=>req.headers.origin==='https://vitrinecity.com'?next():res.sendStatus(403)});
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base='http://127.0.0.1:'+server.address().port;
const send=body=>fetch(base+'/api/platform-performance',{method:'POST',headers:{origin:'https://vitrinecity.com','Content-Type':'application/json'},body:JSON.stringify(body)});
try{
 assert.equal((await fetch(base+'/api/admin/platform-health')).status,401);
 assert.equal((await fetch(base+'/admin-saude.html')).status,401);
 assert.equal((await fetch(base+'/api/platform-performance',{method:'POST'})).status,403);
 assert.equal((await send({metric:'page_load_ms',value:1000})).status,204);
 assert.equal(db.prepare("SELECT count(*) n FROM platform_operations_daily WHERE metric='page_load_ms'").get().n,0);
 assert.equal((await send({consent:true,metric:'page_load_ms',value:-1})).status,400);
 assert.equal((await send({consent:true,metric:'email',value:1})).status,400);
 assert.equal((await send({consent:true,metric:'page_load_ms',value:1200,query:'must-not-store',email:'must-not-store'})).status,204);
 const response=await fetch(base+'/api/admin/platform-health',{headers:{'x-admin':'test'}});
 assert.equal(response.headers.get('cache-control'),'no-store');
 const data=await response.json();assert.equal(data.metrics.find(x=>x.metric==='page_load_ms').total,1200);
 assert(!JSON.stringify(data).includes('must-not-store'));
 for(let i=0;i<29;i++)assert.equal((await send({consent:true,metric:'js_error',value:1})).status,204);
 assert.equal((await send({consent:true,metric:'js_error',value:1})).status,429);
 const p=db.prepare("SELECT * FROM affiliate_catalog WHERE status='published' LIMIT 1").get();
 db.prepare('UPDATE affiliate_catalog SET description=? WHERE slug=?').run('Descrição "especial" <segura>',p.slug);
 const html=await(await fetch(base+'/ofertas/'+p.slug)).text();
 assert(html.includes('name="description" content="Descrição &quot;especial&quot; &lt;segura&gt;"'));
 assert(html.includes('property="og:description"'));
 console.log('Operations: access, origin, consent, validation, aggregation, privacy, throttling and escaped metadata passed.');
}finally{catalog.close();await new Promise(r=>server.close(r));db.close();}
