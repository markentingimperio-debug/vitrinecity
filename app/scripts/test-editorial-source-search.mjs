import test from 'node:test';
import assert from 'node:assert/strict';
import {createEditorialSourceSearch} from '../editorial-source-search.js';

const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
test('editorial discovery uses existing fixed search route and returns only permitted URLs',async()=>{
  let call;
  const search=createEditorialSourceSearch({fetchImpl:async(url,options)=>{call={url,options};return json({status:'ready',results:[
    {url:'https://veja.abril.com.br/brasil/tema',title:'<b>Tema</b>',description:'Never treat this snippet as evidence'},
    {url:'https://veja.abril.com.br/brasil/tema#ref',title:'Duplicate'},
    {url:'http://127.0.0.1/private',title:'Private'},
    {url:'https://example.com/article',title:'Unreviewed host'}
  ]});}});
  const result=await search({query:'Notícia pública sobre plantas'});
  const target=new URL(call.url);
  assert.equal(target.origin,'http://127.0.0.1:3000');assert.equal(target.pathname,'/api/search/web');
  assert.equal(target.searchParams.get('q'),'Notícia pública sobre plantas');assert.equal(target.searchParams.get('type'),'web');
  assert.deepEqual(call.options.headers,{Accept:'application/json'});assert.equal(call.options.method,'GET');
  assert.equal(call.options.redirect,'error');assert.equal(call.options.credentials,'omit');
  assert.deepEqual(result,[{url:'https://veja.abril.com.br/brasil/tema',title:'Tema'}]);
});
test('invalid and cancelled queries perform no request',async()=>{
  let calls=0;const search=createEditorialSourceSearch({fetchImpl:async()=>{calls++;return json({status:'empty',results:[]});}});
  for(const query of ['',null,'ab','x'.repeat(301),'hello\nworld'])await assert.rejects(search({query}));
  await assert.rejects(search({query:'Tema público',signal:AbortSignal.abort()}));assert.equal(calls,0);
});
test('empty, failed and partial search results remain distinct',async()=>{
  assert.deepEqual(await createEditorialSourceSearch({fetchImpl:async()=>json({status:'empty',results:[]})})({query:'Tema público'}),[]);
  for(const data of [{status:'unavailable',results:[]},{status:'partial',results:[]},{status:'ready',results:{}},null]){
    await assert.rejects(createEditorialSourceSearch({fetchImpl:async()=>json(data)})({query:'Tema público'}));
  }
  await assert.rejects(createEditorialSourceSearch({fetchImpl:async()=>new Response('down',{status:503})})({query:'Tema público'}));
});
test('search rejects oversized, mislabeled and malformed responses',async()=>{
  for(const response of [new Response('html'),new Response('{',{headers:{'content-type':'application/json'}}),new Response('x'.repeat(512*1024+1),{headers:{'content-type':'application/json'}})]){
    await assert.rejects(createEditorialSourceSearch({fetchImpl:async()=>response})({query:'Tema público'}));
  }
});
test('search preserves usable partial results and bounds candidates',async()=>{
  const result=await createEditorialSourceSearch({fetchImpl:async()=>json({status:'partial',results:Array.from({length:50},(_,i)=>({title:'Texto '+i,url:'https://veja.abril.com.br/brasil/item-'+i,description:'Unverified'}))})})({query:'Tema público'});
  assert.equal(result.length,8);assert.ok(result.every(item=>Object.keys(item).join(',')==='url,title'));
});
