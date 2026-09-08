import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import express from 'express';
import Database from 'better-sqlite3';
import {memberPage} from '../public/vitriny-membership-core.js';
import {setupMediaCatalog} from '../media-catalog.js';
import {youtubeSource} from '../public/vitriny-music-core.js';
const source=readFileSync(new URL('../public/vitriny-music-arena.js',import.meta.url),'utf8');
assert.equal(memberPage('/vitriny-music-arena.html'),true);assert.equal(memberPage('/vitriny-cinema.html'),true);assert.match(source,/closePlayer\(\);const frame/);assert.match(source,/addEventListener\('pagehide'/);assert.doesNotMatch(source,/spotify|playVideo\(|\.play\(/);
for(const url of ['https://evil.test/watch?v=98ovJs-Ibd4','https://youtube.com@evil.test/watch?v=98ovJs-Ibd4','javascript:alert(1)','http://youtube.com/watch?v=98ovJs-Ibd4','https://www.youtube.com/embed/nope'])assert.equal(youtubeSource(url),null);
assert.match(youtubeSource('https://youtu.be/98ovJs-Ibd4?si=test').embedUrl,/98ovJs-Ibd4\?autoplay=0&playsinline=1/);
const db=new Database(':memory:'),app=express();app.use(express.json());const options={app,db,requireAdmin:(req,res,next)=>req.get('admin')==='yes'?next():res.sendStatus(401),sameOriginOnly:(req,res,next)=>req.get('origin')==='https://vitrinecity.com'?next():res.sendStatus(403),siteUrl:'https://vitrinecity.com',publicDir:'.'};
const catalog=setupMediaCatalog(options);const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
try{
  let d=await (await fetch(base+'/api/media/music')).json();assert.equal(d.total,13);assert.ok(d.items.some(i=>i.kind==='live'));assert.ok(d.items.some(i=>i.url.includes('98ovJs-Ibd4')));assert.ok(d.items.every(i=>i.source.embedUrl.startsWith('https://www.youtube-nocookie.com/embed/')));
  d=await (await fetch(base+'/api/media/music?q=sofrencia&genero=sertanejo')).json();assert.ok(d.total>0);assert.ok(d.items.every(i=>i.genre==='sertanejo'));
  d=await (await fetch(base+'/api/media/cinema')).json();assert.equal(d.total,7);assert.equal(d.items.find(i=>i.genre==='lancamentos').format,'trailer');
  const item=d.items[0];const html=await (await fetch(base+item.pagePath)).text();assert.ok(html.includes('<h1>'+item.title));assert.match(html,/CollectionPage/);assert.doesNotMatch(html,/<iframe|VideoObject/);assert.ok(catalog.sitemapPaths().includes(item.pagePath));
  assert.equal((await fetch(base+'/api/admin/media/music')).status,401);assert.equal((await fetch(base+'/api/media/cinema/constructor')).status,404);
  const malicious=await (await fetch(base+'/musicas?q='+encodeURIComponent('<script>alert(1)</script>'))).text();assert.doesNotMatch(malicious,/<script>alert/);assert.match(malicious,/noindex,follow/);
  const body={title:'Seleção de teste',genre:'rock',format:'video',url:'https://youtu.be/98ovJs-Ibd4',artist:'Canal de teste',description:'Descrição original de teste longa o suficiente para validação.',tags:'guitarra',status:'published'};
  const put=(slug,b=body,origin='https://vitrinecity.com')=>fetch(base+'/api/admin/media/music/'+slug,{method:'PUT',headers:{admin:'yes',origin,'Content-Type':'application/json'},body:JSON.stringify(b)});
  assert.equal((await put('test-source',body,'https://evil.test')).status,403);assert.equal((await put('test-source',{...body,url:'https://evil.test/video'})).status,400);
  for(let i=0;i<30;i++)assert.equal((await put('test-source-'+i)).status,200);
  const page1=await (await fetch(base+'/api/media/music?genero=rock')).json(),page2=await (await fetch(base+'/api/media/music?genero=rock&p=2')).json();assert.equal(page1.items.length,24);assert.equal(page2.items.length,6);assert.ok(page2.items.every(i=>!page1.items.some(p=>p.slug===i.slug)));
  const first=page1.items[0];await put(first.slug,{...body,status:'paused'});assert.equal((await fetch(base+first.pagePath)).status,404);
  setupMediaCatalog({...options,app:express()});assert.equal(db.prepare('SELECT status FROM vitriny_media_catalog WHERE scope=? AND slug=?').get('music',first.slug).status,'paused','Restart must not overwrite editorial changes');
  console.log('media-catalog: verified source shapes, genres, pagination, public SEO, protected editing, XSS, pause, idempotent seeds and explicit playback passed');
}finally{await new Promise(r=>server.close(r));db.close();}
