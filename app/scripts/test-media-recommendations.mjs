import assert from 'node:assert/strict';
import test from 'node:test';
import {createMediaRecommendationLoader, mediaRecommendationContext, rankMediaRecommendations, safeMediaRecommendationHref} from '../public/vitriny-media-recommendations-core.js';
import {mountMediaRecommendations} from '../public/vitriny-media-recommendations.js';

const electronic = {slug:'set-eletronico',title:'Tomorrowland · DJ set',genre:'eletronica',tags:'festival, house'};
const country = {slug:'sertanejo',title:'Sertanejo Sofrência',genre:'sertanejo',tags:'violao, country'};
const cartoon = {slug:'animacao',title:'Aventura no espaço',genre:'aventura',tags:'animacao, familia'};
const product = (id, name, extra = {}) => ({id, name, productUrl:'/produto/'+id+'/produto', ...extra});
const response = data => ({ok:true, json:async() => data});

test('Contexts are bounded and use only title, genre and tags, without personal history', () => {
  assert.deepEqual(mediaRecommendationContext(electronic).queries,['producao musical','dj','fone']);
  assert.deepEqual(mediaRecommendationContext(country).queries,['sertanejo','violao','moda country']);
  assert.deepEqual(mediaRecommendationContext(cartoon,'cinema').queries,['animacao','desenho','projetor']);
  assert.deepEqual(mediaRecommendationContext({title:'Um assunto desconhecido',description:'fone dj musica',history:['dj']}).queries,[]);
  assert.deepEqual(mediaRecommendationContext(null).queries,[]);
});

test('An unrelated entertainment course or electronic product never qualifies', () => {
  const items = {products:[product(1,'Smartphone eletrônico'),product(2,'Fone Bluetooth'),product(3,'Geladeira', {description:'Ouça música e seja DJ enquanto organiza sua casa.'})],contents:[
    {kind:'course',title:'Como vender qualquer produto',description:'Música, DJ e cinema fazem parte da vida',url:'/centro-educacional#vendas'},
    {kind:'course',title:'Produção musical para iniciantes',url:'/centro-educacional.html#producao-musical'},
  ]};
  assert.deepEqual(rankMediaRecommendations(mediaRecommendationContext(electronic),[items]).map(item=>item.title),['Produção musical para iniciantes','Fone Bluetooth']);
});

test('Country association requires actual clothing or a musical identity', () => {
  const items={products:[product(1,'Ração Sertaneja'),product(2,'Adubo Country'),product(3,'Bota de couro country'),product(4,'Violão acústico'),product(5,'CD de música sertaneja')]};
  const result=rankMediaRecommendations(mediaRecommendationContext(country),[items]);
  assert.equal(result.length,3);
  assert.ok(result.every(item=>!['Ração Sertaneja','Adubo Country'].includes(item.title)));
});

test('Unavailable, malformed, draft and irrelevant responses stay hidden', () => {
  const context=mediaRecommendationContext(electronic);
  assert.deepEqual(rankMediaRecommendations(context,[{products:[null,product(1,'Fone',{available:0}),product(2,'Fone',{available:false}),product(3,'Fone',{status:'draft'})],contents:[null,{kind:'article',title:'DJ nos jornais',url:'/artigo/dj'}]},null,{}]),[]);
});

test('All returned offers are internal detail pages, bounded and deduplicated', () => {
  const contents=[
    {kind:'article',title:'Fone sem fio',url:'/ofertas/fone-sem-fio'},
    {kind:'affiliate',title:'Fone externo',url:'https://shopee.com.br/fone'},
    {kind:'affiliate',title:'DJ inesperado',url:'/api/ads/12/click'},
    {kind:'course',title:'Curso de DJ',url:'/centro-educacional.html#curso-dj'},
  ];
  const items={contents,products:Array.from({length:10},(_,i)=>product(i+1,'Fone '+i))};
  const result=rankMediaRecommendations(mediaRecommendationContext(electronic),[items,items],{limit:999});
  assert.equal(result.length,3);assert.equal(new Set(result.map(item=>item.href)).size,3);
  const affiliate=rankMediaRecommendations(mediaRecommendationContext(electronic),[{contents:[contents[0]]}])[0];
  assert.equal(affiliate.affiliate,true);assert.equal(affiliate.kind,'affiliate');
  assert.equal(safeMediaRecommendationHref('/centro-educacional.html#curso-dj'),'/centro-educacional#curso-dj');
});

test('URL policy rejects external origins, redirects, scripts, encoded paths and malformed credentials', () => {
  for(const url of ['https://evil.test/produto/1','//evil.test/ofertas/fone','javascript:alert(1)','/api/ads/1/click','/ofertas/fone?next=https://evil.test','/ofertas/../ofertas/fone','/ofertas/%2e%2e/fone','/ofertas/fone%2fteste','/ofertas/fone\\teste','https://user@vitrinecity.com/ofertas/fone','/centro-educacional','/produto/0','/produto/1#fragment'])assert.equal(safeMediaRecommendationHref(url),'',url);
  assert.equal(safeMediaRecommendationHref('https://vitrinecity.com/ofertas/fone'),'/ofertas/fone');
  assert.equal(safeMediaRecommendationHref('http://127.0.0.1:4311/produto/12/fone','http://127.0.0.1:4311'),'/produto/12/fone');
});

test('Loader uses only three internal GET requests and supports one source failing', async () => {
  const requests=[],updates=[];
  const loader=createMediaRecommendationLoader({onResults:value=>updates.push(value),fetchImpl:async(url,options)=>{
    requests.push({url,options});
    if(url.includes('producao'))throw Error('temporary');
    return response({products:[product(8,'Fone de ouvido')]});
  }});
  const result=await loader.update(electronic);
  assert.equal(requests.length,3);assert.equal(result.length,1);assert.equal(updates.at(-1).length,1);
  for(const {url,options}of requests){assert.ok(url.startsWith('/api/discovery/search?q='));assert.equal(options.redirect,'error');assert.equal(options.credentials,'same-origin');assert.ok(options.signal);}
  loader.destroy();
});

test('Clearing an active selection aborts requests and a delayed result cannot reappear', async () => {
  const pending=[],updates=[];
  const loader=createMediaRecommendationLoader({onResults:value=>updates.push(value),fetchImpl:(url,options)=>new Promise(resolve=>pending.push({url,options,resolve}))});
  const old=loader.update(electronic);
  loader.clear();
  assert.ok(pending.every(item=>item.options.signal.aborted));
  pending.forEach(item=>item.resolve(response({products:[product(1,'Fone atrasado')]})));
  assert.deepEqual(await old,[]);assert.deepEqual(updates.at(-1),[]);loader.destroy();
});

test('Changing videos ignores late previous results even when the transport ignores cancellation', async () => {
  const pending=[],updates=[];
  const loader=createMediaRecommendationLoader({onResults:value=>updates.push(value),fetchImpl:(url,options)=>new Promise(resolve=>pending.push({url,options,resolve}))});
  const old=loader.update(electronic),current=loader.update(country);
  pending.slice(3).forEach(item=>item.resolve(response({products:[product(2,'Violão acústico')]})));
  await current;assert.equal(updates.at(-1)[0].title,'Violão acústico');
  pending.slice(0,3).forEach(item=>item.resolve(response({products:[product(1,'Fone atrasado')]})));
  await old;assert.equal(updates.at(-1)[0].title,'Violão acústico');loader.destroy();
});

test('Dismissed suggestions remain closed for that selection and new selections can show', async () => {
  let requests=0;const updates=[];
  const loader=createMediaRecommendationLoader({onResults:value=>updates.push(value),fetchImpl:async()=>{requests++;return response({products:[product(1,'Fone'),product(2,'Violão acústico')]});}});
  await loader.update(electronic);loader.dismiss();assert.deepEqual(updates.at(-1),[]);
  const oldCount=requests;await loader.update(electronic);assert.equal(requests,oldCount);assert.deepEqual(updates.at(-1),[]);
  await loader.update(country);assert.equal(updates.at(-1)[0].title,'Violão acústico');loader.destroy();
});

test('Unknown media and a catalogue with no relevant result never display an empty promo', async () => {
  let requests=0;const updates=[];
  const loader=createMediaRecommendationLoader({onResults:value=>updates.push(value),fetchImpl:async()=>{requests++;return response({products:[product(1,'Jardinagem em vasos')]});}});
  await loader.update({title:'Sem tema reconhecido'});assert.equal(requests,0);
  await loader.update(electronic);assert.equal(requests,3);assert.deepEqual(updates.at(-1),[]);loader.destroy();
});

test('The UI uses text nodes, identifies affiliates, closes and removes itself cleanly', async () => {
  class Element {
    constructor(tag,document){this.tagName=tag.toUpperCase();this.ownerDocument=document;this.children=[];this.attributes={};this.events={};this.hidden=false;}
    append(...children){this.children.push(...children);children.forEach(child=>child.parent=this);}
    replaceChildren(...children){this.children=[];this.append(...children);}
    setAttribute(name,value){this.attributes[name]=value;}
    addEventListener(name,fn){this.events[name]=fn;}
    remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);}
  }
  const document={createElement:tag=>new Element(tag,document)},container=document.createElement('div');
  let closed=0;
  const component=mountMediaRecommendations(container,{onClose:()=>closed++,fetchImpl:async()=>response({contents:[{kind:'article',title:'Fone <img src=x onerror=alert(1)>',url:'/ofertas/fone'}]})});
  const section=container.children[0];assert.equal(section.hidden,true);
  await component.update(electronic);assert.equal(section.hidden,false);
  const link=section.children[1].children[0].children[0];
  assert.equal(link.rel,'sponsored');assert.equal(link.children[0].textContent,'Oferta de afiliado');assert.equal(link.children[1].textContent,'Fone <img src=x onerror=alert(1)>');assert.equal(link.children[1].children.length,0);
  section.children[0].children[1].events.click();assert.equal(section.hidden,true);assert.equal(closed,1);
  component.destroy();assert.equal(container.children.length,0);
});
