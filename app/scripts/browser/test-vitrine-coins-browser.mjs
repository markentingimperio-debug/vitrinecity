import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {assertCoinStatus,quoteCoinTopup,VITRINE_COINS_POLICY} from '../../public/vitrine-coins-contract.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const root=path.resolve(fileURLToPath(new URL('../../public/',import.meta.url)));
const coinWallet=assertCoinStatus({ok:true,currency:'VITRINE_COINS',policyVersion:VITRINE_COINS_POLICY.version,unified:true,frozen:false,availableAtoms:'408960000',reservedAtoms:'96000000',chargedAtoms:'0',expiredAtoms:'0'});
let mode='active',invalidDiscount=false,legacyQuote=false,checkoutCalls=0,quoteCalls=0;
const errors=[],viewports=[],unexpectedRequests=[];
const server=createServer(async(req,res)=>{
  const send=(data,status=200)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));};
  try{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/api/coins/status')return mode==='disabled'?send({ok:false,error:'Carteira em preparação'},503):send({...coinWallet,...(mode==='malformed'?{availableAtoms:'not-atoms'}:{})});
    if(url.pathname==='/api/rewards/me')return send({settings:{coinsPerReal:100,dailyLimit:100},balance:{points:1000,nextExpiry:null},avatar:{active:false},orders:[]});
    if(url.pathname==='/api/rewards/quote'){
      quoteCalls++;const discount=url.searchParams.get('usePoints')==='true'?(invalidDiscount?400:300):0;
      return send({title:'Curso de teste',priceCents:1000,discountCents:discount,payCents:1000-discount,points:discount,availablePoints:1000,termsVersion:VITRINE_COINS_POLICY.version});
    }
    if(url.pathname.startsWith('/api/rewards/exploration'))return send({error:'Conquistas indisponíveis no cenário de teste'},503);
    if(url.pathname==='/api/auth/me')return send({user:{id:1,name:'Pessoa de teste',email:'teste@example.test',admin:false},wallet:{balanceUnits:12000,nextExpirationAt:null,transactions:[{description:'Recarga anterior',created_at:'2026-09-01T12:00:00',delta_units:960}]}});
    if(url.pathname==='/api/ads/campaigns')return send({campaigns:[]});
    if(url.pathname==='/api/social/status')return send({configured:false,accounts:[]});
    if(url.pathname==='/api/credits/quote'){
      quoteCalls++;const topup=quoteCoinTopup(501);
      return send({quote:{...topup,unified:!legacyQuote,termsVersion:legacyQuote?'2026-09-08-ads-60':VITRINE_COINS_POLICY.version,requestedNetUnits:4089,netCreditUnits:4089,grossCreditUnits:4809,managementCreditUnits:720,grossAtoms:'480960000',feeAtoms:'72000000',mediaCents:426,dailyBudgetCents:500,durationDays:7}});
    }
    if(url.pathname.endsWith('/checkout')){checkoutCalls++;return send({error:'Checkout must not run in this fixture'},409);}
    if(url.pathname.startsWith('/api/')){unexpectedRequests.push(req.method+' '+url.pathname);return send({error:'Unmocked API'},404);}
    if(['/analytics.js','/openai-ads.js'].includes(url.pathname)){res.writeHead(200,{'content-type':'text/javascript'});res.end('// Analytics isolated in wallet fixture.');return;}
    if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
    const file=path.resolve(root,'.'+url.pathname);if(!file.startsWith(root+path.sep))return send({error:'Forbidden'},403);
    const data=await readFile(file);res.writeHead(200,{'content-type':({html:'text/html',js:'text/javascript',css:'text/css'})[file.split('.').pop()]||'application/octet-stream'});res.end(data);
  }catch(error){errors.push(error.message);if(!res.headersSent)send({error:'fixture_error'},500);else res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
let browser;
try{
  browser=await chromium.launch({headless:true,...(process.env.CASUAL_QA_BROWSER?{executablePath:process.env.CASUAL_QA_BROWSER}:{channel:'chrome'})});
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',reducedMotion:'reduce'});
  await context.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin===origin||['blob:','data:'].includes(url.protocol))return route.continue();
    if(url.href==='https://cdn.jsdelivr.net/npm/qrcode@1.5.4/build/qrcode.min.js')return route.fulfill({status:200,contentType:'text/javascript',body:'// Optional QR renderer isolated in this fixture.'});
    unexpectedRequests.push(route.request().url());return route.abort();
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  for(const width of [320,360,390,412,768,1280]){
    await page.setViewportSize({width,height:844});
    for(const route of ['/central-creditos.html','/carteira.html']){
      await page.goto(origin+route);await page.waitForFunction(()=>document.getElementById('balance').textContent.includes('40,896'));
      const metrics=await page.evaluate(()=>({width:innerWidth,overflow:document.documentElement.scrollWidth-innerWidth}));
      assert.ok(metrics.overflow<=1,`${route} overflow at ${width}: ${metrics.overflow}`);viewports.push({route,...metrics});
      assert.match(await page.locator('#equivalent').innerText(),/R\$ 4,26/);
      assert.match(await page.locator(route.includes('central')?'#reserved':'#reservedCoins').innerText(),/9,6 Vitrine Coins/);
    }
  }
  assert.equal(checkoutCalls,0);assert.equal(quoteCalls,0,'Opening wallet never creates a quote or purchase');
  await page.setViewportSize({width:390,height:844});await page.goto(origin+'/central-creditos.html?curso=curso-teste');
  await page.locator('#purchase').waitFor({state:'visible'});await page.locator('#pay').waitFor({state:'visible'});
  assert.equal(await page.locator('#legacyBalance').isVisible(),false);
  assert.equal(await page.locator('#balance').innerText(),'40,896');
  assert.match(await page.locator('#earningRules').innerText(),/9,6 Vitrine Coins/);
  await page.locator('#usePoints').check();await page.waitForFunction(()=>document.getElementById('purchaseSummary').textContent.includes('28,8 Vitrine Coins'));
  assert.match(await page.locator('#purchaseSummary').innerText(),/R\$\s*3,00.*28,8 Vitrine Coins/s);
  assert.match(await page.locator('#purchaseSummary').innerText(),/96 Vitrine Coins/,'1000 legacy reward points are R$10 = 96 Coins, never 1000 Coins');
  assert.equal(checkoutCalls,0);
  invalidDiscount=true;await page.locator('#usePoints').uncheck();await page.waitForFunction(()=>!document.getElementById('pay').disabled);await page.locator('#usePoints').check();
  await page.waitForFunction(()=>document.getElementById('purchaseError').textContent.includes('desconto válido'));
  assert.equal(await page.locator('#pay').isDisabled(),true);assert.equal(checkoutCalls,0);invalidDiscount=false;
  await page.locator('#closePurchase').click();
  mode='disabled';await page.locator('#refresh').click();await page.waitForFunction(()=>document.getElementById('balance').textContent==='—');
  await page.locator('#legacyBalance').waitFor({state:'visible'});assert.match(await page.locator('#legacyBalance').innerText(),/1.000 pontos/);
  assert.equal(await page.locator('#centralPurchase').isVisible(),false);assert.match(await page.locator('#coinState').innerText(),/ainda não está disponível/);
  mode='malformed';await page.locator('#refresh').click();await page.waitForFunction(()=>document.getElementById('coinState').textContent.includes('validar o saldo único'));
  assert.equal(await page.locator('#centralPurchase').isVisible(),false);
  mode='active';await page.goto(origin+'/carteira.html');await page.waitForFunction(()=>document.getElementById('balance').textContent.includes('40,896'));
  await page.locator('#destinationUrl').fill('https://example.test/loja');await page.locator('#reviewPayment').click();await page.locator('#paymentSummary').waitFor({state:'visible'});
  assert.match(await page.locator('#requestedNet').innerText(),/^40,896 Vitrine Coins \(R\$ 4,26\)$/);
  assert.match(await page.locator('#grossCredits').innerText(),/^48,096 Coins$/);assert.match(await page.locator('#managementCredits').innerText(),/7,2 Coins/);
  assert.equal(await page.locator('#purchaseTerms').isChecked(),false);assert.equal(checkoutCalls,0);
  await page.locator('#buy').click();assert.equal(checkoutCalls,0,'No payment without explicit terms consent');
  legacyQuote=true;await page.locator('#dailyCredits').fill('96');await page.locator('#reviewPayment').click();await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('condições da recarga'));
  assert.equal(await page.locator('#paymentSummary').isVisible(),false);assert.equal(checkoutCalls,0);
  mode='disabled';await page.reload();await page.waitForFunction(()=>document.getElementById('balance').textContent.includes('créditos anteriores'));
  assert.match(await page.locator('#coinWalletState').innerText(),/registro anterior permanece preservado/);
  if(process.env.NEURAL_QA_OUTPUT){mode='active';await page.goto(origin+'/central-creditos.html');await page.waitForFunction(()=>document.getElementById('balance').textContent.includes('40,896'));await mkdir(process.env.NEURAL_QA_OUTPUT,{recursive:true});await page.screenshot({path:path.join(process.env.NEURAL_QA_OUTPUT,'vitrine-coins-central-mobile.png'),fullPage:true});}
  assert.deepEqual(errors,[]);assert.deepEqual(unexpectedRequests,[]);
  console.log(JSON.stringify({ok:true,viewports,exactAtomicBalances:true,legacyRewardsConverted:true,courseDiscountMaximum30Percent:true,topup15PercentOnce:true,legacyAndInvalidFailClosed:true,externalNetworkCalls:0,paidCalls:0,checkoutCalls}));
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
