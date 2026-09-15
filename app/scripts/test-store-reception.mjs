import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {createStoreReception,storeReceptionPose} from '../public/vitriny-store-reception-core.js';
import {createResidentCatalog,CITY_RESIDENTS} from '../public/vitriny-city-residents-core.js';
import {layoutStoreProducts} from '../public/vitriny-store-interior-core.js';
import {siteAssistantDirectIntent} from '../public/site-assistant-policy.js';

const publicStore={order_reference:'official_agrotecnica',business_name:'Agrotécnica',product_count:2,reference:'official_agrotecnica',name:'Agrotécnica',href:'/loja/official_agrotecnica/agrotecnica'};
const source=readFileSync(new URL('../public/vitriny-store-interior.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/vitriny-store-interior.html',import.meta.url),'utf8');
const coreSource=readFileSync(new URL('../public/vitriny-store-reception-core.js',import.meta.url),'utf8');

test('showroom reuses its one existing city identity without private fields or added residents',()=>{
  const before=CITY_RESIDENTS.length;
  const reception=createStoreReception({...publicStore,phone:'PRIVATE',instructions:'PRIVATE',token:'PRIVATE'});
  const catalog=createResidentCatalog([{reference:publicStore.order_reference,name:publicStore.business_name,href:reception.storeHref,position:{x:200,z:32}}]);
  assert.deepEqual(reception.identity,catalog.residents.find(person=>person.id==='guide-official_agrotecnica'));
  assert.deepEqual(reception,createStoreReception(publicStore));
  assert.equal(CITY_RESIDENTS.length,before);
  assert.equal(reception.identity.status,'unconnected');
  assert.ok(Object.isFrozen(reception)&&Object.isFrozen(reception.identity));
  assert.doesNotMatch(JSON.stringify(reception),/PRIVATE/);
  assert.match(reception.notice,/não um funcionário.*não representa trabalho executado/);
  assert.match(reception.availability,/não confirma disponibilidade/);
});

test('invalid stores cannot create a guide or supply a destination; Lia is an explicit UI fragment',()=>{
  for(const input of [null,undefined,{},[],{reference:'../admin',name:'Bad'},{reference:'x'.repeat(101),name:'Bad'}])assert.equal(createStoreReception(input),null);
  for(const href of ['https://evil.example/','/loja/wrong/shop','/api/admin/tasks','/loja/official_agrotecnica/agrotecnica?token=secret'])assert.equal(createStoreReception({...publicStore,href}),null);
  const reception=createStoreReception({...publicStore,liaHref:'/api/admin/tasks',accepting_orders:1,stock_quantity:500});
  assert.equal(reception.storeHref,'/loja/official_agrotecnica/agrotecnica');
  assert.equal(reception.liaHref,reception.storeHref+'#falar-com-lia');
  assert.equal(siteAssistantDirectIntent(reception.storeHref,'#falar-com-lia'),true);
  assert.doesNotMatch(reception.greeting,/estoque|online|disponível|executando/);
});

test('stationary reception clears the central aisle and every product layout',()=>{
  const pose=storeReceptionPose();assert.equal(pose.moving,false);assert.equal(pose.action,'talk');
  assert.ok(Math.abs(pose.x)>.65+1.5);
  for(const columns of [3,4])for(const limit of [12,20,24]){
    const products=layoutStoreProducts(Array.from({length:limit},(_,i)=>({id:i+1,store_reference:'ref',name:'Product'})),{storeReference:'ref',columns,limit});
    for(const product of products)assert.ok(Math.abs(pose.x-product.position.x)>3.1||Math.abs(pose.z-product.position.z)>2.1);
  }
});

test('UI keeps original shop navigation and has a native labelled dialog with visible keyboard access',()=>{
  assert.match(source,/openStore\.href=store\.href/);
  assert.match(html,/<dialog[^>]+id="receptionDialog"[^>]+aria-labelledby="receptionName"[^>]+aria-describedby="receptionNotice"/);
  assert.match(html,/<button[^>]+id="openReception"[^>]+aria-haspopup="dialog"/);
  assert.match(html,/:focus-visible/);assert.match(html,/min-height:44px/);
  assert.match(html,/max-height:calc\(100dvh - 32px\);overflow:auto/);
  assert.doesNotMatch(source+coreSource,/\bfetch\s*\(|XMLHttpRequest|sendBeacon|\/api\/admin|\/api\/site-assistant|mountCityResidents/);
  assert.equal((source.match(/createUrbanCrowd\(/g)||[]).length,1);
  assert.equal((source.match(/requestAnimationFrame\(animate\)/g)||[]).length,2,'Only the existing render loop schedules itself');
});

const dataModule=text=>'data:text/javascript;base64,'+Buffer.from(text).toString('base64');
const threeURL=import.meta.resolve('three');
const urbanSource=readFileSync(new URL('../public/vitriny-urban-models.js',import.meta.url),'utf8');
const instrumentedUrban=urbanSource.replaceAll("'/vendor/three/three.module.js'",JSON.stringify(threeURL))
  .replace('export function createUrbanCrowd(', 'function actualCreateUrbanCrowd(')+`
export function createUrbanCrowd(options){
  globalThis.__receptionCrowdCalls.push(options);
  const crowd=actualCreateUrbanCrowd(options),update=crowd.update.bind(crowd),dispose=crowd.dispose.bind(crowd);
  crowd.update=()=>{globalThis.__receptionUpdates++;return update();};
  crowd.dispose=()=>{globalThis.__receptionDisposals++;return dispose();};
  return crowd;
}`;

async function fixture({reduced=false,invalid=false}={}){
  const previous=new Map(),globals=new EventTarget(),doc=new EventTarget(),media=new EventTarget(),frames=new Map(),calls=[];
  let nextFrame=0,lastScene=null,lastCamera=null,rendererDisposals=0;
  class Element extends EventTarget{
    constructor(id=''){super();this.id=id;this.hidden=['openReception','pauseReception'].includes(id);this.open=false;this.style={};this.attrs={};this.classList={add(){}};this.textContent='';this.disabled=false;}
    setAttribute(key,value){this.attrs[key]=String(value);}
    focus(){doc.activeElement=this;}
    showModal(){this.open=true;}
    close(){this.open=false;this.dispatchEvent(new Event('close'));}
    setPointerCapture(){}
    closest(){return null;}
    getContext(){return {scale(){},fillRect(){},strokeRect(){},fillText(){},measureText(value){return {width:String(value).length*10};}};}
  }
  const elements=new Map([...html.matchAll(/id="([^"]+)"/g)].map(match=>[match[1],new Element(match[1])]));
  doc.getElementById=id=>elements.get(id);doc.body={prepend(){}};doc.createElement=()=>new Element();doc.hidden=false;
  media.matches=reduced;let listeners=0;const addMedia=media.addEventListener.bind(media),removeMedia=media.removeEventListener.bind(media);
  media.addEventListener=(...args)=>{listeners++;addMedia(...args);};media.removeEventListener=(...args)=>{listeners--;removeMedia(...args);};
  class Renderer{
    constructor(){this.domElement=new Element('canvas');this.shadowMap={};this.capabilities={getMaxAnisotropy:()=>1};}
    setPixelRatio(){}setSize(){}dispose(){rendererDisposals++;}
    render(scene,camera){lastScene=scene;lastCamera=camera;scene.updateMatrixWorld(true);}
  }
  const rendererInstances=[];
  class TrackedRenderer extends Renderer{constructor(){super();rendererInstances.push(this);}}
  const fakeArchitecture=()=>({
    stone:new THREE.MeshBasicMaterial(),wood:new THREE.MeshBasicMaterial(),graphite:new THREE.MeshBasicMaterial(),warm:new THREE.MeshBasicMaterial(),
    reflections:()=>()=>{},pavingMaterial:()=>new THREE.MeshBasicMaterial(),dispose(){},tree(){},
    part(parent){const group=new THREE.Group();parent.add(group);return group;},
    textSign(parent){const group=new THREE.Group();parent.add(group);return group;}
  });
  const set=(key,value)=>{previous.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});};
  for(const [key,value] of Object.entries({document:doc,navigator:{deviceMemory:2,hardwareConcurrency:2},devicePixelRatio:1,innerWidth:390,innerHeight:844,
    location:{search:'?store=official_agrotecnica',assign:href=>calls.push(href)},sessionStorage:{getItem:()=>null},
    matchMedia:query=>query.includes('prefers-reduced-motion')?media:{matches:true},
    addEventListener:globals.addEventListener.bind(globals),requestAnimationFrame:fn=>{const id=++nextFrame;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id),
    __receptionTestRenderer:TrackedRenderer,__receptionArchitecture:fakeArchitecture,__receptionCrowdCalls:[],__receptionUpdates:0,__receptionDisposals:0,
    __receptionFetch:async()=>{if(invalid)throw new Error('not_found');return {store:publicStore,products:[]};},fetch:()=>{throw new Error('Unexpected network');}
  }))set(key,value);
  const replacements={
    '/vendor/three/three.module.js':dataModule(`export * from ${JSON.stringify(threeURL)};export const WebGLRenderer=globalThis.__receptionTestRenderer;`),
    '/vitriny-premium-architecture.js':dataModule('export const createArchitectureKit=()=>globalThis.__receptionArchitecture();'),
    '/vitriny-store-interior-core.js':dataModule('export const fetchStoreInteriorData=(...args)=>globalThis.__receptionFetch(...args);'),
    '/vitriny-urban-models.js?v=20260915-human-1':dataModule(instrumentedUrban)
  };
  const runtime=source.replace(/from '([^']+)'/g,(_,path)=>`from ${JSON.stringify(replacements[path]||new URL('../public/'+path.slice(1),import.meta.url).href)}`);
  const restore=()=>{for(const [key,descriptor] of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}};
  try{await import(dataModule(runtime+`\n// fixture ${reduced} ${invalid}`));}catch(error){restore();throw error;}
  const frame=now=>{const pending=[...frames.entries()];frames.clear();for(const [,callback]of pending)callback(now);};
  return {doc,media,elements,calls,frames,globals,renderer:rendererInstances[0],frame,
    scene:()=>lastScene,camera:()=>lastCamera,mediaListeners:()=>listeners,rendererDisposals:()=>rendererDisposals,
    cleanup(){globals.dispatchEvent(new Event('pagehide'));restore();}};
}

test('actual showroom wires one bounded avatar, explicit Lia link, keyboard focus and pause/disposal without network',async()=>{
  const f=await fixture();
  try{
    const e=id=>f.elements.get(id),calls=globalThis.__receptionCrowdCalls;
    assert.equal(calls.length,1);assert.equal(calls[0].count,1);assert.equal(calls[0].profileId,'LITE');
    assert.equal(calls[0].identities[0].id,'guide-official_agrotecnica');
    assert.equal(e('openReception').hidden,false);
    assert.equal(e('receptionLia').href,'/loja/official_agrotecnica/agrotecnica#falar-com-lia');
    assert.equal(e('openStore').href,'/loja/official_agrotecnica/agrotecnica');
    e('openReception').dispatchEvent(new Event('click'));
    assert.equal(e('receptionDialog').open,true);assert.equal(f.doc.activeElement,e('closeReception'));
    const openedUpdates=globalThis.__receptionUpdates;f.frame(1000);assert.equal(globalThis.__receptionUpdates,openedUpdates);
    const cancel=new Event('cancel',{cancelable:true});e('receptionDialog').dispatchEvent(cancel);
    assert.equal(cancel.defaultPrevented,true);assert.equal(e('receptionDialog').open,false);assert.equal(f.doc.activeElement,e('openReception'));
    f.frame(1100);assert.ok(globalThis.__receptionUpdates>openedUpdates);
    e('pauseReception').dispatchEvent(new Event('click'));const pausedUpdates=globalThis.__receptionUpdates;f.frame(1200);
    assert.equal(globalThis.__receptionUpdates,pausedUpdates);assert.equal(e('pauseReception').attrs['aria-pressed'],'true');
    e('pauseReception').dispatchEvent(new Event('click'));f.doc.hidden=true;f.frame(1300);assert.equal(globalThis.__receptionUpdates,pausedUpdates);
    f.doc.hidden=false;f.frame(1400);assert.ok(globalThis.__receptionUpdates>pausedUpdates);
    const root=f.scene().getObjectByName('store-virtual-reception'),batches=root.children.filter(item=>item.isInstancedMesh);
    assert.ok(batches.length>0&&batches.length<=4,'One crowd adds at most four geometry batches');
    const instances=batches.reduce((sum,batch)=>sum+batch.count,0);
    const triangles=batches.reduce((sum,batch)=>sum+batch.count*(batch.geometry.index?.count||batch.geometry.attributes.position.count)/3,0);
    assert.ok(instances<=100);assert.ok(triangles<=12000,`LITE reception triangles: ${triangles}`);
    assert.equal(f.calls.length,0,'Opening reception never navigates or sends a message');
    f.globals.dispatchEvent(new Event('pagehide'));
    assert.equal(globalThis.__receptionDisposals,1);assert.equal(f.scene().getObjectByName('store-virtual-reception'),undefined);
    assert.equal(f.frames.size,0);assert.equal(f.mediaListeners(),0);assert.equal(f.rendererDisposals(),1);
    f.globals.dispatchEvent(new Event('pagehide'));assert.equal(globalThis.__receptionDisposals,1);
    console.log(JSON.stringify({receptionProfile:'LITE',avatars:1,batches:batches.length,instances,triangles}));
  }finally{f.cleanup();}
});

test('reduced motion poses once, runtime preference changes freeze updates, and bfcache keeps the one resident',async()=>{
  const f=await fixture({reduced:true});
  try{
    const motion=f.elements.get('pauseReception'),before=globalThis.__receptionUpdates;f.frame(1000);f.frame(1100);
    assert.equal(globalThis.__receptionUpdates,before);assert.equal(motion.disabled,true);assert.equal(motion.attrs['aria-pressed'],'true');
    f.media.matches=false;f.media.dispatchEvent(new Event('change'));f.frame(1200);assert.ok(globalThis.__receptionUpdates>before);assert.equal(motion.disabled,false);
    f.media.matches=true;f.media.dispatchEvent(new Event('change'));const frozen=globalThis.__receptionUpdates;f.frame(1300);assert.equal(globalThis.__receptionUpdates,frozen);
    const pagehide=new Event('pagehide');Object.defineProperty(pagehide,'persisted',{value:true});f.globals.dispatchEvent(pagehide);
    assert.equal(globalThis.__receptionDisposals,0);assert.equal(globalThis.__receptionCrowdCalls.length,1);assert.equal(f.frames.size,1);
  }finally{f.cleanup();}
});

test('failed store loading never mounts or offers an unverified guide',async()=>{
  const f=await fixture({invalid:true});
  try{assert.equal(globalThis.__receptionCrowdCalls.length,0);assert.equal(f.elements.get('openReception').hidden,true);f.elements.get('openReception').dispatchEvent(new Event('click'));assert.equal(f.elements.get('receptionDialog').open,false);}
  finally{f.cleanup();}
});
