import test from 'node:test';
import assert from 'node:assert/strict';
import {mountStoryAutomation,canRunAutomation,validAutomationStatus,storyHistoryLink} from '../public/admin-web-story-automation.js';

const groups=['products','services','news','recipes','sports','trends'];
const sample=changes=>({enabled:true,configured:true,running:false,closed:false,revision:3,dailyLimit:6,hour:9,groups:[...groups],nextAt:'2026-09-09T12:00:00.000Z',quota:{attempted:1,remaining:5,published:1,review:0},history:[],reason:'completed',...changes});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
function fixture(t,fetcher){
  class Element{
    constructor(){this.children=[];this.listeners={};this.dataset={};this.attrs={};this.value='';this.checked=false;this.disabled=false;}
    append(...items){this.children.push(...items);}
    replaceChildren(...items){this.children=items;}
    setAttribute(name,value){this.attrs[name]=value;}
    addEventListener(name,fn){(this.listeners[name]||=new Set()).add(fn);}
    removeEventListener(name,fn){this.listeners[name]?.delete(fn);}
    dispatch(name){for(const fn of this.listeners[name]||[])fn({preventDefault(){}});}
    reportValidity(){return true;}
  }
  const document=new Element(),window=new Element(),root=new Element(),nodes={};
  document.hidden=false;document.createElement=()=>new Element();root.ownerDocument=document;
  for(const id of ['form','message','enabled','limit','hour','save','pause','run','refresh','state','next','quota','results','provider','history','published','publication-note'])nodes[id]=new Element();
  const inputs=groups.map(value=>Object.assign(new Element(),{value}));nodes.hour.append(Object.assign(new Element(),{value:'9'}));
  nodes.form.querySelectorAll=selector=>selector==='input[name=groups]'?inputs:[nodes.enabled,nodes.limit,nodes.hour,...inputs];
  root.querySelector=selector=>nodes[selector.replace('#automation-','')];
  const timers=new Map();let timerId=0;
  const controller=mountStoryAutomation(root,{document,window,fetcher,setTimer:fn=>{timers.set(++timerId,fn);return timerId;},clearTimer:id=>timers.delete(id)});
  t.after(()=>controller.destroy());return {document,window,root,nodes,inputs,timers,controller};
}

test('status validation and daily limits never enable a manual quota bypass',()=>{
  for(const status of [sample({enabled:false}),sample({configured:false}),sample({running:true}),sample({closed:true}),sample({quota:{remaining:0}})])assert.equal(canRunAutomation(status),false);
  assert.equal(canRunAutomation(sample()),true);
  assert.throws(()=>validAutomationStatus(sample({revision:undefined})),/configuração completa/);
  assert.throws(()=>validAutomationStatus(sample({groups:['private']})),/configuração completa/);
  assert.equal(storyHistoryLink({storyId:'id/?unsafe#fragment'}),'/admin-web-stories?story=id%2F%3Funsafe%23fragment#editor');
  assert.equal(storyHistoryLink({}),null);
});

test('initial load is read-only; inactive or unconfigured routines show status without polling',async t=>{
  const calls=[],f=fixture(t,async(url,options)=>{calls.push({url,options});return response(sample({enabled:false,configured:false,reason:'disabled'}));});await tick();
  assert.equal(calls.length,1);assert.equal(calls[0].options.method,undefined);assert.equal(f.nodes.run.disabled,true);assert.equal(f.nodes.state.textContent,'Pausada');assert.equal(f.nodes.provider.textContent,'Precisa de configuração');assert.equal(f.timers.size,0);
  f.nodes.run.dispatch('click');await tick();assert.equal(calls.length,1);
});

test('save sends selected groups and the revision that was edited; run waits for saved settings',async t=>{
  const calls=[],f=fixture(t,async(url,options)=>{calls.push({url,options});return response(sample({revision:calls.length===1?3:4}));});await tick();
  f.nodes.limit.value='4';f.inputs.forEach(input=>input.checked=input.value==='recipes');f.nodes.form.dispatch('change');assert.equal(f.nodes.run.disabled,true);
  f.nodes.run.dispatch('click');assert.equal(calls.length,1);
  f.nodes.form.dispatch('submit');await tick();
  assert.equal(calls[1].options.method,'PUT');assert.deepEqual(JSON.parse(calls[1].options.body),{enabled:true,dailyLimit:4,hour:9,groups:['recipes'],revision:3});assert.equal(calls[1].options.credentials,'same-origin');
  f.nodes.run.dispatch('click');await tick();assert.equal(calls[2].url,'/api/admin/web-story-automation/run');assert.equal(calls[2].options.method,'POST');assert.deepEqual(JSON.parse(calls[2].options.body),{});
});

test('polling runs only during work, stops when hidden, and discards responses from the previous view',async t=>{
  const calls=[],f=fixture(t,(url,options)=>new Promise(resolve=>calls.push({url,options,resolve})));calls[0].resolve(response(sample({running:true})));await tick();assert.equal(f.timers.size,1);
  const poll=[...f.timers.values()][0];f.timers.clear();poll();assert.equal(calls.length,2);
  f.document.hidden=true;f.document.dispatch('visibilitychange');assert.equal(calls[1].options.signal.aborted,true);assert.equal(f.timers.size,0);
  f.document.hidden=false;f.document.dispatch('visibilitychange');assert.equal(calls.length,3);calls[2].resolve(response(sample({running:false,enabled:false})));await tick();
  calls[1].resolve(response(sample({running:true})));await tick();assert.equal(f.nodes.state.textContent,'Pausada');assert.equal(f.timers.size,0);
  f.controller.destroy();assert.equal(f.document.listeners.visibilitychange.size,0);
});

test('a conflict blocks mutations until refreshed; history stays bounded and uses safe editor links',async t=>{
  const calls=[],history=Array.from({length:15},(_,i)=>({status:i?'review':'published',storyId:'story-'+i,sourceGroup:'products',summary:'<script>not markup</script>',startedAt:1788948000000}));
  const f=fixture(t,async(url,options)=>{calls.push({url,options});return calls.length===2?response({error:'A configuração mudou em outra sessão.'},409):response(sample({history,revision:calls.length===1?3:4}));});await tick();
  assert.equal(f.nodes.history.children.length,15);assert.equal(f.nodes.history.children[0].children[1].children[0].href,'/admin-web-stories?story=story-0#editor');assert.equal(f.nodes.history.children[0].children[0].children[3].textContent,'<script>not markup</script>');
  f.nodes.form.dispatch('change');f.nodes.form.dispatch('submit');await tick();assert.equal(f.nodes.save.disabled,true);assert.match(f.nodes.message.textContent,/outra sessão/);
  f.nodes.refresh.dispatch('click');await tick();assert.equal(f.nodes.save.disabled,false);f.nodes.form.dispatch('submit');await tick();assert.equal(JSON.parse(calls.at(-1).options.body).revision,4);
});

test('hiding during a write aborts it and reconciles with the server on return',async t=>{
  const calls=[];let rejectWrite;
  const f=fixture(t,(url,options)=>{calls.push({url,options});if(options.method)return new Promise((_,reject)=>{rejectWrite=reject;});return Promise.resolve(response(sample({enabled:calls.length===1})));});await tick();
  f.nodes.pause.dispatch('click');assert.equal(calls[1].options.method,'PUT');assert.equal(JSON.parse(calls[1].options.body).enabled,false);
  f.document.hidden=true;f.document.dispatch('visibilitychange');assert.equal(calls[1].options.signal.aborted,true);
  f.document.hidden=false;f.document.dispatch('visibilitychange');rejectWrite(Object.assign(Error('abort'),{name:'AbortError'}));await tick();await tick();assert.equal(calls.length,3);assert.equal(f.nodes.state.textContent,'Pausada');
});

test('six reviews and zero confirmed publications never become a success badge; recovered history stays intact',async t=>{
  const value=sample({quota:{attempted:6,remaining:0,published:0,review:6,failed:0,interrupted:0},publications:{today:1,total:3},history:[{status:'review',sourceKey:'recipe',recovery:{sourceAvailable:true,sourceKey:'recipe',storyId:'saved',published:true,publishedUrl:'/stories/recipe',title:'Receita completa'},diagnostics:{code:'review_details_unavailable'}}]});
  const f=fixture(t,async()=>response(value));await tick();assert.equal(f.nodes.state.dataset.active,'false');assert.equal(f.nodes.published.textContent,'1');assert.match(f.nodes.results.textContent,/0 publicadas pela rotina · 6 tentativas em revisão/);
  const copy=f.nodes.history.children[0].children[0];assert.equal(copy.children[0].textContent,'Tentativa ficou em revisão');assert.ok(copy.children.some(el=>/não registrou um motivo detalhado/.test(el.textContent)));assert.ok(copy.children.some(el=>/versão atual desta fonte já está publicada/.test(el.textContent)));
  assert.equal(f.nodes.history.children[0].children[1].children.at(-1).href,'/stories/recipe');assert.equal(value.history[0].status,'review');
});

test('source recovery links remain read-only and unavailable counts do not become zero',async t=>{
  const calls=[],f=fixture(t,async(...args)=>{calls.push(args);return response(sample({history:[{status:'review',sourceKey:'without-draft',recovery:{sourceAvailable:true,sourceKey:'without-draft',sourceUrl:'/artigo/receita'}}]}));});await tick();
  assert.equal(calls.length,1);assert.equal(calls[0][1].method,undefined);assert.equal(f.nodes.published.textContent,'Não informado');
  const actions=f.nodes.history.children[0].children[1];assert.equal(actions.children[0].href,'/admin-web-stories?source=without-draft#source-manual');assert.equal(actions.children[1].href,'/artigo/receita');
});

test('global pauses and catalog backoff prevent blind retry, and server rejection keeps its actual reason',async t=>{
  for(const extra of [{reason:'global_paused'},{catalogRetry:{pending:true,nextAt:'2026-09-09T13:00:00Z'}}])assert.equal(canRunAutomation(sample(extra)),false);
  const f=fixture(t,async(_url,options)=>response(options.method?{error:'As publicações estão pausadas na Central.'}:sample(),options.method?409:200));await tick();f.nodes.run.dispatch('click');await tick();assert.equal(f.nodes.message.textContent,'As publicações estão pausadas na Central.');assert.equal(f.nodes.run.disabled,true);
});
