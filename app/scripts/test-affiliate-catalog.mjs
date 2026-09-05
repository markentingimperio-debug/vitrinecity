import assert from 'node:assert/strict';
import express from 'express';
import Database from 'better-sqlite3';
import { setupAffiliateCatalog, checkAffiliateLink, validAffiliateUrl } from '../affiliate-catalog.js';
assert.equal(validAffiliateUrl('https://meli.la/a','mercadolivre'),true);
for(const url of ['http://meli.la/a','https://meli.la.evil.test/a','https://user:pass@meli.la/a','https://127.0.0.1/','https://meli.la:8443/a'])assert.equal(validAffiliateUrl(url,'mercadolivre'),false);
let calls=0;
assert.equal(await checkAffiliateLink('https://meli.la/a','mercadolivre',async()=>{calls++;return new Response(null,{status:302,headers:{location:'http://127.0.0.1/'}});}), 'review');
assert.equal(calls,1,'Unsafe redirect must not be fetched');
for(const [status,expected] of [[200,'reachable'],[404,'broken'],[410,'broken'],[403,'review'],[429,'review'],[500,'review'],[405,'review']])assert.equal(await checkAffiliateLink('https://meli.la/a','mercadolivre',async()=>new Response(null,{status})),expected);
const app=express();app.use(express.json());const db=new Database(':memory:');
let responseStatus=200;
const catalog=setupAffiliateCatalog({app,db,siteUrl:'https://vitrinecity.com',publicDir:'/tmp',startMonitor:false,
requireAdmin:(req,res,next)=>req.headers['x-test-admin']==='yes'?next():res.status(401).end(),
sameOriginOnly:(req,res,next)=>req.headers.origin==='https://vitrinecity.com'?next():res.status(403).end(),
fetcher:async()=>new Response(null,{status:responseStatus})});
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base='http://127.0.0.1:'+server.address().port;
const headers={'x-test-admin':'yes',origin:'https://vitrinecity.com','Content-Type':'application/json'};
try{
assert.equal((await fetch(base+'/api/admin/affiliate-catalog')).status,401);
assert.equal((await fetch(base+'/admin-vendas-afiliadas.html')).status,401);
let data=await (await fetch(base+'/api/admin/affiliate-catalog',{headers})).json();assert.equal(data.items.length,6);
let p=data.items[0];const url=base+'/api/admin/affiliate-catalog/'+p.slug;
assert.equal((await fetch(url,{method:'PUT',headers:{'x-test-admin':'yes','Content-Type':'application/json'},body:JSON.stringify(p)})).status,403);
const detail=await (await fetch(base+'/ofertas/'+p.slug)).text();assert(detail.includes(p.affiliate_url));assert(detail.includes('rel="sponsored noopener noreferrer"'));assert(detail.includes('rel="canonical"'));
assert((await (await fetch(base+'/ofertas')).text()).includes('/ofertas/'+p.slug));
assert.equal((await fetch(base+'/ofertas/inexistente')).status,404);
await catalog.checkDue(p.slug);assert.equal(db.prepare('SELECT availability FROM affiliate_catalog WHERE slug=?').get(p.slug).availability,'unknown');
responseStatus=404;await catalog.checkDue(p.slug);
assert(!(await (await fetch(base+'/ofertas/'+p.slug)).text()).includes('data-affiliate-id'));
assert.equal((await fetch(url,{method:'PUT',headers,body:JSON.stringify({...p,affiliate_url:'https://meli.la/replacement'})})).status,200);
assert.equal((await fetch(url,{method:'PUT',headers,body:JSON.stringify(p)})).status,409,'Reject stale editor');
p=db.prepare('SELECT * FROM affiliate_catalog WHERE slug=?').get(p.slug);assert.equal(p.health,'unchecked');assert.equal(p.checked_at,null);
assert((await (await fetch(base+'/ofertas/'+p.slug)).text()).includes('https://meli.la/replacement'));
assert.equal((await fetch(url,{method:'PUT',headers,body:JSON.stringify({...p,status:'paused'})})).status,200);
assert.equal((await fetch(base+'/ofertas/'+p.slug)).status,200,'Paused page must remain available');
assert(!(await (await fetch(base+'/ofertas/'+p.slug)).text()).includes('data-affiliate-id'));
assert(!catalog.searchContent().some(x=>x.url.endsWith(p.slug)));
assert(!catalog.sitemapPaths().some(x=>x.endsWith(p.slug)));
const highlights=await (await fetch(base+'/api/affiliate-highlights')).json();
assert(!highlights.items.some(x=>x.url.endsWith(p.slug)),'Paused products must not appear in outdoor');
assert(highlights.items.every(x=>x.url.startsWith('/ofertas/')&&!('affiliate_url' in x)&&!('evidence' in x)),'Public highlights expose only display fields and permanent page links');
console.log('Affiliate catalog: auth, editing, persistent URLs, relevance source, pauses, monitor and redirect safety passed.');
}finally{catalog.close();await new Promise(r=>server.close(r));db.close();}
