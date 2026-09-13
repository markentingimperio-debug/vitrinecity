// Isolated Chromium uses real page CSS/DOM and local modules, never the owner's tabs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {decorateGamesAppPage} from '../../games-app-pages.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const root=fileURLToPath(new URL('../../public/',import.meta.url)),origin='http://127.0.0.1:4351';
const out=process.env.SHARE_QA_OUTPUT||'';if(out)fs.mkdirSync(out,{recursive:true});
const strip=html=>html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,'');
function template(mode){
  let html;
  if(mode.startsWith('city'))html=strip(fs.readFileSync(path.join(root,'vitriny-multiverse-explore.html'),'utf8')).replace('</body>','<script>document.querySelector(".loading")?.classList.add("hide");</script><script type="module" src="/vitriny-city-mobile-hud.js"></script><script src="/pwa-install.js" defer></script></body>');
  else if(mode==='game-app')html=decorateGamesAppPage(strip(fs.readFileSync(path.join(root,'vitriny-blocks.html'),'utf8')),{path:'/games/blocos'});
  else if(mode==='plants-app')html=decorateGamesAppPage(strip(fs.readFileSync(path.join(root,'games/plants.html'),'utf8')),{path:'/games/plantas'});
  else if(mode==='game-web')html=strip(fs.readFileSync(path.join(root,'vitriny-blocks.html'),'utf8')).replace('</body>','<script type="module" src="/games/install.js"></script></body>');
  else html='<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Produto QA · VitrineCity</title><style>body{margin:0;font-family:Arial}main{padding:20px;min-height:250px}</style></head><body><main><h1>Planta de exemplo QA</h1><p>Catálogo público de teste, sem cadastro real.</p><button id="base-control">Ver detalhes</button></main><script src="/pwa-install.js" defer></script></body></html>';
  return html;
}
const browser=await chromium.launch({headless:true,...(process.env.CASUAL_QA_BROWSER?{executablePath:process.env.CASUAL_QA_BROWSER}:{})});
const results=[];
try{
  for(const [mode,width,height,routePath] of [
    ['city-mobile',360,800,'/multiverso?city=silvania&token=do-not-share'],
    ['city-desktop',1280,800,'/multiverso?city=silvania'],
    ['product',390,844,'/produto/11/rosa?email=do-not-share'],
    ['game-web',390,844,'/vitriny-blocks.html'],
    ['game-app',390,844,'/games/blocos'],
    ['plants-app',390,844,'/games/plantas?plant=do-not-share']
  ]){
    const context=await browser.newContext({viewport:{width,height},serviceWorkers:'block',reducedMotion:'reduce'});
    const page=await context.newPage(),errors=[],writes=[],external=[];
    page.on('pageerror',e=>errors.push(e.message));
    await context.addInitScript(()=>{
      window.__shareCalls=[];window.__copied=[];window.__shareMode='missing';window.__clipboardFail=false;
      Object.defineProperty(navigator,'share',{configurable:true,get(){if(window.__shareMode==='missing')return undefined;return async data=>{window.__shareCalls.push(data);if(window.__shareMode==='cancel')throw Object.assign(new Error('cancel'),{name:'AbortError'});};}});
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{if(window.__clipboardFail)throw Error('denied');window.__copied.push(text);}}});
    });
    await context.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(request.method()!=='GET'){writes.push(url.pathname);return route.fulfill({status:405,body:''});}
      if(url.origin!==origin){external.push(url.origin);return route.abort();}
      if(url.pathname===new URL(routePath,origin).pathname)return route.fulfill({status:200,contentType:'text/html',body:template(mode)});
      if(url.pathname.startsWith('/api/'))return route.fulfill({status:200,contentType:'application/json',body:'{}'});
      const file=path.resolve(root,'.'+url.pathname);if(!file.startsWith(root))return route.abort();
      try{return route.fulfill({status:200,contentType:({'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg'})[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});}catch{return route.fulfill({status:404,body:''});}
    });
    await page.goto(origin+routePath,{waitUntil:'load'});await page.waitForSelector('#vc-public-share',{state:'attached'});
    assert.equal(await page.locator('#vc-public-share').count(),1);
    assert.deepEqual(await page.evaluate(()=>[__shareCalls.length,__copied.length]),[0,0]);
    if(mode==='city-mobile'){
      assert.equal(await page.locator('#vc-public-share').isVisible(),false);
      await page.locator('#openCityMenu').click();
      assert.equal(await page.locator('#cityMobileMenu').evaluate(e=>e.open),true);
      await page.locator('#cityTools > summary').click();
    }else if(mode==='city-desktop')await page.locator('#cityTools > summary').click();
    await page.locator('#vc-public-share .vc-public-share-primary').click();
    assert.equal(await page.locator('#vc-public-share details').evaluate(e=>e.open),true);
    if(mode==='city-mobile')assert.equal(await page.locator('#cityMobileMenu').evaluate(e=>e.open),true,'share alternatives remain in the existing menu');
    await page.getByRole('button',{name:'Copiar link',exact:true}).click();
    const copied=await page.evaluate(()=>__copied.at(-1));assert.ok(copied.startsWith(origin));assert.doesNotMatch(copied,/token|email|do-not-share/);
    await page.getByRole('button',{name:'Copiar convite para cadastro',exact:true}).click();
    const invitation=await page.evaluate(()=>__copied.at(-1));assert.match(invitation,/Crie sua conta, se quiser/);assert.ok(invitation.includes(origin+'/entrar-cidade.html?returnTo='));assert.doesNotMatch(invitation,/token|email|do-not-share/);
    await page.evaluate(()=>{__clipboardFail=true;});await page.getByRole('button',{name:'Copiar link',exact:true}).click();
    assert.equal(await page.locator('#vc-public-share textarea').evaluate(e=>document.activeElement===e),true);
    assert.equal(await page.locator('#vc-public-share textarea').inputValue(),copied);
    await page.evaluate(()=>{__shareMode='cancel';});await page.locator('#vc-public-share .vc-public-share-primary').click();
    assert.equal(await page.locator('.vc-public-share-status').textContent(),'Compartilhamento cancelado.');
    const box=await page.locator('#vc-public-share').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1,'panel fits viewport');
    if(out)await page.screenshot({path:path.join(out,mode+'.png'),fullPage:!mode.startsWith('city')});
    if(mode==='city-mobile'){
      await page.keyboard.press('Escape');assert.equal(await page.locator('#cityMobileMenu').evaluate(e=>e.open),false);
      assert.equal(await page.locator('#openCityMenu').evaluate(e=>document.activeElement===e),true);
      await page.locator('#openCityMenu').click();await page.mouse.click(1,1);assert.equal(await page.locator('#cityMobileMenu').evaluate(e=>e.open),false);
      await page.locator('#openCityMenu').click();await page.locator('#toggleView').click();assert.equal(await page.locator('#cityMobileMenu').evaluate(e=>e.open),false,'ordinary city actions still close');
    }
    assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);assert.equal(external.filter(x=>x.includes('wa.me')).length,0,'WhatsApp never opens automatically');
    results.push({mode,width,overflow:false,nativeCancelled:true,copyFallback:true,errors:0,writes:0});await context.close();
  }
}finally{await browser.close();}
if(out)fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({ok:true,results},null,2));
console.log(JSON.stringify({ok:true,results},null,2));
