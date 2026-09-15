import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';

// Local UI fixture only: no providers, authentication, analytics or mutations.
const publicDir=path.resolve(fileURLToPath(new URL('../public/',import.meta.url)));
const original=await readFile(path.join(publicDir,'vitriny-multiverse-explore.html'),'utf8');
const fixture=original.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace('</head>','<script type="module" src="/vitriny-city-residents.js"></script><style>#loading{display:none}body{background:#152831}</style></head>');
const server=http.createServer(async(req,res)=>{
  try{
    const name=new URL(req.url,'http://localhost').pathname;
    if(name==='/'){res.setHeader('content-type','text/html');res.end(fixture);return;}
    const file=path.resolve(publicDir,'.'+name);if(!file.startsWith(publicDir+path.sep))throw new Error('outside fixture');
    const body=await readFile(file);res.setHeader('content-type',name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'application/octet-stream');res.end(body);
  }catch{res.statusCode=404;res.end('fixture only');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const modulePath=process.env.PLAYWRIGHT_MODULE;
const {chromium}=await import(modulePath?pathToFileURL(modulePath).href:'playwright');
let browser;
try{
  browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'});
  for(const width of [320,360,390,412,768,1280]){
    const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),page=await context.newPage(),errors=[],requests=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>{const request=route.request();requests.push({url:request.url(),method:request.method()});if(request.url().startsWith(base))return route.continue();return route.abort();});
    await page.goto(base);await page.locator('#openCityResidents').waitFor({state:'attached'});
    await page.locator('#cityTools>summary').click();await page.locator('#openCityResidents').click();
    const dialog=page.locator('#cityResidents');await dialog.waitFor({state:'visible'});
    assert.equal(await page.locator('#residentName').textContent(),'Vera');assert.equal(await dialog.getByRole('button',{name:'Ver na cidade',exact:true}).isDisabled(),true);
    await page.locator('#residentsDepartment').selectOption('studio');await page.locator('#residentsPerson').selectOption('olivia');
    assert.equal(await page.locator('#residentName').textContent(),'Olívia');assert.equal(await dialog.locator('.resident-channels a').count(),3);
    await dialog.getByRole('button',{name:'Conversar · simulação',exact:true}).click();assert.match(await page.locator('#residentSpeech').textContent(),/Fala simulada de Olívia/);
    for(const a of await dialog.locator('.resident-channels a').all()){assert.equal(await a.getAttribute('target'),'_blank');assert.match(await a.getAttribute('rel'),/noopener/);}
    const overflow=await dialog.evaluate(d=>({width:d.clientWidth,scroll:d.scrollWidth,left:d.getBoundingClientRect().left,right:d.getBoundingClientRect().right}));
    assert.ok(overflow.scroll<=overflow.width+1,JSON.stringify({width,overflow}));assert.ok(overflow.left>=0&&overflow.right<=width+1);
    for(const select of await dialog.locator('select').all())assert.ok(await select.evaluate(n=>!!document.querySelector(`label[for="${n.id}"]`)));
    await page.keyboard.press('Escape');assert.equal(await dialog.isVisible(),false);assert.equal(await page.evaluate(()=>document.activeElement.id),'openCityResidents');
    // Keyboard-only reopen; native select and modal trap are retained.
    await page.keyboard.press('Enter');assert.equal(await dialog.isVisible(),true);
    await page.evaluate(()=>dispatchEvent(new CustomEvent('vitriny:residents-ready',{detail:{ready:true}})));
    await page.locator('#residentsDepartment').selectOption('neural');assert.match(await dialog.locator('.resident-primary').getAttribute('href'),/personal=1/);
    await page.evaluate(()=>{window.residentVisit=null;window.residentClosed=false;const canvas=document.createElement('canvas');canvas.id='fixtureCanvas';canvas.tabIndex=0;document.body.append(canvas);document.getElementById('cityResidents').addEventListener('close',()=>window.residentClosed=true,{once:true});addEventListener('vitriny:resident-visit',e=>{window.residentVisit=e.detail.residentId;canvas.focus();},{once:true});});
    await dialog.getByRole('button',{name:'Ver na cidade',exact:true}).click();assert.equal(await page.evaluate(()=>window.residentVisit),'iris');assert.equal(await dialog.isVisible(),false);await page.waitForFunction(()=>window.residentClosed);assert.equal(await page.evaluate(()=>document.activeElement.id),'fixtureCanvas');
    await page.locator('#openCityResidents').click();
    await page.evaluate(()=>dispatchEvent(new CustomEvent('vitriny:residents-catalog',{detail:{stores:[{reference:'official_test',name:'<img src=x onerror=alert(1)>',href:'/loja/test',position:{x:180,z:32},instructions:'SECRET_PROMPT'}]}})));
    await page.locator('#residentsDepartment').selectOption('store-official_test');assert.equal(await dialog.locator('img').count(),0);assert.ok(!(await dialog.textContent()).includes('SECRET_PROMPT'));
    if(width===390&&process.env.RESIDENT_SCREENSHOT_DIR){await mkdir(process.env.RESIDENT_SCREENSHOT_DIR,{recursive:true});await page.locator('#residentsDepartment').selectOption('studio');await page.screenshot({path:path.join(process.env.RESIDENT_SCREENSHOT_DIR,'residents-390.png')});}
    const appearance=await dialog.locator('.resident-portrait').getAttribute('style');await page.reload();await page.locator('#cityTools>summary').click();await page.locator('#openCityResidents').click();await page.locator('#residentsDepartment').selectOption('studio');
    // Fixed catalog returns the same first studio identity after every load.
    assert.equal(await page.locator('#residentName').textContent(),'Noa');assert.ok(appearance);
    assert.deepEqual(errors,[]);assert.ok(requests.every(r=>r.method==='GET'&&r.url.startsWith(base)&&!r.url.includes('/api/')));
    console.log(`PASS residents browser ${width}px: modal, keyboard, channels, navigation, safety, reduced motion`);await context.close();
  }
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
