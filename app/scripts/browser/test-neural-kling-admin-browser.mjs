import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {KLING_API_LINKS,assertKlingReadiness} from '../../public/neural-kling-contract.js';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const publicRoot=fileURLToPath(new URL('../../public/',import.meta.url));
const receipts=stage=>assertKlingReadiness({version:1,provider:'kling_api',stage,configured:stage!=='credentials_missing',checkedAt:stage==='not_checked'||stage==='credentials_missing'?null:'2026-09-15T12:00:00.000Z',generationEnabled:false,customerBillingEnabled:false,studioCreditsShared:false,balanceFreshness:'up_to_12_hours',packageCount:stage==='access_verified'?2:null});
let current=receipts('not_checked'),releaseCheck=null,rejectCheck=false,checks=0;
const calls=[],external=[],errors=[],measurements=[];
const legacy={
  '/status':{service:{enabled:true,mode:'shadow'},readiness:{recommendedMode:'shadow'},skills:{providers:[]}},
  '/skills':{skills:[],providers:[]},'/models/qualifications':{items:[]},'/benchmark':{recent:[]},
  '/web-research/status':{configured:false},'/web-research/candidates':{items:[]},
  '/training/status':{counts:{}},'/training/examples':{items:[]},
  '/supervisor/status':{enabled:false,configured:false,paused:false,revision:1,automaticDaily:false,automatic:{},limits:{},quote:{},budget:{},availability:{state:'unknown'},recent:[]}
};
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');res.setHeader('Cache-Control','no-store');
    const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
    if(url.pathname.startsWith('/api/admin/vitriny-neural')){
      const route=url.pathname.slice('/api/admin/vitriny-neural'.length);calls.push({route,method:req.method});
      if(route==='/kling/status')return json({ok:true,status:current});
      if(route==='/kling/check'){
        assert.equal(req.method,'POST');assert.equal(req.headers['x-neural-request'],'1');assert.equal(req.headers['content-type'],'application/json');
        const chunks=[];for await(const chunk of req)chunks.push(chunk);assert.equal(Buffer.concat(chunks).toString(),'{}');checks++;
        if(rejectCheck)return json({ok:false,error:'PRIVATE_ERROR_SHOULD_NOT_RENDER'},503);
        await new Promise(resolve=>{releaseCheck=resolve;});current=receipts('access_verified');return json({ok:true,status:current});
      }
      assert.equal(req.method,'GET','legacy console must not mutate on open');
      assert.ok(Object.hasOwn(legacy,route),'Unexpected legacy read '+route);return json(legacy[route]);
    }
    if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
    const file=path.resolve(publicRoot,'.'+decodeURIComponent(url.pathname));
    if(!file.startsWith(path.resolve(publicRoot)+path.sep)){res.writeHead(403);res.end();return;}
    res.setHeader('Content-Type',({js:'text/javascript; charset=utf-8',html:'text/html; charset=utf-8',css:'text/css'})[path.extname(file).slice(1)]||'application/octet-stream');
    res.end(await readFile(file));
  }catch(error){errors.push(error.message);res.writeHead(500);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
let browser;
try{
  browser=await chromium.launch({channel:'chrome',headless:true});
  const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce',serviceWorkers:'block'});
  await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){external.push(route.request().url());return route.abort();}return route.continue();});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  for(const width of [320,360,390,412,768,1280]){
    await page.setViewportSize({width,height:844});await page.goto(origin+'/admin-vitriny-neural.html');
    await page.waitForFunction(()=>document.getElementById('kling-stage').dataset.state==='not_checked');
    const view=await page.evaluate(()=>{
      const panel=document.getElementById('kling-panel'),button=document.getElementById('kling-check').getBoundingClientRect();
      return {width:innerWidth,overflow:document.documentElement.scrollWidth-innerWidth,buttonHeight:button.height,buttonWidth:button.width,panelWidth:panel.getBoundingClientRect().width,insideAdvanced:!!panel.closest('.advanced-console'),advancedOpen:document.querySelector('.advanced-console').open};
    });
    assert.ok(view.overflow<=1,'no overflow at '+width);assert.ok(view.buttonHeight>=44&&view.buttonWidth>=44);assert.equal(view.insideAdvanced,false);assert.equal(view.advancedOpen,false);measurements.push(view);
    assert.equal(checks,0,'opening or resizing never checks API access');
  }
  await page.setViewportSize({width:390,height:844});
  const panel=page.locator('#kling-panel');await panel.scrollIntoViewIfNeeded();
  for(const [key,value]of Object.entries(KLING_API_LINKS)){
    const link=page.locator('#kling-'+key+'-link');assert.equal(await link.getAttribute('href'),value);assert.equal(await link.getAttribute('target'),'_blank');assert.equal(await link.getAttribute('rel'),'noopener noreferrer');
    await link.focus();assert.equal(await link.evaluate(element=>document.activeElement===element),true);
  }
  await page.locator('#kling-check').click();
  await page.waitForFunction(()=>document.getElementById('kling-panel').getAttribute('aria-busy')==='true');
  assert.equal(await page.locator('#kling-check').isDisabled(),true);assert.equal(await page.locator('#kling-refresh').isDisabled(),true);
  assert.equal(await page.locator('#kling-stage').getAttribute('data-state'),'loading');
  await page.locator('#kling-check').dispatchEvent('click');assert.equal(checks,1,'busy guard prevents a second check');
  assert.ok(releaseCheck);releaseCheck();
  await page.waitForFunction(()=>document.getElementById('kling-stage').dataset.state==='access_verified');
  assert.match(await page.locator('#kling-status').innerText(),/Nenhum vídeo foi gerado/);
  assert.match(await page.locator('#kling-commercial').innerText(),/ainda precisam ser confirmados/);
  assert.match(await panel.innerText(),/Assinatura e créditos do Studio não são compartilhados/);
  assert.match(await page.locator('#kling-billing').innerText(),/^Desativada/);
  if(process.env.NEURAL_QA_OUTPUT){await mkdir(process.env.NEURAL_QA_OUTPUT,{recursive:true});await panel.screenshot({path:path.join(process.env.NEURAL_QA_OUTPUT,'kling-admin-verified-mobile.png')});}
  rejectCheck=true;await page.locator('#kling-check').click();
  await page.waitForFunction(()=>document.getElementById('kling-stage').dataset.state==='error');
  assert.equal(await page.locator('#kling-stage').innerText(),'Estado não confirmado');assert.equal(await page.locator('#kling-package-count').isVisible(),false);
  assert.doesNotMatch(await panel.innerText(),/PRIVATE_ERROR_SHOULD_NOT_RENDER/);
  assert.equal(await page.locator('#kling-check').isDisabled(),true);assert.equal(await page.locator('#kling-refresh').isEnabled(),true);
  if(process.env.NEURAL_QA_OUTPUT)await panel.screenshot({path:path.join(process.env.NEURAL_QA_OUTPUT,'kling-admin-failed-mobile.png')});
  await page.locator('#kling-refresh').click();await page.waitForFunction(()=>document.getElementById('kling-stage').dataset.state==='access_verified');assert.equal(checks,2,'recovery uses GET, never repeats POST');
  current=receipts('credentials_missing');await page.reload();await page.waitForFunction(()=>document.getElementById('kling-stage').dataset.state==='credentials_missing');
  assert.equal(await page.locator('#kling-check').isDisabled(),true);assert.equal(checks,2);
  assert.ok(calls.filter(call=>call.method==='POST').every(call=>call.route==='/kling/check'));assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,measurements,officialLinkNavigation:true,readOnlyInitialGet:true,explicitCheckOnly:true,failedCheckClearsPriorEvidence:true,studioSeparate:true,readinessNotGeneration:true,paidCalls:0,externalRequests:0}));
}finally{releaseCheck?.();if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
