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
  return {box,heading,copy,progress,detail,link,goal:box.children[5],requests,emit:detail=>{for(const listener of listeners.get('vitrinecity:reward-earned')||[])listener({detail});},emitPageShow:()=>{for(const listener of listeners.get('pageshow')||[])listener({persisted:true});},restore:()=>Object.assign(globalThis,saved)};
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

const goal={target:3,completed:2,remaining:1,achieved:false,available:true,rewardCoinsPerStore:1,bonusCoins:0};
test('daily goal shows credited visits, completes without extra coins and explains paused or capped rewards',async()=>{
  const view=mount(async()=>response({...known,dailyGoal:goal,enabled:true}));
  try{
    await flush();assert.equal(view.goal.hidden,false);assert.match(view.goal.textContent,/2 de 3 lojas · falta 1 loja/);assert.match(view.goal.textContent,/não acrescenta moedas extras/);
    assert.equal(view.goal.children[1].value,2);assert.equal(view.goal.children[1].max,3);
    view.emit({...known,visitedToday:['first-store','second-store','third-store'],dailyGoal:{...goal,completed:3,remaining:0,achieved:true}});assert.match(view.goal.textContent,/Meta de hoje concluída/);assert.equal(view.copy.textContent,'7 moedas · 3 lojas descobertas hoje');
    view.emit({...known,dailyGoal:goal,enabled:false});assert.match(view.goal.textContent,/recompensas estão pausadas/);
    view.emit({...known,dailyGoal:goal,dailyRewards:{limit:50,earned:50,remaining:0}});assert.match(view.goal.textContent,/limite de moedas de hoje entre visitas e fazenda/);
    view.emit({...known,dailyGoal:{...goal,target:0,completed:0,remaining:0,available:false,achieved:false}});assert.match(view.goal.textContent,/Ainda não há lojas/);assert.equal(view.goal.children[1].hidden,true);
    view.emit({...known,dailyGoal:{...goal,completed:99,achieved:true}});assert.equal(view.goal.hidden,true,'Malformed goals cannot advertise completion');
  }finally{view.restore();}
});

test('returning from a store refreshes the daily goal and an older request cannot undo a reward',async()=>{
  let resolveRequest;const view=mount(()=>new Promise(resolve=>{resolveRequest=resolve;}));
  try{
    view.emit({...known,balance:8,dailyGoal:goal});const fresh=snapshot(view);
    resolveRequest(response({...known,balance:7}));await flush();assert.deepEqual(snapshot(view),fresh);
    view.emitPageShow();assert.equal(view.requests.length,2);
    resolveRequest(response({...known,visitedToday:[],dailyGoal:{...goal,completed:0,remaining:3}}));await flush();assert.match(view.goal.textContent,/0 de 3 lojas/);
  }finally{view.restore();}
});

test('the daily itinerary uses safe local store links and renders names as text',async()=>{
  const view=mount(async()=>response({...known,dailyGoal:goal,dailyStores:[{reference:'official_agrotecnica',name:'Agrotécnica',completed:false},{reference:'school_1',name:'Centro <b>educacional</b>',completed:false},{reference:'../admin',name:'Invalid',completed:false}]}));
  try{await flush();const list=view.goal.children[4];assert.equal(list.children.length,2);assert.equal(list.children[0].href,'/loja/official_agrotecnica');assert.equal(list.children[1].textContent,'Visitar Centro <b>educacional</b> →');assert.equal(list.children[1].children.length,0);}finally{view.restore();}
});

test('logout on return clears a previous wallet and inconsistent goals cannot claim completion',async()=>{
  let loggedIn=true;const summaries=[];const view=mount(async()=>loggedIn?response({...known,dailyGoal:goal}):response({error:'Unauthenticated'},401),{onSummary:s=>summaries.push(s)});
  try{await flush();view.emit({...known,dailyGoal:{...goal,completed:3,remaining:0,achieved:true}});assert.equal(view.goal.hidden,true);
    view.emit({...known,dailyGoal:goal});assert.equal(view.goal.hidden,false);
    loggedIn=false;view.emitPageShow();await flush();assert.equal(view.copy.textContent,'Entre na sua conta para participar.');assert.equal(view.goal.hidden,true);assert.equal(view.progress.hidden,true);assert.equal(view.link.textContent,'Entrar na conta');assert.equal(summaries.at(-1),null);
  }finally{view.restore();}
});

test('opening the goal refreshes it and the server midnight schedules another refresh',async()=>{
  const realSet=globalThis.setTimeout,realClear=globalThis.clearTimeout,timers=new Map();let serial=0,openGoal;
  globalThis.setTimeout=(fn,delay)=>{timers.set(++serial,{fn,delay});return serial;};globalThis.clearTimeout=id=>timers.delete(id);
  const reset=Date.parse('2026-09-12T03:00:00Z'),data={...known,dailyGoal:goal,serverNow:reset-5000,dailyRewards:{limit:100,earned:2,remaining:98,resetsAt:new Date(reset).toISOString()}};
  const view=mount(async()=>response(data),{refreshOn:{addEventListener:(_event,callback)=>{openGoal=callback;}}});
  try{await flush();assert.equal(timers.size,1);assert.equal([...timers.values()][0].delay,5100);
    openGoal();await flush();assert.equal(view.requests.length,2);assert.equal(timers.size,1,'Refreshing replaces the old midnight timer');
    const pending=[...timers.values()][0];pending.fn();await flush();assert.equal(view.requests.length,3);
  }finally{for(const id of timers.keys())globalThis.clearTimeout(id);globalThis.setTimeout=realSet;globalThis.clearTimeout=realClear;view.restore();}
});
