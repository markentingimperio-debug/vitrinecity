import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

// Isolated anonymous fixture: no production, provider, credentials or write calls.
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const publicRoot=fileURLToPath(new URL('../../public/',import.meta.url));
const threeRoot=path.dirname(fileURLToPath(import.meta.resolve('three'))),threeAddonsRoot=path.resolve(threeRoot,'../examples/jsm');
const store={order_reference:'official_agrotecnica',business_name:'Agrotécnica',product_count:4};
const products=Array.from({length:4},(_,index)=>({id:index+1,store_reference:store.order_reference,name:`Produto demonstrativo ${index+1}`,category:'Exemplo local',price_cents:1000+index*250,stock_quantity:2}));
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.hdr':'application/octet-stream'};
let mode='after';
const server=http.createServer(async(req,res)=>{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
  try{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(['/api/marketplace/stores','/api/marketplace/products'].includes(pathname)){
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(pathname.endsWith('stores')?{stores:[store]}:{products}));return;
    }
    if(pathname.startsWith('/api/')){res.writeHead(503);res.end('Unexpected fixture API');return;}
    if(pathname.startsWith('/loja/')){res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>Local shop destination</title>Local shop destination');return;}
    const root=pathname.startsWith('/vendor/three/addons/')?threeAddonsRoot:pathname.startsWith('/vendor/three/')?threeRoot:publicRoot;
    const relative=root===threeAddonsRoot?pathname.slice('/vendor/three/addons/'.length):root===threeRoot?pathname.slice('/vendor/three/'.length):'.'+pathname;
    const file=path.resolve(root,relative);assert.ok(file.startsWith(path.resolve(root)+path.sep));
    let body=await readFile(file);
    if(pathname==='/vitriny-store-interior.js'){
      let script=body.toString();if(mode==='before')script=script.replace('mountReception(store);','/* Fixture baseline: same scene without reception. */');
      script+=`\n;globalThis.__receptionQA={inspect(){const gl=renderer.getContext(),point=new THREE.Vector3(receptionPose.x,1.1,receptionPose.z).project(camera);return{profile:profile.id,calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,textures:renderer.info.memory.textures,lights:scene.children.filter(item=>item.isLight).length,identity:reception?.identity.id||null,avatars:receptionCrowd?.people.length||0,elapsed:receptionElapsed,shaders:renderer.info.programs.map(p=>gl.getProgramParameter(p.program,gl.LINK_STATUS)),point:{x:(point.x+1)/2*innerWidth,y:(1-point.y)/2*innerHeight}}}};`;
      body=Buffer.from(script);
    }
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:body);
  }catch{res.writeHead(404);res.end('local fixture');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`,results=[];let browser;
try{
  browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'});
  for(const device of [{name:'desktop',width:1440,height:900,memory:8},{name:'tablet',width:768,height:1024,memory:4},{name:'mobile-lite',width:375,height:812,memory:2}]){
    const pair=[];
    for(const selectedMode of ['before','after']){
      mode=selectedMode;
      const context=await browser.newContext({viewport:{width:device.width,height:device.height},deviceScaleFactor:1,isMobile:device.width<760,hasTouch:device.width<760,reducedMotion:'reduce',serviceWorkers:'block'});
      await context.addInitScript(memory=>{Object.defineProperty(navigator,'deviceMemory',{get:()=>memory});Object.defineProperty(navigator,'hardwareConcurrency',{get:()=>memory});},device.memory);
      const page=await context.newPage(),errors=[],external=[],writes=[],apiCalls=[];
      page.on('pageerror',error=>errors.push(error.message));
      await context.route('**/*',route=>{
        const request=route.request(),url=new URL(request.url());
        if(url.origin!==base){external.push(request.url());return route.abort();}
        if(!['GET','HEAD'].includes(request.method())){writes.push({method:request.method(),path:url.pathname});return route.abort();}
        if(url.pathname.startsWith('/api/'))apiCalls.push(url.pathname);
        return route.continue();
      });
      await page.goto(base+'/vitriny-store-interior.html?store=official_agrotecnica',{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>{const state=globalThis.__receptionQA?.inspect();return state?.calls>0&&state.shaders.length>0&&state.shaders.every(Boolean);},null,{timeout:30000});
      const state=await page.evaluate(()=>globalThis.__receptionQA.inspect());
      assert.ok(state.shaders.length>0&&state.shaders.every(Boolean));assert.equal(state.avatars,mode==='after'?1:0);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
      if(mode==='after'){
        assert.equal(state.identity,'guide-official_agrotecnica');
        assert.ok(state.point.x>0&&state.point.x<device.width&&state.point.y>0&&state.point.y<device.height,'Guide is inside the default camera');
        const sample=await page.evaluate(()=>new Promise(resolve=>{const intervals=[];let previous=performance.now();function step(now){intervals.push(now-previous);previous=now;if(intervals.length<20)requestAnimationFrame(step);else resolve(intervals.sort((a,b)=>a-b)[10]);}requestAnimationFrame(step);}));
        assert.equal((await page.evaluate(()=>globalThis.__receptionQA.inspect())).elapsed,state.elapsed,'Reduced motion freezes reception');
        if(process.env.STORE_RECEPTION_SCREENSHOT_DIR){await mkdir(process.env.STORE_RECEPTION_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.STORE_RECEPTION_SCREENSHOT_DIR,`showroom-${device.name}.png`),animations:'disabled'});}
        await page.locator('#openReception').focus();await page.keyboard.press('Enter');
        assert.equal(await page.locator('#receptionDialog').evaluate(element=>element.open),true);
        assert.equal(await page.evaluate(()=>document.activeElement.id),'closeReception');
        for(let tab=0;tab<4;tab++){await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.closest('dialog')?.id),'receptionDialog');}
        if(process.env.STORE_RECEPTION_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.STORE_RECEPTION_SCREENSHOT_DIR,`showroom-${device.name}-reception.png`),animations:'disabled'});
        await page.keyboard.press('Escape');assert.equal(await page.locator('#receptionDialog').evaluate(element=>element.open),false);
        assert.equal(await page.evaluate(()=>document.activeElement.id),'openReception');
        // The same receptionist can be selected in 3D without touching products.
        await page.mouse.click(state.point.x,state.point.y);assert.equal(await page.locator('#receptionDialog').evaluate(element=>element.open),true);
        assert.deepEqual(apiCalls.filter(item=>item!=='/api/spatial/presence/stream').sort(),['/api/marketplace/products','/api/marketplace/stores']);
        await page.locator('#receptionLia').click();await page.waitForURL('**/loja/official_agrotecnica/agrotecnica#falar-com-lia');
        state.fixtureMedianFrameMs=sample;
      }
      assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
      // Existing spatial-session import starts anonymous presence; block it in
      // both baseline and candidate, and reject any other attempted mutation.
      assert.ok(writes.every(item=>item.method==='POST'&&['/api/spatial/telemetry/event','/api/spatial/presence/heartbeat','/api/spatial/presence/leave'].includes(item.path)),JSON.stringify(writes));
      state.blockedExistingWrites=writes.length;pair.push(state);await context.close();
    }
    const before=pair[0],after=pair[1];assert.equal(after.lights,before.lights);assert.equal(after.textures,before.textures);
    assert.ok(after.calls-before.calls<=8);assert.ok(after.triangles-before.triangles<=16680);
    results.push({device:device.name,profile:after.profile,avatars:after.avatars,extraDrawCalls:after.calls-before.calls,extraTriangles:after.triangles-before.triangles,extraTextures:after.textures-before.textures,fixtureMedianFrameMs:after.fixtureMedianFrameMs,network:'existing marketplace GETs and spatial presence only',blockedExistingWrites:after.blockedExistingWrites,keyboardAndHitTest:true});
  }
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
for(const result of results)console.log(JSON.stringify(result));
console.log('PASS 3 isolated showroom sizes, native modal focus and simulated reception; no production/provider traffic. Frame samples are not production performance evidence.');
