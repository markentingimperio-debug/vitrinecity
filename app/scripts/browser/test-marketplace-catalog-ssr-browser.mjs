// Isolated browser: real template/modules + synthetic public catalog; no provider or checkout calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {renderMarketplaceCatalog} from '../../marketplace-catalog-ssr.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const root=fileURLToPath(new URL('../../public/',import.meta.url));
const template=fs.readFileSync(path.join(root,'loja.html'),'utf8');
const products=[
  {id:11,name:'Adubo para rosa — exemplo QA',price_cents:1899,stock_quantity:5,product_type:'physical',product_url:'https://example.invalid/adubo'},
  {id:12,name:'Vaso de jardim — exemplo QA',price_cents:2000,stock_quantity:5,product_type:'physical',product_url:''},
  {id:13,name:'Guia de plantas — exemplo QA',price_cents:2399,stock_quantity:5,product_type:'digital',product_url:'/cursos/guia-qa'}
].map(product=>({...product,store_reference:'qa-store',store_name:'Loja QA',category:'Jardinagem',image_url:'/assets/store-seed/utilidades.svg'}));
const html=renderMarketplaceCatalog(template,products);
const browser=await chromium.launch({headless:true,...(process.env.CASUAL_QA_BROWSER?{executablePath:process.env.CASUAL_QA_BROWSER}:{})});
const results=[];
try{
  for(const mode of ['no-javascript','api-unavailable','api-success']){
    const context=await browser.newContext({javaScriptEnabled:mode!=='no-javascript',viewport:{width:390,height:844},serviceWorkers:'block'});
    const page=await context.newPage(),errors=[],writes=[];let failApi=mode==='api-unavailable';
    page.on('pageerror',error=>errors.push(error.message));
    await context.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(request.method()!=='GET'){writes.push({method:request.method(),path:url.pathname});return route.fulfill({status:405,body:''});}
      if(url.origin!=='http://127.0.0.1:4342')return route.abort();
      if(url.pathname==='/loja')return route.fulfill({status:200,contentType:'text/html',body:html});
      if(url.pathname==='/api/marketplace/products')return route.fulfill({status:failApi?503:200,contentType:'application/json',body:JSON.stringify(failApi?{error:'QA unavailable'}:{products})});
      if(url.pathname.startsWith('/api/'))return route.fulfill({status:url.pathname==='/api/auth/me'?401:200,contentType:'application/json',body:url.pathname==='/api/auth/me'?'{"authenticated":false}':'{}'});
      const file=path.resolve(root,'.'+url.pathname);
      if(!file.startsWith(path.resolve(root)+path.sep))return route.abort();
      try{const body=fs.readFileSync(file),contentType=({'.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg'})[path.extname(file)]||'application/octet-stream';return route.fulfill({status:200,contentType,body});}catch{return route.fulfill({status:404,body:''});}
    });
    await page.goto('http://127.0.0.1:4342/loja?carrinho=1',{waitUntil:'load'});
    if(mode==='api-unavailable')await page.waitForFunction(()=>document.querySelector('#catalogStatus')?.textContent.includes('Não foi possível'));
    if(mode==='api-success')await page.waitForFunction(()=>document.querySelector('#products [data-add="12"]'));
    assert.equal(await page.locator('#products .card').count(),3,'exactly three cards, no duplicate render');
    assert.equal(await page.locator('#products h2 a[href^="/produto/"]').count(),3);
    assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'),'https://vitrinecity.com/loja');
    if(mode!=='api-success'){
      assert.equal(await page.locator('#products [data-add]').count(),0,'SSR exposes usable links rather than inert cart controls');
      assert.equal(await page.locator('#products a').filter({hasText:'Ver produto'}).count(),3);
    }
    if(mode!=='no-javascript'){
      assert.equal(await page.locator('#cart').evaluate(element=>element.classList.contains('open')),true);
      await page.getByRole('button',{name:'✕',exact:true}).click();
      assert.equal(await page.locator('#cart').evaluate(element=>element.classList.contains('open')),false);
    }
    if(mode==='api-success'){
      failApi=true;const before=await page.locator('#products').innerHTML();
      await page.locator('#search').fill('nova busca');await page.locator('#searchButton').click();
      await page.waitForFunction(()=>document.querySelector('#catalogStatus')?.textContent.includes('Não foi possível'));
      assert.equal(await page.locator('#products').innerHTML(),before,'failed later search preserves the last valid catalog');
    }
    assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
    results.push({mode,cards:3,links:3,errors:0,writes:0});await context.close();
  }
}finally{await browser.close();}
console.log(JSON.stringify({ok:true,results},null,2));
