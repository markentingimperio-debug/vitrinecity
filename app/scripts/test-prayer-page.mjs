import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {buildPrayerShareText,prayerShareUrl,writePrayerClipboard,validatedWhatsAppGroupUrl,installPrayerPage} from '../public/oracao-do-dia.js';
import {PRAYER_PAGE_CONFIG} from '../public/oracao-do-dia-config.js';
import {installPrayerSupport,validatedSupportCheckoutUrl,validSupportConfiguration,supportStatusMessage,supportAmountLabel} from '../public/oracao-do-dia-apoio.js';
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

function supportFixture(fetch,href='https://vitrinecity.com.br/oracao-do-dia.html'){
  const nodes=new Map(),data=new Map(),redirects=[];
  for(const id of ['supportButton','supportStatus','supportAmounts','supportBeneficiary','refreshSupport'])nodes.set(id,{disabled:['supportButton','supportAmounts'].includes(id),hidden:['supportBeneficiary','refreshSupport'].includes(id),checked:false,textContent:id==='supportStatus'?'O apoio ainda não está disponível.':'',listeners:{},addEventListener(event,callback){this.listeners[event]=callback;}});
  const inputs=[50,100,200,300,500].map(value=>({value:String(value),checked:value===500,disabled:false,listeners:{},addEventListener(event,callback){this.listeners[event]=callback;}}));
  const document={getElementById:id=>nodes.get(id),querySelectorAll:()=>inputs},storage={getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)},location={href,assign:url=>redirects.push(url)};
  return {document,storage,location,fetch,crypto:{randomUUID:()=> '7bbdfddf-c219-4455-a50b-83e2ce9e99b2'},nodes,data,redirects,inputs};
}
const json=payload=>({ok:true,json:async()=>payload});

test('disabled support makes no checkout, even when the button handler is invoked',async()=>{
  const calls=[],f=supportFixture(async(url,options)=>{calls.push({url,options});return json({enabled:false});});await installPrayerSupport(f);
  await f.nodes.get('supportButton').listeners.click();assert.equal(calls.length,1);assert.equal(f.nodes.get('supportButton').disabled,true);assert.equal(f.redirects.length,0);
});

test('support starts only after a click, retries the same request and rejects untrusted destinations',async()=>{
  const calls=[],f=supportFixture(async(url,options)=>{
    calls.push({url,options});
    if(url.endsWith('/config'))return json(availableSupport);
    return json({reference:'support-test',statusToken:'test-token',checkoutUrl:'https://evil.test/checkout/'});
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
