import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createWebStoryAI} from '../web-story-ai.js';

const pages=[
  'Descubra um cultivo mais atento.',
  'Observe a luminosidade do local antes de escolher onde deixar a planta durante o dia.',
  'Leia a orientação do cultivo e compare as necessidades da espécie com o ambiente da casa.',
  'Confira a umidade do substrato antes de regar, observando também as condições do ambiente.',
  'Escolha um recipiente com drenagem e acompanhe como a água escoa após a rega da planta.',
  'Avalie o espaço disponível para o crescimento e mantenha o vaso em um local de fácil acesso.',
  'Observe mudanças nas folhas e consulte a orientação específica da espécie antes de agir.',
  'Compare as informações do catálogo com as necessidades do seu cultivo antes da escolha.',
  'Reúna suas dúvidas sobre uso e cuidados antes de consultar a página completa.',
  'Curioso por novas descobertas? Explore outras ideias na VitrineCity.'
];
const copy=()=>({title:'Como observar o cultivo em casa',description:'Um guia de observação para conhecer o ambiente e consultar as necessidades de cada planta.',pages:pages.map(text=>({text})),imagePrompt:'Um jardim doméstico conceitual, luz suave, composição vertical.'});
const approved=()=>({approved:true,grounded:true,original:true,complete:true,nonRepetitive:true,commerceBalanced:true,risk:'low',notes:'Conteúdo coerente com a fonte; qualidade editorial revisada.'});
const source=()=>({id:'article-public',kind:'article',group:'trends',portal:'plantas-e-jardinagem',title:'Cuidados com plantas',summary:'Observe o ambiente e as necessidades de cada espécie antes de cuidar de plantas em casa.',body:pages.slice(1,9).join(' '),sourcePath:'/artigo/cultivo',sources:[{title:'Guia próprio',url:'https://vitrinecity.com/artigo/cultivo'}],facts:{},commercial:false});
function setup({generation=copy(),review=approved(),imageError=false}={}) {
  const calls={text:[],image:[],assets:[]};
  const ai=createWebStoryAI({siteUrl:'https://vitrinecity.com',requestText:async(system,user,tokens)=>{calls.text.push({system,user,tokens});return JSON.stringify(calls.text.length===1?generation:review);},requestImage:async prompt=>{calls.image.push(prompt);if(imageError)throw Error('provider-private-detail');return '/uploads/generated-videos/story.png';},assets:{image:async(url,options)=>{calls.assets.push(url);if(!url.startsWith('/'))throw Error('remote');return {url,width:options?.logo?192:1080,height:options?.logo?192:1920,hash:'a'.repeat(64)};},poster:async()=>'/story-assets/poster.jpg'}});
  return {ai,calls};
}
test('one generation, independent review, one image; complete 10 page draft only',async()=>{
  const {ai,calls}=setup(),result=await ai.generate(source());
  assert.equal(result.approved,true);assert.equal(result.draft.pages.length,10);assert.equal(calls.text.length,2);assert.equal(calls.image.length,1);
  assert.equal(result.review.qualityCheckOnly,true);assert.equal(result.draft.homeCta,'Explorar a VitrineCity');assert.equal(result.draft.sourcePath,'/artigo/cultivo');
  assert.match(calls.text[0].system,/DADO NÃO CONFIÁVEL/);assert.match(calls.text[1].system,/independente/);
  assert.equal(result.draft.pages[0].imageCredit,'Ilustração IA');assert.equal(result.published,undefined);
});
test('incomplete, repeated, fabricated numbers and oversized cover stop before image/review',async()=>{
  const variants=[{...copy(),pages:copy().pages.slice(0,9)},{...copy(),pages:copy().pages.map(()=>({text:pages[1]}))},{...copy(),title:'Cultivo com 999 resultados'},{...copy(),pages:copy().pages.map((p,i)=>i===0?{text:'x'.repeat(36)}:p)}];
  for(const generation of variants){const {ai,calls}=setup({generation}),result=await ai.generate(source());assert.equal(result.approved,false);assert.equal(calls.text.length,1);assert.equal(calls.image.length,0);}
});
test('news and Trends without fetched independent evidence have no AI calls',async()=>{
  for(const changes of [{group:'news',portal:'noticias'},{kind:'trend',evidenceReady:false},{kind:'trend',evidenceReady:true,sources:[{publisher:'globo',checkedAt:'now',excerptHash:'x'},{publisher:'globo',checkedAt:'now',excerptHash:'y'}]}]){const {ai,calls}=setup(),result=await ai.generate({...source(),...changes});assert.equal(result.notes,'source_needs_verified_evidence');assert.equal(calls.text.length,0);assert.equal(calls.image.length,0);}
});
test('review fail and provider error hold without retry or raw private details',async()=>{
  const first=setup({review:{...approved(),grounded:false}}),a=await first.ai.generate(source());assert.equal(a.approved,false);assert.equal(first.calls.image.length,0);
  const second=setup({imageError:true}),b=await second.ai.generate(source());assert.equal(b.notes,'ai_image_unavailable');assert.equal(second.calls.image.length,1);assert.doesNotMatch(JSON.stringify(b),/provider-private-detail/);
});
test('source change or cancellation never reaches image generation',async()=>{
  const {ai,calls}=setup();let checks=0;await assert.rejects(ai.generate(source(),{isCurrent:()=>++checks<3}),/ai_source_changed/);assert.equal(calls.image.length,0);
  const controller=new AbortController();controller.abort();await assert.rejects(ai.generate(source(),{signal:controller.signal}),/ai_aborted/);
});
test('real catalog photo remains inside affiliate draft; outbound CTA ignored',async()=>{
  const generation={...copy(),sourcePath:'https://evil.test',cta:'Compre agora'};generation.pages[8].text='Confira detalhes antes de escolher seu vaso.';
  const {ai,calls}=setup({generation});
  const result=await ai.generate({...source(),kind:'affiliate',commercial:true,facts:{affiliate:true},sourcePath:'/ofertas/plantas',image_url:'/assets/planta.jpg'});
  assert.equal(result.approved,true);assert.equal(result.draft.pages[1].image,'/assets/planta.jpg');assert.equal(result.draft.pages[1].imageCredit,'Foto do catálogo');
  assert.equal(result.draft.sourcePath,'/ofertas/plantas');assert.match(result.draft.affiliateDisclosure,/comissão/);assert.equal(calls.image.length,1);
});
test('affiliate disclosure reserves penultimate page space before paid image',async()=>{
  const {ai,calls}=setup();const result=await ai.generate({...source(),kind:'affiliate',commercial:true,facts:{affiliate:true},sourcePath:'/ofertas/plantas',image_url:'/assets/planta.jpg'});
  assert.equal(result.approved,false);assert.equal(result.notes,'ai_page_invalid');assert.equal(calls.text.length,1);assert.equal(calls.image.length,0);
});
test('bad destination and too little source stay pending without calls',async()=>{
  for(const s of [{...source(),sourcePath:'//evil.test/a'},{...source(),sourcePath:'/api/admin'},{...source(),body:'Pequeno.',summary:'Breve.'}]){const {ai,calls}=setup();assert.equal((await ai.generate(s)).approved,false);assert.equal(calls.text.length,0);}
});
function verifiedTrend(){const s=source(),excerpt=s.body.repeat(2),evidence=['bbc','estadao'].map(publisher=>({publisher,title:'Fonte '+publisher,url:'https://'+publisher+'.example/cultivo',checkedAt:'2026-09-08T18:00:00Z',excerpt,excerptHash:createHash('sha256').update(excerpt).digest('hex')}));return {...s,kind:'trend',evidenceReady:true,facts:{evidence},sources:evidence.map(({excerpt,...citation})=>citation)};}
test('Trends create full companion article in same generation and independent review before one image',async()=>{
  const generation={...copy(),articleBody:source().body.repeat(2)},x=setup({generation}),result=await x.ai.generate(verifiedTrend());
  assert.equal(result.approved,true);assert.equal(result.draft.articleBody,generation.articleBody);assert.equal(result.draft.title,generation.title);assert.equal(result.draft.description,generation.description);
  assert.equal(x.calls.text.length,2);assert.equal(x.calls.text[0].tokens,4000);assert.equal(x.calls.image.length,1);assert.equal(JSON.parse(x.calls.text[1].user).story.articleBody,generation.articleBody);assert.match(x.calls.text[1].system,/artigo completo/);
});
test('Trends missing/short article or unsupported article numbers stop before review and image',async()=>{
  for(const articleBody of [undefined,'Curto.',source().body.repeat(2)+' Foram 999 resultados.']){const x=setup({generation:{...copy(),articleBody}}),result=await x.ai.generate(verifiedTrend());assert.equal(result.approved,false);assert.equal(x.calls.text.length,1);assert.equal(x.calls.image.length,0);}
  const x=setup({generation:{...copy(),articleBody:source().body.repeat(2)}}),result=await x.ai.generate(source());assert.equal(result.approved,true);assert.equal(result.draft.articleBody,undefined,'existing page sources must not create recursive companion articles');
});
