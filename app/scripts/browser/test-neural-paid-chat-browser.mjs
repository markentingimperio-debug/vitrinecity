import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {assertChatReceipt,assertChatPayment,assertChatWallet,assertChatArtifact,assertAiPurchaseStatus,assertAiPurchaseOrder} from '../../public/neural-chat-contract.js';
import {assertCoinStatus,quoteCoinTopup,VITRINE_COINS_POLICY} from '../../public/vitrine-coins-contract.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const root=path.resolve(fileURLToPath(new URL('../../public/',import.meta.url)));
const mp4=await readFile(path.join(root,'assets/convite-grupo-vip-vitrinecity.mp4'));
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
const conversation={id:'11111111-1111-4111-8111-111111111111',title:'Geração privada'};
const requestId='33333333-3333-4333-8333-333333333333';
const quoteExpiresAt=Date.now()+600000;
let phase='awaiting_confirmation',posts=0,confirms=0,downloads=0,checkoutPosts=0,creditRefreshes=0,loseConfirm=true,order=null;
const external=[],errors=[],viewports=[];
const coinWallet=assertCoinStatus({ok:true,currency:'VITRINE_COINS',policyVersion:VITRINE_COINS_POLICY.version,unified:true,frozen:false,availableAtoms:'816000000',reservedAtoms:'0',chargedAtoms:'0',expiredAtoms:'0'});
const payment=()=>assertChatPayment({quoteId:'quote-browser',currency:'BRL',amountMicro:1150000,expiresAt:quoteExpiresAt,kind:'video',summary:'Vídeo de 5 segundos',state:phase==='completed'?'settled':phase==='awaiting_confirmation'?'quoted':'reserved',chargedMicro:phase==='completed'?1000000:null});
const artifacts=[assertChatArtifact({id:'artifact-video',requestId,kind:'video',name:'meu-video.mp4',mimeType:'video/mp4',bytes:mp4.length,availability:'ready'}),assertChatArtifact({id:'artifact-image',requestId,kind:'image',name:'minha-imagem.png',mimeType:'image/png',bytes:png.length,availability:'ready'})];
const receipt=()=>assertChatReceipt({id:requestId,requestId,conversationId:conversation.id,messageId:'message-paid',status:phase,createdAt:1,updatedAt:2,payment:payment()});
const status=()=>({ok:true,enabled:true,paidGenerationEnabled:true,capabilities:{text:true,image:true,video:true},wallet:assertChatWallet({currency:'BRL',availableMicro:5000000,reservedMicro:phase==='queued'?1150000:0})});
const creditStatus=()=>assertAiPurchaseStatus({ok:true,currency:'BRL',availableMicro:8500000,reservedMicro:0,chargedMicro:0,expiredMicro:0,frozenMicro:0,frozen:false,canPurchase:true,presetsCents:[1000,2500,5000,10000],coinWallet,terms:{version:VITRINE_COINS_POLICY.version,validityDays:60,summary:'Vitrine Coins: 15% apenas na recarga, sem acréscimo no uso.',refunds:'Direitos legais de restituição preservados.',feeStage:'topup',topupFeeBps:1500,usageMarkupBps:0,coinsPerBRL:'9.6'},orders:order?[order]:[]});
const server=createServer(async(req,res)=>{
  const send=(value,code=200)=>{res.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));};
  try{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/api/coins/status')return send(coinWallet);
    const match=url.pathname.match(/^\/api\/(?:neural|admin\/vitriny-neural|store-portal\/qa-store\/neural)\/chat(.*)$/);
    if(match){
      if(url.pathname.includes('store-portal'))assert.equal(req.headers['x-store-token'],'fixture-private-access');
      const route=match[1];let body={};
      if(req.method==='POST'){posts++;assert.equal(req.headers['x-neural-request'],'1');const chunks=[];for await(const chunk of req)chunks.push(chunk);body=JSON.parse(Buffer.concat(chunks));}
      if(route==='/status')return send(status());
      if(route==='/conversations')return send({ok:true,items:[conversation]});
      if(route==='/conversations/'+conversation.id)return send({ok:true,conversation,messages:[{id:'message-paid',role:'assistant',requestId,text:phase==='completed'?'Sua imagem e seu vídeo estão prontos.':'Confira o valor antes de gerar.',status:phase,payment:payment(),artifacts:phase==='completed'?artifacts:[]}]});
      if(route==='/requests/'+requestId+'/confirm'){
        confirms++;assert.equal(body.quoteId,'quote-browser');assert.equal(Object.keys(body).sort().join(','),'idempotencyKey,quoteId');
        if(loseConfirm){loseConfirm=false;res.writeHead(200,{'content-type':'application/json'});res.end('{');return;}
        phase='queued';return send({ok:true,...receipt()});
      }
      if(route==='/requests/'+requestId)return send({ok:true,request:receipt()});
      if(route.startsWith('/artifacts/')){
        const item=artifacts.find(artifact=>route.includes('/'+artifact.id+'/'));if(!item)return send({ok:false},404);
        if(route.endsWith('/download'))downloads++;
        const data=item.kind==='video'?mp4:png;
        res.writeHead(200,{'content-type':item.mimeType,'content-length':data.length,'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(data);return;
      }
      if(route==='/credits/status')return send(creditStatus());
      if(route==='/credits/checkout'){
        checkoutPosts++;assert.equal(body.termsAccepted,true);assert.equal(body.amountCents,1000);
        order=assertAiPurchaseOrder({reference:'ai_55555555-5555-4555-8555-555555555555',status:'pending',...quoteCoinTopup(1000),checkoutUrl:'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=fixture',createdAt:Date.now(),expiresAt:Date.now()+600000});return send({ok:true,order});
      }
      if(route.endsWith('/refresh')){creditRefreshes++;return send({ok:true,order});}
      return send({ok:false},404);
    }
    if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
    const file=path.resolve(root,'.'+url.pathname);if(!file.startsWith(root+path.sep))return send({ok:false},403);
    res.writeHead(200,{'content-type':({html:'text/html',js:'text/javascript',css:'text/css'})[file.split('.').pop()]||'application/octet-stream'});res.end(await readFile(file));
  }catch(error){errors.push(error.message);if(!res.headersSent)send({ok:false},500);else res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
let browser;
try{
  browser=await chromium.launch({headless:true,...(process.env.CASUAL_QA_BROWSER?{executablePath:process.env.CASUAL_QA_BROWSER}:{channel:'chrome'})});
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',reducedMotion:'reduce'});
  await context.route('**/*',route=>{if(!['blob:','data:'].includes(new URL(route.request().url()).protocol)&&new URL(route.request().url()).origin!==origin){external.push(route.request().url());return route.abort();}return route.continue();});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  for(const width of [320,360,390,412,768,1280]){
    await page.setViewportSize({width,height:844});await page.goto(origin+'/neural-workspace.html?personal=1');await page.locator('[data-confirm-payment]').waitFor();
    const metrics=await page.evaluate(()=>({width:innerWidth,overflow:document.documentElement.scrollWidth-innerWidth,quoteButtonHeight:document.querySelector('[data-confirm-payment]').getBoundingClientRect().height,selectors:document.querySelectorAll('select').length}));
    assert.ok(metrics.overflow<=1);assert.ok(metrics.quoteButtonHeight>=44);assert.equal(metrics.selectors,0);viewports.push(metrics);
  }
  assert.equal(posts,0,'quote render/reload never confirms or creates checkout');
  await page.setViewportSize({width:390,height:844});await page.locator('[data-confirm-payment]').click();await page.locator('#recovery').waitFor({state:'visible'});assert.equal(confirms,1);
  await page.locator('#recover-request').click();assert.equal(confirms,1);assert.equal(await page.locator('#recovery').isVisible(),true);
  phase='queued';await page.locator('#recover-request').click();await page.locator('#recovery').waitFor({state:'hidden'});assert.equal(confirms,1);
  phase='completed';await page.locator('video').waitFor({state:'visible'});await page.waitForFunction(()=>document.querySelector('video').readyState>=1);
  const consumption=page.locator('.payment-consumption'),consumptionSummary=consumption.locator('summary');
  assert.equal(await consumption.getAttribute('open'),null,'settled details are collapsed by default');
  assert.match(await consumptionSummary.innerText(),/Usou 9,6 Vitrine Coins/);
  assert.doesNotMatch(await consumption.innerText(),/Consumo exato|R\$/,'only the small Coins line is visible');
  const postsBeforeDetails=posts;
  await consumptionSummary.focus();await page.keyboard.press('Enter');
  assert.equal(await consumption.evaluate(el=>el.open),true);
  assert.match(await consumption.innerText(),/Consumo exato: 9,6 Vitrine Coins \(R\$ 1,00\)/);
  await page.keyboard.press('Enter');assert.equal(await consumption.evaluate(el=>el.open),false);
  for(const width of [320,390,768,1280]){
    await page.setViewportSize({width,height:844});
    const compactMetrics=await consumption.evaluate(el=>({height:el.querySelector('summary').getBoundingClientRect().height,overflow:document.documentElement.scrollWidth-innerWidth,fontSize:parseFloat(getComputedStyle(el.querySelector('summary')).fontSize)}));
    assert.ok(compactMetrics.height>=44&&compactMetrics.height<=64,'discreet line retains a usable touch target');
    assert.ok(compactMetrics.overflow<=1);assert.ok(compactMetrics.fontSize>=12&&compactMetrics.fontSize<=13);
  }
  await page.setViewportSize({width:390,height:844});assert.equal(posts,postsBeforeDetails,'opening details never sends or charges');
  if(process.env.NEURAL_QA_OUTPUT){await mkdir(process.env.NEURAL_QA_OUTPUT,{recursive:true});await page.screenshot({path:path.join(process.env.NEURAL_QA_OUTPUT,'lia-consumption-compact-mobile.png')});}
  const video=await page.locator('video').elementHandle();await video.evaluate(element=>{element.muted=true;return element.play();});
  await page.waitForFunction(()=>document.querySelector('video').currentTime>0.1);
  await page.locator('#history-toggle').click();await page.locator('#refresh').click();await page.waitForFunction(()=>!document.getElementById('refresh').disabled);await page.locator('#history-toggle').click();
  assert.equal(await video.evaluate(element=>element===document.querySelector('video')),true,'same playable node retained');
  assert.equal(await video.evaluate(element=>element.paused),false,'playback continues across history refresh');
  const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'Baixar vídeo',exact:true}).click();assert.equal((await downloadEvent).suggestedFilename(),'meu-video.mp4');assert.equal(downloads,1);assert.equal(confirms,1);
  await page.locator('#history-toggle').click();await page.locator('#credits-toggle').click();await page.getByRole('button',{name:'Recarregar R$ 10,00',exact:true}).waitFor();
  assert.match(await page.locator('#billing-status').innerText(),/81,6 Vitrine Coins/);assert.match(await page.locator('#credits-options').innerText(),/taxa de 15%: R\$\s*1,50.*81,6 Vitrine Coins/s);
  assert.equal(await page.getByRole('button',{name:'Recarregar R$ 10,00',exact:true}).isDisabled(),true);assert.equal(checkoutPosts,0);
  await page.locator('#credits-terms').check();await page.getByRole('button',{name:'Recarregar R$ 10,00',exact:true}).click();await page.getByRole('link',{name:'Pagar no Mercado Pago'}).waitFor();
  assert.equal(checkoutPosts,1);assert.equal(await page.getByRole('link',{name:'Pagar no Mercado Pago'}).getAttribute('target'),'_blank');
  await page.getByRole('button',{name:'Conferir pagamento',exact:true}).click();await page.waitForFunction(()=>!document.getElementById('credits-refresh').disabled);assert.equal(creditRefreshes,1);assert.equal(checkoutPosts,1);
  if(process.env.NEURAL_QA_OUTPUT){await mkdir(process.env.NEURAL_QA_OUTPUT,{recursive:true});await page.screenshot({path:path.join(process.env.NEURAL_QA_OUTPUT,'paid-chat-credits-mobile.png')});}
  const postsBeforeStore=posts;
  await page.goto(origin+'/neural-workspace.html?store=qa-store');await page.locator('#access-token').fill('fixture-private-access');await page.locator('#connect').click();await page.locator('video').waitFor({state:'visible'});
  assert.equal(posts,postsBeforeStore,'store playback uses authenticated GET only');
  assert.ok((await page.locator('video').getAttribute('src')).startsWith('blob:'));
  assert.equal((await page.content()).includes('fixture-private-access'),false);
  await page.locator('#disconnect').click();assert.equal(await page.locator('video').count(),0);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log(JSON.stringify({ok:true,viewports,explicitQuote:true,uncertainConfirmationGetOnly:true,privateImageAndVideo:true,playbackSurvivesRefresh:true,authenticatedDownload:true,storeTokenNeverInUrl:true,checkoutExplicitConsent:true,checkoutPosts,confirms,externalRequests:0,paidCalls:0}));
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
