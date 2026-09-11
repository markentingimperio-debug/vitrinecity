import assert from 'node:assert/strict';import test from 'node:test';import {readFileSync} from 'node:fs';import * as THREE from 'three';
const urbanSource=readFileSync(new URL('../public/vitriny-urban-models.js',import.meta.url),'utf8').replace("'/vendor/three/three.module.js'",JSON.stringify(import.meta.resolve('three')));
const {createUrbanPerson}=await import('data:text/javascript;base64,'+Buffer.from(urbanSource).toString('base64'));
const source=readFileSync(new URL('../public/vitriny-visitor-avatar.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export function mountVisitorAvatar','function mountVisitorAvatar').replaceAll("import('./vitriny-realistic-avatar.js')",'loadAvatarModule()');
class Element{
  constructor(tag){this.tagName=tag;this.children=[];this.style={};this.dataset={};this.attributes={};this.listeners={};this.clientWidth=360;this.clientHeight=280;this.open=false;this.value='';}
  append(...children){for(const c of children){c.parent=this;this.children.push(c);}}
  before(...children){const i=this.parent.children.indexOf(this);for(const c of children)c.parent=this.parent;this.parent.children.splice(i,0,...children);}
  addEventListener(name,fn){(this.listeners[name]??=[]).push(fn);}setAttribute(name,value){this.attributes[name]=value;}
  emit(name){for(const fn of this.listeners[name]||[])fn({});}close(){this.open=false;this.emit('close');}
}
const flush=async()=>{for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));};
function fixture({entitlement={active:false,expiresAt:null},failModel=false,webgl=true}={}){
  const saved=Object.fromEntries(['window','document','MutationObserver','fetch','localStorage','requestAnimationFrame','cancelAnimationFrame','devicePixelRatio'].map(k=>[k,globalThis[k]])),originalNow=Date.now;
  let now=Date.now(),observer,requested=0,loads=0,entered=0,frames=0;const people=[],head=new Element('head'),dialog=new Element('dialog'),skin=new Element('select'),outfit=new Element('select'),enter=new Element('button'),close=new Element('button'),options=new Element('div');
  options.append(skin,outfit);dialog.append(close,options,enter);dialog.querySelector=s=>({'[name="skin"]':skin,'[name="outfit"]':outfit,'[data-enter-avatar]':enter,'[data-close]':close,'.avatar-options':options}[s]);
  globalThis.document={head,createElement:tag=>new Element(tag),querySelector:()=>head.children.find(x=>x.dataset.visitorPreview)||null};
  globalThis.window={addEventListener(){},removeEventListener(){}};globalThis.localStorage={getItem:()=>JSON.stringify({skin:3,outfit:2,premium:true,expiresAt:9999999999999}),setItem(){}};
  globalThis.MutationObserver=class{constructor(fn){observer=fn;}observe(){}disconnect(){}};
  globalThis.requestAnimationFrame=()=>++frames;globalThis.cancelAnimationFrame=()=>{};globalThis.devicePixelRatio=3;
  globalThis.fetch=async(url,config)=>{requested++;assert.equal(url,'/api/rewards/me');assert.equal(config.cache,'no-store');return {ok:true,json:async()=>({avatar:entitlement}),headers:{get:()=>new Date(now).toUTCString()}};};Date.now=()=>now;
  class Renderer{constructor(){if(!webgl)throw Error('no_webgl');this.domElement=new Element('canvas');}setPixelRatio(value){assert.ok(value<=1.5);}setSize(){}render(){}dispose(){}}
  const loadAvatarModule=async()=>({loadRealisticVisitor:async()=>{loads++;if(failModel)throw Error('offline');const person={group:new THREE.Group(),colors:null,paid:false,ticks:0,disposed:false,setAppearance(...colors){this.colors=colors;},setPremium(value){this.paid=value;},tick(){this.ticks++;},dispose(){this.disposed=true;this.group.removeFromParent();}};people.push(person);return person;}});
  const mount=new Function('THREE','createUrbanPerson','loadAvatarModule',source+';return mountVisitorAvatar;')({...THREE,WebGLRenderer:Renderer},createUrbanPerson,loadAvatarModule);
  const scene=new THREE.Scene(),avatar=mount({scene,dialog,onEnter:()=>entered++});
  return {avatar,scene,dialog,skin,outfit,enter,people,open(){dialog.open=true;observer();},observe:()=>observer(),advance(ms){now+=ms;},get loads(){return loads;},get entered(){return entered;},get requested(){return requested;},premium(){return dialog.children.find(c=>c.tagName==='label').children[0];},restore(){avatar.dispose();Object.assign(globalThis,saved);Date.now=originalNow;}};
}
test('avatar model and preview load only on demand, personalize together and keep the mounted API',async()=>{
  const f=fixture();try{await flush();assert.equal(f.requested,1);assert.equal(f.loads,0);assert.equal(f.avatar.group.visible,false);assert.equal(f.premium().disabled,true);f.open();await flush();assert.equal(f.loads,2);assert.equal(f.people.length,2);assert.deepEqual(f.people[0].colors,['#593a2a','#705c84']);assert.ok(f.people.every(p=>!p.paid),'Local storage cannot unlock premium');
    f.skin.value='0';f.outfit.value='3';f.skin.emit('change');assert.ok(f.people.every(p=>p.colors[0]==='#f2c5a1'&&p.colors[1]==='#485747'));
    f.enter.emit('click');assert.equal(f.entered,1);f.avatar.tick(.016,{position:{x:5,z:9},yaw:1,moving:true,visible:true});assert.deepEqual(f.avatar.group.position.toArray(),[5,.13,9]);assert.equal(f.avatar.group.rotation.y,-1);assert.equal(f.avatar.group.visible,true);assert.equal(f.people[0].ticks,1);f.open();await flush();assert.equal(f.loads,2);
  }finally{f.restore();}assert.ok(f.people.every(p=>p.disposed));
});
test('only a valid unexpired server entitlement enables premium, and expiration removes it',async()=>{
  const f=fixture({entitlement:{active:true,expiresAt:Date.now()+60000}});try{await flush();assert.equal(f.premium().disabled,false);f.open();await flush();assert.ok(f.people.every(p=>p.paid));f.advance(120000);f.avatar.tick(.016,{position:{x:0,z:0},yaw:0,visible:true});await flush();assert.equal(f.people[0].paid,false);assert.equal(f.premium().disabled,true);}finally{f.restore();}
  for(const entitlement of [{active:'true',expiresAt:Date.now()+60000},{active:true,expiresAt:'bad'},{active:true,expiresAt:1}]){const view=fixture({entitlement});try{await flush();assert.equal(view.premium().disabled,true);}finally{view.restore();}}
});
test('failed model downloads preserve navigation and do not retry on every frame or dialog reopening',async()=>{
  const f=fixture({failModel:true});try{f.open();await flush();const initial=f.loads;for(let i=0;i<6;i++)f.avatar.tick(.016,{position:{x:0,z:0},yaw:0,moving:true,visible:true});f.enter.emit('click');assert.equal(f.entered,1);assert.equal(f.avatar.group.children[0].visible,true);f.open();await flush();assert.equal(f.loads,initial);}finally{f.restore();}
});
test('devices without a second WebGL context keep one clear fallback notice and functional color controls',async()=>{
  const f=fixture({webgl:false});try{f.open();await flush();const count=f.dialog.children.filter(c=>c.className==='visitor-preview').length;f.dialog.close();f.open();await flush();assert.equal(f.dialog.children.filter(c=>c.className==='visitor-preview').length,count);assert.equal(count,1);f.enter.emit('click');assert.equal(f.entered,1);}finally{f.restore();}
});
