// Browser regression using the real page, styles, scripts and daily SSR. No external services.
// PLAYWRIGHT_MODULE and CASUAL_QA_BROWSER accept the same local tooling as the Games UI checks.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {getDailyPrayer, renderDailyPrayer} from '../../prayer-daily.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const root=path.resolve(fileURLToPath(new URL('../../public/',import.meta.url)));
const template=await readFile(path.join(root,'oracao-do-dia.html'),'utf8'), errors=[], external=[], results=[];
let writes=0;
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    res.setHeader('Cache-Control','no-store');
    if(req.method!=='GET'){writes++;res.writeHead(405);res.end();return;}
    if(url.pathname==='/oracao-do-dia'||url.pathname==='/oracao-do-dia.html'){
      const day=url.searchParams.get('dia')||'2026-09-12';
      res.setHeader('Content-Type','text/html; charset=utf-8');res.end(renderDailyPrayer(template,getDailyPrayer(day),{today:'2026-09-12'}));return;
    }
    if(url.pathname.startsWith('/api/')){
      res.setHeader('Content-Type','application/json');
      res.end(JSON.stringify(url.pathname==='/api/prayer-support/config'?{enabled:false}:{videos:[]}));return;
    }
    if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
    const file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
    if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
    res.setHeader('Content-Type',({js:'text/javascript; charset=utf-8',css:'text/css',png:'image/png'})[file.split('.').pop()]||'application/octet-stream');
    res.end(await readFile(file));
  }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
try{
  browser=await chromium.launch({headless:true,...(process.env.CASUAL_QA_BROWSER?{executablePath:process.env.CASUAL_QA_BROWSER}:{})});
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',reducedMotion:'reduce'});
  await context.route('**/*',route=>{
    if(new URL(route.request().url()).origin!==origin){external.push(route.request().url());return route.abort();}
    return route.continue();
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  for(const width of [390,320,360,412,760,1024]){
    await page.setViewportSize({width,height:844});
    await page.goto(`${origin}/oracao-do-dia?dia=2026-09-12#oracao`);
    await page.locator('#prayerTitle').waitFor();
    const measure=await page.evaluate(()=>{
      const intro=document.querySelector('#oracao .section-intro'), note=intro.querySelector('.availability-detail'), title=document.getElementById('prayerTitle');
      const box=element=>{const {x,y,width,height}=element.getBoundingClientRect();return {x,y,width,height};};
      return {viewport:innerWidth,intro:box(intro),note:box(note),title:box(title),eyebrow:box(intro.querySelector('.eyebrow')),overflow:document.documentElement.scrollWidth-innerWidth};
    });
    results.push(measure);
    if(process.env.PRAYER_QA_OUTPUT&&width===390){
      await mkdir(process.env.PRAYER_QA_OUTPUT,{recursive:true});
      await page.screenshot({path:path.join(process.env.PRAYER_QA_OUTPUT,'prayer-mobile-390.png')});
    }
    console.log(JSON.stringify(measure));
    if(width<=760){
      assert.ok(measure.note.width>=width-100,`collection description must use the text column at ${width}px`);
      assert.ok(Math.abs(measure.note.x-measure.eyebrow.x)<1,'description aligns with the edition text');
      assert.ok(measure.note.height<220,'description cannot push the prayer offscreen with single-word wrapping');
      assert.ok(measure.title.y-(measure.note.y+measure.note.height)<80,'prayer follows the compact introduction');
    }else{
      assert.ok(measure.title.x>measure.intro.x+measure.intro.width,'desktop retains its two-column prayer layout');
    }
    assert.ok(measure.overflow<=1,`no horizontal scrolling at ${width}px`);
    for(const selector of ['#sharePrayer','#copyPrayer','#copyPrayerLink','#amenButton','#prayerDate','#supportButton','#prayerVideos'])assert.equal(await page.locator(selector).count(),1);
  }
  // Changing edition still renders all introductory copy in the same mobile column.
  await page.setViewportSize({width:360,height:800});
  await page.goto(`${origin}/oracao-do-dia.html?dia=2026-09-11#oracao`);
  assert.match(await page.locator('.edition-state').innerText(),/anterior/);
  assert.ok((await page.locator('#oracao .availability-detail').boundingBox()).width>=260);
  await page.locator('#amenButton').click();
  assert.equal(await page.locator('#amenButton').getAttribute('aria-pressed'),'true');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.equal(writes,0);
  console.log(JSON.stringify({ok:true,widths:results.map(item=>item.viewport),archivedEdition:true,amenWorks:true,externalRequests:0,writes:0}));
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
