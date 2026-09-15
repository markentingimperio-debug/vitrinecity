import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';

// The production 3D modules render in an isolated local browser. This fixture
// rejects production/provider requests, authentication and every write method.
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const publicRoot=fileURLToPath(new URL('../../public/',import.meta.url));
const repo=fileURLToPath(new URL('../../../',import.meta.url));
const threeRoot=path.dirname(fileURLToPath(import.meta.resolve('three')));
// Opt-in benchmark measures the four synchronous floor builds, not network time
// or overall FPS. Pin the pre-optimization implementation for reproducibility.
const benchmark=process.env.CITY_PAVING_BENCHMARK==='1';
const storeFixture=process.env.CITY_PAVING_STORE_FIXTURE==='1';
const fixtureStores=[
  {order_reference:'official_agrotecnica',business_name:'Agrotecnica',product_count:14},
  {order_reference:'official_centro_educacional',business_name:'Centro Educacional VitrineCity',product_count:8},
  {order_reference:'official_sertaneja_moda_country',business_name:'Sertaneja Moda Country',product_count:0},
  {order_reference:'official_beemi_agencia_shopee',business_name:'Beemi - Agencia Shopee',product_count:0}
];
const baselineFile=benchmark?'/vitriny-architectural-paving.js':'/vitriny-premium-architecture.js';
const baselineRef=benchmark?'83906b91ed690237e066ce3f1354a666c86e1f4a':'cbbbe053c3b07d002f151bf08c9b261fc3effffa';
const baseline=spawnSync(process.env.GIT_EXECUTABLE||'git',['show',`${baselineRef}:app/public${baselineFile}`],{cwd:repo,encoding:'utf8'});
assert.equal(baseline.status,0,baseline.stderr);
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.hdr':'application/octet-stream','.glb':'model/gltf-binary'};
// Concurrent development must not change other scene modules between a pair.
// Freeze each current local asset on its first read; no historical scene overlay.
const fixtureFiles=new Map();
let selectedMode='after',selectedHour=12;
const server=http.createServer(async(req,res)=>{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
  try{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(storeFixture&&['/api/maps/stores','/api/marketplace/stores'].includes(pathname)){
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({stores:pathname.includes('/marketplace/')?fixtureStores.slice(0,2):fixtureStores}));return;
    }
    if(pathname.startsWith('/api/')){res.writeHead(503,{'Content-Type':'application/json'});res.end('{"ok":false,"localFixture":true}');return;}
    const name=pathname==='/multiverso'?'/vitriny-multiverse-explore.html':pathname;
    // Addons are the actual vendored browser modules (with rewritten imports),
    // not npm's bare-import sources. Only Three's core comes from node_modules.
    const root=name.startsWith('/vendor/three/')&&!name.startsWith('/vendor/three/addons/')?threeRoot:publicRoot;
    const relative=root===threeRoot?name.slice('/vendor/three/'.length):'.'+name;
    const file=path.resolve(root,relative);
    assert.ok(file.startsWith(path.resolve(root)+path.sep));
    if(!fixtureFiles.has(file))fixtureFiles.set(file,readFile(file));
    let body=await fixtureFiles.get(file);
    if(name===baselineFile&&selectedMode==='before')body=Buffer.from(baseline.stdout);
    if(benchmark&&name==='/vitriny-premium-architecture.js')body=Buffer.from(body.toString()
      .replace('function pavingMaterial(','function pavingMaterialImpl(')
      .replace('function reflections(){',`function pavingMaterial(options){const start=performance.now();try{return pavingMaterialImpl(options);}finally{(globalThis.__pavingTimings||=[]).push({formal:options?.formal===true,ms:performance.now()-start});}}\nfunction reflections(){`));
    if(name==='/vitriny-architectural-lighting.js')body=Buffer.from(body.toString().replace('now=()=>new Date()',`now=()=>new Date('2026-09-15T${String(selectedHour+3).padStart(2,'0')}:00:00Z')`));
    if(name==='/vitriny-multiverse-explore.js')body=Buffer.from(body.toString()+`\n;globalThis.__pavingQA={walk(){position.set(-164,3.2,235);yaw=Math.PI;pitch=-.06;releaseControls();updateViewButton();},inspect(){const gl=renderer.getContext();return{pavingTimings:globalThis.__pavingTimings||[],stores:liveStoreGroup.children.map(g=>({reference:g.userData.reference,href:g.userData.href,interiorHref:g.userData.interiorHref,visible:g.visible,architecture:g.userData.architecture?.status})),profile:profile.id,paused:animationPaused,lights:scene.children.filter(o=>o.isLight).length,shaders:renderer.info.programs.map(p=>gl.getProgramParameter(p.program,gl.LINK_STATUS)),calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,textures:renderer.info.memory.textures,phase:scene.userData.dayPhase,materials:[...architecture.materials].filter(m=>m.bumpMap).map(m=>({bumpScale:m.bumpScale,roughness:m.roughness,shared:m.bumpMap===m.roughnessMap,repeat:m.map.repeat.toArray(),surfaceRepeat:m.bumpMap.repeat.toArray()}))}}};`);
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:body);
  }catch{res.writeHead(404);res.end('local fixture');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`,results=[];
let browser;
try{
  browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'});
  const devices=benchmark?[{name:'mobile-standard',width:390,height:844,memory:4},{name:'mobile-lite',width:360,height:800,memory:2}]:[{name:'desktop',width:1280,height:800,memory:8},{name:'mobile-lite',width:360,height:800,memory:2}];
  for(const device of devices)for(const hour of benchmark?[12]:[12,18])for(let round=0;round<(benchmark?3:1);round++){
    const pair=[];
    for(const mode of ['before','after']){
      selectedMode=mode;selectedHour=hour;
      const context=await browser.newContext({viewport:{width:device.width,height:device.height},deviceScaleFactor:1,isMobile:device.width<760,hasTouch:device.width<760,reducedMotion:'reduce',serviceWorkers:'block'});
      await context.addInitScript(memory=>{Object.defineProperty(navigator,'deviceMemory',{get:()=>memory});Object.defineProperty(navigator,'hardwareConcurrency',{get:()=>memory});},device.memory);
      const page=await context.newPage(),errors=[],external=[],writes=[];
      page.on('pageerror',error=>errors.push(error.message));
      await context.route('**/*',route=>{
        const request=route.request();
        if(new URL(request.url()).origin!==base){external.push(request.url());return route.abort();}
        if(!['GET','HEAD'].includes(request.method())){writes.push(request.method());return route.abort();}
        return route.continue();
      });
      if(benchmark){const session=await context.newCDPSession(page);await session.send('Emulation.setCPUThrottlingRate',{rate:4});}
      await page.goto(base+'/multiverso',{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>globalThis.__pavingQA?.inspect().phase&&globalThis.__pavingQA.inspect().calls>0,null,{timeout:60000});
      if(storeFixture){
        try{await page.waitForFunction(()=>{const stores=globalThis.__pavingQA.inspect().stores;return stores.length===4&&stores.every(s=>s.visible&&s.architecture==='ready');},null,{timeout:60000});}
        catch(error){console.error(JSON.stringify({storeFixtureFailed:true,stores:await page.evaluate(()=>globalThis.__pavingQA.inspect().stores),errors}));throw error;}
      }
      await page.evaluate(()=>globalThis.__pavingQA.walk());
      await page.waitForTimeout(1600);
      const state=await page.evaluate(()=>globalThis.__pavingQA.inspect());
      if(storeFixture){
        const links=await page.evaluate(()=>({
          stores:[...document.querySelectorAll('#storeLinks [data-store-reference]')].map(a=>({reference:a.dataset.storeReference,href:a.getAttribute('href')})),
          showrooms:[...document.querySelectorAll('#storeLinks [data-store-showroom]')].map(a=>({reference:a.dataset.storeShowroom,href:a.getAttribute('href')})),
          entrances:[...document.querySelectorAll('.store-entrance-group')].map(g=>({href:g.querySelector('.store-entrance')?.getAttribute('href'),showroom:g.querySelector('.store-showroom-link')?.getAttribute('href')||''}))
        }));
        assert.equal(links.stores.length,4);assert.equal(links.showrooms.length,2);assert.equal(links.entrances.length,4);
        for(const store of state.stores){
          assert.equal(links.stores.find(a=>a.reference===store.reference)?.href,store.href);
          assert.equal(links.entrances.find(a=>a.href===store.href)?.showroom,store.interiorHref);
          assert.equal(links.showrooms.find(a=>a.reference===store.reference)?.href||'',store.interiorHref);
        }
      }
      assert.ok(state.shaders.length>0&&state.shaders.every(Boolean));assert.equal(state.paused,true);
      assert.equal(state.phase,hour===12?'day':'dusk');assert.deepEqual(errors,[]);
      if(benchmark){assert.equal(state.pavingTimings.filter(p=>p.formal).length,4);assert.ok(state.pavingTimings.every(p=>Number.isFinite(p.ms)&&p.ms>=0));}
      // The app can attempt its anonymous presence heartbeat; it is blocked here.
      // No request can leave the fixture and no mutation ever reaches a server.
      assert.deepEqual(external,[]);
      if(mode==='after'&&device.name==='mobile-lite')assert.deepEqual(state.materials,[]);
      if(mode==='after'&&device.name==='desktop'){
        assert.ok(state.materials.length>=3);
        for(const material of state.materials){assert.equal(material.bumpScale,.006);assert.equal(material.shared,true);assert.deepEqual(material.repeat,material.surfaceRepeat);}
      }
      if(process.env.CITY_PAVING_SCREENSHOT_DIR){
        await mkdir(process.env.CITY_PAVING_SCREENSHOT_DIR,{recursive:true});
        await page.screenshot({path:path.join(process.env.CITY_PAVING_SCREENSHOT_DIR,`paving-${device.name}-${hour}-${mode}${benchmark?`-bench-${round+1}`:''}.png`),animations:'disabled'});
      }
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false);
      pair.push(state);results.push({device:device.name,hour,round,mode,state,errors,externalRequests:external.length,blockedWrites:writes.length});
      await context.close();
    }
    assert.equal(pair[0].calls,pair[1].calls,'Changing the pavement must add no draw calls');
    assert.equal(pair[0].triangles,pair[1].triangles,'Changing the pavement must add no geometry');
    assert.equal(pair[0].lights,pair[1].lights,'Changing the pavement must add no scene lights');
    console.log(JSON.stringify({device:device.name,hour,round:round+1,calls:pair[1].calls,triangles:pair[1].triangles,beforeTextures:pair[0].textures,afterTextures:pair[1].textures,shadersLinked:true,noExtraDrawCalls:true,...(storeFixture?{modeledStores:pair[1].stores.length,showrooms:pair[1].stores.filter(s=>s.interiorHref).length}:{}),...(benchmark?{beforePavingMs:pair[0].pavingTimings.filter(p=>p.formal).reduce((sum,p)=>sum+p.ms,0),afterPavingMs:pair[1].pavingTimings.filter(p=>p.formal).reduce((sum,p)=>sum+p.ms,0)}:{})}));
  }
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
if(benchmark){
  for(const device of [...new Set(results.map(r=>r.device))]){
    const median=mode=>results.filter(r=>r.device===device&&r.mode===mode).map(r=>r.state.pavingTimings.filter(p=>p.formal).reduce((sum,p)=>sum+p.ms,0)).sort((a,b)=>a-b)[1];
    const beforeMs=median('before'),afterMs=median('after');
    console.log(JSON.stringify({benchmark:'four synchronous city pavements',device,baselineRef,cpuSlowdown:4,repeats:3,beforeMedianMs:beforeMs,afterMedianMs:afterMs,reductionPercent:(1-afterMs/beforeMs)*100}));
  }
}
console.log(`PASS ${results.length} isolated architectural-paving renders; no production or provider traffic`);
