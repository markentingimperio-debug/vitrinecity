import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {mountNeuralKlingAdmin} from '../public/neural-kling-admin.js';
import {KLING_READINESS_VERSION,KLING_API_LINKS,KLING_READINESS_STATES,assertKlingReadiness} from '../public/neural-kling-contract.js';

const html=readFileSync(new URL('../public/admin-vitriny-neural.html',import.meta.url),'utf8');
const script=readFileSync(new URL('../public/neural-kling-admin.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/neural-kling-admin.css',import.meta.url),'utf8');
const BASE='/api/admin/vitriny-neural/kling';
function readiness(stage='not_checked',overrides={}){
  return assertKlingReadiness({version:KLING_READINESS_VERSION,provider:'kling_api',stage,configured:stage!=='credentials_missing',checkedAt:['not_checked','credentials_missing'].includes(stage)?null:'2026-09-15T12:00:00.000Z',generationEnabled:false,customerBillingEnabled:false,studioCreditsShared:false,balanceFreshness:'up_to_12_hours',packageCount:stage==='access_verified'?2:null,...overrides});
}
const response=(value,status=200)=>({ok:status>=200&&status<300,status,json:async()=>structuredClone(value)});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {resolve,reject,promise};};
const tick=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};
class Element{
  constructor(){this.textContent='';this.hidden=false;this.disabled=false;this.attributes={};this.listeners={};}
  set innerHTML(_value){throw Error('Untrusted HTML rendering is forbidden');}
  setAttribute(key,value){this.attributes[key]=String(value);}
  getAttribute(key){return this.attributes[key];}
  addEventListener(key,listener){this.listeners[key]=listener;}
  click(){return this.listeners.click?.();}
}
function fixture(fetcher){
  const nodes=new Map([...html.matchAll(/\bid="(kling-[^"]+)"/g)].map(([,id])=>[id,new Element()]));
  const calls=[],navigation=[],listeners=new Map(),timers=new Map();let timer=0;
  mountNeuralKlingAdmin({document:{getElementById:id=>nodes.get(id)},window:{addEventListener:(key,callback)=>listeners.set(key,callback)},location:{assign:path=>navigation.push(path)},AbortController,
    setTimeout:(callback,ms)=>{timers.set(++timer,{callback,ms});return timer;},clearTimeout:id=>timers.delete(id),
    fetch:async(url,options)=>{assert.ok([BASE+'/status',BASE+'/check'].includes(url));const call={url,options};calls.push(call);return fetcher?fetcher(call):response({ok:true,status:readiness()});}});
  return {nodes,calls,navigation,listeners,timers,$:id=>nodes.get(id),text:()=>[...nodes.values()].map(node=>node.textContent).join('\n')};
}

test('Kling readiness is visible outside advanced tools with mobile, accessible and separate Studio wording',()=>{
  const panel=html.indexOf('<section id="kling-panel"'),advanced=html.indexOf('<details class="advanced-console">');
  assert.ok(panel>0&&advanced>panel);
  assert.ok(html.indexOf('</section>',panel)<advanced);
  assert.match(html,/<h2 id="kling-title">Kling API · geração para clientes<\/h2>/);
  assert.match(html,/<script type="module" src="\/neural-kling-admin.js"><\/script>/);
  assert.match(html,/Assinatura e créditos do Studio não são compartilhados com a API/);
  assert.match(html,/não significa geração de vídeos ativa/);
  assert.match(html,/até 12 horas/);
  assert.match(html,/cobrança dos clientes são etapas diferentes/);
  assert.match(html,/id="kling-status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html,/id="kling-error"[^>]*role="alert"/);
  assert.match(html,/id="kling-check"[^>]*aria-describedby="kling-check-hint"/);
  assert.match(css,/min-height:44px/);assert.match(css,/@media\(max-width:650px\)/);assert.match(css,/:focus-visible/);
  assert.doesNotMatch(script,/innerHTML|outerHTML|insertAdjacentHTML|localStorage|sessionStorage|document\.write|\beval\s*\(/);
  for(const [,id]of script.matchAll(/\$\('(kling-[^']+)'\)/g))assert.ok(html.includes('id="'+id+'"'),'Required selector '+id);
});

test('opening only gets status and navigation uses canonical official links, never tokens or drifting prices',async()=>{
  const f=fixture();assert.equal(f.$('kling-panel').getAttribute('aria-busy'),'true');await tick();
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].url,BASE+'/status');assert.equal(f.calls[0].options.method,'GET');
  assert.equal(f.calls[0].options.body,undefined);assert.equal(f.calls[0].options.credentials,'same-origin');assert.equal(f.calls[0].options.cache,'no-store');assert.equal(f.calls[0].options.redirect,'error');
  assert.equal(f.$('kling-stage').textContent,KLING_READINESS_STATES.not_checked);
  assert.equal(f.$('kling-check').disabled,false);assert.equal(f.$('kling-package-count').hidden,true);
  for(const key of Object.keys(KLING_API_LINKS)){
    const element=f.$('kling-'+key+'-link'),url=new URL(element.href);
    assert.equal(element.href,KLING_API_LINKS[key]);assert.equal(url.protocol,'https:');assert.equal(url.hostname,'kling.ai');assert.equal(url.search,'');assert.equal(url.username,'');assert.equal(url.password,'');
    assert.equal(element.target,'_blank');assert.equal(element.rel,'noopener noreferrer');
  }
  assert.doesNotMatch(f.text(),/R\$|USD|saldo disponível:|geração ativa/i);
});

test('one explicit access check sends only empty JSON and busy state never retains prior validation',async()=>{
  const wait=deferred();const f=fixture(call=>call.options.method==='POST'?wait.promise:response({ok:true,status:readiness('access_verified')}));await tick();
  assert.equal(f.$('kling-package-count').hidden,false);
  const first=f.$('kling-check').click(),second=f.$('kling-check').click();
  assert.equal(f.calls.length,2);assert.equal(f.$('kling-check').disabled,true);assert.equal(f.$('kling-refresh').disabled,true);
  assert.equal(f.$('kling-stage').getAttribute('data-state'),'loading');assert.equal(f.$('kling-package-count').hidden,true);
  const call=f.calls[1];assert.equal(call.url,BASE+'/check');assert.equal(call.options.method,'POST');assert.equal(call.options.body,'{}');
  assert.equal(call.options.headers['x-neural-request'],'1');assert.equal(call.options.headers['content-type'],'application/json');
  wait.resolve(response({ok:true,status:readiness('access_verified')}));await first;await second;
  assert.equal(f.$('kling-stage').textContent,KLING_READINESS_STATES.access_verified);
  assert.match(f.$('kling-status').textContent,/Nenhum vídeo foi gerado/);
  assert.match(f.$('kling-commercial').textContent,/ainda precisam ser confirmados/);
  assert.match(f.$('kling-package-count').textContent,/2.*não confirma saldo/);
  assert.match(f.$('kling-checked-at').textContent,/Brasília/);
  assert.equal(f.$('kling-panel').getAttribute('aria-busy'),'false');
});

test('all canonical stages render honestly and missing credentials cannot launch a check',async()=>{
  for(const stage of Object.keys(KLING_READINESS_STATES)){
    const f=fixture(()=>response({ok:true,status:readiness(stage)}));await tick();
    assert.equal(f.$('kling-stage').textContent,KLING_READINESS_STATES[stage]);
    assert.equal(f.$('kling-error').hidden,!['credentials_rejected','unavailable'].includes(stage));
    if(stage==='credentials_missing'){await f.$('kling-check').click();assert.equal(f.calls.length,1);assert.equal(f.$('kling-check').disabled,true);}
  }
});

test('v2 unknown package quantity replaces prior count without claiming zero or available balance',async()=>{
  let current=readiness('access_verified');
  const f=fixture(()=>response({ok:true,status:current}));await tick();
  assert.match(f.$('kling-package-count').textContent,/Pacotes retornados pela API: 2/);
  current=readiness('access_verified',{packageCount:null});await f.$('kling-refresh').click();
  assert.equal(f.$('kling-stage').getAttribute('data-state'),'access_verified');assert.equal(f.$('kling-package-count').hidden,false);
  assert.match(f.$('kling-package-count').textContent,/Quantidade de pacotes não informada pela API/);
  assert.match(f.$('kling-package-count').textContent,/saldo disponível continua não confirmado/);
  assert.doesNotMatch(f.$('kling-package-count').textContent,/null|undefined|\b0\b|\b2\b/);
  assert.match(f.$('kling-commercial').textContent,/ainda precisam ser confirmados/);
  assert.match(f.$('kling-status').textContent,/Nenhum vídeo foi gerado/);
  assert.equal(f.$('kling-error').hidden,true);assert(f.calls.every(call=>call.options.method==='GET'));
});

test('consumer supports v1 and v2 known zero counts but refuses a v1 unknown count',async()=>{
  for(const version of [1,KLING_READINESS_VERSION]){
    const f=fixture(()=>response({ok:true,status:readiness('access_verified',{version,packageCount:0})}));await tick();
    assert.equal(f.$('kling-stage').getAttribute('data-state'),'access_verified');
    assert.match(f.$('kling-package-count').textContent,/Pacotes retornados pela API: 0\. Isso não confirma saldo/);
  }
  const f=fixture(()=>response({ok:true,status:{...readiness('access_verified'),version:1,packageCount:null}}));await tick();
  assert.equal(f.$('kling-stage').getAttribute('data-state'),'error');assert.equal(f.$('kling-package-count').hidden,true);
});

test('failed checks invalidate former success, suppress remote payloads and recover by explicit GET only',async()=>{
  const failures=[()=>response({error:'DO_NOT_RENDER_SERVER_DETAIL'},503),()=>response({ok:true,status:{...readiness('access_verified'),generationEnabled:true}}),()=>response({ok:true,status:{...readiness('access_verified'),secret:'DO_NOT_RENDER_SERVER_DETAIL'}}),()=>({ok:true,status:200,json:async()=>{throw Error('DO_NOT_RENDER_SERVER_DETAIL');}}),()=>Promise.reject(Object.assign(Error('DO_NOT_RENDER_SERVER_DETAIL'),{name:'AbortError'}))];
  for(const fail of failures){
    const f=fixture(call=>call.options.method==='POST'?fail():response({ok:true,status:readiness('access_verified')}));await tick();await f.$('kling-check').click();
    assert.equal(f.$('kling-stage').getAttribute('data-state'),'error');assert.equal(f.$('kling-stage').textContent,'Estado não confirmado');
    assert.equal(f.$('kling-package-count').hidden,true);assert.equal(f.$('kling-package-count').textContent,'');
    assert.equal(f.$('kling-check').disabled,true);assert.equal(f.$('kling-refresh').disabled,false);
    assert.match(f.$('kling-checked-at').textContent,/Nenhuma conferência/);assert.doesNotMatch(f.text(),/DO_NOT_RENDER_SERVER_DETAIL/);
    assert.equal(f.$('kling-error').hidden,false);assert.equal(f.calls.filter(call=>call.options.method==='POST').length,1);
    await f.$('kling-refresh').click();assert.equal(f.calls.at(-1).options.method,'GET');
    assert.equal(f.$('kling-stage').getAttribute('data-state'),'access_verified');assert.equal(f.calls.filter(call=>call.options.method==='POST').length,1);
  }
});

test('unauthenticated readiness offers the existing admin login while forbidden access stays unverified',async()=>{
  for(const code of [401,403]){
    const f=fixture(()=>response({ok:false,error:'DO_NOT_RENDER_PRIVATE'},code));await tick();
    assert.equal(f.$('kling-stage').getAttribute('data-state'),'error');assert.equal(f.$('kling-check').disabled,true);
    assert.deepEqual(f.navigation,code===401?['/admin-login.html']:[]);assert.equal(f.$('kling-login').hidden,code!==401);
    assert.doesNotMatch(f.text(),/DO_NOT_RENDER_PRIVATE/);
  }
});

test('leaving during a check discards late evidence and restoring the page never repeats POST',async()=>{
  const wait=deferred();const f=fixture(call=>call.options.method==='POST'?wait.promise:response({ok:true,status:readiness()}));await tick();
  const check=f.$('kling-check').click();f.listeners.get('pagehide')();
  assert.equal(f.calls.at(-1).options.signal.aborted,true);
  wait.resolve(response({ok:true,status:readiness('access_verified')}));await check;
  assert.notEqual(f.$('kling-stage').getAttribute('data-state'),'access_verified');assert.equal(f.$('kling-package-count').hidden,true);
  f.listeners.get('pageshow')({persisted:true});await tick();
  assert.equal(f.calls.at(-1).options.method,'GET');assert.equal(f.calls.filter(call=>call.options.method==='POST').length,1);
  assert.equal(f.$('kling-stage').getAttribute('data-state'),'not_checked');
});
