import test from 'node:test';
import assert from 'node:assert/strict';
import {createStationLoader,stationFilters,articlePath,articleImage} from '../public/emissora.js';
const filters=(category='total',query='',page=1)=>({category,query,page});
const data=(title='Matéria pública',page=1)=>({page,pages:2,pageSize:12,total:14,items:[{slug:'materia-publica',category:'noticias',title,summary:'Resumo público.',imageUrl:'/assets/editorial/exemplo.jpg',url:'/artigo/materia-publica',publishedAt:'2026-09-08T12:00:00Z'}]});
const response=value=>({ok:true,json:async()=>value});
const deferred=()=>{let resolve;const promise=new Promise(ready=>{resolve=ready;});return {promise,resolve};};

test('a later filter wins even if the aborted earlier response eventually arrives',async()=>{
  const states=[],pending=[];
  const loader=createStationLoader({onState:state=>states.push(state),fetchImpl:(_url,{signal})=>{const job=deferred();pending.push({...job,signal});return job.promise;}});
  const first=loader.load(filters('noticias')),second=loader.load(filters('receitas','cenoura'));
  assert.equal(pending[0].signal.aborted,true);pending[1].resolve(response(data('Receita escolhida')));await second;
  pending[0].resolve(response(data('Notícia atrasada')));await first;
  assert.deepEqual(states.filter(state=>state.phase==='ready').map(state=>state.data.items[0].title),['Receita escolhida']);assert.equal(states.at(-1).filters.category,'receitas');loader.close();
});

test('retry recovers a failed request and preserves the selected category, query and page',async()=>{
  const states=[],urls=[];let count=0;
  const loader=createStationLoader({onState:state=>states.push(state),fetchImpl:async url=>{urls.push(url);return ++count===1?{ok:false}:response(data('Resultado',2));}});
  const chosen=filters('noticias','São Paulo',2);await loader.load(chosen);assert.equal(states.at(-1).phase,'error');await loader.load(chosen);assert.equal(states.at(-1).phase,'ready');assert.deepEqual(states.at(-1).filters,chosen);assert.equal(urls[0],urls[1]);assert.match(urls[1],/categoria=noticias/);assert.match(urls[1],/page=2/);loader.close();
});

test('timeout aborts the request and returns an actionable timeout state',async()=>{
  const states=[];let signal;
  const loader=createStationLoader({timeoutMs:10,onState:state=>states.push(state),fetchImpl:(_url,options)=>new Promise((_resolve,reject)=>{signal=options.signal;signal.addEventListener('abort',()=>reject(Object.assign(Error('aborted'),{name:'AbortError'})),{once:true});})});
  await loader.load(filters());assert.equal(signal.aborted,true);assert.equal(states.at(-1).phase,'error');assert.equal(states.at(-1).timeout,true);loader.close();
});

test('closing while a request is pending cannot update a departed page',async()=>{
  const states=[],job=deferred();const loader=createStationLoader({onState:state=>states.push(state),fetchImpl:()=>job.promise});
  const pending=loader.load(filters());loader.close();job.resolve(response(data()));await pending;await loader.load(filters());assert.deepEqual(states.map(state=>state.phase),['loading']);
});

test('feed destinations and image paths cannot be changed to executable, external or private resources',async()=>{
  for(const path of ['https://outside.test/artigo/teste','//outside.test/teste','javascript:alert(1)','/api/admin','/artigo/../admin','/artigo/%2e%2e','/artigo/teste?redirect=external','/artigo/teste#external'])assert.equal(articlePath(path),'',path);
  for(const path of ['https://outside.test/x.jpg','//outside.test/x.jpg','/assets/../uploads/x.jpg','/api/private.jpg','data:image/svg+xml,test','/assets/image.jpg?token=private'])assert.equal(articleImage(path),'',path);
  const states=[],payload=data();payload.items.push({...payload.items[0],title:'Link externo',url:'https://outside.test'});payload.items[0].imageUrl='https://outside.test/photo.jpg';
  const loader=createStationLoader({onState:state=>states.push(state),fetchImpl:async()=>response(payload)});await loader.load(filters());assert.equal(states.at(-1).data.items.length,1);assert.equal(states.at(-1).data.items[0].imageUrl,'');loader.close();
});

test('empty results remain empty and malformed pagination produces an error instead of misleading controls',async()=>{
  const states=[];let payload={...data(),items:[],total:0,pages:1};
  const loader=createStationLoader({onState:state=>states.push(state),fetchImpl:async()=>response(payload)});await loader.load(filters());assert.equal(states.at(-1).phase,'ready');assert.deepEqual(states.at(-1).data.items,[]);
  payload={...data(),page:3};await loader.load(filters());assert.equal(states.at(-1).phase,'error');loader.close();
});

test('bookmark filters accept bounded valid values without trusting category or page injection',()=>{
  assert.deepEqual(stationFilters('?categoria=receitas&q=bolo+de+cenoura&page=2'),filters('receitas','bolo de cenoura',2));
  for(const query of ['?categoria=constructor&page=Infinity','?categoria=admin&page=-1','?page=10001','?page=1.5'])assert.deepEqual(stationFilters(query),filters());
  assert.equal(stationFilters('?q='+('a'.repeat(150))).query.length,120);
});
