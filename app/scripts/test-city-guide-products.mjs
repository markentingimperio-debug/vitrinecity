import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {guideProductItems,fetchGuideProducts} from '../public/vitriny-city-guide-products.js';
import {filterCityGuide} from '../public/vitriny-city-guide-core.js';

const product=(id=51,extra={})=>({id,store_reference:'official_agrotecnica',store_name:'Agrotécnica',name:'Adubo Orgânico 3 kg',category:'Adubos',price_cents:2590,stock_quantity:20,...extra});
const response=data=>({ok:true,json:async()=>data});
const flush=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};

test('buyer searches find singular, plural, multiword and accented catalog terms',()=>{
  const items=guideProductItems([
    product(),product(52,{name:'Terra Vegetal 3 kg',category:'Jardinagem'}),
    product(53,{name:'Substrato para Planta e Horta',category:'Jardinagem',description:'Ideal para hortaliças'})
  ]);
  for(const query of ['adubo','adubos','ADUBOS','adubo organico','adubo orgânico'])assert.deepEqual(filterCityGuide(query,'comprar',items).map(item=>item.id),['product-51'],query);
  assert.deepEqual(filterCityGuide('terra vegetal','comprar',items).map(item=>item.id),['product-52']);
  for(const query of ['substratos','plantas','hortas'])assert.deepEqual(filterCityGuide(query,'comprar',items).map(item=>item.id),['product-53']);
  assert.deepEqual(filterCityGuide('hortalicas','comprar',items).map(item=>item.id),['product-53'],'A product matched by its catalog description must remain findable');
  assert.equal(filterCityGuide('agrotecnica','all',items).length,3);
  assert.equal(filterCityGuide('AGROTÉCNICA','all',items).length,3);
  assert.deepEqual(filterCityGuide('adubo vegetal','all',items),[],'Every query token must still match the same product');
  assert.deepEqual(filterCityGuide('adubo','diversao',items),[],'Product matches must respect the selected category');
});

test('each product keeps its verified internal route and ignores arbitrary seller URLs',()=>{
  for(const url of ['https://seller.example/buy','//seller.example/buy','javascript:alert(1)','/api/admin/delete','/produto/999/outro']){
    const input=product(71,{name:'Adubo Orgânico <Oferta> / 3 kg',product_url:url,href:url}),before=structuredClone(input);
    const [item]=guideProductItems([input]);
    assert.equal(item.id,'product-71');assert.equal(item.href,'/produto/71/adubo-organico-oferta-3-kg');
    assert.equal(item.product,true);assert.equal(item.group,'comprar');
    assert.match(item.description,/Agrotécnica/);assert.ok(item.keywords.includes('Agrotécnica'));
    assert.deepEqual(input,before,'Guide conversion must not change the source catalog');
  }
  const [anotherStore]=guideProductItems([product(72,{store_reference:'other-store',store_name:'Outra loja',name:'Terra Vegetal'})]);
  assert.equal(anotherStore.href,'/produto/72/terra-vegetal');assert.match(anotherStore.description,/Outra loja/);
});

test('malformed rows are skipped without hiding the valid products beside them',()=>{
  const invalid=[null,undefined,0,'invalid',false,[],{},product(0),product(-1),product(1.5),product('not-an-id'),product(1,{store_reference:''}),product(1,{name:'  '})];
  assert.deepEqual(guideProductItems([...invalid,product(73)]).map(item=>item.id),['product-73']);
  for(const input of [null,undefined,{},'products',3])assert.deepEqual(guideProductItems(input),[]);
});

test('duplicate IDs are removed before the 24-product limit and keep the first association',()=>{
  const first=product(1),rows=[first,product('1',{name:'Duplicate record',store_name:'Unexpected store'}),...Array.from({length:35},(_,i)=>product(i+2))],before=structuredClone(rows);
  const items=guideProductItems(rows);
  assert.equal(items.length,24);assert.equal(new Set(items.map(item=>item.id)).size,24);
  assert.equal(items[0].title,first.name);assert.deepEqual(items.map(item=>item.id),Array.from({length:24},(_,i)=>'product-'+(i+1)));
  assert.deepEqual(rows,before);
});

test('catalog requests normalize supported plurals, encode queries and forward cancellation',async()=>{
  const controller=new AbortController(),calls=[];
  const fetchImpl=async(url,options)=>{calls.push({url,options});return response({products:[product()]});};
  assert.equal((await fetchGuideProducts('  Adubos orgânicos  ',{fetchImpl,signal:controller.signal})).length,1);
  assert.equal(calls[0].url,'/api/marketplace/products?q=adubo%20org%C3%A2nicos');
  assert.equal(calls[0].options.signal,controller.signal);assert.equal(calls[0].options.headers.accept,'application/json');
  await fetchGuideProducts('substratos & vasos?',{fetchImpl});
  assert.equal(calls[1].url,'/api/marketplace/products?q=substrato%20%26%20vasos%3F');
  await fetchGuideProducts('a'.repeat(100),{fetchImpl});
  assert.equal(new URL(calls[2].url,'https://example.test').searchParams.get('q').length,80);
});

test('empty and one-character searches do not fetch the catalog',async()=>{
  let calls=0;const fetchImpl=async()=>{calls++;throw Error('Unexpected request');};
  for(const query of ['',null,undefined,'a','  a  ','  '])assert.deepEqual(await fetchGuideProducts(query,{fetchImpl}),[]);
  assert.equal(calls,0);
});

test('HTTP, transport, invalid JSON and malformed payload failures never become empty success',async()=>{
  await assert.rejects(fetchGuideProducts('adubo',{fetchImpl:async()=>({ok:false,status:503,json:async()=>({products:[]})})}),/catalog_unavailable/);
  for(const data of [null,{},[],{products:null},{products:{}}])await assert.rejects(fetchGuideProducts('adubo',{fetchImpl:async()=>response(data)}),/catalog_invalid/);
  await assert.rejects(fetchGuideProducts('adubo',{fetchImpl:async()=>{throw new TypeError('Network failure');}}),/Network failure/);
  await assert.rejects(fetchGuideProducts('adubo',{fetchImpl:async()=>({ok:true,json:async()=>{throw new SyntaxError('Broken JSON');}})}),/Broken JSON/);
  assert.deepEqual(await fetchGuideProducts('adubo',{fetchImpl:async()=>response({products:[]})}),[],'A valid empty result must remain distinguishable from failure');
});

test('request cancellation remains an error that the UI can distinguish from valid emptiness',async()=>{
  const controller=new AbortController();controller.abort();
  await assert.rejects(fetchGuideProducts('adubo',{signal:controller.signal,fetchImpl:async(url,{signal})=>{signal.throwIfAborted();return response({products:[]});}}),{name:'AbortError'});
});

// In-memory elements and timers exercise the production guide's asynchronous
// state transitions. This is not browser automation or a visual accessibility test.
class Element{
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.attributes={};this.listeners=new Map();this.value='';this.open=false;this.hidden=false;this._text='';this.classes=new Set();this.classList={add:(...values)=>values.forEach(value=>this.classes.add(value)),contains:value=>this.classes.has(value)};}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
  set textContent(value){this._text=String(value);this.children=[];}
  append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}}
  replaceChildren(...children){for(const child of this.children)child.parentElement=null;this.children=[];this._text='';this.append(...children);}
  setAttribute(name,value){this.attributes[name]=String(value);}
  getAttribute(name){return this.attributes[name]??(name==='href'?this.href:null);}
  addEventListener(name,fn){if(!this.listeners.has(name))this.listeners.set(name,[]);this.listeners.get(name).push(fn);}
  emit(name,extra={}){const event={target:this,preventDefault(){},...extra};for(const fn of this.listeners.get(name)||[])fn(event);}
  click(){this.focus();this.emit('click');}
  focus(){globalThis.document.activeElement=this;}
  contains(element){return this===element||this.children.some(child=>child.contains(element));}
  querySelectorAll(selector){return this.children.flatMap(child=>[...(selector==='button'&&child.tagName==='BUTTON'?[child]:[]),...child.querySelectorAll(selector)]);}
  querySelector(selector){return this.selectors?.get(selector)||null;}
  showModal(){this.open=true;}
  close(){this.open=false;this.emit('close');}
  get isConnected(){return Boolean(this.parentElement)||this.connected===true;}
}

let fixtureId=0;
async function guideFixture(){
  const keys=['document','fetch','location','localStorage','addEventListener','dispatchEvent','MutationObserver','CSS','setTimeout','clearTimeout'];
  const saved=Object.fromEntries(keys.map(key=>[key,globalThis[key]])),body=new Element('body'),dialog=new Element('dialog'),openButton=new Element('button');
  const query=new Element('input'),results=new Element(),count=new Element('p'),categories=new Element('nav'),categorySelect=new Element('select'),close=new Element('button'),form=new Element('form'),preference=new Element('input'),preferenceStatus=new Element('p');
  body.append(dialog,openButton);dialog.append(query,categories,categorySelect,count,results,close,form,preference,preferenceStatus);
  dialog.selectors=new Map([['[data-guide-query]',query],['[data-guide-results]',results],['[data-guide-count]',count],['[data-guide-groups]',categories],['[data-guide-category]',categorySelect],['[data-guide-close]',close],['[data-guide-search]',form],['[data-direct-city]',preference],['[data-preference-status]',preferenceStatus]]);
  const storeLink=new Element('a');storeLink.textContent='Agrotecnica';storeLink.href='/loja/official_agrotecnica/agrotecnica';storeLink.dataset.storeReference='official_agrotecnica';
  const stores=new Element('nav');stores.append(storeLink);body.append(stores);
  const ids=new Map([['cityGuide',dialog],['openCityGuide',openButton],['cityTools',new Element('details')],['storeLinks',stores]]);
  const timers=new Map(),requests=[];let now=0,timerId=0;
  globalThis.document={activeElement:body,body,documentElement:{dataset:{cityGuideReady:'true'}},getElementById:id=>ids.get(id)||null,createElement:tag=>new Element(tag),createTextNode:text=>{const node=new Element('#text');node.textContent=text;return node;},querySelectorAll:selector=>selector==='#storeLinks a'?[storeLink]:[],querySelector:selector=>selector.startsWith('#storeLinks a[')?storeLink:null};
  globalThis.location={origin:'https://vitrinecity.test'};globalThis.localStorage={getItem:()=>null,setItem(){}};globalThis.addEventListener=()=>{};globalThis.dispatchEvent=()=>{};globalThis.MutationObserver=class{observe(){}};globalThis.CSS={escape:value=>value};
  globalThis.setTimeout=(fn,delay)=>{const id=++timerId;timers.set(id,{fn,at:now+delay});return id;};globalThis.clearTimeout=id=>timers.delete(id);
  globalThis.fetch=(url,options)=>new Promise((resolve,reject)=>requests.push({url,options,resolve:data=>resolve(response(data)),reject}));
  const source=readFileSync(new URL('../public/vitriny-city-guide.js',import.meta.url),'utf8').replace(/from\s+(['"])(\.\/[^'"]+)\1/g,(match,quote,path)=>'from '+JSON.stringify(new URL('../public/'+path.slice(2),import.meta.url).href));
  try{await import('data:text/javascript;base64,'+Buffer.from(source+'\n// fixture '+(++fixtureId)).toString('base64'));}
  catch(error){Object.assign(globalThis,saved);throw error;}
  return {dialog,openButton,query,results,count,categories,categorySelect,requests,
    input(value){query.value=value;query.focus();query.emit('input');},
    async tick(ms){const until=now+ms;for(;;){const due=[...timers].filter(([,timer])=>timer.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;now=due[1].at;timers.delete(due[0]);due[1].fn();await flush();}now=until;await flush();},
    restore(){Object.assign(globalThis,saved);}
  };
}

test('guide debounces typing, cancels an older request and ignores its late success',async()=>{
  const view=await guideFixture();
  try{
    view.openButton.click();view.input('ad');await view.tick(150);view.input('adubo');await view.tick(249);assert.equal(view.requests.length,0);await view.tick(1);assert.equal(view.requests.length,1);
    view.input('terra vegetal');assert.equal(view.requests[0].options.signal.aborted,true);await view.tick(250);assert.equal(view.requests.length,2);
    // This transport deliberately ignores AbortSignal to exercise the version guard.
    view.requests[0].resolve({products:[product()]});await flush();assert.doesNotMatch(view.results.textContent,/Adubo Orgânico/);
    view.requests[1].resolve({products:[product(52,{name:'Terra Vegetal 3 kg'})]});await flush();assert.match(view.results.textContent,/Terra Vegetal 3 kg/);assert.doesNotMatch(view.count.textContent,/Buscando|indisponível/);
  }finally{view.restore();}
});

test('clearing a query or switching category invalidates an outstanding product search',async()=>{
  const view=await guideFixture();
  try{
    view.openButton.click();view.input('adubo');await view.tick(250);view.input('a');
    assert.equal(view.requests[0].options.signal.aborted,true);view.requests[0].resolve({products:[product()]});await flush();assert.doesNotMatch(view.results.textContent,/Adubo Orgânico/);
    view.input('adubo');await view.tick(250);view.categories.children.find(button=>button.dataset.group==='diversao').click();assert.equal(view.requests[1].options.signal.aborted,true);
    view.requests[1].resolve({products:[product()]});await flush();assert.doesNotMatch(view.results.textContent,/Adubo Orgânico/);assert.match(view.count.textContent,/Diversão/);
  }finally{view.restore();}
});

test('a late failure cannot overwrite the successful current search',async()=>{
  const view=await guideFixture();
  try{
    view.openButton.click();view.input('adubo');await view.tick(250);view.input('terra');await view.tick(250);
    view.requests[1].resolve({products:[product(52,{name:'Terra Vegetal 3 kg'})]});await flush();
    view.requests[0].reject(new TypeError('Old request failed'));await flush();assert.match(view.results.textContent,/Terra Vegetal/);assert.doesNotMatch(view.count.textContent,/indisponível/);
    view.input('substrato');await view.tick(250);view.requests[2].reject(new TypeError('Current request failed'));await flush();assert.match(view.count.textContent,/indisponível/);
  }finally{view.restore();}
});

test('catalog arrival preserves a focused result until the user leaves the result list',async()=>{
  const view=await guideFixture();
  try{
    view.openButton.click();view.input('agrotecnica');await view.tick(250);
    const first=view.results.children[0],focused=first.children.at(-1).children[0];focused.focus();
    view.requests[0].resolve({products:[product()]});await flush();
    assert.equal(view.results.children[0],first);assert.equal(globalThis.document.activeElement,focused);assert.doesNotMatch(view.results.textContent,/Adubo Orgânico/);
    view.query.focus();view.results.emit('focusout');await flush();assert.match(view.results.textContent,/Adubo Orgânico/);
    view.dialog.close();assert.equal(globalThis.document.activeElement,view.openButton,'Closing the guide restores its invoking control');
  }finally{view.restore();}
});

test('mobile category selection stays synchronized with desktop filters and resets on reopening',async()=>{
  const view=await guideFixture();
  try{
    view.openButton.click();assert.equal(view.categorySelect.value,'comprar');assert.equal(view.categorySelect.children.length,view.categories.children.length);
    view.input('adubo');await view.tick(250);
    view.categorySelect.value='aprender';view.categorySelect.emit('change');
    assert.equal(view.requests[0].options.signal.aborted,true);assert.match(view.count.textContent,/Aprender/);
    assert.equal(view.categories.children.find(button=>button.dataset.group==='aprender').attributes['aria-pressed'],'true');
    view.categories.children.find(button=>button.dataset.group==='all').click();assert.equal(view.categorySelect.value,'all');
    view.dialog.close();view.openButton.click();assert.equal(view.categorySelect.value,'comprar');assert.equal(view.query.value,'');assert.equal(globalThis.document.activeElement,view.query);
  }finally{view.restore();}
});

test('a stalled catalog request times out and presents an unavailable state',async()=>{
  const view=await guideFixture();
  try{
    view.openButton.click();view.input('adubo');await view.tick(250);
    const request=view.requests[0];request.options.signal.addEventListener('abort',()=>request.reject(new DOMException('Request timed out','AbortError')));
    await view.tick(6999);assert.equal(request.options.signal.aborted,false);assert.match(view.count.textContent,/Buscando produtos/);
    await view.tick(1);assert.equal(request.options.signal.aborted,true);assert.match(view.count.textContent,/indisponível/);assert.doesNotMatch(view.count.textContent,/Buscando produtos/);
  }finally{view.restore();}
});

test('closing the guide cancels both the debounce and an in-flight search',async()=>{
  const view=await guideFixture();
  try{
    view.openButton.click();view.input('adubo');view.dialog.close();await view.tick(300);assert.equal(view.requests.length,0);
    view.openButton.click();view.input('adubo');await view.tick(250);view.dialog.close();assert.equal(view.requests[0].options.signal.aborted,true);
    view.requests[0].resolve({products:[product()]});await flush();assert.equal(view.dialog.open,false);
    view.openButton.click();assert.equal(view.query.value,'');assert.doesNotMatch(view.results.textContent,/Adubo Orgânico/);
  }finally{view.restore();}
});

test('expanding an empty category search preserves keyboard focus on the search field',async()=>{
  const view=await guideFixture();
  try{
    view.openButton.click();view.categories.children.find(button=>button.dataset.group==='diversao').click();view.input('adubo');
    const reset=view.results.querySelectorAll('button').find(button=>button.textContent==='Buscar em toda a cidade');assert.ok(reset);reset.click();
    assert.equal(globalThis.document.activeElement,view.query);assert.equal(view.categorySelect.value,'all');assert.equal(view.query.value,'adubo');
    await view.tick(250);assert.equal(view.requests.length,1);
  }finally{view.restore();}
});
