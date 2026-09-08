import assert from 'node:assert/strict';
import express from 'express';
import Database from 'better-sqlite3';
import { setupAffiliateCatalog, checkAffiliateLink, validAffiliateUrl } from '../affiliate-catalog.js';
assert.equal(validAffiliateUrl('https://meli.la/a','mercadolivre'),true);
for(const url of ['http://meli.la/a','https://meli.la.evil.test/a','https://user:pass@meli.la/a','https://127.0.0.1/','https://meli.la:8443/a'])assert.equal(validAffiliateUrl(url,'mercadolivre'),false);
// Synthetic links only. HEAD probes below are injected mocks, never real checkouts.
const digitalLinks=[
  ['cakto','https://pay.cakto.com.br/fixture-cakto?affiliate=synthetic-ref&utm_source=vitrinecity&sck=fixture%2Fone'],
  ['kiwify','https://pay.kiwify.com.br/fixture-kiwify?afid=synthetic-ref&utm_source=vitrinecity&sck=fixture%2Ftwo'],
  ['kiwify','https://kiwify.app/fixture-short?afid=synthetic-ref&utm_source=vitrinecity']
];
for(const [platform,link] of digitalLinks){
  assert.equal(validAffiliateUrl(link,platform),true,link);
  let probes=0;
  assert.equal(await checkAffiliateLink(link,platform,async(url,init)=>{
    probes++;assert.equal(url,link,'Affiliate path, query values and parameter order must be preserved.');
    assert.equal(init.method,'HEAD');assert.equal(init.redirect,'manual');return new Response(null,{status:200});
  }),'reachable');
  assert.equal(probes,1);
}
const rejectedDigitalLinks=[
  ['cakto','https://cakto.com.br/fixture'],['cakto','https://www.pay.cakto.com.br/fixture'],
  ['cakto','https://pay.cakto.com.br.evil.test/fixture'],['cakto','https://evil-pay.cakto.com.br/fixture'],
  ['cakto','https://pay.kiwify.com.br/fixture'],['cakto','https://kiwify.app/fixture'],
  ['kiwify','https://kiwify.com.br/fixture'],['kiwify','https://www.pay.kiwify.com.br/fixture'],
  ['kiwify','https://child.kiwify.app/fixture'],['kiwify','https://kiwify.app.evil.test/fixture'],
  ['kiwify','https://pay.cakto.com.br/fixture'],
  ...digitalLinks.flatMap(([platform,link])=>{
    const host=new URL(link).hostname;
    return [[platform,'http://'+host+'/fixture'],[platform,'https://user:pass@'+host+'/fixture'],
      [platform,'https://'+host+':8443/fixture'],[platform,'javascript:alert(1)']];
  }),
  ...['__proto__','constructor','toString','hasOwnProperty'].map(platform=>[platform,'https://pay.cakto.com.br/fixture'])
];
for(const [platform,link] of rejectedDigitalLinks){
  assert.equal(validAffiliateUrl(link,platform),false,platform+': '+link);
  let probes=0;
  assert.equal(await checkAffiliateLink(link,platform,async()=>{probes++;return new Response(null,{status:200});}),'review');
  assert.equal(probes,0,'Invalid initial destinations must never be fetched.');
}
// Existing platforms intentionally retain their previous subdomain behavior.
for(const [platform,link] of [['mercadolivre','https://produto.mercadolivre.com.br/fixture'],
  ['shopee','https://sub.shopee.com.br/fixture'],['tiktok','https://www.tiktok.com/fixture']])assert.equal(validAffiliateUrl(link,platform),true);
for(const [platform,link] of digitalLinks){
  for(const destination of ['http://127.0.0.1/','https://evil.test/checkout',
    'https://user:pass@'+new URL(link).hostname+'/fixture','https://'+new URL(link).hostname+':8443/fixture',
    'https://child.'+new URL(link).hostname+'/fixture',
    platform==='cakto'?'https://pay.kiwify.com.br/fixture':'https://pay.cakto.com.br/fixture']){
    let probes=0;
    assert.equal(await checkAffiliateLink(link,platform,async(url)=>{
      probes++;assert.equal(url,link);return new Response(null,{status:302,headers:{location:destination}});
    }),'review');
    assert.equal(probes,1,'An unsafe redirect target must never receive a second request.');
  }
  const expected=new URL('/fixture-final?affiliate=synthetic-ref&sck=fixture%2Ffinal',link).href,seen=[];
  assert.equal(await checkAffiliateLink(link,platform,async(url)=>{
    seen.push(url);return seen.length===1?new Response(null,{status:302,headers:{location:'/fixture-final?affiliate=synthetic-ref&sck=fixture%2Ffinal'}}):new Response(null,{status:200});
  }),'reachable');
  assert.deepEqual(seen,[link,expected],'A same-platform relative redirect must preserve its affiliate parameters.');
}
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
const escaped=value=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
for(const [platform,affiliate_url] of digitalLinks.slice(0,2)){
  const slug='curso-digital-fixture-'+platform,path='/ofertas/'+slug,endpoint=base+'/api/admin/affiliate-catalog/'+slug;
  const fixture={platform,title:'Curso digital '+platform+' <script>fixtureOnly()</script>',
    description:'Material educacional sintético para teste. <img src=x onerror=fixtureOnly()>',
    category:'Cursos digitais',keywords:'curso digital aprendizado '+platform,image:'',affiliate_url,
    status:'draft',availability:'unknown',evidence:'Fixture local: não é uma oferta comercial real.'};
  assert.equal((await fetch(endpoint,{method:'PUT',headers:{origin:headers.origin,'Content-Type':'application/json'},body:JSON.stringify(fixture)})).status,401);
  assert.equal((await fetch(endpoint,{method:'PUT',headers:{...headers,origin:'https://evil.test'},body:JSON.stringify(fixture)})).status,403);
  for(const [badPlatform,badLink] of rejectedDigitalLinks.filter(([id])=>id===platform||['__proto__','constructor','toString','hasOwnProperty'].includes(id))){
    assert.equal((await fetch(endpoint,{method:'PUT',headers,body:JSON.stringify({...fixture,platform:badPlatform,affiliate_url:badLink})})).status,400);
  }
  assert.equal(db.prepare('SELECT COUNT(*) n FROM affiliate_catalog WHERE slug=?').get(slug).n,0,'Rejected writes must not create a product.');
  assert.equal((await fetch(endpoint,{method:'PUT',headers,body:JSON.stringify(fixture)})).status,200);
  let stored=db.prepare('SELECT * FROM affiliate_catalog WHERE slug=?').get(slug);
  assert.equal(stored.affiliate_url,affiliate_url);assert.equal(stored.platform,platform);
  assert.equal((await fetch(base+path)).status,404,'Draft digital products must not have a public page.');
  assert(!(await (await fetch(base+'/ofertas')).text()).includes(path));
  assert(!catalog.searchContent().some(item=>item.url===path));assert(!catalog.sitemapPaths().includes(path));
  assert(!(await (await fetch(base+'/api/affiliate-highlights')).json()).items.some(item=>item.url===path));
  assert.equal((await fetch(endpoint,{method:'PUT',headers,body:JSON.stringify({...stored,status:'published'})})).status,200);
  stored=db.prepare('SELECT * FROM affiliate_catalog WHERE slug=?').get(slug);
  assert.equal(stored.affiliate_url,affiliate_url);
  const pageResponse=await fetch(base+path),html=await pageResponse.text();assert.equal(pageResponse.status,200);
  assert(html.includes('rel="canonical" href="https://vitrinecity.com'+path+'"'));
  assert(html.includes('href="'+escaped(affiliate_url)+'"'),'The checkout href must preserve affiliate parameters with HTML escaping.');
  assert(html.includes('data-affiliate-id="'+slug+'"'));assert(html.includes('rel="sponsored noopener noreferrer"'));assert(html.includes('target="_blank"'));
  assert(html.includes(escaped(fixture.title)));assert(html.includes(escaped(fixture.description)));
  assert(!html.includes('<script>fixtureOnly()'));assert(!html.includes('<img src=x onerror=fixtureOnly()>'));
  const filtered=await (await fetch(base+'/ofertas?plataforma='+platform+'&q='+platform)).text();
  assert(filtered.includes(path));assert(filtered.includes('value="'+platform+'"'));
  assert(!filtered.includes('/ofertas/curso-digital-fixture-'+(platform==='cakto'?'kiwify':'cakto')));
  for(const other of db.prepare("SELECT slug FROM affiliate_catalog WHERE status='published' AND platform<>?").all(platform))assert(!filtered.includes('/ofertas/'+other.slug));
  const searchItem=catalog.searchContent().find(item=>item.url===path);assert(searchItem);
  assert(searchItem.keywords.toLowerCase().includes(platform));assert(!('affiliate_url' in searchItem));
  assert(catalog.sitemapPaths().includes(path));
  const publicHighlight=(await (await fetch(base+'/api/affiliate-highlights')).json()).items.find(item=>item.url===path);
  assert(publicHighlight);assert.equal(publicHighlight.platform,platform==='cakto'?'Cakto':'Kiwify');assert(!('affiliate_url' in publicHighlight));
  assert.equal((await fetch(endpoint,{method:'PUT',headers,body:JSON.stringify({...stored,status:'paused'})})).status,200);
  const pausedResponse=await fetch(base+path),pausedHtml=await pausedResponse.text();assert.equal(pausedResponse.status,200);
  assert(pausedHtml.includes('rel="canonical" href="https://vitrinecity.com'+path+'"'));
  assert(!pausedHtml.includes('data-affiliate-id="'+slug+'"'));assert(!pausedHtml.includes(escaped(affiliate_url)));
  assert(!catalog.searchContent().some(item=>item.url===path));assert(!catalog.sitemapPaths().includes(path));
  assert(!(await (await fetch(base+'/ofertas')).text()).includes(path));
  assert(!(await (await fetch(base+'/api/affiliate-highlights')).json()).items.some(item=>item.url===path));
}
console.log('Affiliate catalog: auth, Cakto/Kiwify exact hosts and affiliate parameters, safe redirects, SSR escaping/canonical/sponsored, search/filter/sitemap/highlights, draft/paused controls and existing platform behavior passed.');
}finally{catalog.close();await new Promise(r=>server.close(r));db.close();}
