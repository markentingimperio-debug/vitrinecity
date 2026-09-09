import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const settle=async()=>{await tick();await tick();};
const walk=el=>[el,...el.children.flatMap(walk)];
let sequence=0;
async function boot(t,{conflict=false}={}){
  const previous=Object.fromEntries(['document','window','location','fetch','confirm'].map(key=>[key,globalThis[key]]));
  t.after(()=>{for(const [key,value]of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
  let document;
  class Element{
    constructor(tag='div'){this.tagName=tag;this.children=[];this.listeners={};this.dataset={};this.attrs={};this.value='';this.hidden=false;this.checked=false;this.disabled=false;this.textContent='';this.open=false;this.isConnected=true;}
    append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;}setAttribute(key,value){this.attrs[key]=value;}removeAttribute(){}scrollIntoView(){}focus(){document.activeElement=this;}reportValidity(){return true;}
    addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
    dispatch(type){const event={target:this,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};for(const fn of this.listeners[type]||[])fn(event);return event;}
    showModal(){this.open=true;}close(){this.open=false;this.dispatch('close');}
    querySelector(selector){const field=/^\[data-field=([^\]]+)\]$/.exec(selector)?.[1];return walk(this).find(el=>field?el.dataset.field===field:selector==='[data-choose-image]'&&el.dataset.chooseImage!==undefined)||null;}
  }
  const html=fs.readFileSync(new URL('../public/admin-web-stories.html',import.meta.url),'utf8');
  const nodes=Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(([,id])=>[id,new Element()]));
  nodes['source-search'].elements={q:{value:''},group:{value:'all'}};nodes['source-group'].value='all';
  nodes['story-form'].elements=Object.fromEntries(['title','description','cta','ctaLabel','homeCta'].map(name=>[name,new Element()]));
  document={activeElement:null,getElementById:id=>{assert.ok(nodes[id],id);return nodes[id];},createElement:tag=>new Element(tag),body:new Element('body'),querySelectorAll:selector=>{
    if(selector==='#source-manual button,#story-library button,#editor button')return [nodes.regenerate,nodes.publish,nodes['save-story']];
    if(selector.includes('#story-form input'))return Object.values(nodes['story-form'].elements);
    return [];
  }};
  const item={id:'story',article_id:'article',revision:7,published_at:'2026-09-09T20:00:00Z',sourceAvailable:true,url:'/stories/story',draft:{title:'História <com texto> & revisão',description:'Descrição completa para testar uma história em revisão.',cta:'Ler artigo',homeCta:'',pages:Array.from({length:10},()=>({text:'Conteúdo factual revisado para esta página.',image:'/uploads/generated-videos/original.png',alt:'Ilustração temática',imageCredit:'Ilustração IA'}))}};
  const calls=[];let waitForRequest=null;
  globalThis.document=document;globalThis.window={addEventListener(){}};globalThis.location={search:'?story=story'};
  globalThis.confirm=()=>{throw Error('Browser-native confirmation must not be used for regeneration');};
  globalThis.fetch=async(url,options={})=>{
    assert.ok(url.startsWith('/api/admin/web-stories'));calls.push({url,options});
    if(url.endsWith('/regenerate')){
      if(waitForRequest)await waitForRequest;
      if(conflict)return {ok:false,status:409,json:async()=>({error:'A versão mudou. Reabra a história.'})};
      item.revision++;item.draft.pages[0].text='Texto atual da fonte, pronto para uma nova revisão.';
      return {ok:true,status:200,json:async()=>structuredClone(item)};
    }
    return {ok:true,status:200,json:async()=>url==='/api/admin/web-stories/story'?structuredClone(item):{items:url==='/api/admin/web-stories'?[structuredClone(item)]:[],nextOffset:null}};
  };
  await import('../public/admin-web-stories.js?regeneration-test='+sequence++);await settle();
  return {nodes,calls,item,document,html,field:()=>nodes.pages.children[0].querySelector('[data-field=text]'),defer:promise=>{waitForRequest=promise;},posts:()=>calls.filter(call=>call.options.method==='POST'),open(){nodes.regenerate.focus();nodes.regenerate.dispatch('click');}};
}

test('opening and cancelling the in-page confirmation keeps unsaved edits and makes no mutation',async t=>{
  const f=await boot(t);f.field().value='Minha edição ainda não salva.';f.nodes['story-form'].dispatch('input');
  f.open();assert.equal(f.nodes['regenerate-confirm'].open,true);assert.equal(f.document.activeElement,f.nodes['regenerate-cancel']);
  assert.equal(f.nodes['regenerate-confirm-story'].textContent,'História: História <com texto> & revisão');
  assert.equal(f.nodes.regenerate.disabled,true);assert.equal(f.nodes['regenerate-cancel'].disabled,false);assert.equal(f.nodes['regenerate-accept'].disabled,false);
  assert.equal(f.posts().length,0);f.nodes['regenerate-cancel'].dispatch('click');await settle();
  assert.equal(f.nodes['regenerate-confirm'].open,false);assert.equal(f.field().value,'Minha edição ainda não salva.');assert.equal(f.item.revision,7);
  assert.equal(f.document.activeElement,f.nodes.regenerate);assert.equal(f.nodes.regenerate.disabled,false);assert.equal(f.posts().length,0);
  assert.match(f.nodes.status.textContent,/cancelada.*mantidas/);
});

test('Escape cancels through the dialog cancel event and restores focus without a request',async t=>{
  const f=await boot(t);f.open();const event=f.nodes['regenerate-confirm'].dispatch('cancel');await settle();
  assert.equal(event.defaultPrevented,true);assert.equal(f.nodes['regenerate-confirm'].open,false);assert.equal(f.posts().length,0);assert.equal(f.document.activeElement,f.nodes.regenerate);
});

test('confirmation sends exactly one POST with the saved revision and requires another review',async t=>{
  const f=await boot(t);let release;f.defer(new Promise(resolve=>{release=resolve;}));
  f.nodes.reviewed.checked=true;f.nodes.rights.checked=true;f.open();f.nodes['regenerate-accept'].dispatch('click');f.nodes['regenerate-accept'].dispatch('click');await settle();
  f.nodes.regenerate.dispatch('click');assert.equal(f.posts().length,1);assert.equal(f.nodes.regenerate.disabled,true);
  const request=f.posts()[0];assert.equal(request.url,'/api/admin/web-stories/story/regenerate');assert.equal(request.options.credentials,'same-origin');assert.deepEqual(JSON.parse(request.options.body),{revision:7,confirmed:true});
  release();await settle();assert.equal(f.item.revision,8);assert.equal(f.nodes.reviewed.checked,false);assert.equal(f.nodes.rights.checked,false);assert.equal(f.nodes.publish.disabled,true);
  assert.equal(f.nodes['public-link'].hidden,false);assert.match(f.nodes['revision-note'].textContent,/Versão salva 8.*há uma versão publicada/);assert.equal(f.posts().length,1);assert.equal(f.document.activeElement,f.nodes.regenerate);
});

test('a stale revision is displayed as an error and is not retried or published',async t=>{
  const f=await boot(t,{conflict:true});f.open();f.nodes['regenerate-accept'].dispatch('click');await settle();
  assert.equal(f.posts().length,1);assert.deepEqual(JSON.parse(f.posts()[0].options.body),{revision:7,confirmed:true});assert.equal(f.item.revision,7);
  assert.equal(f.nodes.status.textContent,'A versão mudou. Reabra a história.');assert.equal(f.nodes['regenerate-confirm'].open,false);assert.equal(f.nodes.regenerate.disabled,false);
});

test('dialog markup has an accessible name, consequence text and responsive touch targets',async t=>{
  const f=await boot(t);assert.match(f.html,/<dialog id="regenerate-confirm"[^>]*aria-labelledby="regenerate-confirm-title"[^>]*aria-describedby="regenerate-confirm-description"/);
  assert.match(f.html,/A publicação atual permanece/);assert.match(f.html,/id="regenerate-cancel" type="button"/);assert.match(f.html,/id="regenerate-accept" type="button"/);
  const css=fs.readFileSync(new URL('../public/vitriny-web-stories.css',import.meta.url),'utf8');assert.match(css,/\.story-confirm\{width:min\(540px,calc\(100% - 32px\)\)/);assert.match(css,/\.story-confirm button\{min-height:46px\}/);
});
