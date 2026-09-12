import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {buildPrayerShareText,prayerShareUrl,writePrayerClipboard,validatedWhatsAppGroupUrl,installPrayerPage} from '../public/oracao-do-dia.js';
import {PRAYER_PAGE_CONFIG} from '../public/oracao-do-dia-config.js';
import {installPrayerSupport,validatedSupportCheckoutUrl,validatedSupportPix,validSupportConfiguration,supportStatusMessage,supportAmountLabel} from '../public/oracao-do-dia-apoio.js';
const availableSupport={enabled:true,amountsCents:[50,100,200,300,500],defaultAmountCents:500,currency:'BRL',oneTime:true,beneficiary:'Recebedor de teste'};

test('prayer sharing preserves the prayer and removes payment or tracking parameters',()=>{
  const url=prayerShareUrl('https://vitrinecity.com.br/oracao-do-dia.html?apoio=retorno&ref=private-order&utm_source=anything#support');
  assert.equal(url,'https://vitrinecity.com.br/oracao-do-dia.html#oracao');
  const text=buildPrayerShareText({title:'A oração',edition:'10 de setembro de 2026',verse:'O Senhor é o meu pastor; nada me faltará.',paragraphs:['Senhor, acolhe este dia.','Em nome de Jesus, amém.'],url});
  assert.ok(text.includes('Senhor, acolhe este dia.\n\nEm nome de Jesus, amém.'));assert.ok(text.includes('https://www.sbb.org.br/biblia/ARA/PSA.23'));assert.ok(!text.includes('private-order'));
});

test('clipboard acknowledges only a completed copy and supports manual fallback',async()=>{
  const written=[];assert.equal(await writePrayerClipboard('oração',{writeText:async text=>written.push(text)}),true);assert.deepEqual(written,['oração']);
  assert.equal(await writePrayerClipboard('oração',null),false);assert.equal(await writePrayerClipboard('oração',{writeText:async()=>{throw new Error('denied');}}),false);
});

test('the WhatsApp call to action uses the confirmed prayer invitation and only accepts group invitations',()=>{
  assert.equal(PRAYER_PAGE_CONFIG.groupInviteUrl,'https://chat.whatsapp.com/HiSHfNtx67Y7JuKTqsyfcq');
  assert.equal(validatedWhatsAppGroupUrl('https://chat.whatsapp.com/ValidInvitation12345'),'https://chat.whatsapp.com/ValidInvitation12345');
  for(const url of [null,'','javascript:alert(1)','https://chat.whatsapp.com.evil.test/ValidInvitation12345','https://evil.test/?next=chat.whatsapp.com','http://chat.whatsapp.com/ValidInvitation12345','https://user@chat.whatsapp.com/ValidInvitation12345','https://wa.me/5511999999999'])assert.equal(validatedWhatsAppGroupUrl(url),null);
});

test('the confirmed prayer invitation becomes an accessible link without joining or sending automatically',()=>{
  const nodes=new Map();
  const document={getElementById:id=>{if(!nodes.has(id))nodes.set(id,{attributes:{'aria-disabled':'true',tabindex:'-1'},addEventListener(){},setAttribute(key,value){this.attributes[key]=value;},removeAttribute(key){delete this.attributes[key];}});return nodes.get(id);}};
  installPrayerPage({document,navigator:{},location:{href:'https://vitrinecity.com/oracao-do-dia.html'}});
  const link=nodes.get('joinPrayerGroup');
  assert.equal(link.href,PRAYER_PAGE_CONFIG.groupInviteUrl);assert.equal(link.target,'_blank');assert.equal(link.rel,'noopener noreferrer');
  assert.equal(link.attributes['aria-disabled'],'false');assert.equal(link.attributes.tabindex,undefined);
  assert.ok(nodes.get('signupStatus').textContent.includes('Você escolhe'));
});

test('support accepts only the five permitted values and official checkout destinations',()=>{
  const config=availableSupport;assert.equal(validSupportConfiguration(config),true);
  for(const bad of [{...config,enabled:false},{...config,amountsCents:[600]},{...config,amountsCents:[]},{...config,oneTime:false},{...config,beneficiary:''}])assert.equal(validSupportConfiguration(bad),false);
  assert.deepEqual(config.amountsCents.map(supportAmountLabel),['R$ 0,50','R$ 1','R$ 2','R$ 3','R$ 5']);
  assert.equal(validatedSupportCheckoutUrl('https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=test'),'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=test');
  for(const url of ['https://www.mercadopago.com.br.evil.test/checkout/v1/redirect','https://evil.test/checkout/','http://www.mercadopago.com.br/checkout/v1/redirect','https://www.mercadopago.com.br/not-a-checkout'])assert.equal(validatedSupportCheckoutUrl(url),null);
  assert.ok(supportStatusMessage('pending').includes('aguarda'));assert.ok(!supportStatusMessage('unknown').includes('foi confirmado'));
});

function supportFixture(fetch,href='https://vitrinecity.com.br/oracao-do-dia.html',{pix=false}={}){
  const nodes=new Map(),data=new Map(),redirects=[];
  for(const id of ['supportButton','supportStatus','supportAmounts','supportBeneficiary','refreshSupport'])nodes.set(id,{disabled:['supportButton','supportAmounts'].includes(id),hidden:['supportBeneficiary','refreshSupport'].includes(id),checked:false,textContent:id==='supportStatus'?'O apoio ainda não está disponível.':'',listeners:{},addEventListener(event,callback){this.listeners[event]=callback;}});
  if(pix)for(const id of ['supportPayerEmail','supportPix','supportPixQr','supportPixCode','copySupportPix','supportPixExpiry','supportPixCopyStatus','supportAlternative'])nodes.set(id,{disabled:false,hidden:id==='supportPix',value:'',textContent:'',listeners:{},addEventListener(event,callback){this.listeners[event]=callback;},removeAttribute(name){delete this[name];},focus(){this.focused=true;},select(){this.selected=true;},setSelectionRange(start,end){this.selection=[start,end];},reportValidity(){this.validityReported=true;}});
  const inputs=[50,100,200,300,500].map(value=>({value:String(value),checked:value===500,disabled:false,listeners:{},addEventListener(event,callback){this.listeners[event]=callback;}}));
  const document={getElementById:id=>nodes.get(id),querySelectorAll:()=>inputs},storage={getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)},location={href,assign:url=>redirects.push(url)};
  return {document,storage,location,fetch,crypto:{randomUUID:()=> '7bbdfddf-c219-4455-a50b-83e2ce9e99b2'},nodes,data,redirects,inputs};
}
const json=payload=>({ok:true,json:async()=>payload});

test('disabled support makes no checkout, even when the button handler is invoked',async()=>{
  const calls=[],f=supportFixture(async(url,options)=>{calls.push({url,options});return json({enabled:false});});await installPrayerSupport(f);
  await f.nodes.get('supportButton').listeners.click();assert.equal(calls.length,1);assert.equal(f.nodes.get('supportButton').disabled,true);assert.equal(f.redirects.length,0);
});

test('support starts only after a click and recovers the same request when no receipt arrives',async()=>{
  const calls=[],f=supportFixture(async(url,options)=>{
    calls.push({url,options});
    if(url.endsWith('/config'))return json(availableSupport);
    return json({checkoutUrl:'https://evil.test/checkout/'});
  });await installPrayerSupport(f);
  assert.equal(calls.length,1);await f.nodes.get('supportButton').listeners.click();await f.nodes.get('supportButton').listeners.click();
  assert.equal(calls.length,3);assert.equal(calls[1].options.body,calls[2].options.body);assert.equal(f.redirects.length,0);assert.equal(f.nodes.get('supportButton').disabled,false);
});

test('a return URL cannot claim approval without a stored token and verified server response',async()=>{
  const calls=[],f=supportFixture(async(url,options)=>{calls.push({url,options});return json({enabled:false});},'https://vitrinecity.com.br/oracao-do-dia.html?apoio=retorno&ref=fake&status=approved');await installPrayerSupport(f);
  assert.equal(calls.length,1);assert.ok(!f.nodes.get('supportStatus').textContent.includes('foi confirmado'));
  const verified=supportFixture(async url=>url.endsWith('/config')?json({enabled:false}):json({reference:'support-test',amountCents:500,currency:'BRL',status:'approved',beneficiary:'Recebedor de teste'}),'https://vitrinecity.com.br/oracao-do-dia.html?apoio=retorno&ref=support-test');
  verified.data.set('vitrinecity:prayer-support:support-test','test-token');await installPrayerSupport(verified);assert.ok(verified.nodes.get('supportStatus').textContent.includes('foi confirmado'));
});

test('uncertain payment creation keeps the same reference and token without opening checkout',async()=>{
  const f=supportFixture(async url=>url.endsWith('/config')?json(availableSupport):{ok:false,status:502,json:async()=>({reference:'support-pending',statusToken:'pending-token',status:'creating'})});
  await installPrayerSupport(f);await f.nodes.get('supportButton').listeners.click();
  assert.equal(f.data.get('vitrinecity:prayer-support:support-pending'),'pending-token');assert.ok(f.data.get('vitrinecity:prayer-support:request-key'));assert.equal(f.nodes.get('refreshSupport').hidden,false);assert.equal(f.redirects.length,0);assert.ok(!f.nodes.get('supportStatus').textContent.includes('foi confirmado'));
});

test('each selected value is sent unchanged and displayed before redirecting',async()=>{
  for(const amountCents of availableSupport.amountsCents){
    let body;
    const f=supportFixture(async(url,options)=>{if(url.endsWith('/config'))return json(availableSupport);body=JSON.parse(options.body);return json({reference:'support-test',statusToken:'test-token',amountCents,currency:'BRL',checkoutUrl:'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=test'});});
    await installPrayerSupport(f);const selected=f.inputs.find(input=>Number(input.value)===amountCents);selected.checked=true;selected.listeners.change();
    assert.ok(f.nodes.get('supportButton').textContent.includes(supportAmountLabel(amountCents)));await f.nodes.get('supportButton').listeners.click();assert.equal(body.amountCents,amountCents);assert.equal(body.accepted,true);assert.equal(f.redirects.length,1);
  }
});

test('an embedded support checkout reaches Lia only after the explicit click and never navigates its iframe',async()=>{
  const calls=[],handoffs=[],url='https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=test';
  const f=supportFixture(async(path,options)=>{calls.push({path,options});return path.endsWith('/config')?json(availableSupport):json({reference:'support-test',statusToken:'test-token',amountCents:500,currency:'BRL',checkoutUrl:url});});
  f.window={vcLiaNavigate:destination=>{handoffs.push(destination);return true;}};
  await installPrayerSupport(f);assert.equal(calls.length,1);assert.deepEqual(handoffs,[]);assert.deepEqual(f.redirects,[]);
  await f.nodes.get('supportButton').listeners.click();
  assert.equal(calls.length,2);assert.equal(calls[1].path,'/api/prayer-support/checkout');assert.deepEqual(JSON.parse(calls[1].options.body),{requestKey:'7bbdfddf-c219-4455-a50b-83e2ce9e99b2',amountCents:500,accepted:true});
  assert.deepEqual(handoffs,[url]);assert.deepEqual(f.redirects,[]);assert.equal(f.data.get('vitrinecity:prayer-support:support-test'),'test-token');
  assert.match(f.nodes.get('supportStatus').textContent,/link de pagamento na conversa/);assert.match(f.nodes.get('supportStatus').textContent,/Nenhum pagamento foi confirmado/);
  assert.equal(f.nodes.get('refreshSupport').hidden,false);assert.equal(f.nodes.get('supportButton').disabled,true);
  await f.nodes.get('supportButton').listeners.click();assert.equal(calls.length,2);
});

test('support bridge is never given an invalid destination, amount or unsuccessful receipt',async()=>{
  const handoffs=[];
  for(const patch of [{checkoutUrl:'https://evil.test/checkout/'},{amountCents:300},{currency:'USD'},{statusToken:''}]){
    const f=supportFixture(async path=>path.endsWith('/config')?json(availableSupport):json({reference:'support-test',statusToken:'test-token',amountCents:500,currency:'BRL',checkoutUrl:'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=test',...patch}));
    f.window={vcLiaNavigate:url=>{handoffs.push(url);return true;}};await installPrayerSupport(f);await f.nodes.get('supportButton').listeners.click();assert.deepEqual(f.redirects,[]);
  }
  assert.deepEqual(handoffs,[]);
});

test('embedded support stays locked while pending and unlocks only after a verified terminal status',async()=>{
  let providerStatus='pending',checkouts=0;
  const f=supportFixture(async path=>{
    if(path.endsWith('/config'))return json(availableSupport);
    if(path.includes('/orders/'))return json({reference:'support-test',amountCents:500,currency:'BRL',status:providerStatus});
    checkouts++;return json({reference:'support-test',statusToken:'test-token',amountCents:500,currency:'BRL',checkoutUrl:'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=test'});
  });
  f.window={vcLiaNavigate:()=>true};const controller=await installPrayerSupport(f);
  await f.nodes.get('supportButton').listeners.click();await controller.checkReturn();
  assert.equal(f.nodes.get('supportButton').disabled,true);await f.nodes.get('supportButton').listeners.click();assert.equal(checkouts,1);
  providerStatus='rejected';await controller.checkReturn();
  assert.equal(f.nodes.get('supportButton').disabled,false);assert.equal(f.nodes.get('supportAmounts').disabled,false);
  assert.equal(f.data.has('vitrinecity:prayer-support:request-key'),false);assert.equal(checkouts,1);assert.match(f.nodes.get('supportStatus').textContent,/não foi aprovado/);
});

test('the ordinary support page retains its normal redirect when no bridge handles the checkout',async()=>{
  const url='https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=test';
  const f=supportFixture(async path=>path.endsWith('/config')?json(availableSupport):json({reference:'support-test',statusToken:'test-token',amountCents:500,currency:'BRL',checkoutUrl:url}));
  f.window={vcLiaNavigate:()=>false};await installPrayerSupport(f);await f.nodes.get('supportButton').listeners.click();assert.deepEqual(f.redirects,[url]);
});

test('the review page exposes unavailable actions and contains no automatic advertising or collection',()=>{
  const html=readFileSync(new URL('../public/oracao-do-dia.html',import.meta.url),'utf8'),script=readFileSync(new URL('../public/oracao-do-dia.js',import.meta.url),'utf8'),css=readFileSync(new URL('../public/oracao-do-dia.css',import.meta.url),'utf8');
  assert.ok(html.includes('Arte digital gerada por IA'));assert.ok(html.includes('width="1536" height="1024"'));assert.ok(html.includes('Convite do grupo em preparação'));
  assert.ok(!/<form|openai-ads|oaiq|facebook\.com\/tr/.test(html));assert.ok(!/fetch\(|localStorage|sessionStorage/.test(script));assert.ok(css.includes('prefers-reduced-motion'));assert.ok(html.includes('aria-live="polite"'));
});

const pixConfig={...availableSupport,pixEnabled:true};
const pixNow=Date.parse('2026-09-12T12:00:00Z');
// Synthetic offline payload, never sent to a payment provider.
const fixturePix={qrCode:'00020101021226330014br.gov.bcb.pix0111fixtureonly52040000530398654045.005802BR5907FIXTURE6007GOIANIA6304ABCD',qrCodeBase64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1cAAAAASUVORK5CYII=',expiresAt:'2026-09-12T13:00:00Z'};
const pixOrder=(patch={})=>({reference:'support-pix',statusToken:'opaque-pix-token',method:'pix',amountCents:500,currency:'BRL',status:'pending',pix:fixturePix,...patch});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function pixFixture(fetch){
  const f=supportFixture(fetch,undefined,{pix:true});f.now=()=>pixNow;
  f.nodes.get('supportPayerEmail').value='offline-test@example.test';
  return f;
}
function browserLifecycle(f){
  const timers=new Map(),events=new Map(),docEvents=new Map();let timerId=0;
  f.document.visibilityState='visible';
  f.document.addEventListener=(event,callback)=>docEvents.set(event,callback);
  f.document.removeEventListener=event=>docEvents.delete(event);
  f.window={setTimeout(callback,delay){const id=++timerId;timers.set(id,{callback,delay});return id;},clearTimeout:id=>timers.delete(id),addEventListener:(event,callback)=>events.set(event,callback),removeEventListener:event=>events.delete(event)};
  return {timers,events,docEvents,async fireTimer(){const [id,item]=timers.entries().next().value;timers.delete(id);item.callback();await tick();}};
}

test('Pix validation allows a bounded PNG and rejects active images, malformed codes and expired payloads',()=>{
  assert.equal(validatedSupportPix(fixturePix,pixNow).code,fixturePix.qrCode);
  assert.ok(validatedSupportPix({...fixturePix,qrCodeBase64:'data:image/png;base64,'+fixturePix.qrCodeBase64},pixNow));
  for(const patch of [{qrCode:'javascript:alert(1)'},{qrCode:fixturePix.qrCode+'<script>'},{qrCode:fixturePix.qrCode.replace('fixtureonly','fixture\nonly')},{qrCodeBase64:'data:image/svg+xml;base64,PHN2Zy8+'},{qrCodeBase64:Buffer.from('<svg onload="x"/>').toString('base64')},{qrCodeBase64:fixturePix.qrCodeBase64.slice(0,44)},{expiresAt:'invalid'},{expiresAt:'2026-09-12T12:00:00Z'}])assert.equal(validatedSupportPix({...fixturePix,...patch},pixNow),null);
});

test('Pix needs the explicit feature flag, new DOM and a real user-supplied valid email before POST',async()=>{
  for(const config of [{enabled:false},{...availableSupport},{...pixConfig,enabled:false}]){
    const f=pixFixture(async()=>json(config));await installPrayerSupport(f);assert.equal(f.nodes.get('supportPayerEmail').disabled,true);
  }
  const calls=[],f=pixFixture(async(url,options)=>{calls.push({url,options});return json(pixConfig);});
  f.nodes.get('supportPayerEmail').value='';await installPrayerSupport(f);
  assert.equal(calls.length,1);assert.match(f.nodes.get('supportButton').textContent,/Gerar Pix/);
  for(const invalid of ['', 'sem-arroba', 'a@b', 'a b@example.test']){f.nodes.get('supportPayerEmail').value=invalid;await f.nodes.get('supportButton').listeners.click();}
  assert.equal(calls.length,1);assert.equal(f.nodes.get('supportPayerEmail').focused,true);
  const legacy=supportFixture(async()=>json(pixConfig));await installPrayerSupport(legacy);assert.match(legacy.nodes.get('supportButton').textContent,/Mercado Pago/);
});

test('Pix stays inline, locks its amount and alternative, stores only recovery credentials and ignores repeated clicks',async()=>{
  const calls=[],handoffs=[];let complete;
  const f=pixFixture(async(url,options)=>{calls.push({url,options});return url.endsWith('/config')?json(pixConfig):new Promise(resolve=>{complete=resolve;});});
  f.window={vcLiaNavigate:url=>handoffs.push(url)};await installPrayerSupport(f);
  const amount=f.inputs.find(input=>input.value==='200');amount.checked=true;amount.listeners.change();
  const first=f.nodes.get('supportButton').listeners.click();await f.nodes.get('supportButton').listeners.click();await f.nodes.get('supportAlternative').listeners.click();
  assert.equal(calls.length,2);assert.equal(f.nodes.get('supportAmounts').disabled,true);assert.equal(f.nodes.get('supportPayerEmail').disabled,true);
  complete(json(pixOrder({amountCents:200})));await first;
  assert.equal(calls[1].url,'/api/prayer-support/pix');
  assert.deepEqual(JSON.parse(calls[1].options.body),{requestKey:f.crypto.randomUUID(),amountCents:200,accepted:true,payerEmail:'offline-test@example.test'});
  assert.equal(f.nodes.get('supportPix').hidden,false);assert.equal(f.nodes.get('supportPixCode').value,fixturePix.qrCode);
  assert.match(f.nodes.get('supportPixQr').src,/^data:image\/png;base64,/);assert.equal(f.nodes.get('supportPixCode').readOnly,true);
  assert.equal(f.nodes.get('supportAlternative').disabled,true);assert.deepEqual(f.redirects,[]);assert.deepEqual(handoffs,[]);
  const stored=JSON.stringify([...f.data]);assert.ok(stored.includes('opaque-pix-token'));assert.ok(stored.includes('"pix"'));assert.ok(!stored.includes('example.test'));assert.ok(!stored.includes(fixturePix.qrCode));assert.ok(!stored.includes(fixturePix.qrCodeBase64));
  const other=f.inputs.find(input=>input.value==='100');other.checked=true;other.listeners.change();assert.match(f.nodes.get('supportButton').textContent,/R\$ 2/);
});

test('reloading Pix recovers the same order with GET only and without retaining the email',async()=>{
  const first=pixFixture(async url=>json(url.endsWith('/config')?pixConfig:pixOrder()));await installPrayerSupport(first);await first.nodes.get('supportButton').listeners.click();
  const calls=[],restored=pixFixture(async(url,options)=>{calls.push({url,options});return json(url.endsWith('/config')?pixConfig:pixOrder());});
  restored.storage=first.storage;restored.nodes.get('supportPayerEmail').value='';await installPrayerSupport(restored);
  assert.equal(calls.length,2);assert.equal(calls[1].url,'/api/prayer-support/orders/support-pix');assert.equal(calls[1].options.headers['X-Support-Token'],'opaque-pix-token');assert.equal(calls[1].options.method,undefined);
  assert.equal(restored.nodes.get('supportPayerEmail').value,'');assert.equal(restored.nodes.get('supportPix').hidden,false);assert.equal(restored.nodes.get('supportButton').disabled,true);
  await restored.nodes.get('supportAlternative').listeners.click();assert.equal(calls.length,2);
});

test('a timeout preserves method, amount and request key for an explicit retry without a second payment method',async()=>{
  const calls=[],f=pixFixture(async(url,options)=>{calls.push({url,options});if(url.endsWith('/config'))return json(pixConfig);throw Error('network timeout');});
  await installPrayerSupport(f);await f.nodes.get('supportButton').listeners.click();await f.nodes.get('supportAlternative').listeners.click();
  assert.equal(calls.length,2);assert.equal(f.nodes.get('supportAmounts').disabled,true);assert.equal(f.nodes.get('supportButton').disabled,false);
  await f.nodes.get('supportButton').listeners.click();assert.equal(calls.length,3);assert.equal(calls[1].options.body,calls[2].options.body);
  const reloadCalls=[],restored=pixFixture(async(url,options)=>{reloadCalls.push({url,options});return json(url.endsWith('/config')?pixConfig:pixOrder());});
  restored.storage=f.storage;restored.nodes.get('supportPayerEmail').value='';await installPrayerSupport(restored);
  assert.equal(reloadCalls.length,1);await restored.nodes.get('supportButton').listeners.click();assert.equal(reloadCalls.length,1);
  restored.nodes.get('supportPayerEmail').value='reentered@example.test';await restored.nodes.get('supportButton').listeners.click();
  assert.equal(JSON.parse(reloadCalls[1].options.body).requestKey,JSON.parse(calls[1].options.body).requestKey);assert.equal(reloadCalls[1].url,'/api/prayer-support/pix');
});

test('an uncertain response with a receipt stays locked and is reconciled by GET',async()=>{
  let posts=0;
  const f=pixFixture(async(url,options)=>{if(url.endsWith('/config'))return json(pixConfig);if(options.method==='POST'){posts++;return {ok:false,status:409,json:async()=>pixOrder({status:'creating',pix:null})};}return json(pixOrder({status:'approved',pix:null}));});
  const controller=await installPrayerSupport(f);await f.nodes.get('supportButton').listeners.click();
  assert.equal(f.nodes.get('supportButton').disabled,true);assert.equal(f.nodes.get('supportPix').hidden,true);
  await f.nodes.get('supportButton').listeners.click();await f.nodes.get('supportAlternative').listeners.click();assert.equal(posts,1);
  await controller.checkReturn();assert.match(f.nodes.get('supportStatus').textContent,/foi confirmado/);assert.equal(f.nodes.get('supportPix').hidden,true);assert.equal(f.nodes.get('supportAmounts').disabled,false);assert.equal(f.data.has('vitrinecity:prayer-support:request-state'),false);
});

test('the local Pix expiry never unlocks payment while the provider still reports pending',async()=>{
  let now=pixNow,providerStatus='pending',posts=0;
  const f=pixFixture(async(url,options)=>{if(url.endsWith('/config'))return json(pixConfig);if(options.method==='POST')posts++;return json(pixOrder({status:providerStatus}));});f.now=()=>now;
  const controller=await installPrayerSupport(f);await f.nodes.get('supportButton').listeners.click();now=Date.parse(fixturePix.expiresAt);
  await controller.checkReturn();assert.equal(f.nodes.get('supportPix').hidden,true);assert.match(f.nodes.get('supportStatus').textContent,/expirou/);
  assert.equal(f.nodes.get('supportAmounts').disabled,true);assert.equal(f.nodes.get('supportButton').disabled,true);assert.equal(f.nodes.get('supportAlternative').disabled,true);
  await f.nodes.get('supportButton').listeners.click();assert.equal(posts,1);
  providerStatus='cancelled';await controller.checkReturn();assert.equal(f.nodes.get('supportAmounts').disabled,false);assert.equal(f.nodes.get('supportButton').disabled,false);assert.equal(f.nodes.get('supportAlternative').disabled,false);assert.match(f.nodes.get('supportStatus').textContent,/cancelado/);
});

test('a malformed Pix or inconsistent amount is never shown and cannot enable another charge',async()=>{
  for(const patch of [{pix:{...fixturePix,qrCodeBase64:'data:image/svg+xml;base64,PHN2Zy8+'}},{amountCents:100},{currency:'USD'},{method:'checkout'}]){
    let posts=0;const f=pixFixture(async(url,options)=>{if(url.endsWith('/config'))return json(pixConfig);if(options.method==='POST')posts++;return json(pixOrder(patch));});
    await installPrayerSupport(f);await f.nodes.get('supportButton').listeners.click();
    assert.equal(f.nodes.get('supportPix').hidden,true);assert.equal(f.nodes.get('supportPixCode').value,'');assert.equal(f.nodes.get('supportAlternative').disabled,true);
    await f.nodes.get('supportButton').listeners.click();assert.equal(posts,1);assert.ok(!/Seu apoio.*foi confirmado/.test(f.nodes.get('supportStatus').textContent));
  }
});

test('copy Pix acknowledges only completed clipboard writes and falls back to selecting the readonly code',async()=>{
  const copied=[];let complete;
  const f=pixFixture(async url=>json(url.endsWith('/config')?pixConfig:pixOrder()));f.window={navigator:{clipboard:{writeText:text=>{copied.push(text);return new Promise(resolve=>{complete=resolve;});}}}};
  await installPrayerSupport(f);await f.nodes.get('supportButton').listeners.click();const copying=f.nodes.get('copySupportPix').listeners.click();
  assert.equal(f.nodes.get('supportPixCopyStatus').textContent,'');complete();await copying;assert.deepEqual(copied,[fixturePix.qrCode]);assert.match(f.nodes.get('supportPixCopyStatus').textContent,/copiado/);
  f.window.navigator.clipboard.writeText=async()=>{throw Error('denied');};await f.nodes.get('copySupportPix').listeners.click();
  assert.equal(f.nodes.get('supportPixCode').selected,true);assert.deepEqual(f.nodes.get('supportPixCode').selection,[0,fixturePix.qrCode.length]);assert.match(f.nodes.get('supportPixCopyStatus').textContent,/Selecione e copie/);
});

test('status polling uses 15 seconds, pauses while hidden and stops on terminal status or destruction',async()=>{
  let gets=0,providerStatus='pending';const f=pixFixture(async(url,options)=>{if(url.endsWith('/config'))return json(pixConfig);if(options.method!=='POST')gets++;return json(pixOrder({status:providerStatus}));});
  const lifecycle=browserLifecycle(f),controller=await installPrayerSupport(f);assert.equal(lifecycle.timers.size,0);await f.nodes.get('supportButton').listeners.click();
  assert.equal(lifecycle.timers.size,1);assert.equal([...lifecycle.timers.values()][0].delay,15000);await lifecycle.fireTimer();assert.equal(gets,1);
  f.document.visibilityState='hidden';lifecycle.docEvents.get('visibilitychange')();assert.equal(lifecycle.timers.size,0);
  f.document.visibilityState='visible';lifecycle.docEvents.get('visibilitychange')();await tick();assert.equal(gets,2);assert.equal(lifecycle.timers.size,1);
  lifecycle.events.get('pagehide')();assert.equal(lifecycle.timers.size,0);lifecycle.events.get('pageshow')();await tick();assert.equal(gets,3);
  providerStatus='approved';await lifecycle.fireTimer();assert.equal(lifecycle.timers.size,0);assert.equal(gets,4);
  controller.destroy();assert.equal(lifecycle.docEvents.size,0);assert.equal(lifecycle.events.size,0);await controller.checkReturn();assert.equal(gets,4);
});

test('a pending GET cannot overlap another check or restart polling after pagehide',async()=>{
  let resolveStatus,gets=0;
  const f=pixFixture(async(url,options)=>{if(url.endsWith('/config'))return json(pixConfig);if(options.method==='POST')return json(pixOrder());gets++;return new Promise(resolve=>{resolveStatus=resolve;});});
  const lifecycle=browserLifecycle(f),controller=await installPrayerSupport(f);await f.nodes.get('supportButton').listeners.click();
  const first=controller.checkReturn();await controller.checkReturn();assert.equal(gets,1);lifecycle.events.get('pagehide')();resolveStatus(json(pixOrder()));await first;assert.equal(lifecycle.timers.size,0);
  controller.destroy();
});

test('storage failure still displays Pix honestly while the atomic record supports partial legacy writes',async()=>{
  const broken=pixFixture(async url=>json(url.endsWith('/config')?pixConfig:pixOrder()));broken.storage={getItem(){throw Error('denied');},setItem(){throw Error('denied');},removeItem(){throw Error('denied');}};
  await installPrayerSupport(broken);await broken.nodes.get('supportButton').listeners.click();assert.equal(broken.nodes.get('supportPix').hidden,false);assert.match(broken.nodes.get('supportStatus').textContent,/Mantenha esta página aberta/);assert.equal(broken.nodes.get('supportButton').disabled,true);
  const data=new Map(),storage={getItem:key=>data.get(key),setItem(key,value){if(!key.endsWith(':request-state'))throw Error('legacy storage full');data.set(key,value);},removeItem:key=>data.delete(key)};
  const first=pixFixture(async url=>json(url.endsWith('/config')?pixConfig:pixOrder()));first.storage=storage;await installPrayerSupport(first);await first.nodes.get('supportButton').listeners.click();
  const calls=[],restored=pixFixture(async(url,options)=>{calls.push({url,options});return json(url.endsWith('/config')?pixConfig:pixOrder());});restored.storage=storage;restored.location.href+='?apoio=retorno&ref=support-pix';await installPrayerSupport(restored);
  assert.equal(calls.length,2);assert.equal(calls[1].options.headers['X-Support-Token'],'opaque-pix-token');assert.equal(restored.nodes.get('supportPix').hidden,false);
});

test('the alternative uses the unchanged Mercado Pago checkout before Pix begins and keeps Lia handoff',async()=>{
  const calls=[],handoffs=[],url='https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=offline-test';
  const f=pixFixture(async(path,options)=>{calls.push({path,options});return json(path.endsWith('/config')?pixConfig:{reference:'support-legacy',statusToken:'legacy-token',amountCents:500,currency:'BRL',checkoutUrl:url});});
  f.window={vcLiaNavigate:value=>{handoffs.push(value);return true;}};f.nodes.get('supportPayerEmail').value='';await installPrayerSupport(f);await f.nodes.get('supportAlternative').listeners.click();
  assert.equal(calls[1].path,'/api/prayer-support/checkout');assert.equal(JSON.parse(calls[1].options.body).payerEmail,undefined);assert.deepEqual(handoffs,[url]);assert.deepEqual(f.redirects,[]);assert.equal(f.nodes.get('supportButton').disabled,true);
});
