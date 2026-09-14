import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createGrowthSkill} from '../vitriny-neural/skills/growth.js';

const html=readFileSync(new URL('../public/admin-vitriny-neural.html',import.meta.url),'utf8');
const script=readFileSync(new URL('../public/vitriny-neural-admin.js',import.meta.url),'utf8');
const actions=['diagnose','campaign-plan','content-plan','seo-plan','experiment','metric-review'];
const prompt='Prepare material sobre organização da mesa.';
const response=data=>({ok:true,status:200,json:async()=>structuredClone(data)});
const tick=async()=>{for(let n=0;n<5;n++)await new Promise(resolve=>setImmediate(resolve));};
class Element{
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this._text='';this.value='';this.disabled=false;this.checked=false;this.hidden=false;this.style={};}
  set textContent(value){this._text=String(value);this.children=[];}get textContent(){return this._text+this.children.map(child=>child.textContent??String(child)).join('');}
  set innerHTML(_value){throw Error('HTML rendering is forbidden in this fixture.');}
  append(...children){this.children.push(...children);}replaceChildren(...children){this._text='';this.children=children;}
  setAttribute(name,value){this.attributes[name]=String(value);}getAttribute(name){return this.attributes[name];}
  reset(){}focus(){this.focused=true;}
}
function fixture({fetcher}={}){
  const nodes=new Map(),calls=[],invocations=[],storage=new Map();
  for(const match of html.matchAll(/<([a-z][a-z0-9-]*)\b[^>]*\bid="([^"]+)"[^>]*>/gi)){
    const node=new Element(match[1]);node.id=match[2];node.disabled=/\sdisabled(?:\s|>)/.test(match[0]);node.hidden=/\shidden(?:\s|>)/.test(match[0]);nodes.set(node.id,node);
  }
  for(const match of html.matchAll(/<select\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/select>/gi)){
    const options=[...match[2].matchAll(/<option\b[^>]*\bvalue="([^"]*)"[^>]*>/gi)];
    nodes.get(match[1]).value=(options.find(option=>/\sselected(?:\s|>)/.test(option[0]))||options[0])?.[1]||'';
  }
  const $=name=>nodes.get(name),document={getElementById:$,createElement:tag=>new Element(tag)};
  const reads={
    '/status':{service:{enabled:true,mode:'shadow'},readiness:{recommendedMode:'shadow'},skills:{providers:[]}},
    '/skills':{skills:[],providers:[]},'/models/qualifications':{items:[]},'/benchmark':{recent:[]},
    '/web-research/status':{configured:false},'/web-research/candidates?status=candidate&limit=50':{items:[]},
    '/training/status':{counts:{}},'/training/examples?status=candidate&limit=100':{items:[]},
    '/supervisor/status':{enabled:false,configured:false,paused:false,revision:1,automaticDaily:false,automatic:{},limits:{},quote:{},budget:{},availability:{state:'unknown'},recent:[]}
  };
  const context={document,Intl,Date,URLSearchParams,performance:{now:()=>0},AbortSignal:{timeout:()=>undefined},
    sessionStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    location:{assign:()=>{throw Error('Unexpected navigation');}},setInterval:()=>1,setTimeout:()=>1,clearTimeout:()=>{},
    fetch:async(url,options)=>{
      const call={path:url.replace('/api/admin/vitriny-neural',''),method:options.method,body:options.body?JSON.parse(options.body):null};calls.push(call);
      assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');
      if(call.method==='GET'){assert(Object.hasOwn(reads,call.path),'Unexpected GET '+call.path);return response(reads[call.path]);}
      assert.equal(options.headers['x-neural-request'],'1');assert.equal(options.headers['content-type'],'application/json');
      assert.match(call.path,/^\/skills\/[a-z.]+\/run$/);
      const overridden=await fetcher?.(call);if(overridden!==undefined)return overridden;
      if(call.path==='/skills/growth.optimizer/run'){
        const result=await createGrowthSkill().execute({input:call.body,invoke:async(capability,input,options)=>{
          invocations.push({capability,input,options});return {provider:'fixture',output:{text:'Rascunho sintético para revisão.'},attempts:[]};
        }});
        return response({ok:true,evaluation:true,result});
      }
      return response({ok:true,evaluation:true,result:{provider:'fixture',output:{text:'Resposta sintética.'}}});
    }
  };
  context.window=context;vm.runInNewContext(script,context,{filename:'vitriny-neural-admin.js'});
  return {$,calls,invocations,posts:()=>calls.filter(call=>call.method==='POST'),
    change(name,value){$(name).value=value;$(name).onchange?.();},
    async submit(){await $('test-form').onsubmit({preventDefault(){}});await tick();}};
}

test('growth content requests do not inherit experiment measurement requirements; the other actions retain them',async()=>{
  for(const action of actions){
    let captured;
    await createGrowthSkill().execute({input:{action,objective:prompt,constraints:['somente rascunho'],metrics:{ctr:.03}},invoke:async(capability,input)=>{
      captured={capability,input};return {provider:'fixture',output:{text:'fixture'},attempts:[]};
    }});
    assert.equal(captured.capability,'growth.'+action);assert.equal(captured.input.requireMeasurementPlan,action!=='content-plan',action);
    assert.deepEqual(captured.input.constraints,['somente rascunho']);assert.deepEqual(captured.input.metrics,{ctr:.03});
  }
});

test('the skill keeps its diagnose default and rejects invalid action or input before invoking a provider',async()=>{
  let calls=0,captured;
  const invoke=async(capability,input)=>{calls++;captured={capability,input};return {provider:'fixture',output:{text:'fixture'},attempts:[]};};
  const skill=createGrowthSkill();await skill.execute({input:{objective:prompt},invoke});
  assert.equal(captured.capability,'growth.diagnose');assert.equal(captured.input.requireMeasurementPlan,true);
  for(const input of [{action:'publish',objective:prompt},{action:'content-plan',objective:'x'},{action:'content-plan',objective:prompt,constraints:['bad\nconstraint']}]){
    await assert.rejects(skill.execute({input,invoke}));
  }
  assert.equal(calls,1);
});

test('the console exposes a labelled explicit growth action, without sending on open or selection',async()=>{
  assert.match(html,/<label\s+for="growth-action">/);assert.match(html,/<select\b[^>]*id="growth-action"[^>]*required[^>]*disabled/);
  const select=html.match(/<select\b[^>]*id="growth-action"[^>]*>([\s\S]*?)<\/select>/)[1];
  assert.deepEqual([...select.matchAll(/<option\b[^>]*value="([^"]*)"/g)].map(match=>match[1]),['',...actions]);
  const f=fixture();await tick();assert.equal(f.$('growth-action-field').hidden,true);assert.equal(f.$('growth-action').disabled,true);
  f.change('area','growth');assert.equal(f.$('growth-action-field').hidden,false);assert.equal(f.$('growth-action').disabled,false);
  f.change('growth-action','content-plan');assert.equal(f.posts().length,0);
});

test('the selected growth action reaches the real skill capability instead of always becoming diagnose',async()=>{
  for(const action of actions){
    const f=fixture();await tick();f.change('area','growth');f.change('growth-action',action);f.$('prompt').value=prompt;await f.submit();
    assert.equal(f.posts().length,1);assert.equal(f.posts()[0].path,'/skills/growth.optimizer/run');assert.equal(f.posts()[0].body.action,action);
    assert.equal(f.invocations.length,1);assert.equal(f.invocations[0].capability,'growth.'+action);assert.equal(f.invocations[0].input.objective,prompt);
    assert.equal(f.invocations[0].input.requireMeasurementPlan,action!=='content-plan');assert.equal(f.$('mode').textContent,'SHADOW');
  }
});

test('missing or unsupported growth action cannot submit even when native form validation is bypassed',async()=>{
  for(const action of ['','publish','CONTENT-PLAN']){
    const f=fixture();await tick();f.change('area','growth');f.change('growth-action',action);f.$('prompt').value=prompt;await f.submit();
    assert.equal(f.posts().length,0);assert.equal(f.$('error').hidden,false);assert.equal(f.$('growth-action').focused,true);assert.equal(f.$('run-test').disabled,false);
  }
});

test('leaving growth hides its selector and preserves the existing actions and safeguards in other areas',async()=>{
  const expected={support:['support.assistant','draft-reply'],code:['code.engineer','analyze'],research:['research.supervised','verify'],commerce:['commerce.advisor','seller-diagnose'],ranking:['ranking.optimizer','evaluate'],media:['media.generate',undefined]};
  for(const [area,[skill,action]] of Object.entries(expected)){
    const f=fixture();await tick();f.change('area','growth');f.change('growth-action','content-plan');f.change('area',area);
    assert.equal(f.$('growth-action-field').hidden,true);assert.equal(f.$('growth-action').disabled,true);assert.equal(f.posts().length,0);
    if(area==='media')assert.match(f.$('test-hint').textContent,/provider de imagem/);
    f.$('prompt').value=prompt;await f.submit();assert.equal(f.posts().length,1);assert.equal(f.posts()[0].path,'/skills/'+skill+'/run');assert.equal(f.posts()[0].body.action,action);
    if(area==='code'){assert.equal(f.posts()[0].body.dryRun,true);assert.equal(f.posts()[0].body.requireTests,true);}
    if(area==='ranking')assert.equal(f.posts()[0].body.offlineOnly,true);
  }
});

test('a pending growth request stays single and untrusted output is rendered as text',async()=>{
  let resolve;const pending=new Promise(done=>{resolve=done;});
  const f=fixture({fetcher:()=>pending});await tick();f.change('area','growth');f.change('growth-action','content-plan');f.$('prompt').value=prompt;
  const first=f.submit(),second=f.submit();assert.equal(f.posts().length,1);assert.equal(f.$('run-test').disabled,true);
  const text='<img src=x onerror=alert(1)> Apenas um rascunho.';
  resolve(response({ok:true,evaluation:true,result:{provider:'fixture',output:{text}}}));await first;await second;
  assert.equal(f.$('test-output').textContent,text);assert.equal(f.$('test-output').children.length,0);assert.equal(f.$('run-test').disabled,false);
  assert.equal(f.$('test-response').getAttribute('aria-busy'),'false');assert.equal(f.posts().length,1);
});
