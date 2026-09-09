import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const walk=el=>[el,...el.children.flatMap(walk)];
let sequence=0;
async function boot(t,{imageCredit,layout}={}){
  const previous=Object.fromEntries(['document','window','location','fetch'].map(key=>[key,globalThis[key]]));
  t.after(()=>{for(const [key,value]of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
  class Element{
    constructor(tag='div'){this.tagName=tag;this.children=[];this.listeners={};this.dataset={};this.attrs={};this.value='';this.hidden=false;this.checked=false;this.disabled=false;this.textContent='';}
    append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;}setAttribute(key,value){this.attrs[key]=value;}removeAttribute(){}scrollIntoView(){}focus(){}reportValidity(){return true;}
    addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}dispatch(type){for(const fn of this.listeners[type]||[])fn({target:this,preventDefault(){}});}
    querySelector(selector){const field=/^\[data-field=([^\]]+)\]$/.exec(selector)?.[1];return walk(this).find(el=>field?el.dataset.field===field:selector==='[data-choose-image]'&&el.dataset.chooseImage!==undefined)||null;}
  }
  const html=fs.readFileSync(new URL('../public/admin-web-stories.html',import.meta.url),'utf8');
  const nodes=Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(([,id])=>[id,new Element()]));
  nodes['source-search'].elements={q:{value:''},group:{value:'all'}};nodes['source-group'].value='all';
  nodes['story-form'].elements=Object.fromEntries(['title','description','cta','ctaLabel','homeCta'].map(name=>[name,new Element()]));
  const document={getElementById:id=>{assert.ok(nodes[id],id);return nodes[id];},createElement:tag=>new Element(tag),body:new Element('body'),querySelectorAll:selector=>selector.includes('#story-form select')?walk(nodes.pages).filter(el=>el.tagName==='select'):[]};
  const item={id:'story',article_id:'article',revision:1,sourceAvailable:true,url:'/stories/story',draft:{title:'Título de teste',description:'Descrição completa para testar uma história em revisão.',cta:'Ler artigo',homeCta:'',pages:Array.from({length:10},()=>({text:'Conteúdo factual revisado para a página desta história.',image:'/uploads/generated-videos/original.png',alt:'Ilustração temática',...(imageCredit?{imageCredit}:{}),...(layout?{layout}:{})}))}};
  const calls=[];let deferSave=null;
  globalThis.document=document;globalThis.window={addEventListener(){}};globalThis.location={search:'?story=story'};
  globalThis.fetch=async(url,options={})=>{
    assert.ok(url.startsWith('/api/admin/web-stories'));calls.push({url,options});
    if(options.method==='PUT'){
      const data=JSON.parse(options.body);if(deferSave)await deferSave;
      item.draft=data.draft;item.revision++;
    }
    return {ok:true,status:200,json:async()=>url==='/api/admin/web-stories/story'?structuredClone(item):{items:[],nextOffset:null}};
  };
  await import('../public/admin-web-stories.js?credit-test='+sequence++);await tick();await tick();
  return {nodes,calls,item,field:(index,name)=>nodes.pages.children[index].querySelector('[data-field='+name+']'),save:async()=>{nodes['story-form'].dispatch('submit');await tick();await tick();return JSON.parse(calls.findLast(call=>call.options.method==='PUT').options.body).draft;},defer:promise=>{deferSave=promise;}};
}
test('new uploads default to no credit; explicit selection invalidates confirmations and saves known editorial layout',async t=>{
  const f=await boot(t,{layout:'editorial'}),credit=f.field(0,'credit');
  assert.equal(credit.value,'');assert.deepEqual(credit.children.map(option=>option.textContent),['Sem crédito','Ilustração IA','Foto do catálogo','Imagem do artigo']);
  assert.ok(f.calls.every(call=>!call.options.method));f.nodes.reviewed.checked=true;f.nodes.rights.checked=true;
  credit.value='Ilustração IA';credit.dispatch('change');assert.equal(f.nodes.reviewed.checked,false);assert.equal(f.nodes.rights.checked,false);assert.equal(f.nodes.publish.disabled,true);
  const draft=await f.save();assert.equal(draft.pages[0].imageCredit,'Ilustração IA');assert.equal(draft.pages[1].imageCredit,undefined);assert.ok(draft.pages.every(page=>page.layout==='editorial'));
});
test('all supported existing credits survive editing; no credit explicitly removes one',async t=>{
  const f=await boot(t,{imageCredit:'Imagem do artigo'});assert.equal(f.field(0,'credit').value,'Imagem do artigo');
  f.field(1,'credit').value='Foto do catálogo';f.field(1,'credit').dispatch('change');f.field(2,'credit').value='';f.field(2,'credit').dispatch('change');
  const draft=await f.save();assert.equal(draft.pages[0].imageCredit,'Imagem do artigo');assert.equal(draft.pages[1].imageCredit,'Foto do catálogo');assert.equal(draft.pages[2].imageCredit,undefined);
});
test('changing an image clears its old attribution until a human chooses again',async t=>{
  const f=await boot(t,{imageCredit:'Ilustração IA',layout:'editorial'}),address=f.field(0,'image');address.value='/assets/recipes/another.jpg';address.dispatch('input');assert.equal(f.field(0,'credit').value,'');
  let draft=await f.save();assert.equal(draft.pages[0].imageCredit,undefined);assert.equal(draft.pages[0].layout,'editorial');
  f.field(0,'credit').value='Foto do catálogo';f.field(0,'credit').dispatch('change');draft=await f.save();assert.equal(draft.pages[0].imageCredit,'Foto do catálogo');
});
test('unknown attribution and layout cannot enter the saved draft; busy save locks credit selection',async t=>{
  const f=await boot(t,{imageCredit:'<script>bad</script>',layout:'injected'});assert.equal(f.field(0,'credit').value,'');
  f.field(0,'credit').value='invented';f.field(0,'credit').dispatch('change');let release;f.defer(new Promise(resolve=>{release=resolve;}));
  const pending=f.save();await tick();assert.equal(f.field(0,'credit').disabled,true);release();const draft=await pending;
  assert.equal(draft.pages[0].imageCredit,undefined);assert.equal(draft.pages[0].layout,undefined);assert.equal(f.field(0,'credit').disabled,false);
});
