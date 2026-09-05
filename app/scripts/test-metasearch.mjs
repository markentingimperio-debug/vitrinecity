import assert from 'node:assert/strict';
import express from 'express';
import { setupMetasearch, normalizeWebResults, publicResultUrl, platformDomains, resultMatchesDomains } from '../metasearch.js';

const engines=['google','bing','youtube'];
assert.deepEqual(platformDomains('shopping','all'),['mercadolivre.com.br','shopee.com.br']);
assert.deepEqual(platformDomains('all','instagram'),['instagram.com']);
assert.equal(resultMatchesDomains('https://produto.mercadolivre.com.br/MLB-123',['mercadolivre.com.br']),true);
assert.equal(resultMatchesDomains('https://mercadolivre.com.br.fake.example/item',['mercadolivre.com.br']),false);
const payload={results:[
  {title:'<b>Bolo simples</b>',url:'https://receitas.example/bolo?utm_source=google',content:'Misture farinha &amp; ovos.',engines:['google'],template:'default.html'},
  {title:'Receita repetida',url:'https://receitas.example/bolo#preparo',engines:['bing']},
  {title:'Vídeo',url:'https://www.youtube.com/watch?v=test',engine:'youtube',template:'videos.html'},
  {title:'Unsafe',url:'javascript:alert(1)',engine:'google'},
  {title:'Private',url:'http://127.0.0.1/admin',engine:'google'},
  {title:'Unknown engine',url:'https://example.org',engine:'unconfigured'}
],suggestions:['bolo de chocolate','bolo sem leite','bolo sem leite'],unresponsive_engines:[['bing','timeout']]};
const normal=normalizeWebResults(payload,engines);
assert.equal(normal.results.length,2);assert.deepEqual(normal.results[0].providers,['google','bing']);
assert.equal(normal.results[0].title,'Bolo simples');assert.equal(normal.results[0].description,'Misture farinha & ovos.');
assert.deepEqual(normal.suggestions,['bolo de chocolate','bolo sem leite']);assert.deepEqual(normal.unavailable,['bing']);
for(const url of ['javascript:x','file:///etc/passwd','https://name:pass@example.com','http://192.168.1.1','http://[::1]'])assert.equal(publicResultUrl(url),'');
let calls=0,fail=false,clock=Date.now(),upstream=[];
const fetchImpl=async(url,options)=>{
  calls++;upstream.push(new URL(url));
  assert.equal(options.redirect,'error');
  if(fail)return new Response('{}',{status:503});
  if(new URL(url).pathname==='/autocompleter')return Response.json(['como fazer bolo simples','como fazer bolo de chocolate']);
  return Response.json(payload);
};
const app=express();setupMetasearch(app,{env:{SEARXNG_URL:'http://search:8080',SEARCH_ENGINES:engines.join(',')},fetchImpl,now:()=>clock});
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const get=(q,path='/api/search/web')=>fetch(origin+path+'?'+new URLSearchParams(q));
try {
  let r=await get({q:'como fazer bolo'});assert.equal(r.status,200);let data=await r.json();
  assert.equal(data.status,'partial');assert.equal(data.results.length,2);assert.equal(data.nextPage,2);
  assert.equal(upstream[0].searchParams.get('q'),'como fazer bolo');assert.equal(upstream[0].searchParams.get('format'),'json');
  await get({q:'como fazer bolo'});assert.equal(calls,1,'Repeated query is served from bounded cache.');
  await get({q:'como fazer bolo',type:'videos'});assert.equal(upstream.at(-1).searchParams.get('engines'),'youtube');
  r=await get({q:'como fazer'},'/api/search/autocomplete');data=await r.json();assert.equal(data.suggestions[0].label,'como fazer bolo simples');
  assert.equal(data.suggestions[0].type,'web');
  r=await get({q:'x'});assert.equal(r.status,400);
  r=await get({q:'bolo',page:'999'});await r.json();assert.equal(upstream.at(-1).searchParams.get('pageno'),'5');
  r=await get({q:'vaso',source:'shopee'});data=await r.json();assert.equal(data.results.length,0);assert.ok(upstream.at(-1).searchParams.get('q').includes('site:shopee.com.br'));assert.ok(!upstream.at(-1).searchParams.get('engines').includes('youtube'));
  fail=true;r=await get({q:'unique query'});assert.equal(r.status,503);assert.equal((await r.json()).status,'unavailable');fail=false;
  for(let i=0;i<15;i++)await get({q:'como fazer bolo'});
  r=await get({q:'como fazer bolo'});assert.equal(r.status,429);assert.equal(r.headers.get('retry-after'),'60');
  clock+=61000;r=await get({q:'como fazer bolo'});assert.equal(r.status,200);
  console.log('metasearch: deduplication, sources, suggestions, cache, limits, failures, pagination and URL safety passed');
}finally{await new Promise(resolve=>server.close(resolve));}
const offline=express();setupMetasearch(offline,{env:{},fetchImpl:()=>{throw Error('must not call provider');}});
const offServer=offline.listen(0,'127.0.0.1');await new Promise(resolve=>offServer.once('listening',resolve));
try { const r=await fetch('http://127.0.0.1:'+offServer.address().port+'/api/search/web?q=bolo');assert.equal(r.status,503);assert.equal((await r.json()).status,'unconfigured'); }
finally {await new Promise(resolve=>offServer.close(resolve));}
