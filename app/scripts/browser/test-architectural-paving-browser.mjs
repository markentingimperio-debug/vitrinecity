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
const baseline=spawnSync(process.env.GIT_EXECUTABLE||'git',['show','cbbbe053c3b07d002f151bf08c9b261fc3effffa:app/public/vitriny-premium-architecture.js'],{cwd:repo,encoding:'utf8'});
assert.equal(baseline.status,0,baseline.stderr);
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.hdr':'application/octet-stream','.glb':'model/gltf-binary'};
let selectedMode='after',selectedHour=12;
const server=http.createServer(async(req,res)=>{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
  try{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(pathname.startsWith('/api/')){res.writeHead(503,{'Content-Type':'application/json'});res.end('{"ok":false,"localFixture":true}');return;}
    const name=pathname==='/multiverso'?'/vitriny-multiverse-explore.html':pathname;
    const root=name.startsWith('/vendor/three/')?threeRoot:publicRoot;
    const file=path.resolve(root,root===threeRoot?name.slice('/vendor/three/'.length):'.'+name);
    assert.ok(file.startsWith(path.resolve(root)+path.sep));
    let body=await readFile(file);
    if(name==='/vitriny-premium-architecture.js'&&selectedMode==='before')body=Buffer.from(baseline.stdout);
    if(name==='/vitriny-architectural-lighting.js')body=Buffer.from(body.toString().replace('now=()=>new Date()',`now=()=>new Date('2026-09-15T${String(selectedHour+3).padStart(2,'0')}:00:00Z')`));
    if(name==='/vitriny-multiverse-explore.js')body=Buffer.from(body.toString()+`\n;globalThis.__pavingQA={walk(){position.set(-164,3.2,235);yaw=Math.PI;pitch=-.06;releaseControls();updateViewButton();},inspect(){const gl=renderer.getContext();return{profile:profile.id,paused:animationPaused,lights:scene.children.filter(o=>o.isLight).length,shaders:renderer.info.programs.map(p=>gl.getProgramParameter(p.program,gl.LINK_STATUS)),calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,textures:renderer.info.memory.textures,phase:scene.userData.dayPhase,materials:[...architecture.materials].filter(m=>m.bumpMap).map(m=>({bumpScale:m.bumpScale,roughness:m.roughness,shared:m.bumpMap===m.roughnessMap,repeat:m.map.repeat.toArray(),surfaceRepeat:m.bumpMap.repeat.toArray()}))}}};`);
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:body);
  }catch{res.writeHead(404);res.end('local fixture');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`,results=[];
let browser;
try{
  browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'});
  for(const device of [{name:'desktop',width:1280,height:800,memory:8},{name:'mobile-lite',width:360,height:800,memory:2}])for(const hour of [12,18]){
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
      await page.goto(base+'/multiverso',{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>globalThis.__pavingQA?.inspect().phase&&globalThis.__pavingQA.inspect().calls>0,null,{timeout:60000});
      await page.evaluate(()=>globalThis.__pavingQA.walk());
      await page.waitForTimeout(1600);
      const state=await page.evaluate(()=>globalThis.__pavingQA.inspect());
      assert.ok(state.shaders.length>0&&state.shaders.every(Boolean));assert.equal(state.paused,true);
      assert.equal(state.phase,hour===12?'day':'dusk');assert.deepEqual(errors,[]);
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
        await page.screenshot({path:path.join(process.env.CITY_PAVING_SCREENSHOT_DIR,`paving-${device.name}-${hour}-${mode}.png`),animations:'disabled'});
      }
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false);
      pair.push(state);results.push({device:device.name,hour,mode,state,errors,externalRequests:external.length,blockedWrites:writes.length});
      await context.close();
    }
    assert.equal(pair[0].calls,pair[1].calls,'Changing the pavement must add no draw calls');
    assert.equal(pair[0].triangles,pair[1].triangles,'Changing the pavement must add no geometry');
    assert.equal(pair[0].lights,pair[1].lights,'Changing the pavement must add no scene lights');
    console.log(JSON.stringify({device:device.name,hour,calls:pair[1].calls,triangles:pair[1].triangles,beforeTextures:pair[0].textures,afterTextures:pair[1].textures,shadersLinked:true,noExtraDrawCalls:true}));
  }
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
console.log(`PASS ${results.length} isolated architectural-paving renders; no production or provider traffic`);
