// Real pages, synthetic account/API receipts, no production data or provider calls.
import assert from 'node:assert/strict';
import express from 'express';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {setupGamesAppRoutes} from '../../games-app-routes.js';
import {newFarm} from '../../public/vitriny-farm-core.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const publicDir=fileURLToPath(new URL('../../public/',import.meta.url)),app=express(),calls=[],external=[],errors=[];
const protocol='LGPD-20260911-ABCDEF01';let origin,authenticated=false,loginMode='success',registerMode='success',privacyMode='created',privacyReadExpired=false,catalogMode='success',liaMode='success',farmExpired=false,checks=0;
const fixtureProducts=[{id:7,name:'Substrato QA',product_type:'retail',available:1,stock_quantity:2,price_cents:1000},{id:8,name:'Livro digital QA',product_type:'digital',available:1,stock_quantity:20,price_cents:1000},{id:9,name:'Produto sem estoque QA',product_type:'retail',available:1,stock_quantity:0,price_cents:1000}];
app.use(express.json());app.use((req,res,next)=>{if(req.path.startsWith('/api/')){calls.push({method:req.method,path:req.path,body:req.body,query:req.query});res.set('Cache-Control','private,no-store');if(req.method==='POST'&&req.get('origin')!==origin)return res.sendStatus(403);}next();});
setupGamesAppRoutes(app,{publicDir,currentUser:()=>authenticated?{id:999999,account_status:'active',name:'QA local'}:null});
app.post('/api/auth/login',(req,res)=>{if(loginMode==='invalid')return res.status(401).json({error:'E-mail ou senha inválidos.'});if(loginMode==='malformed')return res.json({});authenticated=true;res.json({ok:true});});
app.post('/api/auth/register',(req,res)=>{if(registerMode==='exists')return res.status(409).json({error:'Este e-mail já possui uma conta.'});authenticated=true;res.status(201).json({ok:true});});
app.get('/api/auth/me',(_req,res)=>authenticated?res.json({authenticated:true,user:{name:'QA local',email:'qa@example.invalid'}}):res.status(401).json({authenticated:false}));
app.post('/api/auth/logout',(_req,res)=>{authenticated=false;res.json({ok:true});});
app.get('/api/privacy/requests',(_req,res)=>!authenticated||privacyReadExpired?res.status(401).json({error:'Entre na conta.'}):res.json({items:[{protocol,status:'received',responseNote:'<img src=x onerror=alert(1)> anotação literal'}]}));
app.post('/api/privacy/requests',(_req,res)=>{if(privacyMode==='expired'){authenticated=false;return res.status(401).json({error:'Entre na conta.'});}if(privacyMode==='duplicate')return res.status(409).json({error:'Já existe uma solicitação recente deste tipo.',protocol});if(privacyMode==='malformed')return res.json({ok:true});return res.status(201).json({ok:true,protocol,status:'received'});});
app.post('/api/contact',(_req,res)=>res.status(201).json({ok:true,protocol:'VC-000123'}));
app.post('/api/auth/password-reset/request',(_req,res)=>res.json({ok:true,message:'Se o e-mail estiver cadastrado, enviaremos as instruções.'}));
app.get('/api/games/farm',(_req,res)=>farmExpired?res.status(401).json({error:'Entre na conta.'}):res.json({state:newFarm(),preview:true,serverNow:Date.now()}));
app.get('/api/marketplace/products',(_req,res)=>catalogMode==='failure'?res.status(503).json({error:'Indisponível'}):res.json({products:fixtureProducts}));
app.get('/api/site-assistant/context',(req,res)=>res.json({enabled:true,context:{kind:'portal',path:req.query.path,title:'Plantas'},history:[{role:'user',content:'<img src=x onerror=alert(1)> histórico literal'},{role:'assistant',content:'Vamos observar sua planta.'}]}));
app.post('/api/site-assistant/chat',(req,res)=>{
  if(liaMode==='failure')return res.status(503).json({error:'O atendimento está indisponível agora.'});
  res.json({reply:'<img src=x onerror=alert(1)> Resposta literal. https://evil.example/'+ 'x'.repeat(450),mode:'fallback',offers:[
    {assetType:'product',assetId:'7',url:'/produto/7/substrato-qa',title:'Nome inventado'},
    {assetType:'product',assetId:'8',url:'/produto/8/livro-digital'},
    {assetType:'product',assetId:'9',url:'/produto/9/sem-estoque'},
    {assetType:'product',assetId:'777',url:'/produto/7/id-incompativel'},
    {assetType:'product',assetId:'7',url:'https://evil.example/produto/7/substrato'},
    {assetType:'course',assetId:'curso',url:'/course-checkout.html?curso=curso'}
  ],actions:[{label:'Comprar curso',url:'/course-checkout.html?curso=curso'}],discountOffer:{code:'LIA5'}});
});
app.get('/favicon.ico',(_req,res)=>res.sendStatus(204));app.use(express.static(publicDir));
const server=await new Promise(resolve=>{const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));});origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,...(process.env.CASUAL_QA_BROWSER?{executablePath:process.env.CASUAL_QA_BROWSER}:{})});
const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',reducedMotion:'reduce'});
await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){external.push(route.request().url());return route.abort();}return route.continue();});
await context.addInitScript(()=>{const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return String(type).includes('webgl')?null:get.call(this,type,...args);};});
const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
const statusOf=kind=>page.locator(`[data-games-form="${kind}"] [role="status"]`);
async function visibleText(locator,pattern){await locator.filter({hasText:pattern}).waitFor({state:'visible'});}
async function noOverflow(){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
async function accountForm(kind){const form=page.locator(`[data-games-form="${kind}"]`);if(kind==='register')await page.getByText('Criar conta gratuita',{exact:true}).click();await form.locator('[name=email]').fill('qa@example.invalid');await form.locator('[name=password]').fill('Fixture-only-123!');if(kind==='register'){await form.locator('[name=name]').fill('QA local');await form.locator('[name=adult]').check();await form.locator('[name=terms]').check();}return form;}
try{
  await page.goto(origin+'/games/cuidados');await page.locator('#cultiva-lia-open').waitFor();assert.equal(calls.length,0,'no API before deliberate Lia opt-in');assert.equal(await page.locator('#cultiva-lia-form').isVisible(),false);await noOverflow();checks++;
  await page.locator('#cultiva-lia-open').click();await page.locator('#cultiva-lia-form').waitFor({state:'visible'});assert.deepEqual(calls.map(c=>c.path),['/api/site-assistant/context']);assert.equal(calls[0].query.path,'/plantas-e-jardinagem');assert.equal(await page.locator('#cultiva-lia-log img').count(),0);checks++;
  await page.locator('#cultiva-lia-input').fill('Qual substrato devo observar?');await page.locator('#cultiva-lia-form button').click();await visibleText(page.locator('#cultiva-lia-status'),/Confira as condições/);
  const chat=calls.find(c=>c.path==='/api/site-assistant/chat');assert.deepEqual(chat.body,{message:'Qual substrato devo observar?',contextPath:'/plantas-e-jardinagem'});
  assert.equal(await page.locator('#cultiva-lia-products a').count(),1);assert.equal(await page.locator('#cultiva-lia-products a').innerText(),'Substrato QA — ver na loja');assert.equal(await page.locator('#cultiva-lia-products a').getAttribute('target'),'_blank');assert.equal(await page.locator('#cultiva-lia-products a').getAttribute('rel'),'noopener noreferrer');assert.equal(await page.locator('#cultiva-lia-products a').getAttribute('href'),origin+'/produto/7/substrato-qa');
  assert.equal(await page.locator('#cultiva-lia-log img,#cultiva-lia-log script,#cultiva-lia-log a[href^="https:"]').count(),0);assert.equal(await page.locator('a[href*="course-checkout"]').count(),0);assert.equal(await page.locator('#cultiva-lia-log a').getAttribute('href'),'/games/ajuda?assunto=lia');await noOverflow();checks++;
  const safe=await page.evaluate(async({origin,products})=>{const {physicalProductLink:link}=await import('/games/care.js?v=1');const offer={assetType:'product',assetId:'7',url:'/produto/7/substrato'};return [link(offer,origin,products),...['javascript:alert(1)',origin+'/produto/7/substrato?token=x',origin+'/produto/7#x',origin.replace('://','://name:password@')+'/produto/7/substrato','//evil.example/produto/7'].map(url=>link({...offer,url},origin,products)),link(offer,origin,[]),link({...offer,assetId:'8'},origin,products)];},{origin,products:fixtureProducts});assert.equal(safe[0],origin+'/produto/7/substrato');assert.ok(safe.slice(1).every(value=>value===''));checks++;
  catalogMode='failure';await page.locator('#cultiva-lia-input').fill('Pode continuar me orientando?');await page.locator('#cultiva-lia-form button').click();await visibleText(page.locator('#cultiva-lia-status'),/Confira as condições/);assert.equal(await page.locator('#cultiva-lia-products a').count(),0);assert.match(await page.locator('#cultiva-lia-log').innerText(),/Resposta literal/);checks++;
  liaMode='failure';await page.locator('#cultiva-lia-input').fill('Quero entender a luz do vaso.');await page.locator('#cultiva-lia-form button').click();await visibleText(page.locator('#cultiva-lia-status'),/indisponível/);assert.equal(await page.locator('#cultiva-lia-input').inputValue(),'Quero entender a luz do vaso.');checks++;
  await page.goto(origin+'/games/entrar?returnTo=https%3A%2F%2Fevil.example');let form=await accountForm('login');loginMode='invalid';await form.locator('button').click();await visibleText(statusOf('login'),/E-mail ou senha inválidos/);assert.doesNotMatch(await statusOf('login').innerText(),/sessão terminou/);assert.equal(await form.locator('[name=email]').inputValue(),'qa@example.invalid');checks++;
  loginMode='malformed';await form.locator('button').click();await visibleText(statusOf('login'),/Não foi possível confirmar o acesso/);assert.ok(page.url().includes('/games/entrar'));checks++;
  loginMode='success';await form.locator('button').click();await page.waitForURL(origin+'/games/fazenda');await visibleText(page.locator('#saveStatus'),/Prévia local/);assert.equal(await page.locator('#backCity').getAttribute('href'),'/games/');checks++;
  authenticated=false;await page.goto(origin+'/games/entrar?returnTo=%2Fgames%2Fdados');form=await accountForm('register');registerMode='exists';await form.locator('button').click();await visibleText(statusOf('register'),/já possui uma conta/);assert.equal(await form.locator('[name=email]').inputValue(),'qa@example.invalid');assert.ok(page.url().includes('/games/entrar'));checks++;
  registerMode='success';await form.locator('button').click();await page.waitForURL(origin+'/games/dados');await page.locator('#games-private-data').waitFor({state:'visible'});await visibleText(page.locator('#games-requests'),/LGPD-/);assert.equal(await page.locator('#games-requests img').count(),0);
  const registration=calls.filter(c=>c.path==='/api/auth/register').at(-1).body;assert.equal(registration.accountContext,'games');assert.deepEqual(registration.communications,{email:false,whatsapp:false});assert.equal(registration.adultConfirmed,true);assert.equal(registration.termsAccepted,true);assert.equal('whatsapp' in registration,false);checks++;
  const deletion=page.locator('[data-games-form="deletion"]');await deletion.locator('[name=confirm]').check();await deletion.locator('button').click();await visibleText(statusOf('deletion'),/Sua conta ainda não foi excluída/);assert.match(await statusOf('deletion').innerText(),new RegExp(protocol));assert.deepEqual(calls.filter(c=>c.method==='POST'&&c.path==='/api/privacy/requests').at(-1).body,{requestType:'deletion',details:'Solicito a exclusão da minha conta VitrineCity e dos dados pessoais associados.'});checks++;
  privacyMode='duplicate';await deletion.locator('button').click();await visibleText(statusOf('deletion'),/Já existe uma solicitação/);assert.match(await statusOf('deletion').innerText(),new RegExp(protocol));checks++;
  privacyMode='malformed';await deletion.locator('button').click();await visibleText(statusOf('deletion'),/Não foi possível confirmar o protocolo/);assert.doesNotMatch(await statusOf('deletion').innerText(),/undefined|recebido para análise/);checks++;
  privacyMode='expired';await deletion.locator('button').click();await page.locator('#games-account-required').waitFor({state:'visible'});assert.equal(await page.locator('#games-private-data').isVisible(),false);assert.equal(await page.locator('#games-requests article').count(),0);checks++;
  authenticated=true;privacyReadExpired=true;await page.goto(origin+'/games/dados');await page.locator('#games-account-required').waitFor({state:'visible'});assert.equal(await page.locator('#games-private-data').isVisible(),false);privacyReadExpired=false;checks++;
  await page.goto(origin+'/games/ajuda?assunto=lia');const contact=page.locator('[data-games-form="contact"]');assert.match(await contact.locator('[name=details]').inputValue(),/reportar uma resposta da Lia/);await contact.locator('[name=name]').fill('QA local');await contact.locator('[name=email]').fill('qa@example.invalid');await contact.locator('[name=consent]').check();await contact.locator('button').click();await visibleText(statusOf('contact'),/VC-000123/);assert.equal(calls.filter(c=>c.path==='/api/contact').at(-1).body.accountContext,'games');checks++;
  farmExpired=true;await page.goto(origin+'/games/fazenda');await page.waitForURL(origin+'/games/entrar?returnTo=%2Fgames%2Ffazenda');checks++;
  await page.goto(origin+'/games/privacidade');assert.match(await page.locator('main').innerText(),/OpenAI/);assert.match(await page.locator('main').innerText(),/histórico curto/);assert.match(await page.locator('main').innerText(),/não são enviados automaticamente/);await noOverflow();checks++;
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);assert.ok(calls.every(c=>!/(payments|checkout|farm\/action)/.test(c.path)));
  console.log(JSON.stringify({ok:true,checks,mobile:390,providerCalls:0,externalRequests:0,realAccounts:0,realPayments:0,mockedApiRequests:calls.length}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
