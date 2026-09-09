import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mountEditorialSources,editorialSourceHref,editorialSourcesSnapshot,canSyncEditorialSources,editorialSourceState} from '../public/admin-editorial-sources.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const response=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
const watch='https://www.youtube.com/watch?v=abcdefghijk';
const channel={id:'news',name:'Canal brasileiro',topic:'news',channelId:'UCabcdefghijklmnopqrstuv',url:'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv',status:'ready',lastCheckedAt:'2026-09-09T18:00:00Z',lastSuccessAt:'2026-09-09T18:00:00Z',errorCode:null,itemsCount:2};
const item={key:'video:a',title:'<img src=x onerror=alert(1)>',topic:'news',channelName:channel.name,publishedAt:'2026-09-09T10:00:00Z',url:watch,views:null,popularityScore:null,sourceStatus:'discovery_only',editorUrl:'/admin-web-stories?source=unsafe-claim',sourceLinks:[]};
const sample=changes=>({channels:[{...channel}],items:[{...item}],busy:false,nextAt:null,lastCheckedAt:'2026-09-09T18:00:00Z',controls:{canSync:true,reason:'ready',nextAt:null},pagination:{offset:0,limit:12,total:1,nextOffset:null},...changes});
const walk=element=>[element,...element.children.flatMap(walk)];
function fixture(t,fetcher){
  class Element{
    constructor(tag='div'){this.tagName=tag;this.children=[];this.listeners={};this.dataset={};this.attrs={};this.value='';this.checked=false;this.disabled=false;this.hidden=false;this.textContent='';}
    append(...items){this.children.push(...items);}replaceChildren(...items){this.children=items;}setAttribute(name,value){this.attrs[name]=value;}
    addEventListener(name,fn){(this.listeners[name]||=new Set()).add(fn);}removeEventListener(name,fn){this.listeners[name]?.delete(fn);}dispatch(name){for(const fn of this.listeners[name]||[])fn({preventDefault(){},target:this});}
  }
  const document=new Element(),window=new Element(),root=new Element(),nodes={};document.hidden=false;document.createElement=tag=>new Element(tag);document.defaultView=window;root.ownerDocument=document;
  const ids=['Message','Checked','NextCheck','Channels','Items','Sync','Refresh','Form','Query','Topic','Sort','Search','Previous','Next','Page'];for(const id of ids)nodes[id]=new Element();nodes.Topic.value='all';nodes.Sort.value='recent';root.querySelector=selector=>nodes[selector.slice(3)];
  const timers=new Map();let timerId=0;const controller=mountEditorialSources(root,{fetcher,document,window,setTimer:fn=>{timers.set(++timerId,fn);return timerId;},clearTimer:id=>timers.delete(id)});t.after(()=>controller.destroy());return {nodes,document,window,root,timers,controller};
}

test('official original links and protected editors reject external redirects, executable URLs and action endpoints',()=>{
  assert.equal(editorialSourceHref(watch,{youtube:true}),watch);assert.equal(editorialSourceHref(channel.url,{youtube:true}),channel.url);assert.equal(editorialSourceHref('https://youtu.be/abcdefghijk',{youtube:true}),'https://youtu.be/abcdefghijk');
  for(const url of ['javascript:alert(1)','//evil.test','https://evil.test/watch?v=abcdefghijk','https://www.youtube.com/redirect?q=https://evil.test','https://www.youtube.com/logout','https://u:p@youtube.com/watch?v=abcdefghijk','http://youtube.com/watch?v=abcdefghijk'])assert.equal(editorialSourceHref(url,{youtube:true}),null,url);
  assert.equal(editorialSourceHref('/admin-web-stories.html?source=article%3A1',{editor:true}),'/admin-web-stories?source=article%3A1#source-manual');
  for(const url of ['/api/admin/delete','/admin-login?source=a','https://evil.test/admin-web-stories?source=a','/admin-web-stories?source=%00','/admin-web-stories'])assert.equal(editorialSourceHref(url,{editor:true}),null,url);
  for(const url of ['https://127.0.0.1/a','https://localhost/a','https://u:p@example.com/a','http://example.com/a'])assert.equal(editorialSourceHref(url),null,url);
});

test('initial load only reads, renders metadata as text and does not promote discovery into publishable evidence',async t=>{
  const calls=[],f=fixture(t,async(url,options)=>{calls.push({url,options});return response(sample());});await tick();
  assert.equal(calls.length,1);assert.equal(calls[0].options.method,undefined);assert.equal(calls[0].options.credentials,'same-origin');assert.equal(f.nodes.Sync.disabled,false);
  const nodes=walk(f.nodes.Items);assert.ok(nodes.some(node=>node.textContent===item.title));assert.ok(nodes.some(node=>node.textContent==='Pauta encontrada'));assert.ok(nodes.some(node=>node.textContent==='Visualizações na coleta: Não informado'));assert.ok(!nodes.some(node=>node.href?.startsWith('/admin-web-stories')));assert.ok(!nodes.some(node=>['img','iframe','video'].includes(node.tagName)));
});

test('only confirmed evidence gets an editor link; extracted recipe text remains review-only and escaped',async t=>{
  const values=[{...item,key:'verified',sourceStatus:'evidence_ready',editorUrl:'/admin-web-stories?source=verified'}, {...item,key:'recipe',topic:'recipes',sourceStatus:'text_ready',evidence:{kind:'recipe',title:'Receita',sourceUrl:'https://example.com/receita',ingredients:['<script>texto</script>'],steps:['Misture com cuidado.'],checkedAt:'2026-09-09T18:00:00Z'}}, {...item,key:'bad',sourceStatus:'evidence_ready',editorUrl:'https://evil.test/admin-web-stories?source=a'}];
  const f=fixture(t,async()=>response(sample({items:values})));await tick();const nodes=walk(f.nodes.Items),editors=nodes.filter(node=>node.href?.startsWith('/admin-web-stories'));
  assert.equal(editors.length,1);assert.equal(editors[0].href,'/admin-web-stories?source=verified#source-manual');assert.ok(nodes.some(node=>node.textContent==='<script>texto</script>'));assert.equal(values[1].sourceStatus,'text_ready');
  assert.equal(editorialSourceState('future')[0],'Estado não informado');
});

test('excerpts remain explicitly partial even when short, with original date separate from checked date',async t=>{
  const f=fixture(t,async()=>response(sample({items:[{...item,sourceStatus:'evidence_ready',evidence:{kind:'article',title:'Jardinagem',text:'Trecho curto preservado.',excerptOnly:true,publishedAt:'2026-09-01T12:00:00Z',checkedAt:'2026-09-09T18:00:00Z',sourceUrl:'https://example.com/jardim'}}]})));await tick();const nodes=walk(f.nodes.Items);
  assert.ok(nodes.some(node=>node.textContent==='Fontes conferidas para revisão'));assert.ok(nodes.some(node=>node.textContent==='Trecho de leitura; confira a fonte original.'));assert.ok(nodes.some(node=>/^Data original da fonte: 01\/09\/2026/.test(node.textContent)));assert.ok(nodes.some(node=>/^Material consultado em: 09\/09\/2026/.test(node.textContent)));
  assert.ok(walk(f.nodes.Channels).some(node=>node.textContent==='2 itens na última consulta'));assert.ok(!nodes.some(node=>node.textContent==='Fonte completa disponível'));
});

test('pause, cooldown, busy and unavailable configuration block sync before any POST',async t=>{
  for(const reason of ['global_paused','closed','busy','cooldown','disabled'])assert.equal(canSyncEditorialSources(sample({controls:{canSync:true,reason}})),false);
  assert.equal(canSyncEditorialSources(sample({busy:true})),false);assert.equal(canSyncEditorialSources(null),false);assert.throws(()=>editorialSourcesSnapshot({channels:[],items:[],busy:false}),/estado completo/);
  const calls=[],f=fixture(t,async(url,options)=>{calls.push({url,options});return response(sample({controls:{canSync:false,reason:'global_paused'}}));});await tick();f.nodes.Sync.dispatch('click');await tick();assert.equal(calls.length,1);assert.equal(f.nodes.Sync.disabled,true);assert.match(f.nodes.Message.textContent,/pausadas na Central/);
});

test('explicit sync is single flight and subsequent polling only reads its actual result',async t=>{
  const calls=[];let finish;const f=fixture(t,async(url,options)=>{calls.push({url,options});if(options.method)return new Promise(resolve=>{finish=resolve;});return response(sample({busy:calls.length>1,controls:calls.length>1?{canSync:false,reason:'busy'}:{canSync:true,reason:'ready'}}));});await tick();
  f.nodes.Sync.dispatch('click');f.nodes.Sync.dispatch('click');assert.equal(calls.filter(call=>call.options.method).length,1);assert.equal(calls[1].url,'/api/admin/editorial-sources/sync');assert.equal(calls[1].options.body,'{}');assert.equal(f.nodes.Refresh.disabled,true);
  finish(response(sample({busy:true}),202));await tick();await tick();assert.equal(calls.length,3);assert.equal(calls[2].options.method,undefined);assert.equal(f.timers.size,1);assert.equal(f.nodes.Sync.disabled,true);assert.match(f.nodes.Message.textContent,/consulta está em andamento/);
});

test('an uncertain POST is never retried and requires a fresh status read',async t=>{
  const calls=[],f=fixture(t,async(url,options)=>{calls.push({url,options});if(options.method)throw Error('A conexão caiu.');return response(sample({controls:calls.length>1?{canSync:false,reason:'cooldown',nextAt:'2026-09-09T19:00:00Z'}:{canSync:true,reason:'ready'}}));});await tick();f.nodes.Sync.dispatch('click');await tick();assert.equal(f.nodes.Sync.disabled,true);assert.match(f.nodes.Message.textContent,/Atualize o status/);f.nodes.Sync.dispatch('click');assert.equal(calls.length,2);f.nodes.Refresh.dispatch('click');await tick();assert.equal(calls.length,3);assert.equal(calls.filter(call=>call.options.method).length,1);assert.equal(f.nodes.Sync.disabled,true);assert.match(f.nodes.NextCheck.textContent,/Próxima consulta permitida/);
});

test('search, topic, measured-view sorting and pagination use server reads and discard late results',async t=>{
  const calls=[],f=fixture(t,(url,options)=>new Promise(resolve=>calls.push({url,options,resolve})));calls[0].resolve(response(sample({pagination:{offset:0,limit:12,total:20,nextOffset:12}})));await tick();
  f.nodes.Query.value='horta';f.nodes.Topic.value='gardening';f.nodes.Sort.value='views';f.nodes.Form.dispatch('submit');let url=new URL(calls[1].url,'https://vitrinecity.com');assert.equal(url.searchParams.get('q'),'horta');assert.equal(url.searchParams.get('topic'),'gardening');assert.equal(url.searchParams.get('sort'),'views');
  f.nodes.Query.value='manjericão';f.nodes.Form.dispatch('submit');assert.equal(calls[1].options.signal.aborted,true);calls[2].resolve(response(sample({items:[{...item,title:'Resultado atual'}],pagination:{offset:0,limit:12,total:20,nextOffset:12}})));await tick();calls[1].resolve(response(sample({items:[{...item,title:'Resultado antigo'}]})));await tick();assert.ok(!walk(f.nodes.Items).some(node=>node.textContent==='Resultado antigo'));
  f.nodes.Next.dispatch('click');url=new URL(calls[3].url,'https://vitrinecity.com');assert.equal(url.searchParams.get('offset'),'12');assert.equal(url.searchParams.get('q'),'manjericão');calls[3].resolve(response(sample({pagination:{offset:12,limit:12,total:20,nextOffset:null}})));await tick();assert.equal(f.nodes.Next.disabled,true);assert.ok(calls.every(call=>!call.options.method));
});

test('unconsulted, empty and failed sources remain different states; failed reads preserve prior items',async t=>{
  const channels=[{...channel,id:'never',status:'never',lastCheckedAt:null,lastSuccessAt:null},{...channel,id:'empty',status:'empty'},{...channel,id:'error',status:'error',errorCode:'feed_identity_mismatch'}];let count=0;
  const f=fixture(t,async()=>++count===1?response(sample({channels,items:[]})):response({error:'Consulta indisponível.'},503));await tick();const text=walk(f.nodes.Channels).map(node=>node.textContent).join(' ');assert.match(text,/Aguardando primeira consulta/);assert.match(text,/Consulta sem itens/);assert.match(text,/identidade retornada não corresponde/);assert.match(f.nodes.Items.children[0].textContent,/resultados podem estar incompletos/);
  f.nodes.Refresh.dispatch('click');await tick();assert.match(f.nodes.Message.textContent,/última leitura bem-sucedida/);assert.equal(f.nodes.Channels.children.length,3);assert.equal(f.nodes.Sync.disabled,true);
});

test('busy polling is bounded and stops when the panel is hidden',async t=>{
  let calls=0;const f=fixture(t,async()=>{calls++;return response(sample({busy:true,controls:{canSync:false,reason:'busy'}}));});await tick();for(let i=0;i<12;i++){const callback=[...f.timers.values()][0];assert.ok(callback);f.timers.clear();callback();await tick();}
  assert.equal(calls,13);assert.equal(f.timers.size,0);assert.match(f.nodes.Message.textContent,/Atualizar status/);f.document.hidden=true;f.document.dispatch('visibilitychange');assert.equal(f.timers.size,0);f.document.hidden=false;f.document.dispatch('visibilitychange');await tick();assert.equal(calls,14);assert.equal(f.timers.size,1);
});

test('HTML wires named controls and single-column mobile styles with touch-size actions',()=>{
  const html=fs.readFileSync(new URL('../public/admin-web-stories.html',import.meta.url),'utf8'),css=fs.readFileSync(new URL('../public/vitriny-web-stories.css',import.meta.url),'utf8'),central=fs.readFileSync(new URL('../public/admin-operacao.html',import.meta.url),'utf8');
  for(const name of ['Message','Checked','NextCheck','Channels','Items','Sync','Refresh','Form','Query','Topic','Sort','Search','Previous','Next','Page'])assert.equal([...html.matchAll(new RegExp('id="es'+name+'"','g'))].length,1,name);
  for(const name of ['Query','Topic','Sort'])assert.match(html,new RegExp('for="es'+name+'"'));assert.match(html,/admin-editorial-sources\.js" type="module"/);assert.match(central,/\/admin-web-stories#editorial-sources/);assert.match(css,/\.editorial-sources \*\{min-width:0\}/);assert.match(css,/@media\(max-width:600px\)\{\.editorial-channels,\.editorial-items,\.editorial-source-filters\{grid-template-columns:minmax\(0,1fr\)\}/);assert.match(css,/\.editorial-item summary\{[^}]*min-height:44px/);
});
