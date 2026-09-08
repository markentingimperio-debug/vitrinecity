import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createWebStoryAI,normalizeStoryCopy} from '../web-story-ai.js';
import {storyPageVisibleText} from '../web-story-render.js';

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
test('thin, repeated, fabricated numbers and unsplittable words stop before image/review',async()=>{
  const variants=[{...copy(),pages:copy().pages.slice(0,3)},{...copy(),pages:copy().pages.map(()=>({text:pages[1]}))},{...copy(),title:'Cultivo com 999 resultados'},{...copy(),pages:copy().pages.map((p,i)=>i===0?{text:'x'.repeat(101)}:p)}];
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

test('store stories require and display their actual public photo before generating conceptual artwork',async()=>{
  const store={...source(),kind:'store',commercial:true,sourcePath:'/loja/fixture/jardim',image_url:'/assets/fachada-jardim.jpg'};
  const first=setup(),published=await first.ai.generate(store);assert.equal(published.approved,true);assert.equal(published.draft.pages[1].image,store.image_url);assert.equal(published.draft.pages[1].imageCredit,'Foto do catálogo');assert.equal(published.draft.sourcePath,store.sourcePath);assert.equal(first.calls.image.length,1);
  const missing=setup(),held=await missing.ai.generate({...store,image_url:''});assert.equal(held.notes,'catalog_photo_missing');assert.equal(missing.calls.text.length,0);assert.equal(missing.calls.image.length,0);
});

test('recipe generation ends with a compact character contract and requires complete quantities or an insufficient result',async()=>{
  const fixture=setup({generation:{insufficient:true}}),recipe={...source(),group:'recipes',portal:'receitas'};
  const result=await fixture.ai.generate(recipe);assert.equal(result.notes,'source_insufficient_for_ten_pages');assert.equal(fixture.calls.text.length,1);assert.equal(fixture.calls.image.length,0);
  const instructions=fixture.calls.text[0].system.slice(fixture.calls.text[0].system.indexOf('CONFERÊNCIA FINAL DO JSON:'));
  assert.match(instructions,/exatamente 12 objetos/);assert.match(instructions,/UMA FRASE CURTA/);assert.match(instructions,/CARACTERES COM ESPAÇOS, não de palavras/);assert.match(instructions,/entre 650 e 1100 caracteres/);assert.match(instructions,/quantidades de TODOS os ingredientes/);assert.match(instructions,/Não substitua medidas/);assert.match(instructions,/receita completa dentro dos limites/);
});

test('observed twelve-paragraph response stays rejected without dropping content or paying for an image',async()=>{
  const lengths=[202,163,172,146,161,146,177,135,155,141,164,164];
  const generation={...copy(),pages:lengths.map((length,i)=>({text:('Parágrafo '+String.fromCharCode(65+i)+' '+('informação extensa '.repeat(20))).slice(0,length)}))};
  const fixture=setup({generation}),result=await fixture.ai.generate(source());assert.equal(generation.pages.map(p=>p.text).join(' ').length,1937);assert.equal(result.notes,'ai_ten_pages_required');assert.equal(fixture.calls.text.length,1);assert.equal(fixture.calls.image.length,0);assert.equal(result.draft,null);
});
test('affiliate disclosure repair reserves penultimate space and keeps displaced text',async()=>{
  const {ai,calls}=setup();const result=await ai.generate({...source(),kind:'affiliate',commercial:true,facts:{affiliate:true},sourcePath:'/ofertas/plantas',image_url:'/assets/planta.jpg'});
  assert.equal(result.approved,true);assert.ok(result.draft.pages.at(-2).text.length<=45);assert.equal(calls.text.length,2);assert.equal(calls.image.length,1);
  assert.ok(result.draft.pages.map(p=>p.text).join(' ').includes(pages[8]));assert.ok(result.draft.pages.every((_,i)=>[...storyPageVisibleText(result.draft,i)].length<=180));
});
test('common oversized model copy is split before review without losing or repeating source words',async()=>{
  const generation=copy();generation.pages[0].text='Observe o seu ambiente e descubra como organizar o cuidado com suas plantas.';
  generation.pages[1].text+=' '+generation.pages[2].text;generation.pages.splice(2,1);
  generation.pages.at(-1).text='Gostou de observar o cultivo? Você pode explorar este assunto e conhecer outras ideias na VitrineCity com calma.';
  const original=generation.pages.map(p=>p.text).join(' '),normalized=normalizeStoryCopy(generation);
  const tokens=text=>text.split(/\s+/).reduce((m,word)=>(m[word]=(m[word]||0)+1,m),{}),old=tokens(original),next=tokens(normalized.pages.map(p=>p.text).join(' '));
  for(const [word,n] of Object.entries(old))assert.ok(next[word]>=n,'lost word: '+word);
  assert.ok(normalized.pages.map(p=>p.text).join(' ').includes(original),'the original narrative order is preserved');
  assert.ok(normalized.pages.length>=10&&normalized.pages.length<=15);assert.equal(new Set(normalized.pages.map(p=>p.text)).size,normalized.pages.length);
  const x=setup({generation}),result=await x.ai.generate(source());assert.equal(result.approved,true);assert.equal(x.calls.text.length,2);assert.equal(x.calls.image.length,1);
  assert.deepEqual(JSON.parse(x.calls.text[1].user).story.pages,result.draft.pages.map(p=>({text:p.text})),'review sees the repaired text');
  assert.ok(result.draft.pages.every((_,i)=>[...storyPageVisibleText(result.draft,i)].length<=180));
});
test('normalization never conceals unsupported numbers or accepts an ungrounded review',async()=>{
  const generation=copy();generation.pages[1].text+=' Foram 999 resultados adicionais e exclusivos para o nosso público.';
  const first=setup({generation});assert.equal((await first.ai.generate(source())).notes,'ai_unbacked_numbers');assert.equal(first.calls.image.length,0);
  const second=setup({generation:{...copy(),pages:copy().pages.map((p,i)=>i===1?{text:p.text+' Consulte também a página do assunto.'}:p)},review:{...approved(),grounded:false}});
  assert.equal((await second.ai.generate(source())).approved,false);assert.equal(second.calls.image.length,0);
});
test('long model responses fit up to twenty screens without dropping the original narrative',()=>{
  const generated=copy();for(const page of generated.pages)page.text+=' Observe também o contexto apresentado antes de avaliar esta informação.';
  const original=generated.pages.map(p=>p.text).join(' '),repaired=normalizeStoryCopy(generated);
  assert.ok(repaired.pages.length>15&&repaired.pages.length<=20);
  assert.ok(repaired.pages.map(p=>p.text).join(' ').includes(original));
  assert.ok(repaired.pages.slice(1,-2).every(p=>p.text.length<=100));
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
