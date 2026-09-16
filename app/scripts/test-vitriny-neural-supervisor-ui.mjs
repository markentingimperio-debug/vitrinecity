import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../public/admin-vitriny-neural.html',import.meta.url),'utf8');
const script=readFileSync(new URL('../public/vitriny-neural-admin.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/vitriny-neural-admin.css',import.meta.url),'utf8');
const key='vitriny-neural-supervisor-pending-v1',id='12345678-1234-4123-8123-123456789abc',otherId='22345678-1234-4123-8123-123456789abc';
const reviewKey='vitriny-neural-supervisor-review-pending-v1';
const objective='Avalie como melhorar o atendimento com as capacidades existentes.';
const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>structuredClone(data)});
const tick=async()=>{for(let n=0;n<5;n++)await new Promise(resolve=>setImmediate(resolve));};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function status(extra={}){
  return {enabled:true,configured:true,paused:false,model:'gpt-6-astra',revision:1,dailyUsdLimit:.5,automaticDaily:false,
    automatic:{lastAttemptAt:null,nextAt:null,error:null},limits:{maxDailyUsd:.5,minIntervalSeconds:3600,maxInputTokens:12000,maxOutputTokens:1200,timeoutSeconds:60},
    quote:{maximumUsd:.18,inputUsdPerMillion:10,outputUsdPerMillion:50},budget:{day:'2026-09-13',reservedOrSpentUsd:0,remainingUsd:.5,nextEvaluationAt:null},
    availability:{state:'available',checkedAt:'2026-09-13T12:00:00Z',error:null},recent:[],...extra};
}
function run(state='completed',extra={}){
  return {id,state,objective,createdAt:'2026-09-13T12:10:00Z',finishedAt:state==='completed'?'2026-09-13T12:11:00Z':null,
    error:null,notSubmitted:false,retrySafe:false,maximumUsd:.18,actualUsd:state==='completed'?.07:null,candidateId:state==='completed'?'astra-'+id:null,applied:false,
    result:state==='completed'?{summary:'Reutilize o atendimento existente para um experimento pequeno.',findings:['As métricas são agregadas.'],recommendations:['Compare uma mudança antes de aprovar.'],evidenceIds:['KB_1']}:null,...extra};
}
class Element{
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this._text='';this.value='';this.disabled=false;this.checked=false;this.hidden=false;this.style={};}
  set textContent(value){this._text=String(value);this.children=[];}get textContent(){return this._text+this.children.map(child=>child.textContent??String(child)).join('');}
  set innerHTML(_value){throw Error('Untrusted HTML rendering is forbidden in this fixture.');}
  append(...children){this.children.push(...children);}replaceChildren(...children){this._text='';this.children=children;}
  setAttribute(name,value){this.attributes[name]=String(value);}getAttribute(name){return this.attributes[name];}
  reset(){}focus(){this.focused=true;}
}
function fixture({fetcher,initial=status(),storage=new Map(),storageFails=false}={}){
  const nodes=new Map(),calls=[],storageWrites=[],timers=[];
  for(const match of html.matchAll(/<([a-z][a-z0-9-]*)\b[^>]*\bid="([^"]+)"[^>]*>/gi)){
    const node=new Element(match[1]);node.id=match[2];node.disabled=/\sdisabled(?:\s|>)/.test(match[0]);node.hidden=/\shidden(?:\s|>)/.test(match[0]);nodes.set(node.id,node);
  }
  const $=name=>nodes.get(name);
  const document={getElementById:$,createElement:tag=>new Element(tag)};
  const legacy={
    '/status':{service:{enabled:true,mode:'shadow',primaryProviderId:'existing-provider'},readiness:{recommendedMode:'shadow'},skills:{providers:[{id:'existing-provider'}]}},
    '/skills':{skills:[],providers:[]},'/models/qualifications':{items:[]},'/benchmark':{recent:[]},
    '/web-research/status':{configured:false},'/web-research/candidates?status=candidate&limit=50':{items:[]},
    '/training/status':{counts:{}},'/training/examples?status=candidate&limit=100':{items:[]}
  };
  const sessionStorage={getItem:k=>storage.get(k)??null,setItem(k,value){if(storageFails)throw Error('Storage unavailable');storageWrites.push({key:k,value});storage.set(k,value);},removeItem:k=>storage.delete(k)};
  const context={document,sessionStorage,Intl,Date,URLSearchParams,performance:{now:()=>0},crypto:{randomUUID:()=>id},AbortSignal:{timeout:()=>undefined},
    location:{assign:()=>{throw Error('Unexpected navigation');}},setInterval:fn=>{timers.push(fn);return 1;},setTimeout:()=>1,clearTimeout:()=>{},
    fetch:async(url,options)=>{
      const path=url.replace('/api/admin/vitriny-neural','');const call={path,method:options.method,body:options.body?JSON.parse(options.body):null,options};calls.push(call);
      assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');
      if(!path.startsWith('/supervisor/')){assert.equal(options.method,'GET');assert(Object.hasOwn(legacy,path),'Unexpected legacy endpoint '+path);return response(legacy[path]);}
      const result=await fetcher?.(call,{storage});if(result!==undefined)return result;
      if(path==='/supervisor/status')return response(initial);
      throw Error('Unexpected supervisor request '+path);
    }
  };
  context.window=context;vm.runInNewContext(script,context,{filename:'vitriny-neural-admin.js'});
  return {$,calls,storage,storageWrites,timers,async submit(name){await $(name).onsubmit({preventDefault(){},currentTarget:$(name)});await tick();},
    async click(name){await $(name).onclick?.();await tick();},edit(name,value){const el=$(name);if(typeof value==='boolean')el.checked=value;else el.value=value;(el.onchange||el.oninput)?.();},
    mutations:()=>calls.filter(call=>call.method!=='GET'),evaluations:()=>calls.filter(call=>call.path==='/supervisor/evaluate')};
}

test('opening the existing console only reads, keeps shadow and provider, and leaves daily consultation off',async()=>{
  const f=fixture({initial:status({enabled:false})});await tick();
  assert.equal(f.mutations().length,0);assert.equal(f.$('supervisor-automatic').checked,false);
  assert.equal(f.$('mode').textContent,'SHADOW');assert.equal(f.$('provider').textContent,'existing-provider');
  assert.equal(f.$('supervisor-evaluate').disabled,true);assert.match(f.$('supervisor-quote').textContent,/0,18/);
  for(const timer of f.timers)timer();await tick();assert.equal(f.mutations().length,0);
  const before=f.calls.filter(call=>call.path==='/supervisor/status').length;await f.click('refresh');
  assert.equal(f.calls.filter(call=>call.path==='/supervisor/status').length,before+1);assert.equal(f.mutations().length,0);
});

test('explicit configuration saves revision, daily selection and cap once, without evaluating',async()=>{
  const pending=deferred();let current=status({enabled:false});
  const f=fixture({fetcher:call=>call.path==='/supervisor/config'?pending.promise:call.path==='/supervisor/status'?response(current):undefined});await tick();
  f.edit('supervisor-enabled',true);f.edit('supervisor-automatic',true);f.edit('supervisor-daily-cap','0.36');
  const first=f.submit('supervisor-config-form');const second=f.submit('supervisor-config-form');
  assert.equal(f.mutations().length,1);assert.deepEqual(f.mutations()[0].body,{enabled:true,automaticDaily:true,dailyUsdLimit:.36,revision:1});
  assert.equal(f.$('supervisor-save').disabled,true);
  current=status({revision:2,automaticDaily:true,dailyUsdLimit:.36});pending.resolve(response(current));await first;await second;
  assert.equal(f.evaluations().length,0);assert.match(f.$('supervisor-notice').textContent,/próximo ciclo/);
  assert.match(f.$('supervisor-state').textContent,/DIÁRIA/);assert.equal(f.$('supervisor-automatic').checked,true);
});

test('uncertain configuration is not retried or displayed as saved until server readback',async()=>{
  let current=status({enabled:false});const f=fixture({fetcher:call=>{
    if(call.path==='/supervisor/config'){current=status({revision:2,enabled:true,automaticDaily:true});throw Error('Conexão interrompida');}
    if(call.path==='/supervisor/status')return response(current);
  }});await tick();f.edit('supervisor-enabled',true);f.edit('supervisor-automatic',true);
  await f.submit('supervisor-config-form');await f.submit('supervisor-config-form');
  assert.equal(f.mutations().length,1);assert.equal(f.$('supervisor-save').disabled,true);assert.match(f.$('supervisor-state').textContent,/DESABILITADO/);
  await f.click('supervisor-refresh');assert.equal(f.$('supervisor-save').disabled,false);assert.match(f.$('supervisor-state').textContent,/DIÁRIA/);
  assert.equal(f.evaluations().length,0);assert.match(f.$('supervisor-notice').textContent,/conferida no servidor/);
});

test('checking access is one explicit request and never generates an evaluation',async()=>{
  const pending=deferred();const f=fixture({initial:status({availability:{state:'unknown'}}),fetcher:call=>call.path==='/supervisor/check'?pending.promise:undefined});await tick();
  assert.equal(f.$('supervisor-evaluate').disabled,true);const a=f.click('supervisor-check'),b=f.click('supervisor-check');
  assert.equal(f.mutations().length,1);assert.deepEqual(f.mutations()[0].body,{});
  pending.resolve(response(status()));await a;await b;assert.equal(f.$('supervisor-evaluate').disabled,false);assert.equal(f.evaluations().length,0);
});

test('evaluation stores only its identifier before the sole POST and renders a candidate, not an applied change',async()=>{
  const pending=deferred();let current=status();const f=fixture({fetcher:(call,{storage})=>{
    if(call.path==='/supervisor/evaluate'){assert.equal(JSON.parse(storage.get(key)).id,call.body.requestId);return pending.promise;}
    if(call.path==='/supervisor/status')return response(current);
  }});await tick();f.edit('supervisor-objective',objective);const first=f.submit('supervisor-evaluate-form'),second=f.submit('supervisor-evaluate-form');
  assert.equal(f.evaluations().length,1);assert.deepEqual(f.evaluations()[0].body,{requestId:id,objective});
  assert.deepEqual(Object.keys(JSON.parse(f.storage.get(key))).sort(),['createdAt','id']);assert(!f.storage.get(key).includes(objective));
  assert.equal(f.$('supervisor-active').getAttribute('aria-busy'),'true');
  current=status({recent:[run()],budget:{day:'2026-09-13',reservedOrSpentUsd:.07,remainingUsd:.43,nextEvaluationAt:null}});
  pending.resolve(response({run:run()}));await first;await second;
  assert.equal(f.storage.has(key),false);assert.equal(f.$('supervisor-active').getAttribute('aria-busy'),'false');
  assert.match(f.$('supervisor-run-detail').textContent,/não aplicada/);assert.match(f.$('supervisor-history').textContent,/NÃO APLICADO/);
  assert.match(f.$('supervisor-budget').textContent,/0,07/);assert.equal(f.mutations().length,1);
});

test('timeout keeps the request; repeated clicks and a missing record cannot create a second paid request',async()=>{
  const f=fixture({fetcher:call=>{
    if(call.path==='/supervisor/evaluate')throw Error('Timeout');
    if(call.path.startsWith('/supervisor/runs/'))return response({error:'astra_run_not_found'},404);
  }});await tick();f.edit('supervisor-objective',objective);await f.submit('supervisor-evaluate-form');await f.submit('supervisor-evaluate-form');
  assert.equal(f.$('supervisor-evaluate').disabled,true);assert.equal(f.storage.has(key),true);
  await f.click('supervisor-reconcile');await f.submit('supervisor-evaluate-form');
  assert.equal(f.evaluations().length,1);assert.match(f.$('supervisor-error').textContent,/não será repetido/);assert.equal(f.storage.has(key),true);
});

test('reopening a pending evaluation reads the same record, retains unknown cost and never resubmits',async()=>{
  const storage=new Map([[key,JSON.stringify({id,createdAt:'2026-09-13T12:10:00Z'})]]);
  const f=fixture({storage,fetcher:call=>call.path.startsWith('/supervisor/runs/')?response({run:run('unknown')}):undefined});await tick();
  assert.equal(f.mutations().length,0);assert.equal(f.calls.filter(call=>call.path==='/supervisor/runs/'+id).length,1);
  assert.match(f.$('supervisor-run-state').textContent,/existente.*incerto/i);assert.match(f.$('supervisor-run-cost').textContent,/Não informado/);
  assert.equal(f.$('supervisor-evaluate').disabled,true);assert.equal(f.storage.has(key),true);
});

test('server history restores an outstanding request even if local storage is empty or unavailable',async()=>{
  for(const storageFails of [false,true]){
    const f=fixture({storageFails,initial:status({recent:[run('unknown')]}),fetcher:call=>call.path.startsWith('/supervisor/runs/')?response({run:run('unknown')}):undefined});await tick();
    assert.equal(f.mutations().length,0);assert.equal(f.$('supervisor-evaluate').disabled,true);assert.equal(f.$('supervisor-reconcile').hidden,false);
    assert.equal(f.calls.filter(call=>call.path==='/supervisor/runs/'+id).length,1);
  }
});

test('completed readback clears the pending ID, while unverified or wrong-ID responses keep it blocked',async()=>{
  for(const existing of [run(),run('completed',{id:otherId}),run('completed',{applied:true}),{id,state:'not-a-state',applied:false}]){
    const storage=new Map([[key,JSON.stringify({id})]]);const f=fixture({storage,fetcher:call=>call.path.startsWith('/supervisor/runs/')?response({run:existing}):undefined});await tick();
    assert.equal(f.mutations().length,0);assert.equal(f.storage.has(key),existing.id!==id||existing.applied||existing.state!=='completed');
  }
});

test('only confirmed pre-submission blocking clears the request; uncertain failures remain held',async()=>{
  for(const existing of [run('blocked',{notSubmitted:true,retrySafe:true}),run('failed',{notSubmitted:false,retrySafe:false}),run('unknown',{notSubmitted:false,retrySafe:false})]){
    const f=fixture({fetcher:call=>call.path==='/supervisor/evaluate'?response({run:existing}):undefined});await tick();f.edit('supervisor-objective',objective);await f.submit('supervisor-evaluate-form');
    assert.equal(f.evaluations().length,1);assert.equal(f.storage.has(key),existing.state!=='blocked');
  }
});

test('an exact server no-submission proof releases rejected input, but generic errors or contradictory proofs never do',async()=>{
  const proofs=[
    {requestId:id,notSubmitted:true,retrySafe:true},
    {},
    {requestId:otherId,notSubmitted:true,retrySafe:true},
    {requestId:id,notSubmitted:true,retrySafe:false},
    {requestId:id,notSubmitted:true,retrySafe:true,run:run('unknown')}
  ];
  for(const [index,proof] of proofs.entries()){
    const f=fixture({fetcher:call=>call.path==='/supervisor/evaluate'?response({error:'astra_text_invalid',...proof},400):undefined});await tick();
    f.edit('supervisor-objective',objective);await f.submit('supervisor-evaluate-form');
    assert.equal(f.storage.has(key),index!==0);assert.equal(f.$('supervisor-evaluate').disabled,index!==0);assert.equal(f.evaluations().length,1);
    assert.match(f.$('supervisor-error').textContent,/Revise o objetivo/);
    if(index===0)assert.match(f.$('supervisor-notice').textContent,/nenhuma consulta foi enviada/);
  }
});

test('cost changes come from the server quote and are shown before an explicit evaluation',async()=>{
  const f=fixture({initial:status({quote:{maximumUsd:.21}})});await tick();
  assert.match(f.$('supervisor-quote').textContent,/0,21/);assert.match(f.$('supervisor-evaluate').textContent,/0,21/);
  assert.equal(f.mutations().length,0);
});

test('untrusted candidate text is plain text and never creates an executable node or link',async()=>{
  const unsafe='<img src=x onerror=alert(1)>';const existing=run('completed',{objective:unsafe,result:{summary:unsafe,findings:[unsafe],recommendations:['javascript:alert(1)'],evidenceIds:['<script>alert(1)</script>']}});
  const f=fixture({initial:status({recent:[existing]}),fetcher:call=>call.path.startsWith('/supervisor/runs/')?response({run:existing}):undefined});await tick();
  const button=f.$('supervisor-history').children[0].children.at(-1);await button.onclick();await tick();
  assert.match(f.$('supervisor-result').textContent,/<img src=x/);
  const descendants=element=>[element,...element.children.flatMap(descendants)];
  assert(descendants(f.$('supervisor-result')).every(el=>!['A','IMG','SCRIPT','IFRAME'].includes(el.tagName)));
  assert.equal(f.mutations().length,0);
});

test('pause, missing availability, insufficient budget and missing quote block paid action',async()=>{
  for(const extra of [{paused:true},{configured:false},{enabled:false},{availability:{state:'unavailable'}},{budget:{remainingUsd:.17}},{quote:{maximumUsd:null}}]){
    const f=fixture({initial:status(extra)});await tick();f.edit('supervisor-objective',objective);await f.submit('supervisor-evaluate-form');
    assert.equal(f.$('supervisor-evaluate').disabled,true);assert.equal(f.evaluations().length,0);assert.equal(f.storageWrites.length,0);
  }
});

test('invalid input or unavailable local request storage causes no evaluation POST',async()=>{
  for(const text of ['curto','x'.repeat(1001)]){
    const f=fixture();await tick();f.edit('supervisor-objective',text);await f.submit('supervisor-evaluate-form');assert.equal(f.evaluations().length,0);
  }
  const f=fixture({storageFails:true});await tick();f.edit('supervisor-objective',objective);await f.submit('supervisor-evaluate-form');
  assert.equal(f.evaluations().length,0);assert.match(f.$('supervisor-error').textContent,/Nenhuma avaliação foi enviada/);
});

const knownFailure=(extra={})=>run('failed',{failureReviewable:true,reviewed:false,reviewedAt:null,actualUsd:.07,error:'astra_response_invalid',...extra});
test('known-failure review is explicit and single, preserving failed state, recorded cost and cooldown',async()=>{
  const pending=deferred();let existing=knownFailure();const nextAt=new Date(Date.now()+3600000).toISOString();
  const current=()=>status({recent:[existing],budget:{day:'2026-09-13',reservedOrSpentUsd:.07,remainingUsd:.43,nextEvaluationAt:nextAt}});
  const f=fixture({fetcher:(call,{storage})=>{
    if(call.path==='/supervisor/status')return response(current());
    if(call.path.endsWith('/acknowledge-failure')){assert.equal(JSON.parse(storage.get(reviewKey)).id,id);return pending.promise;}
    if(call.path==='/supervisor/runs/'+id)return response({run:existing});
  }});await tick();
  assert.equal(f.mutations().length,0);assert.equal(f.$('supervisor-acknowledge').hidden,false);assert.match(f.$('supervisor-run-detail').textContent,/recibo e o uso/);
  const first=f.click('supervisor-acknowledge'),second=f.click('supervisor-acknowledge');assert.equal(f.mutations().length,1);
  assert.equal(f.mutations()[0].path,'/supervisor/runs/'+id+'/acknowledge-failure');assert.deepEqual(f.mutations()[0].body,{confirmed:true});
  assert.deepEqual(Object.keys(JSON.parse(f.storage.get(reviewKey))).sort(),['createdAt','id']);
  existing=knownFailure({reviewed:true,reviewedAt:'2026-09-13T13:00:00Z'});pending.resolve(response({run:existing}));await first;await second;
  assert.equal(f.storage.has(reviewKey),false);assert.equal(f.storage.has(key),false);assert.equal(f.evaluations().length,0);
  assert.match(f.$('supervisor-run-state').textContent,/Falha · revisão encerrada/);assert.match(f.$('supervisor-history').textContent,/Falha · revisão encerrada/);
  assert.match(f.$('supervisor-budget').textContent,/0,07/);assert.match(f.$('supervisor-run-cost').textContent,/0,07/);
  assert.equal(f.$('supervisor-evaluate').disabled,true);assert.match(f.$('supervisor-evaluation-detail').textContent,/Próxima avaliação/);
});

test('unknown, incomplete and unproven failures never offer or dispatch acknowledgement',async()=>{
  for(const existing of [run('unknown',{failureReviewable:true,actualUsd:.07}),run('submitting',{failureReviewable:true,actualUsd:.07}),knownFailure({failureReviewable:false}),knownFailure({actualUsd:null}),knownFailure({notSubmitted:true}),knownFailure({reviewed:undefined}),knownFailure({reviewed:true,reviewedAt:null}),run('needs_review',{failureReviewable:true,actualUsd:.07})]){
    const f=fixture({initial:status({recent:[existing]}),fetcher:call=>call.path==='/supervisor/runs/'+id?response({run:existing}):undefined});await tick();
    assert.equal(f.$('supervisor-acknowledge').hidden,true);await f.click('supervisor-acknowledge');assert.equal(f.mutations().length,0);
  }
});

test('uncertain acknowledgement survives reload and only reviewed GET readback releases it without another POST',async()=>{
  let existing=knownFailure();const storage=new Map();const fetcher=call=>{
    if(call.path==='/supervisor/status')return response(status({recent:[existing]}));
    if(call.path==='/supervisor/runs/'+id)return response({run:existing});
    if(call.path.endsWith('/acknowledge-failure'))throw Error('Conexão interrompida');
  };
  const first=fixture({storage,fetcher});await tick();await first.click('supervisor-acknowledge');await first.click('supervisor-acknowledge');
  assert.equal(first.mutations().length,1);assert.equal(storage.has(reviewKey),true);assert.equal(first.$('supervisor-acknowledge').disabled,true);
  const reload=fixture({storage,fetcher});await tick();assert.equal(reload.mutations().length,0);
  await reload.click('supervisor-acknowledge');await reload.click('supervisor-reconcile');assert.equal(reload.mutations().length,0);assert.equal(storage.has(reviewKey),true);
  existing=knownFailure({reviewed:true,reviewedAt:'2026-09-13T13:00:00Z'});await reload.click('supervisor-reconcile');
  assert.equal(storage.has(reviewKey),false);assert.equal(storage.has(key),false);assert.equal(reload.mutations().length,0);
  assert.equal(reload.$('supervisor-evaluate').disabled,false);assert.match(reload.$('supervisor-run-state').textContent,/Falha · revisão encerrada/);
});

test('acknowledgement does not accept a different ID, unknown result or missing review confirmation',async()=>{
  for(const result of [knownFailure({reviewed:true,reviewedAt:'2026-09-13T13:00:00Z',id:otherId}),knownFailure(),knownFailure({reviewed:true,reviewedAt:null}),run('unknown',{failureReviewable:true,reviewed:true,reviewedAt:'2026-09-13T13:00:00Z',actualUsd:.07})]){
    const existing=knownFailure();const f=fixture({initial:status({recent:[existing]}),fetcher:call=>{
      if(call.path.endsWith('/acknowledge-failure'))return response({run:result});
      if(call.path==='/supervisor/runs/'+id)return response({run:existing});
    }});await tick();await f.click('supervisor-acknowledge');assert.equal(f.storage.has(reviewKey),true);assert.equal(f.$('supervisor-evaluate').disabled,true);
    await f.click('supervisor-acknowledge');assert.equal(f.mutations().length,1);
  }
});

test('reviewed failure from server history is not treated as completed or automatically acknowledged again',async()=>{
  const existing=knownFailure({reviewed:true,reviewedAt:'2026-09-13T13:00:00Z'});const f=fixture({initial:status({recent:[existing]})});await tick();
  assert.equal(f.storage.has(key),false);assert.equal(f.$('supervisor-acknowledge').hidden,true);assert.equal(f.mutations().length,0);
  assert.match(f.$('supervisor-history').textContent,/Falha · revisão encerrada/);assert.doesNotMatch(f.$('supervisor-history').textContent,/Concluída/);
});

test('unavailable storage blocks an acknowledgement before sending any mutation',async()=>{
  const existing=knownFailure();const f=fixture({storageFails:true,initial:status({recent:[existing]}),fetcher:call=>call.path==='/supervisor/runs/'+id?response({run:existing}):undefined});await tick();
  await f.click('supervisor-acknowledge');assert.equal(f.mutations().length,0);assert.match(f.$('supervisor-error').textContent,/revisão não foi enviada/);
});

test('markup keeps accessible labels and scoped mobile controls without an apply or promotion action',()=>{
  assert.match(html,/id="supervisor-objective"[^>]*minlength="12"[^>]*maxlength="1000"/);
  assert.match(html,/for="supervisor-daily-cap"/);assert.match(html,/for="supervisor-objective"/);
  assert.match(html,/id="supervisor-error"[^>]*role="alert"/);assert.match(html,/id="supervisor-notice"[^>]*aria-live="polite"/);
  assert.match(css,/supervisor-panel[^}]*min-width:\s*0/);assert.match(css,/min-height:\s*44px/);
  assert.match(css,/@media\s*\(max-width:\s*540px\)/);assert.match(css,/:focus-visible/);
  const supervisorHtml=html.slice(html.indexOf('id="supervisor-panel"'),html.indexOf('<div class="grid">'));
  assert(!/\bid="[^"]*(?:apply|promote)/i.test(supervisorHtml));
});
