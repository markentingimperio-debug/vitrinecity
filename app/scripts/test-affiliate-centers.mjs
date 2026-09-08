import assert from 'node:assert/strict';
import express from 'express';
import Database from 'better-sqlite3';
import {setupAffiliateCatalog} from '../affiliate-catalog.js';
import {intersectsCommerceAvenue} from '../public/vitriny-affiliate-centers-core.js';
assert.equal(intersectsCommerceAvenue({position:{x:-200,z:0},size:{width:20,depth:20}}),true);
assert.equal(intersectsCommerceAvenue({position:{x:0,z:0},size:{width:20,depth:20}}),false);
assert.equal(intersectsCommerceAvenue({position:{x:-65,z:0},size:{width:8,depth:50},rotationY:Math.PI/2}),true,'A rotated skyline building must not obstruct the avenue');
const db=new Database(':memory:'),app=express();app.use(express.json());const catalog=setupAffiliateCatalog({app,db,requireAdmin:(req,res,next)=>req.headers['x-test-admin']==='1'?next():res.sendStatus(401),sameOriginOnly:(_req,_res,next)=>next(),siteUrl:'https://vitrinecity.com',publicDir:'/tmp',startMonitor:false,fetcher:async()=>{throw Error('No external requests in test');}});
const insert=db.prepare(`INSERT INTO affiliate_catalog(slug,platform,title,description,category,keywords,image,affiliate_url,status) VALUES(?,?,?,?,?,?,?,?,?)`);
db.transaction(()=>{for(let i=0;i<10000;i++)insert.run(`fixture-${i}`,i%2?'shopee':'cakto',`Seleção ${String(i).padStart(5,'0')}`,i%2?'Solução para cozinha':'Ferramenta de organização',i%3?'Casa e cozinha':'Produtividade','prático útil','','https://shope.ee/synthetic',i===9999?'draft':'published');})();
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}`;
try{
  let response=await fetch(base+'/api/affiliate-centers/shopee/products?q=solucao');let data=await response.json();assert.equal(data.total,4999);assert.equal(data.items.length,24);assert.ok(data.items.every(p=>p.platform==='shopee'&&!('affiliate_url' in p)));const page1=data.items.map(p=>p.slug);
  data=await (await fetch(base+'/api/affiliate-centers/shopee/products?q=solucao&p=2')).json();assert.ok(data.items.every(p=>!page1.includes(p.slug)));assert.equal(data.page,2);
  db.prepare("UPDATE affiliate_catalog SET description='Nova palavra abacaxi' WHERE slug='fixture-1'").run();data=await (await fetch(base+'/api/affiliate-centers/shopee/products?q=abacaxi')).json();assert.equal(data.total,1,'Search index tracks catalogue updates');
  db.prepare("UPDATE affiliate_catalog SET status='paused' WHERE slug='fixture-1'").run();data=await (await fetch(base+'/api/affiliate-centers/shopee/products?q=abacaxi')).json();assert.equal(data.total,0,'Paused products disappear immediately');
  data=await (await fetch(base+'/api/affiliate-centers/cakto/products?departamento=Produtividade&p=9999999')).json();assert.equal(data.page,data.pages);assert.ok(data.items.length<=24&&data.items.every(p=>p.category==='Produtividade'&&p.platform==='cakto'));
  const html=await (await fetch(base+'/centros/shopee?q=%3Cscript%3Ealert%281%29%3C%2Fscript%3E')).text();assert.ok(!html.includes('<script>alert(1)</script>'));assert.match(html,/noindex,follow/);assert.match(html,/Shopee Center/);assert.match(html,/links de afiliado/);
  assert.equal((await fetch(base+'/centros/invalid')).status,404);assert.equal((await fetch(base+'/api/affiliate-centers/constructor/products')).status,404);
  data=await (await fetch(base+'/api/affiliate-centers')).json();assert.equal(data.centers.length,5);assert.equal(data.centers.find(c=>c.id==='kiwify').total,0);
  for(const center of data.centers){assert.match(center.logo,/^\/assets\/affiliate-brands\//);const branded=await (await fetch(base+center.href)).text();assert.ok(branded.includes(`alt="Logo ${center.name}"`));assert.ok(branded.includes(center.logo));}
  assert.equal((await fetch(base+'/api/admin/affiliate-catalog')).status,401);
  const adminHeaders={'x-test-admin':'1'};
  data=await (await fetch(base+'/api/admin/affiliate-catalog?plataforma=shopee',{headers:adminHeaders})).json();assert.equal(data.total,5000);assert.equal(data.items.length,50);assert.ok(data.items.every(p=>p.platform==='shopee'));const adminPage1=new Set(data.items.map(p=>p.slug));
  data=await (await fetch(base+'/api/admin/affiliate-catalog?plataforma=shopee&p=2',{headers:adminHeaders})).json();assert.equal(data.page,2);assert.equal(data.items.length,50);assert.ok(data.items.every(p=>!adminPage1.has(p.slug)));
  data=await (await fetch(base+'/api/admin/affiliate-catalog?plataforma=shopee&q=fixture-9999',{headers:adminHeaders})).json();assert.equal(data.total,1);assert.equal(data.items[0].status,'draft','Administrators can find unpublished products without exposing them publicly');
  assert.ok(catalog.sitemapPaths().includes('/centros/shopee'));console.log('affiliate-centers: 10,000-product fixture, indexed search, pagination, departments, platform isolation, publication status and public pages passed');
}finally{catalog.close();await new Promise(resolve=>server.close(resolve));db.close();}
