import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {readStoryEntry,storyEntry,storyHistoryLink,storyPublicHref,storyDiagnosticLines,storyOutcomeSummary} from '../public/admin-web-story-recovery.js';

test('a recovery source is selected through one exact protected read; opening never creates a draft',async()=>{
  const calls=[],source={id:'article:bolo/?a',title:'Bolo completo',story_id:null};
  const result=await readStoryEntry('?source='+encodeURIComponent(source.id),async(...args)=>{calls.push(args);return {items:[source]};});
  assert.deepEqual(result,{source});assert.equal(calls.length,1);assert.equal(calls[0].length,1);
  const url=new URL(calls[0][0],'https://vitrinecity.com');assert.equal(url.pathname,'/api/admin/web-stories/sources');assert.equal(url.searchParams.get('sourceKey'),source.id);assert.equal(url.searchParams.has('q'),false);
});
test('an existing draft is opened by receipt instead of creating a second story',async()=>{
  const calls=[],source={id:'recipe',title:'Receita',story_id:'saved/id'},story={id:'saved/id',revision:7};
  const result=await readStoryEntry('?source=recipe',async(...args)=>{calls.push(args);return calls.length===1?{items:[source]}:story;});
  assert.deepEqual(result,{source,story});assert.equal(calls[1][0],'/api/admin/web-stories/saved%2Fid');assert.ok(calls.every(args=>args.length===1));
  calls.length=0;await readStoryEntry('?story=saved&source=other',async(...args)=>{calls.push(args);return story;});assert.deepEqual(calls,[['/api/admin/web-stories/saved']]);
});
test('missing or mismatched sources never select a different item; invalid links do not make requests',async()=>{
  for(const items of [[],[{id:'other'}]])await assert.rejects(readStoryEntry('?source=missing',async()=>({items})),/não está mais disponível/);
  let calls=0;await assert.rejects(readStoryEntry('?source='+encodeURIComponent('\nwrong'),async()=>{calls++;}),/incompleto/);assert.equal(calls,0);
  assert.equal(storyEntry(''),null);assert.throws(()=>storyEntry('?source='));assert.throws(()=>storyEntry('?story='+('x'.repeat(201))));
});
test('recovery actions derive internal destinations from identifiers and ignore unsafe provided URLs',()=>{
  const item={sourceKey:'recipe:<script>',recovery:{sourceAvailable:true,editorUrl:'javascript:alert(1)'}};
  assert.equal(storyHistoryLink(item),'/admin-web-stories?source=recipe%3A%3Cscript%3E#source-manual');
  assert.equal(storyHistoryLink({...item,recovery:{sourceAvailable:false}}),null);
  assert.equal(storyHistoryLink({storyId:'saved',recovery:{sourceAvailable:false}}),'/admin-web-stories?story=saved#editor');
  assert.equal(storyPublicHref('/artigo/bolo?origem=story'),'/artigo/bolo?origem=story');
  for(const url of ['javascript:alert(1)','//evil.test','https://evil.test/a','/api/delete','/admin/salvar','/admin-login.html','/../api/change','/path\\evil','/path\nfoo'])assert.equal(storyPublicHref(url),null,url);
});
test('old missing diagnostics are not fabricated, and absent counts remain unavailable',()=>{
  assert.deepEqual(storyDiagnosticLines({code:'review_details_unavailable'}),[]);
  assert.deepEqual(storyDiagnosticLines({qualityFailures:['complete','complete','made_up']}),['Completar as informações da história.']);
  assert.match(storyOutcomeSummary({quota:{published:0,review:6,remaining:0}}),/^0 publicadas pela rotina · 6 tentativas em revisão · — falhas/);
});

test('the actual editor boot preselects an off-page source and leaves publication disabled without a write',async t=>{
  const old=Object.fromEntries(['document','window','location','fetch'].map(name=>[name,globalThis[name]]));t.after(()=>{for(const [name,value] of Object.entries(old)){if(value===undefined)delete globalThis[name];else globalThis[name]=value;}});
  class Element{
    constructor(){this.children=[];this.listeners={};this.dataset={};this.value='';this.hidden=false;this.checked=false;this.disabled=false;this.textContent='';}
    append(...items){this.children.push(...items);}replaceChildren(...items){this.children=items;}setAttribute(){}removeAttribute(){}scrollIntoView(){this.scrolled=true;}addEventListener(name,fn){this.listeners[name]=fn;}querySelectorAll(){return [];}
  }
  const html=fs.readFileSync(new URL('../public/admin-web-stories.html',import.meta.url),'utf8'),nodes=Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(([,id])=>[id,new Element()]));
  nodes['source-search'].elements={q:{value:''},group:{value:'all'}};nodes['source-group'].value='all';
  nodes['story-form'].elements=Object.fromEntries(['title','description','cta','ctaLabel','homeCta'].map(name=>[name,new Element()]));
  const source={id:'article:fonte-fora-da-primeira-pagina',title:'<b>Receita completa</b>',sourceUrl:'/artigo/receita'},calls=[];
  globalThis.document={getElementById:id=>{assert.ok(nodes[id],id+' must exist in HTML');return nodes[id];},createElement:()=>new Element(),querySelectorAll:()=>[],body:new Element()};
  globalThis.window={addEventListener(){}};globalThis.location={search:'?source='+encodeURIComponent(source.id)};
  globalThis.fetch=async(url,options)=>{calls.push({url,options});return {ok:true,status:200,json:async()=>url.includes('sourceKey=')?{items:[source]}:{items:[],nextOffset:null}};};
  await import('../public/admin-web-stories.js?recovery-boot-test');await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.length,3);assert.ok(calls.every(call=>!call.options.method));assert.ok(calls.every(call=>call.options.credentials==='same-origin'));
  assert.equal(nodes.source.value,source.id);assert.equal(nodes['source-recovery-title'].textContent,source.title);assert.equal(nodes['source-recovery-link'].href,source.sourceUrl);assert.equal(nodes['source-recovery'].hidden,false);assert.equal(nodes.publish.disabled,true);assert.match(nodes.status.textContent,/não gerou nem publicou/);
});
