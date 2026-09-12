// Real browser + real app routes on an isolated local fixture. No external calls or game rewards.
import assert from 'node:assert/strict';
import express from 'express';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {setupGamesAppRoutes} from '../../games-app-routes.js';
import {newFarm} from '../../public/vitriny-farm-core.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const publicDir=fileURLToPath(new URL('../../public/',import.meta.url));
const app=express(),requests=[],external=[],errors=[];let authenticated=false,checks=0,posts=0;
app.use((req,res,next)=>{requests.push({path:req.path,method:req.method});if(req.method!=='GET'){posts++;return res.sendStatus(405);}next();});
setupGamesAppRoutes(app,{publicDir,currentUser:()=>authenticated?{id:999999,account_status:'active',name:'QA local'}:null});
app.get('/api/games/farm',(_req,res)=>res.set('Cache-Control','private,no-store').json({state:newFarm(),preview:true,serverNow:Date.now()}));
app.get('/favicon.ico',(_req,res)=>res.sendStatus(204));
app.use(express.static(publicDir,{maxAge:0}));
const server=await new Promise(resolve=>{const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));});
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,...(process.env.CASUAL_QA_BROWSER?{executablePath:process.env.CASUAL_QA_BROWSER}:{})});
const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce',serviceWorkers:'allow'});
await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){external.push(route.request().url());return route.abort();}return route.continue();});
await context.addInitScript(()=>{
  // The farm's already-tested fallback avoids GPU dependence in this install/offline test.
  const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return String(type).includes('webgl')?null:get.call(this,type,...args);};
});
const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
async function geometry(){const result=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,commerce:document.querySelectorAll('[data-city-chat],[data-site-assistant],#site-assistant-root,.farm-rewards').length,manifest:document.querySelector('link[rel=manifest]')?.getAttribute('href')}));assert.ok(result.scroll<=result.width,'no mobile overflow');assert.equal(result.commerce,0);assert.equal(result.manifest,'/games/manifest.webmanifest');}
try{
  const first=await page.goto(origin+'/games/');assert.equal(first.status(),200);await page.waitForFunction(()=>navigator.serviceWorker.controller?.scriptURL.endsWith('/games/sw.js'),undefined,{timeout:20000});
  assert.equal(await page.title(),'VitrineCity Cultiva · Plantas, cuidado e diversão');await geometry();checks++;
  const cachePaths=await page.evaluate(async()=>{const cache=await caches.open('vitrinecity-games-v1');return(await cache.keys()).map(req=>new URL(req.url).pathname);});
  assert.ok(cachePaths.includes('/games/plantas'));assert.ok(cachePaths.includes('/games/plants-core.js'));assert.ok(cachePaths.includes('/games/blocos'));assert.ok(cachePaths.every(p=>!p.startsWith('/api/')&&!/fazenda|entrar|dados|cuidados|\.glb/.test(p)));checks++;
  if(process.env.CULTIVA_QA_OUTPUT){await mkdir(process.env.CULTIVA_QA_OUTPUT,{recursive:true});await page.screenshot({path:path.join(process.env.CULTIVA_QA_OUTPUT,'cultiva-hub-mobile.png'),fullPage:true});}
  await page.goto(origin+'/games/blocos');await page.locator('.block-cell').first().waitFor();await page.locator('[data-piece="0"]').click();await page.locator('.block-cell').first().click();
  const score=await page.locator('#score').innerText();assert.ok(Number(score)>0);await geometry();checks++;
  await page.goto(origin+'/games/fazenda');await page.waitForURL(origin+'/games/entrar?returnTo=%2Fgames%2Ffazenda');assert.match(await page.locator('h1').innerText(),/fazenda/);checks++;
  authenticated=true;await page.goto(origin+'/games/fazenda');await page.locator('#saveStatus').filter({hasText:'Prévia local'}).waitFor();assert.equal(await page.locator('#backCity').getAttribute('href'),'/games/');assert.equal(await page.locator('.farm-rewards,[data-city-chat]').count(),0);checks++;
  const beforeOffline=requests.length;await context.setOffline(true);
  await page.goto(origin+'/games/blocos');await page.locator('.block-cell').first().waitFor();assert.equal(await page.locator('#score').innerText(),score);assert.equal(await page.locator('#undo').isDisabled(),true);checks++;
  await page.goto(origin+'/games/jardim');await page.locator('#board').waitFor();await page.locator('[data-direction="left"]').click();assert.ok(await page.locator('#board').innerHTML());await geometry();checks++;
  await page.goto(origin+'/games/plantas');assert.equal(await page.title(),'Minhas plantas · VitrineCity Cultiva');await geometry();
  await page.locator('#add-plant').click();await page.locator('#plant-name').fill('Zamioculca QA local');await page.locator('#plant-note').fill('Observação de teste, salva apenas neste navegador.');await page.getByRole('button',{name:'Salvar planta',exact:true}).click();
  assert.match(await page.locator('#plant-list').innerText(),/Zamioculca QA local/);await page.reload();assert.match(await page.locator('#plant-list').innerText(),/Zamioculca QA local/);checks++;
  await page.goto(origin+'/games/fazenda');assert.equal(await page.locator('h1').innerText(),'Uma pausa na conexão.');assert.match(await page.locator('main').innerText(),/Nenhuma ação da fazenda ficou aguardando envio/);assert.equal(await page.locator('#coins').count(),0);checks++;
  await page.goto(origin+'/games/cuidados');assert.equal(await page.locator('h1').innerText(),'Uma pausa na conexão.');checks++;
  assert.equal(requests.length,beforeOffline,'offline navigation must not reach any fixture API/server');
  assert.equal(posts,0);assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  const result={ok:true,checks,mobile:390,offline:['blocos','jardim','plantas'],farmOffline:'online-only fallback',realPayments:0,gameWrites:posts,externalRequests:external.length,cachePaths};
  if(process.env.CULTIVA_QA_OUTPUT)await writeFile(path.join(process.env.CULTIVA_QA_OUTPUT,'qa.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
