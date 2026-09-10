import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {buildPrayerShareText,prayerShareUrl,writePrayerClipboard,validatedWhatsAppGroupUrl} from '../public/oracao-do-dia.js';
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

test('the WhatsApp call to action stays unconfigured and only accepts group invitations',()=>{
  assert.equal(PRAYER_PAGE_CONFIG.groupInviteUrl,null);
  assert.equal(validatedWhatsAppGroupUrl('https://chat.whatsapp.com/ValidInvitation12345'),'https://chat.whatsapp.com/ValidInvitation12345');
  for(const url of [null,'','javascript:alert(1)','https://chat.whatsapp.com.evil.test/ValidInvitation12345','https://evil.test/?next=chat.whatsapp.com','http://chat.whatsapp.com/ValidInvitation12345','https://user@chat.whatsapp.com/ValidInvitation12345','https://wa.me/5511999999999'])assert.equal(validatedWhatsAppGroupUrl(url),null);
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

test('the review page exposes unavailable actions and contains no automatic advertising or collection',()=>{
  const html=readFileSync(new URL('../public/oracao-do-dia.html',import.meta.url),'utf8'),script=readFileSync(new URL('../public/oracao-do-dia.js',import.meta.url),'utf8'),css=readFileSync(new URL('../public/oracao-do-dia.css',import.meta.url),'utf8');
  assert.ok(html.includes('Arte digital gerada por IA'));assert.ok(html.includes('width="1536" height="1024"'));assert.ok(html.includes('Convite do grupo em preparação'));
  assert.ok(!/<form|openai-ads|oaiq|facebook\.com\/tr/.test(html));assert.ok(!/fetch\(|localStorage|sessionStorage/.test(script));assert.ok(css.includes('prefers-reduced-motion'));assert.ok(html.includes('aria-live="polite"'));
});
