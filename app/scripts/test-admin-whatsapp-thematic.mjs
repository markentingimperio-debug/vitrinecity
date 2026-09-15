import test from 'node:test';
import assert from 'node:assert/strict';
import {mountThematicGroups,thematicPublicPage} from '../public/admin-whatsapp-thematic.js';
const origin='https://vitrinecity.com',tick=()=>new Promise(resolve=>setImmediate(resolve));
const groups=Array.from({length:4},(_,i)=>({jid:(100+i)+'@g.us',name:i?'Grupo '+i:'<b>Grupo 0</b>',needsReview:false}));
const settings=(enabled=false,groupJids=[])=>({enabled,groupJids,groups});
const previews=groups.map((g,i)=>({groupJid:g.jid,groupName:g.name,reason:'',message:'Texto público '+i,url:origin+'/artigo/receita-'+i,scheduledAt:'2026-09-11T16:05:00Z'}));
const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
function fixture(t,fetcher){
  class Element{
    constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.listeners={};this.dataset={};this.attrs={};this.disabled=false;this.checked=false;this.textContent='';}
    append(...items){this.children.push(...items);}replaceChildren(...items){this.children=items;}
    setAttribute(name,value){this.attrs[name]=value;}
    addEventListener(name,fn){(this.listeners[name]||=new Set()).add(fn);}removeEventListener(name,fn){this.listeners[name]?.delete(fn);}
    dispatch(name){for(const fn of this.listeners[name]||[])fn({target:this});}
  }
  const document={createElement:tag=>new Element(tag),defaultView:{location:{origin}}},root=new Element(),nodes={};
  root.ownerDocument=document;for(const id of ['Notice','Groups','Preview','PreviewButton','Activate','Pause','Reload','State'])nodes[id]=new Element();root.querySelector=id=>nodes[id.slice(3)];
  const controller=mountThematicGroups(root,{document,fetcher,origin});t.after(()=>controller.destroy());
  return {nodes,select(index){const el=nodes.Groups.children[index].children[0];el.checked=true;el.dispatch('change');},controller};
}
test('opening the panel makes one read, shows four exact destinations and never activates by itself',async t=>{
  const calls=[],f=fixture(t,async(url,options)=>{calls.push({url,options});return response(settings());});await tick();
  assert.equal(calls.length,1);assert.equal(calls[0].options.method,undefined);assert.equal(f.nodes.Groups.children.length,4);
  assert.equal(f.nodes.Groups.children[0].children[1].textContent,'<b>Grupo 0</b>');assert(f.nodes.Groups.children.every(row=>!row.children[0].checked));
  assert.equal(f.nodes.Activate.disabled,true);assert.match(f.nodes.State.textContent,/Pausada/);
});
test('preview retains explicit selection, shows content and is required before activation',async t=>{
  const calls=[],f=fixture(t,async(url,options)=>{calls.push({url,options});return response(url.endsWith('/preview')?{settings:settings(),groups:previews}:settings());});await tick();
  f.select(1);assert.equal(f.nodes.Activate.disabled,true);f.nodes.PreviewButton.dispatch('click');await tick();
  assert.equal(f.nodes.Groups.children[1].children[0].checked,true);assert.equal(f.nodes.Preview.children.length,4);assert.equal(f.nodes.Activate.disabled,false);
  assert(calls.every(call=>!call.options.method));assert.equal(f.nodes.Preview.children[0].children.at(-1).href,previews[0].url);
});
test('explicit activation guards double clicks and an uncertain response requires readback before another mutation',async t=>{
  const calls=[];let settle,active=false;
  const f=fixture(t,async(url,options)=>{calls.push({url,options});if(options.method){active=true;return new Promise((_resolve,reject)=>{settle=reject;});}return response(url.endsWith('/preview')?{settings:settings(active,active?[groups[0].jid]:[]),groups:previews}:settings(active,active?[groups[0].jid]:[]));});await tick();
  f.select(0);f.nodes.PreviewButton.dispatch('click');await tick();f.nodes.Activate.dispatch('click');f.nodes.Activate.dispatch('click');
  assert.equal(calls.filter(call=>call.options.method==='PUT').length,1);assert.deepEqual(JSON.parse(calls.at(-1).options.body),{enabled:true,groupJids:[groups[0].jid]});
  settle(Error('Conexão interrompida'));await tick();assert.equal(f.nodes.Activate.disabled,true);assert.equal(f.nodes.Pause.disabled,true);
  f.nodes.Activate.dispatch('click');f.nodes.Pause.dispatch('click');await tick();assert.equal(calls.filter(call=>call.options.method).length,1);
  f.nodes.Reload.dispatch('click');await tick();assert.match(f.nodes.State.textContent,/Ativa/);assert.equal(f.nodes.Pause.disabled,false);assert.match(f.nodes.Notice.textContent,/Estado atualizado/);
});
test('pause is explicit, keeps receipts honest and sends an empty selected list once',async t=>{
  const calls=[],f=fixture(t,async(url,options)=>{calls.push({url,options});return response(settings(!options.method,options.method?[]:groups.map(x=>x.jid)));});await tick();
  f.nodes.Pause.dispatch('click');f.nodes.Pause.dispatch('click');await tick();
  assert.equal(calls.filter(call=>call.options.method).length,1);assert.deepEqual(JSON.parse(calls.at(-1).options.body),{enabled:false,groupJids:[]});
  assert.match(f.nodes.State.textContent,/Pausada/);assert.match(f.nodes.Notice.textContent,/já estavam em andamento/);
});
test('permission/source and uncertain receipt review blocks activation; unsafe links never become anchors',async t=>{
  for(const reason of ['group_permission_or_name','no_published_source','prior_result_needs_review']){
    const f=fixture(t,async url=>response(url.endsWith('/preview')?{settings:settings(),groups:previews.map((row,i)=>i?row:{...row,reason,url:'javascript:alert(1)'})}:settings()));await tick();
    f.select(0);f.nodes.PreviewButton.dispatch('click');await tick();assert.equal(f.nodes.Activate.disabled,true);assert(!f.nodes.Preview.children[0].children.some(x=>x.tagName==='A'));
  }
  for(const url of ['javascript:alert(1)','https://attacker.test/artigo/x','/admin','/api/users'])assert.equal(thematicPublicPage(url,origin),'');
});
