import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

class Element{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.attributes={};this.style={};this.hidden=false;this.value=0;this._text='';}
  set textContent(value){this._text=String(value);this.children=[];}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
  append(...children){for(const child of children){child.parent=this;this.children.push(child);}}
  setAttribute(name,value){this.attributes[name]=String(value);}
}
function documentFixture(){const head=new Element('head');return {head,createElement:tag=>new Element(tag),querySelector:selector=>selector==='link[data-exploration-style]'?head.children.find(child=>child.dataset.explorationStyle)||null:null,getElementById:()=>null};}
const saved={document:globalThis.document,fetch:globalThis.fetch,location:globalThis.location,addEventListener:globalThis.addEventListener};
globalThis.document=documentFixture();
const source=readFileSync(new URL('../public/vitriny-exploration-rewards.js',import.meta.url),'utf8');
const {mountExplorationProgress}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
globalThis.document=saved.document;

const known={level:2,name:'Explorador',balance:7,visitedToday:['first-store','second-store'],progress:25,streak:3,xp:125,nextLevelXp:200};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
function mount(fetchImpl,options){
  const listeners=new Map(),requests=[];
  globalThis.document=documentFixture();globalThis.location={pathname:'/produto/12/exemplo',search:'?via=cidade'};
  globalThis.addEventListener=(name,listener)=>{if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(listener);};
  globalThis.fetch=(...args)=>{requests.push(args);return fetchImpl(...args);};
  const container=new Element('div'),box=mountExplorationProgress(container,options);
  const [heading,copy,progress,detail,link]=box.children;
  return {box,heading,copy,progress,detail,link,requests,emit:detail=>{for(const listener of listeners.get('vitrinecity:reward-earned')||[])listener({detail});},restore:()=>Object.assign(globalThis,saved)};
}
function assertUnavailable(view){
  assert.equal(view.heading.textContent,'Suas conquistas na cidade');assert.equal(view.progress.hidden,true);
  assert.equal(view.progress.style.display,'none','The stylesheet display:block must not reveal unavailable progress');
  assert.equal(view.copy.textContent,'Não foi possível carregar suas conquistas agora. Tente novamente em instantes.');
  assert.doesNotMatch(view.box.textContent,/undefined|NaN|TypeError|Cannot read|Failed to fetch/i);
}
function snapshot(view){return {text:view.box.textContent,value:view.progress.value,hidden:view.progress.hidden,href:view.link.href};}

test('a validated summary renders the phase, coins and progress together',async()=>{
  const view=mount(async()=>response(known));
  try{
    assert.equal(view.progress.hidden,true);assert.equal(view.heading.textContent,'Suas conquistas na cidade');
    await flush();assert.equal(view.heading.textContent,'Fase 2 · Explorador');assert.equal(view.copy.textContent,'7 moedas · 2 lojas descobertas hoje');
    assert.equal(view.detail.textContent,'3 dias seguidos · 75 XP para a próxima fase');assert.equal(view.progress.hidden,false);assert.equal(view.progress.style.display,'');assert.equal(view.progress.value,25);
    assert.equal(view.requests[0][0],'/api/rewards/exploration/check-in');assert.equal(view.requests[0][1].method,'POST');
    assert.equal(view.link.href,'/central-creditos.html');
    view.emit({...known,level:3,name:'Conhecedor',xp:201,nextLevelXp:300,progress:1,balance:8,streak:4,visitedToday:['third-store']});
    assert.equal(view.heading.textContent,'Fase 3 · Conhecedor');assert.equal(view.copy.textContent,'8 moedas · 1 loja descoberta hoje');assert.equal(view.progress.value,1);
  }finally{view.restore();}
});

test('401 responses keep a neutral title and a login link with the current destination',async()=>{
  for(const json of [async()=>({error:'Unauthenticated'}),async()=>{throw new SyntaxError('Unexpected end of JSON input');}]){
    const view=mount(async()=>({ok:false,status:401,json}),{checkIn:false});
    try{
      await flush();assert.equal(view.heading.textContent,'Suas conquistas na cidade');assert.equal(view.progress.hidden,true);
      assert.equal(view.copy.textContent,'Entre na sua conta para participar.');assert.equal(view.link.textContent,'Entrar na conta');
      assert.equal(view.link.href,'/entrar-cidade.html?returnTo='+encodeURIComponent('/produto/12/exemplo?via=cidade'));
      assert.equal(view.requests[0][0],'/api/rewards/exploration');assert.equal(view.requests[0][1].method,'GET');
      view.emit(known);assert.equal(view.progress.hidden,false);assert.equal(view.link.href,'/central-creditos.html');assert.equal(view.link.textContent,'Usar moedas e ver benefícios');
    }finally{view.restore();}
  }
});

test('empty 204, malformed success and network failures show a friendly neutral state',async()=>{
  const invalid=[null,[],{}, {level:1,name:'Visitante'}, {...known,visitedToday:null}, {...known,balance:'7'}, {...known,progress:NaN}, {...known,nextLevelXp:100}, {...known,visitedToday:[null]}];
  const attempts=[...invalid.map(data=>async()=>response(data)),async()=>({ok:true,status:204,json:async()=>{throw new SyntaxError('Unexpected end of JSON input');}}),async()=>{throw new TypeError('Failed to fetch');},async()=>response({error:'TypeError: Cannot read properties of undefined'},500)];
  for(const attempt of attempts){const view=mount(attempt);try{await flush();assertUnavailable(view);}finally{view.restore();}}
});

test('invalid reward events cannot partially overwrite an existing summary or throw',async()=>{
  const view=mount(async()=>response(known));
  try{
    await flush();const before=snapshot(view);
    const throwing={get level(){throw new TypeError('unexpected event getter');}};
    for(const data of [undefined,null,[],{},throwing,{...known,visitedToday:undefined},{...known,level:0},{...known,name:{}},{...known,balance:Infinity}]){
      assert.doesNotThrow(()=>view.emit(data));assert.deepEqual(snapshot(view),before);
    }
  }finally{view.restore();}
});

test('a valid reward event is retained if an older pending request fails',async()=>{
  let rejectRequest;const view=mount(()=>new Promise((resolve,reject)=>{rejectRequest=reject;}));
  try{
    view.emit(known);const before=snapshot(view);rejectRequest(new TypeError('Failed to fetch'));await flush();assert.deepEqual(snapshot(view),before);
  }finally{view.restore();}
});
