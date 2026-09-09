import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {OPERATION_GROUPS,operationPolicy,operationSnapshot,canRunOperation,metricValue,operationHref,operationState,mountOperations} from '../public/admin-operacao.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
const sample=change=>({policy:{revision:3,enabled:true,paused:false,internalSocialEnabled:false,dailyLimit:6,hour:9,groups:['recipes','trends']},automation:{enabled:true,configured:true,running:false,quota:{attempted:2,remaining:4,published:0,review:2}},plan:{date:'2026-09-09',nextAt:'2026-09-10T12:00:00Z',items:[{id:'1',kind:'story',label:'Bolo de cenoura',status:'review',reason:'Imagem precisa de ajuste.',startedAt:'2026-09-09T12:00:00Z',url:'/admin-web-stories?story=1'}]},inventory:[{kind:'products',label:'Produtos',total:5,published:5,pending:0,available:true}],connections:[{id:'facebook',label:'Facebook',status:'blocked',connectedCount:1,canPublish:false,reason:'Aguardando aprovação da Meta.',adminUrl:'/admin-chatbotx.html#socialCommentCampaigns'}],metrics:{periodDays:7,items:[{id:'sales',label:'Vendas afiliadas',value:0,unit:'count',available:false,confirmed:false,note:'Não sincronizadas.'},{id:'visits',label:'Sessões',value:25,unit:'count',available:true,confirmed:true,note:'Últimos 7 dias.'}]},agents:[{id:'a',name:'Produção editorial',status:'ready',detail:'Aguardando a próxima execução.'}],exceptions:[{id:'pending1',title:'Conteúdo aguardando revisão',detail:'<script>não executar</script>',actionLabel:'Revisar conteúdo',actionUrl:'/admin-web-stories'}],events:[],...change});
const catalog=(kind='products',change={})=>({kind,items:[{id:'1',kind,title:'<b>Produto</b>',summary:'Descrição do produto.',status:'published',image:'/assets/photo.jpg',url:'/ofertas/produto',adminUrl:'/admin-vendas-afiliadas.html',meta:['Mercado Livre']}],offset:0,limit:20,total:1,nextOffset:null,...change});

function fixture(t,fetcher){
  class Element{
    constructor(tag='div'){this.tagName=tag;this.children=[];this.listeners={};this.dataset={};this.attrs={};this.value='';this.textContent='';this.checked=false;this.disabled=false;this.hidden=false;}
    append(...items){this.children.push(...items);}
    replaceChildren(...items){this.children=items;}
    setAttribute(name,value){this.attrs[name]=value;}
    addEventListener(name,fn){(this.listeners[name]||=new Set()).add(fn);}
    removeEventListener(name,fn){this.listeners[name]?.delete(fn);}
    dispatch(name){for(const fn of this.listeners[name]||[])fn({preventDefault(){},target:this});}
    reportValidity(){return true;}
  }
  const root=new Element(),document=new Element(),window=new Element(),nodes={};document.hidden=false;document.createElement=tag=>new Element(tag);root.ownerDocument=document;document.defaultView=window;window.location={origin:'https://vitrinecity.com'};
  const ids=['Date','State','Next','Updated','Notice','Refresh','Run','Pause','PauseNote','Workflow','PlanCount','Plan','ExceptionCount','Exceptions','Quota','PolicyForm','Enabled','Limit','Hour','InternalSocial','PolicyNote','Save','Inventory','CatalogTabs','CatalogForm','Query','Search','CatalogNotice','Catalog','Previous','CatalogPage','NextPage','Connections','Metrics','MetricsPeriod','Agents','Events'];
  for(const id of ids)nodes[id]=new Element();
  const inputs=OPERATION_GROUPS.map(value=>Object.assign(new Element('input'),{value})),tabs=['products','stores','pages','buildings','networks'].map(kind=>{const button=new Element('button');button.dataset.kind=kind;return button;});
  nodes.Hour.append(Object.assign(new Element('option'),{value:'9'}));nodes.PolicyForm.querySelectorAll=selector=>selector==='input[name=groups]'?inputs:[nodes.Enabled,nodes.Limit,nodes.Hour,nodes.InternalSocial,...inputs];nodes.CatalogTabs.querySelectorAll=()=>tabs;root.querySelector=selector=>nodes[selector.slice(3)];
  const timers=new Map();let timerId=0;const controller=mountOperations(root,{document,window,fetcher,setTimer:fn=>{timers.set(++timerId,fn);return timerId;},clearTimer:id=>timers.delete(id)});t.after(()=>controller.destroy());return{root,document,window,nodes,inputs,tabs,timers,controller};
}

test('policy bounds and execution gates require complete state, an enabled production routine and remaining quota',()=>{
  assert.deepEqual(operationPolicy(sample().policy),sample().policy);assert.equal(canRunOperation(sample()),true);
  for(const policy of [{paused:true},{enabled:false}])assert.equal(canRunOperation(sample({policy:{...sample().policy,...policy}})),false);
  for(const automation of [{configured:false},{enabled:false},{running:true},{closed:true},{quota:{remaining:0}},{quota:{remaining:undefined}}])assert.equal(canRunOperation(sample({automation:{...sample().automation,...automation}})),false);
  assert.equal(canRunOperation(sample({policy:{...sample().policy,internalSocialEnabled:true},automation:{...sample().automation,quota:{remaining:0}}})),true);
  for(const policy of [{revision:undefined},{dailyLimit:25},{hour:24},{groups:[]},{groups:['recipes','recipes']},{groups:['private']},{enabled:'true'}])assert.throws(()=>operationPolicy({...sample().policy,...policy}));
  assert.throws(()=>operationSnapshot({...sample(),metrics:{}}));assert.throws(()=>operationSnapshot({...sample(),plan:{}}));
});

test('unavailable metrics do not become zero or sales; unknown states are neutral; links reject executable and API targets',()=>{
  assert.equal(metricValue({value:0,available:false}),'—');assert.equal(metricValue({value:null,available:true}),'—');assert.equal(metricValue({value:0,available:true}),'0');assert.equal(metricValue({value:12.5,unit:'%',available:true}),'12,5%');assert.deepEqual(operationState('future_unknown'),['Estado não informado','neutral']);
  assert.equal(metricValue({value:1250,unit:'BRL_cents',available:true}),Number(12.5).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}));assert.deepEqual(operationState('partial'),['Conexão parcial','warn']);assert.deepEqual(operationState('pending'),['Pendente','warn']);
  const origin='https://vitrinecity.com';assert.equal(operationHref('/admin-web-stories?story=1#editor',origin),'/admin-web-stories?story=1#editor');assert.equal(operationHref('https://developers.facebook.com/docs/',origin),'https://developers.facebook.com/docs/');
  for(const value of ['javascript:alert(1)','//evil.test','/api/admin/change','https://u:p@evil.test','https://127.0.0.1/a','https://localhost/a','http://other.test/a','https://evil.test/ bad'])assert.equal(operationHref(value,origin),'',value);
});

test('initial view makes only reads, displays real review failures and pending Meta, and renders untrusted copy as text',async t=>{
  const calls=[],f=fixture(t,async(url,options)=>{calls.push({url,options});return response(url.includes('/catalog?')?catalog():sample());});await tick();
  assert.equal(calls.length,2);assert.ok(calls.every(call=>!call.options.method));assert.equal(f.nodes.Run.disabled,false);assert.equal(f.nodes.State.textContent,'Rotina programada');assert.equal(f.nodes.Quota.textContent,'2 de 6 tentativas hoje');assert.equal(f.nodes.Metrics.children[0].children[1].textContent,'—');
  assert.equal(f.nodes.Exceptions.children[0].children[1].textContent,'<script>não executar</script>');assert.equal(f.nodes.Catalog.children[0].children[1].children[0].children[0].textContent,'<b>Produto</b>');assert.equal(f.nodes.Connections.children[0].children[1].textContent,'Publicação não habilitada');assert.equal(f.nodes.Workflow.children[2].children[2].textContent,'1 precisam de atenção');
  assert.equal(f.nodes.MetricsPeriod.textContent,'Últimos 7 dias');
});

test('editing prevents execution; saving sends the edited revision and never executes the round',async t=>{
  const calls=[],f=fixture(t,async(url,options)=>{calls.push({url,options});if(url.includes('/catalog?'))return response(catalog());return response(options.method?sample({policy:{...JSON.parse(options.body),revision:4}}):sample());});await tick();
  f.nodes.Limit.value='4';f.inputs.forEach(input=>input.checked=input.value==='recipes');f.nodes.PolicyForm.dispatch('input');assert.equal(f.nodes.Run.disabled,true);f.nodes.Run.dispatch('click');assert.equal(calls.length,2);
  f.nodes.PolicyForm.dispatch('submit');await tick();const writes=calls.filter(call=>call.options.method);assert.equal(writes.length,1);assert.equal(writes[0].url,'/api/admin/ecosystem/policy');assert.deepEqual(JSON.parse(writes[0].options.body),{revision:3,enabled:true,paused:false,dailyLimit:4,hour:9,groups:['recipes'],internalSocialEnabled:false});assert.equal(f.nodes.Run.disabled,false);assert.ok(!calls.some(call=>call.url.endsWith('/run')));
});

test('pause preserves unsaved form options, sends only pause and revision, and does not activate an inactive coordinator',async t=>{
  const calls=[],initial=sample({policy:{...sample().policy,enabled:false}}),f=fixture(t,async(url,options)=>{calls.push({url,options});if(url.includes('/catalog?'))return response(catalog());return response(options.method?sample({policy:{...initial.policy,revision:4,paused:true}}):initial);});await tick();
  f.nodes.Limit.value='9';f.nodes.PolicyForm.dispatch('change');f.nodes.Pause.dispatch('click');await tick();const call=calls.find(call=>call.options.method);assert.deepEqual(JSON.parse(call.options.body),{revision:3,paused:true});assert.equal(f.nodes.Limit.value,'9');assert.equal(f.nodes.Enabled.checked,false);assert.equal(f.nodes.Run.disabled,true);assert.equal(f.nodes.Pause.textContent,'Retomar automações');
  f.nodes.PolicyForm.dispatch('submit');await tick();const saved=JSON.parse(calls.filter(call=>call.options.method).at(-1).options.body);assert.equal(saved.revision,4);assert.equal(saved.dailyLimit,9);assert.equal(saved.paused,true);assert.equal(saved.enabled,false);
});

test('run is single flight, returns accepted state without claiming publication, and never bypasses quota',async t=>{
  const calls=[];let finish;const f=fixture(t,async(url,options)=>{calls.push({url,options});if(url.endsWith('/run'))return new Promise(resolve=>{finish=resolve;});return response(url.includes('/catalog?')?catalog():sample());});await tick();f.nodes.Run.dispatch('click');f.nodes.Run.dispatch('click');assert.equal(calls.filter(call=>call.url.endsWith('/run')).length,1);assert.equal(f.nodes.Pause.disabled,true);
  finish(response(sample({automation:{...sample().automation,running:true}}),202));await tick();assert.equal(f.nodes.State.textContent,'Preparação em andamento');assert.match(f.nodes.Notice.textContent,/só aparece após confirmação/);assert.equal(f.nodes.Run.disabled,true);
});

test('an exhausted creation quota still permits only the configured distribution of already approved content',async t=>{
  const calls=[],value=sample({policy:{...sample().policy,internalSocialEnabled:true},automation:{...sample().automation,quota:{attempted:6,remaining:0}}}),f=fixture(t,async(url,options)=>{calls.push({url,options});return response(url.includes('/catalog?')?catalog():value);});await tick();assert.equal(f.nodes.Run.disabled,false);assert.equal(f.nodes.Run.textContent,'Divulgar aprovados');assert.match(f.nodes.Next.textContent,/sem novas gerações/);f.nodes.Run.dispatch('click');await tick();const writes=calls.filter(call=>call.options.method);assert.equal(writes.length,1);assert.equal(writes[0].url,'/api/admin/ecosystem/run');assert.deepEqual(JSON.parse(writes[0].options.body),{});assert.equal(f.nodes.Quota.textContent,'6 de 6 tentativas hoje');
});

test('uncertain write and stale revision block all mutations until a fresh read; refreshing does not retry the write',async t=>{
  const calls=[];let reads=0;const f=fixture(t,async(url,options)=>{calls.push({url,options});if(url.includes('/catalog?'))return response(catalog());if(options.method)return response({error:'conflict'},409);return response(sample({policy:{...sample().policy,revision:++reads===1?3:4}}));});await tick();f.nodes.PolicyForm.dispatch('submit');await tick();assert.equal(f.nodes.Save.disabled,true);assert.equal(f.nodes.Pause.disabled,true);assert.match(f.nodes.Notice.textContent,/outra sessão/);f.nodes.Pause.dispatch('click');assert.equal(calls.filter(call=>call.options.method).length,1);
  f.nodes.Refresh.dispatch('click');await tick();assert.equal(f.nodes.Save.disabled,false);assert.equal(calls.filter(call=>call.options.method).length,1);f.nodes.PolicyForm.dispatch('submit');await tick();assert.equal(JSON.parse(calls.filter(call=>call.options.method).at(-1).options.body).revision,4);
});

test('catalog server search, pagination and rapid tab changes discard stale responses without writing',async t=>{
  const calls=[];let oldResolve;const f=fixture(t,async(url,options)=>{calls.push({url,options});if(!url.includes('/catalog?'))return response(sample());const parsed=new URL(url,'https://vitrinecity.com');if(parsed.searchParams.get('q')==='farinha & ovos')return response(catalog(parsed.searchParams.get('kind'),{total:42,nextOffset:20}));if(parsed.searchParams.get('kind')==='stores')return new Promise(resolve=>{oldResolve=resolve;});return response(catalog(parsed.searchParams.get('kind')));});await tick();f.nodes.Query.value='farinha & ovos';f.nodes.CatalogForm.dispatch('submit');await tick();assert.ok(calls.at(-1).url.includes('q=farinha+%26+ovos'));assert.equal(f.nodes.NextPage.disabled,false);f.nodes.Query.value='';f.tabs[1].dispatch('click');await tick();const obsolete=calls.at(-1);f.tabs[2].dispatch('click');await tick();assert.equal(obsolete.options.signal.aborted,true);oldResolve(response(catalog('stores')));await tick();assert.match(f.nodes.CatalogNotice.textContent,/páginas/);assert.equal(f.tabs[2].attrs['aria-pressed'],'true');assert.ok(calls.every(call=>!call.options.method));
});

test('a network failure after a write keeps actions locked until the actual server state is reloaded',async t=>{
  const calls=[];let current=sample();const f=fixture(t,async(url,options)=>{calls.push({url,options});if(url.includes('/catalog?'))return response(catalog());if(options.method){current=sample({policy:{...sample().policy,revision:4,paused:true}});throw TypeError('network disconnected after acceptance');}return response(current);});await tick();f.nodes.Pause.dispatch('click');await tick();assert.equal(f.nodes.Pause.disabled,true);assert.match(f.nodes.Notice.textContent,/conexão falhou/);f.nodes.Pause.dispatch('click');assert.equal(calls.filter(call=>call.options.method).length,1);f.nodes.Refresh.dispatch('click');await tick();assert.equal(f.nodes.State.textContent,'Pausa global ativa');assert.equal(f.nodes.Pause.disabled,false);assert.equal(calls.filter(call=>call.options.method).length,1);
});

test('background reads stop while hidden and cannot overwrite the new state after returning',async t=>{
  const calls=[];let deferred;const f=fixture(t,async(url,options)=>{calls.push({url,options});if(url.includes('/catalog?'))return response(catalog());if(calls.filter(call=>!call.url.includes('/catalog?')).length===2)return new Promise(resolve=>{deferred=resolve;});return response(sample());});await tick();assert.equal(f.timers.size,1);const poll=[...f.timers.values()][0];f.timers.clear();poll();await tick();const stale=calls.at(-1);f.document.hidden=true;f.document.dispatch('visibilitychange');assert.equal(stale.options.signal.aborted,true);assert.equal(f.timers.size,0);f.document.hidden=false;f.document.dispatch('visibilitychange');await tick();deferred(response(sample({policy:{...sample().policy,paused:true}})));await tick();assert.equal(f.nodes.State.textContent,'Rotina programada');
});

test('HTML has matching unique controls, accessible form labels and mobile styles without a horizontal navigation wall',()=>{
  const html=fs.readFileSync(new URL('../public/admin-operacao.html',import.meta.url),'utf8'),js=fs.readFileSync(new URL('../public/admin-operacao.js',import.meta.url),'utf8'),css=fs.readFileSync(new URL('../public/admin-operacao.css',import.meta.url),'utf8');
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);assert.equal(ids.length,new Set(ids).size);for(const match of js.matchAll(/\$\('([^']+)'\)/g))assert.ok(ids.includes('ec'+match[1]),match[1]);assert.match(html,/aria-live="polite"/);assert.match(html,/aria-label="Tipo de cadastro"/);assert.match(css,/min-height:44px/);assert.match(css,/@media\(max-width:680px\)/);assert.doesNotMatch(css,/overflow-x:auto/);assert.doesNotMatch(js,/innerHTML|insertAdjacentHTML/);
});
