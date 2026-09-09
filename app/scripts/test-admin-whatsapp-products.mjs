import test from 'node:test';
import assert from 'node:assert/strict';
import {campaignPayload,campaignRequestKey,campaignImage,campaignPage,defaultProductMessage,mountProductCampaigns} from '../public/admin-whatsapp-products.js';

const origin='https://vitrinecity.com',now=Date.parse('2026-09-09T12:00:00Z'),tick=()=>new Promise(resolve=>setImmediate(resolve));
const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
const items=Array.from({length:6},(_,i)=>({slug:'produto-'+i,title:i?'Produto '+i:'<b>Travesseiro</b>',description:'Conheça as medidas e os materiais.',category:'Casa',image:'https://http2.mlstatic.com/D_NQ_NP_123-MLB1-F.webp'}));
const groups=[{jid:'100@g.us',name:'Grupo A'},{jid:'200@g.us',name:'Grupo B'}];
const dto=(changes={})=>({id:'abc-123',status:'draft',products:[{slug:items[0].slug,title:items[0].title,image:'/api/admin/whatsapp-qr/product-campaigns/abc-123/images/produto-0',caption:'Produto\n\nDescrição\n\nPublicidade · Link de afiliado',url:origin+'/ofertas/produto-0?utm_source=whatsapp'}],groups,startAt:'2026-09-09T14:00:00Z',intervalMinutes:120,total:2,counts:{pending:0,processing:0,sent:0,failed:0,cancelled:0},...changes});
const payload=changes=>({products:[{slug:'produto-0',message:'Conheça as medidas.'}],groupJids:['200@g.us','100@g.us'],startAt:'2026-09-09T14:00:00Z',intervalMinutes:120,...changes});

function fixture(t,fetcher,{saved='',denyStorage=false}={}){
  class Element{
    constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.listeners={};this.dataset={};this.attrs={};this.value='';this.textContent='';this.checked=false;this.disabled=false;this.hidden=false;}
    append(...items){this.children.push(...items);}
    replaceChildren(...items){this.children=items;}
    setAttribute(name,value){this.attrs[name]=value;}
    addEventListener(name,fn){(this.listeners[name]||=new Set()).add(fn);}
    removeEventListener(name,fn){this.listeners[name]?.delete(fn);}
    dispatch(name){for(const fn of this.listeners[name]||[])fn({preventDefault(){},target:this});}
    reportValidity(){return true;}
    focus(){this.focused=true;}
  }
  const document=new Element(),window=new Element(),root=new Element(),nodes={};document.hidden=false;document.createElement=tag=>new Element(tag);root.ownerDocument=document;document.defaultView=window;window.location={origin};
  let stored=saved;window.localStorage={getItem:()=>{if(denyStorage)throw Error('denied');return stored;},setItem:(_key,value)=>{if(denyStorage)throw Error('denied');stored=value;}};
  for(const id of ['Form','Notice','Reload','Products','ProductSearch','ProductCount','Groups','GroupSearch','GroupCount','AllGroups','StartAt','Interval','Timezone','Prepare','Preview','PreviewTitle','Summary','Counts','DestinationsTitle','Destinations','PreviewProducts','PreviewNote','Publish','Refresh'])nodes[id]=new Element();
  root.querySelector=selector=>nodes[selector.slice(3)];
  nodes.Form.querySelectorAll=()=>[nodes.ProductSearch,nodes.GroupSearch,nodes.AllGroups,nodes.StartAt,nodes.Interval,nodes.Prepare,...nodes.Products.children.flatMap(row=>row.children.flatMap(child=>child.children||[])).filter(element=>['INPUT','TEXTAREA'].includes(element.tagName)),...nodes.Groups.children.flatMap(row=>row.children).filter(element=>element.tagName==='INPUT')];
  const timers=new Map();let timerId=0,keyCount=0;
  const controller=mountProductCampaigns(root,{document,window,fetcher,now:()=>now,randomUUID:()=>`key-${++keyCount}`,setTimer:fn=>{timers.set(++timerId,fn);return timerId;},clearTimer:id=>timers.delete(id)});
  t.after(()=>controller.destroy());
  const select=index=>{const check=nodes.Products.children[index].children[0].children[0];check.checked=true;check.dispatch('change');return check;};
  return {nodes,document,window,controller,timers,select,get stored(){return stored;}};
}

test('selection requires bounded products, future local time, group destinations and messages without prices or custom links',()=>{
  const value=campaignPayload(payload(),now);assert.equal(value.startAtISO,'2026-09-09T14:00:00.000Z');assert.deepEqual(value.groupJids,['100@g.us','200@g.us']);
  for(const change of [{products:[]},{products:Array.from({length:6},(_,i)=>({slug:'p-'+i,message:'Texto'}))},{groupJids:[]},{groupJids:['one@s.whatsapp.net']},{startAt:'bad'},{startAt:'2026-09-09T11:00:00Z'},{startAt:'2026-11-01T12:00:00Z'},{intervalMinutes:29},{intervalMinutes:1441}])assert.throws(()=>campaignPayload(payload(change),now));
  for(const message of ['Apenas R$ 25,00','Confira https://example.com','www.site.test','meli.la/link','a'.repeat(1201)])assert.throws(()=>campaignPayload(payload({products:[{slug:'produto-0',message}]}),now));
  assert.doesNotMatch(defaultProductMessage({title:'X',description:'Compre por R$ 25,00.'}),/R\$/);assert.equal(defaultProductMessage(items[0]),items[0].description);
});

test('same payload reuses an idempotency key and safe media/page URLs stay within their intended scopes',()=>{
  let count=0;const key=campaignRequestKey(()=>String(++count)),value=campaignPayload(payload(),now);assert.equal(key(value),key({...value}));assert.equal(count,1);assert.notEqual(key({...value,intervalMinutes:60}),key(value));
  assert.equal(campaignImage(dto().products[0].image,origin),origin+dto().products[0].image);assert.equal(campaignPage(dto().products[0].url,origin),dto().products[0].url);
  for(const bad of ['javascript:alert(1)','//attacker.test/p.png','https://u:p@vitrinecity.com/assets/p.png','https://127.0.0.1/p.png','/api/admin/users'])assert.equal(campaignImage(bad,origin),'');
  for(const bad of ['javascript:alert(1)','https://attacker.test/ofertas/p','//vitrinecity.com/ofertas/p','/admin'])assert.equal(campaignPage(bad,origin),'');
});

test('initial load selects nothing; the fifth selection disables other products and filtering never changes recipients',async t=>{
  const calls=[],f=fixture(t,async(url,options)=>{calls.push({url,options});return response({items,groups});});await tick();assert.equal(calls.length,1);assert.equal(calls[0].options.method,undefined);
  assert.equal(f.nodes.ProductCount.textContent,'0 de 5 selecionados');assert.equal(f.nodes.AllGroups.checked,false);assert.equal(f.nodes.Publish.disabled,true);
  assert.equal(f.nodes.Products.children[0].children[0].children[1].textContent,'<b>Travesseiro</b>');
  for(let i=0;i<5;i++)f.select(i);assert.equal(f.nodes.Products.children[5].children[0].children[0].disabled,true);
  f.nodes.GroupSearch.value='Grupo A';f.nodes.GroupSearch.dispatch('input');f.nodes.AllGroups.checked=true;f.nodes.AllGroups.dispatch('change');assert.equal(f.nodes.Groups.children[1].hidden,true);assert.equal(f.nodes.Groups.children[1].children[0].checked,true);assert.match(f.nodes.GroupCount.textContent,/2 de 2/);
});

test('preparation retries the same key after uncertain network failure and never publishes by itself',async t=>{
  const calls=[];let previews=0,resolvePreview;
  const f=fixture(t,async(url,options)=>{calls.push({url,options});if(url.endsWith('/catalog'))return response({items,groups});previews++;if(previews===1)throw TypeError('network');return new Promise(resolve=>{resolvePreview=resolve;});});await tick();f.select(0);f.nodes.AllGroups.checked=true;f.nodes.AllGroups.dispatch('change');f.nodes.StartAt.value='2026-09-09T16:00';
  f.nodes.Form.dispatch('submit');await tick();assert.equal(calls.length,2);assert.match(f.nodes.Notice.textContent,/conexão falhou/);
  f.nodes.Form.dispatch('submit');f.nodes.Form.dispatch('submit');await tick();assert.equal(calls.length,3);assert.equal(JSON.parse(calls[1].options.body).idempotencyKey,JSON.parse(calls[2].options.body).idempotencyKey);assert.equal(f.nodes.Prepare.disabled,true);
  resolvePreview(response(dto()));await tick();assert.equal(f.nodes.Publish.disabled,false);assert.equal(f.stored,'abc-123');assert.equal(calls.filter(call=>call.url.endsWith('/publish')).length,0);
  const textarea=f.nodes.Products.children[0].children[3].children[0];textarea.value='Uma descrição alterada';textarea.dispatch('input');assert.equal(f.nodes.Publish.disabled,true);assert.match(f.nodes.PreviewNote.textContent,/nova prévia/);
});

test('publishing is explicit, guards a double click, renders status and stops polling when hidden or destroyed',async t=>{
  const calls=[];let resolvePublish,resolvePoll;
  const f=fixture(t,(url,options)=>{calls.push({url,options});if(url.endsWith('/catalog'))return Promise.resolve(response({items,groups}));if(url.endsWith('/preview'))return Promise.resolve(response(dto()));if(url.endsWith('/publish'))return new Promise(resolve=>{resolvePublish=resolve;});return new Promise(resolve=>{resolvePoll=resolve;});});await tick();f.select(0);f.nodes.AllGroups.checked=true;f.nodes.AllGroups.dispatch('change');f.nodes.Form.dispatch('submit');await tick();
  f.nodes.Publish.dispatch('click');f.nodes.Publish.dispatch('click');assert.equal(calls.filter(call=>call.url.endsWith('/publish')).length,1);assert.equal(f.nodes.Publish.disabled,true);
  resolvePublish(response(dto({status:'queued',counts:{pending:2,sent:0}})));await tick();assert.equal(f.nodes.Publish.disabled,true);assert.match(f.nodes.Counts.textContent,/Pendentes: 2/);assert.equal(f.timers.size,1);
  const poll=[...f.timers.values()][0];f.timers.clear();poll();await tick();const pending=calls.at(-1);f.document.hidden=true;f.document.dispatch('visibilitychange');assert.equal(pending.options.signal.aborted,true);assert.equal(f.timers.size,0);
  resolvePoll(response(dto({status:'completed',counts:{sent:2}})));await tick();assert.equal(f.nodes.PreviewTitle.textContent,'Campanha programada');f.controller.destroy();assert.equal(f.document.listeners.visibilitychange.size,0);
});

test('reload restores only the saved campaign id with read-only requests, and storage denial does not block the form',async t=>{
  const calls=[],f=fixture(t,async(url,options)=>{calls.push({url,options});return response(url.endsWith('/catalog')?{items,groups}:dto({status:'completed',counts:{sent:2}}));},{saved:'abc-123'});await tick();assert.equal(calls.length,2);assert.ok(calls.every(call=>!call.options.method));assert.equal(f.nodes.PreviewTitle.textContent,'Campanha concluída');assert.equal(f.nodes.ProductCount.textContent,'0 de 5 selecionados');assert.equal(f.timers.size,0);
  const denied=fixture(t,async()=>response({items,groups}),{denyStorage:true});await tick();assert.equal(denied.nodes.Prepare.disabled,false);
});

test('unknown confirmations are shown for review, excluded from sent totals, and cannot enable publish',async t=>{
  const calls=[],f=fixture(t,async(url,options)=>{calls.push({url,options});return response(url.endsWith('/catalog')?{items,groups}:dto({status:'needs_review',counts:{unknown:2,sent:0,failed:0}}));},{saved:'abc-123'});
  await tick();
  assert.match(f.nodes.Counts.textContent,/Aceitos pelo serviço: 0/);assert.match(f.nodes.Counts.textContent,/Conferir envio: 2/);
  assert.match(f.nodes.PreviewNote.textContent,/Confira as conversas/);assert.equal(f.nodes.Publish.disabled,true);assert.equal(f.timers.size,0);
  f.nodes.Publish.dispatch('click');await tick();assert(calls.every(call=>!call.options.method));
});
