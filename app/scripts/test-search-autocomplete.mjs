import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mergeSuggestions,loadSuggestions} from '../public/search-autocomplete.js';
const officialCategory='Loja oficial · Prioridade da plataforma';
const official=Array.from({length:8},(_,i)=>({label:'Produto oficial '+i,type:'product',category:officialCategory}));
const web=Array.from({length:8},(_,i)=>({label:'como fazer '+i,type:'web'}));
const merged=mergeSuggestions([web,official]);
assert.equal(merged.length,10);assert.equal(merged[0].category,officialCategory);
assert.equal(merged[1].type,'web','General phrases must remain near the top, not behind every product');
assert.equal(merged.filter(item=>item.type==='web').length,4);
assert.deepEqual(mergeSuggestions([[null,{},false,{label:42},{label:'  '},{label:'Plantas',type:'web'}],[{label:'plantas',type:'content'}]]).map(item=>item.label),['Plantas']);
assert.equal(mergeSuggestions([[{label:'x'.repeat(1000),category:'y'.repeat(1000)}]])[0].label.length,300);
assert.equal(mergeSuggestions([[{label:'safe',category:{unsafe:true}}]])[0].category,'');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
for(const fast of ['web','local']) {
 let release;const waiting=new Promise(resolve=>release=resolve),updates=[],urls=[];
 const controller=new AbortController();
 const task=loadSuggestions({value:'como fazer',city:'São Paulo',signal:controller.signal,onUpdate:items=>updates.push(items),fetcher:async(url,options)=>{
  assert.equal(options.signal,controller.signal);urls.push(new URL(url,'https://vitrinecity.com'));
  const kind=url.startsWith('/api/search/autocomplete?')?'web':'local';
  if(kind!==fast)await waiting;
  return Response.json({suggestions:[kind==='web'?{label:'como fazer bolo',type:'web'}:{label:'Produto oficial',type:'product',category:officialCategory}]});
 }});
 await settle();assert.equal(updates.length,1,fast+' source must render without waiting for the other source');
 assert.equal(updates[0][0].type,fast==='web'?'web':'product');
 release();await task;assert.equal(updates.at(-1).length,2);assert.equal(updates.at(-1)[0].category,officialCategory);
 assert.ok(urls.every(url=>url.searchParams.get('q')==='como fazer'&&url.searchParams.get('city')==='São Paulo'));
}
{
 const updates=[],controller=new AbortController();
 await loadSuggestions({value:'vazio',signal:controller.signal,onUpdate:items=>updates.push(items),fetcher:async url=>url.startsWith('/api/search/autocomplete?')?Response.json({suggestions:{invalid:true}}):Response.json({suggestions:[]})});
 assert.ok(updates.every(items=>items.length===0),'Empty and malformed sources do not invent suggestions');
 await loadSuggestions({value:'parcial',signal:controller.signal,onUpdate:items=>updates.push(items),fetcher:async url=>{
  if(url.startsWith('/api/search/autocomplete?'))throw Error('unavailable');
  return Response.json({suggestions:[{label:'Conteúdo local',type:'content'}]});
 }});
 assert.equal(updates.at(-1)[0].label,'Conteúdo local');
 controller.abort();let called=false;
 await loadSuggestions({value:'cancelada',signal:controller.signal,onUpdate:()=>called=true,fetcher:async()=>Response.json({suggestions:[{label:'stale'}]})});
 assert.equal(called,false,'An aborted request must not publish stale suggestions even if the transport still resolves');
}
const home=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const page=fs.readFileSync(new URL('../public/pesquisar.html',import.meta.url),'utf8');
const search=fs.readFileSync(new URL('../public/search.js',import.meta.url),'utf8');
const module=fs.readFileSync(new URL('../public/search-autocomplete.js',import.meta.url),'utf8');
assert.match(home,/action="\/pesquisar.html"/);assert.match(home,/id="home-search-suggestions"/);
for(const source of [home,search])assert.match(source,/setupSearchAutocomplete/);
for(const source of [home,page])assert.match(source,/search-autocomplete.css/);
assert.doesNotMatch(module,/innerHTML|eval\(|new Function|localStorage|sessionStorage/);
console.log('Autocomplete: independent partial sources, official/general balance, deduplication, bounds, errors, cancellation and both page integrations verified.');
