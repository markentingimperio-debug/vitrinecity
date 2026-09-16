// Local UI verification; install events are simulated, never a real installation.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {decorateGamesAppPage, GAMES_APP_PAGES} from '../../games-app-pages.js';
import {newFarm} from '../../public/vitriny-farm-core.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const root=fileURLToPath(new URL('../../public/',import.meta.url)), errors=[], external=[];
let posts=0, checks=0;
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost'); res.setHeader('Cache-Control','no-store');
    if(req.method!=='GET'){posts++;res.writeHead(405);res.end();return;}
    if(url.pathname==='/api/games/farm'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({state:newFarm(),preview:true,serverNow:Date.now()}));return;}
    if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
    if(GAMES_APP_PAGES[url.pathname]){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(decorateGamesAppPage(await readFile(path.join(root,GAMES_APP_PAGES[url.pathname]),'utf8'),{path:url.pathname}));return;}
    const file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
    if(!file.startsWith(root)){res.writeHead(403);res.end();return;}
    res.setHeader('Content-Type',({html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css',webmanifest:'application/manifest+json'})[file.split('.').pop()]||'application/octet-stream');res.end(await readFile(file));
  }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,...(process.env.CASUAL_QA_BROWSER?{executablePath:process.env.CASUAL_QA_BROWSER}:{})});
const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',reducedMotion:'reduce'});
await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){external.push(route.request().url());return route.abort();}return route.continue();});
await context.addInitScript(()=>{
  // WebGL failure is an existing supported mode, keeping this test about install UI.
  const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return String(type).includes('webgl')?null:get.call(this,type,...args);};
});
const pages=[];
try{
  for(const name of ['blocks','merge','games','mini-fazenda']){
    const page=await context.newPage();pages.push(page);page.on('pageerror',error=>errors.push(error.message));await page.goto(`${origin}/vitriny-${name}.html`);
    await page.locator('#vcgames-install').waitFor({state:'attached'});assert.equal(await page.locator('#vcgames-install').isVisible(),false);
    const target=name==='games'?'a[href="/vitriny-blocks.html"]':name==='mini-fazenda'?'#plots button:first-child':name==='blocks'?'.block-cell:first-child':'#board';
    await page.locator(target).focus();await page.keyboard.press('Shift');page.beforeBoard=await page.locator(target).boundingBox();page.focusSelector=target;
  }
  await Promise.all(pages.map(page=>page.locator('#vcgames-install').waitFor({state:'visible',timeout:20000})));
  for(const page of pages){
    assert.equal(await page.locator(page.focusSelector).evaluate(el=>el===document.activeElement),true,'invitation never takes focus');
    const after=await page.locator(page.focusSelector).boundingBox();assert.equal(after.y,page.beforeBoard.y,'no shift of gameplay above the invitation');
    const geometry=await page.locator('#vcgames-install').evaluate(el=>{const r=el.getBoundingClientRect(),main=document.querySelector('main').getBoundingClientRect();return{left:r.left,right:r.right,width:document.documentElement.clientWidth,below:r.top>=main.bottom,overflow:document.documentElement.scrollWidth>innerWidth,buttons:[...el.querySelectorAll('button,a')].map(button=>button.getBoundingClientRect().height)};});
    assert.equal(geometry.below,true);assert.equal(geometry.overflow,false);assert.ok(geometry.left>=0&&geometry.right<=geometry.width);assert.ok(geometry.buttons.every(h=>h>=44));checks++;
  }
  const page=pages[0];await page.locator('#vcgames-install .vcgames-install-action').click();await page.waitForURL(origin+'/games/?install=1');
  await page.locator('#vcgames-install').waitFor({state:'visible'});await page.getByRole('button',{name:'Como instalar',exact:true}).click();assert.match(await page.locator('#vcgames-install-help').innerText(),/se disponível/);checks++;
  if(process.env.INSTALL_QA_OUTPUT){await mkdir(process.env.INSTALL_QA_OUTPUT,{recursive:true});await page.locator('#vcgames-install').screenshot({path:path.join(process.env.INSTALL_QA_OUTPUT,'games-install-mobile.png')});}
  await page.evaluate(()=>{window.installCalls=0;const e=new Event('beforeinstallprompt',{cancelable:true});e.prompt=async()=>{window.installCalls++;return{outcome:'dismissed'};};e.userChoice=Promise.resolve({outcome:'dismissed'});window.dispatchEvent(e);window.installPrevented=e.defaultPrevented;});
  assert.equal(await page.evaluate(()=>window.installCalls),0);assert.equal(await page.evaluate(()=>window.installPrevented),true);
  await page.getByRole('button',{name:'Instalar VitrineCity Cultiva',exact:true}).click();assert.equal(await page.evaluate(()=>window.installCalls),1);assert.equal(await page.locator('#vcgames-install').isVisible(),false);checks++;
  await page.reload();await page.locator('#vcgames-install').waitFor({state:'visible'});await page.evaluate(()=>window.dispatchEvent(new Event('appinstalled')));assert.equal(await page.locator('#vcgames-install').isVisible(),false);checks++;
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.equal(posts,0);console.log(JSON.stringify({ok:true,checks,mobile:390,realInstalls:0,gameActions:posts,externalRequests:external.length}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
