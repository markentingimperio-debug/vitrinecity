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
const recipeBody=`Tempo aproximado: 1 hora. Rendimento: 12 fatias.

Ingredientes da massa: 3 cenouras médias descascadas e cortadas; 3 ovos; 1 xícara de óleo; 2 xícaras de açúcar; 2 e meia xícaras de farinha de trigo; 1 colher de sopa de fermento químico. Para a cobertura: 4 colheres de sopa de chocolate em pó; 4 colheres de sopa de açúcar; 2 colheres de sopa de manteiga; meia xícara de leite.

Preparo: aqueça o forno a 180 °C e unte uma forma média. Bata no liquidificador as cenouras, os ovos e o óleo até obter uma mistura uniforme. Em uma tigela, misture o açúcar e a farinha. Adicione o líquido aos poucos e mexa somente até incorporar. Por último, acrescente o fermento delicadamente.

Asse por aproximadamente 35 a 45 minutos. O tempo varia conforme o forno; faça o teste do palito no centro e retire quando ele sair sem massa crua. Espere amornar antes de desenformar.

Para a cobertura, leve todos os ingredientes ao fogo baixo, mexendo até engrossar levemente. Espalhe sobre o bolo ainda morno. Use utensílios secos, conserve o bolo coberto e, em dias quentes, mantenha sob refrigeração se a cobertura levar leite. A farinha deve ser medida sem compactar para evitar uma massa pesada.`;
const recipeSource=()=>({...source(),group:'recipes',portal:'receitas',title:'Bolo de cenoura com cobertura de chocolate',summary:'Bolo caseiro com as quantidades e o modo de preparo completos.',body:recipeBody,sourcePath:'/artigo/bolo-de-cenoura'});
function setup({generation=copy(),review=approved(),imageError=false}={}) {
  const calls={text:[],image:[],assets:[]};
  const ai=createWebStoryAI({siteUrl:'https://vitrinecity.com',requestText:async(system,user,tokens)=>{calls.text.push({system,user,tokens});return JSON.stringify(calls.text.length===1?generation:review);},requestImage:async prompt=>{calls.image.push(prompt);if(imageError)throw Error('provider-private-detail');return '/uploads/generated-videos/story.png';},assets:{image:async(url,options)=>{calls.assets.push(url);if(!url.startsWith('/'))throw Error('remote');return {url,width:options?.logo?192:1080,height:options?.logo?192:1920,hash:'a'.repeat(64)};},poster:async()=>'/story-assets/poster.jpg'}});
  return {ai,calls};
}
test('one generation, independent review, one image; complete 10 page draft only',async()=>{
  const {ai,calls}=setup(),result=await ai.generate(source());
  assert.equal(result.approved,true);assert.equal(result.draft.pages.length,10);assert.equal(calls.text.length,2);assert.equal(calls.image.length,1);
  assert.equal(result.review.qualityCheckOnly,true);assert.equal(result.draft.homeCta,'');assert.equal(result.draft.cta,'Ler matéria completa');assert.equal(result.draft.sourcePath,'/artigo/cultivo');
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

test('recipe generation requests only bounded metadata because the complete procedure is already laid out locally',async()=>{
  const fixture=setup({generation:{insufficient:true}}),recipe=recipeSource();
  const result=await fixture.ai.generate(recipe);assert.equal(result.notes,'source_insufficient_for_ten_pages');assert.equal(fixture.calls.text.length,1);assert.equal(fixture.calls.image.length,0);
  const instructions=fixture.calls.text[0].system.slice(fixture.calls.text[0].system.indexOf('CONTRATO ESPECÍFICO DESTA RECEITA:'));
  assert.match(instructions,/preservando todas as palavras/);assert.match(instructions,/quantidades de TODOS os ingredientes/);assert.match(instructions,/Retorne somente JSON com title, description e imagePrompt/);assert.match(instructions,/NÃO escreva pages/);assert.match(instructions,/retorne somente \{"insufficient":true\}/);assert.equal(fixture.calls.text[0].tokens,700);
});

test('observed twelve-paragraph response stays rejected without dropping content or paying for an image',async()=>{
  const lengths=[202,163,172,146,161,146,177,135,155,141,164,164];
  const generation={...copy(),pages:lengths.map((length,i)=>({text:('Parágrafo '+String.fromCharCode(65+i)+' '+('informação extensa '.repeat(20))).slice(0,length)}))};
  const fixture=setup({generation}),result=await fixture.ai.generate(source());assert.equal(generation.pages.map(p=>p.text).join(' ').length,1937);assert.equal(result.notes,'ai_ten_pages_required');assert.equal(fixture.calls.text.length,1);assert.equal(fixture.calls.image.length,0);assert.equal(result.draft,null);
});

test('a complete published recipe keeps every source word and amount when the model returns an oversized incomplete recap',async()=>{
  const generation={...copy(),title:'Bolo de cenoura completo',description:'Conheça as quantidades e todas as etapas desta receita caseira.',pages:Array.from({length:12},(_,i)=>({text:('Resumo '+String.fromCharCode(65+i)+' '+('Um comentário genérico sobre sabor. '.repeat(8))).slice(0,170)}))};
  const fixture=setup({generation}),result=await fixture.ai.generate(recipeSource());assert.equal(result.approved,true,result.notes);assert.ok(result.draft.pages.length>=10&&result.draft.pages.length<=20);
  const exactBody=result.draft.pages.slice(1,-2).map(p=>p.text).join(' ');assert.equal(exactBody,recipeBody.replace(/\s+/g,' '));assert.ok(!exactBody.includes('comentário genérico'));
  for(const quantity of ['3 cenouras','3 ovos','2 e meia xícaras','meia xícara de leite','180 °C','35 a 45 minutos'])assert.ok(exactBody.includes(quantity),quantity);
  assert.equal(fixture.calls.text.length,2);assert.equal(fixture.calls.image.length,1);assert.deepEqual(JSON.parse(fixture.calls.text[1].user).story.pages,result.draft.pages.map(p=>({text:p.text})));assert.equal(result.draft.cta,'Ver modo de preparo');assert.ok(result.draft.pages.every((_,i)=>[...storyPageVisibleText(result.draft,i)].length<=180));
});

test('metadata-only recipe output reaches independent review with the complete locally prepared pages',async()=>{
  const generation={title:'Bolo de cenoura completo',description:'Ingredientes, quantidades e preparo da receita caseira de bolo de cenoura.',imagePrompt:'Ilustração conceitual vertical de um bolo.'};
  const fixture=setup({generation}),result=await fixture.ai.generate(recipeSource());assert.equal(result.approved,true,result.notes);assert.equal(fixture.calls.text.length,2);assert.equal(fixture.calls.text[0].tokens,700);assert.equal(fixture.calls.text[1].tokens,1000);assert.equal(fixture.calls.image.length,1);assert.equal(JSON.parse(fixture.calls.text[1].user).story.pages.slice(1,-2).map(p=>p.text).join(' '),recipeBody.replace(/\s+/g,' '));
});

test('recipe review distinguishes internal layout from third-party copying without bypassing originality approval',async()=>{
  const recipe=setup(),result=await recipe.ai.generate(recipeSource());assert.equal(result.approved,true);
  const prompt=recipe.calls.text[1].system;
  assert.match(prompt,/CONTEXTO DE DIAGRAMAÇÃO/);assert.match(prompt,/receita já publicada na própria plataforma/);
  assert.match(prompt,/não é, por si só, motivo para reprovar originalidade/);assert.match(prompt,/cópia extensa de terceiros/);
  assert.match(prompt,/não presuma autoria, licença ou exclusividade/);assert.match(prompt,/continuam motivo de reprovação/);
  const other=setup();await other.ai.generate(source());assert.doesNotMatch(other.calls.text[1].system,/CONTEXTO DE DIAGRAMAÇÃO/);assert.match(other.calls.text[1].system,/cópia extensa;/);
  const denied=setup({review:{...approved(),original:false}}),held=await denied.ai.generate(recipeSource());assert.equal(held.notes,'ai_review_held');assert.equal(held.approved,false);assert.equal(denied.calls.text.length,2);assert.equal(denied.calls.image.length,0);
});

test('recipe layout never invents missing structure, truncates long sources or forces short content',async()=>{
  for(const body of [recipeBody.replace('Ingredientes da massa:','Lista da massa:'),recipeBody.replace('Preparo:','Observações:'),recipeBody.repeat(2),'Ingredientes: 1 ovo. Preparo: misture.']){
    const fixture=setup(),result=await fixture.ai.generate({...recipeSource(),body});assert.equal(result.notes,'source_insufficient_for_ten_pages');assert.equal(fixture.calls.text.length,0);assert.equal(fixture.calls.image.length,0);assert.equal(result.draft,null);
  }
});

test('source-based recipe layout still requires truthful metadata, approval and a current source',async()=>{
  const metadata=setup({generation:{...copy(),title:'Bolo com 999 benefícios'}});assert.equal((await metadata.ai.generate(recipeSource())).notes,'ai_unbacked_numbers');assert.equal(metadata.calls.image.length,0);
  const unapproved=setup({review:{...approved(),complete:false}});assert.equal((await unapproved.ai.generate(recipeSource())).notes,'ai_review_held');assert.equal(unapproved.calls.image.length,0);assert.equal(unapproved.calls.text.length,2);
  const stopped=setup();await assert.rejects(stopped.ai.generate(recipeSource(),{isCurrent:()=>stopped.calls.text.length===0}),/ai_source_changed/);assert.equal(stopped.calls.text.length,1);assert.equal(stopped.calls.image.length,0);
});
test('affiliate disclosure repair reserves final space and keeps displaced text',async()=>{
  const {ai,calls}=setup();const result=await ai.generate({...source(),kind:'affiliate',commercial:true,facts:{affiliate:true},sourcePath:'/ofertas/plantas',image_url:'/assets/planta.jpg'});
  assert.equal(result.approved,true);assert.ok(result.draft.pages.at(-1).text.length<=45);assert.equal(result.draft.homeCta,'');assert.equal(result.draft.cta,'Ver oferta');assert.equal(calls.text.length,2);assert.equal(calls.image.length,1);
  assert.ok(result.draft.pages.map(p=>p.text).join(' ').includes(pages[8]));assert.ok(result.draft.pages.every((_,i)=>[...storyPageVisibleText(result.draft,i)].length<=180));
});

test('AI contextual final buttons use only the internal source and never claim a discount',async()=>{
  for(const [kind,group,label] of [['article','recipes','Ver modo de preparo'],['product','products','Ver oferta'],['affiliate','products','Ver oferta'],['store','services','Visitar loja'],['course','services','Ver curso'],['service','services','Ver serviço'],['city','trends','Explorar cidade']]){
    const generation={...copy(),cta:'Cupom secreto',homeCta:'Clique para ganhar',sourcePath:'https://evil.test/offer'};
    const fixture=setup({generation}),item={...(group==='recipes'?recipeSource():source()),kind,group,portal:group==='recipes'?'receitas':'guia',commercial:!['article','city'].includes(kind),image_url:'/assets/catalog.jpg'};
    const result=await fixture.ai.generate(item);assert.equal(result.approved,true,kind+': '+result.notes);assert.equal(result.draft.cta,label);assert.equal(result.draft.homeCta,'');assert.equal(result.draft.sourcePath,item.sourcePath);assert.doesNotMatch(result.draft.cta,/cupom|desconto|ganhar/i);
    assert.match(fixture.calls.text[0].system,/página relacionada do nosso site/);assert.match(fixture.calls.text[0].system,/não esconda etapas, ingredientes ou fatos/);assert.match(fixture.calls.text[0].system,/sem confirmação explícita na fonte/);
    assert.match(fixture.calls.text[1].system,/não aprove teasers incompletos/);
    assert.ok(result.draft.pages.every((_,i)=>[...storyPageVisibleText(result.draft,i)].length<=180));
  }
});

test('existing home opt-in is budgeted before image generation with affiliate disclosure on the preceding page',async()=>{
  const fixture=setup(),item={...source(),kind:'affiliate',commercial:true,facts:{affiliate:true},image_url:'/assets/catalog.jpg'};
  const result=await fixture.ai.generate(item,{buttons:{cta:'Ver detalhes',homeCta:'Explorar a VitrineCity'}});
  assert.equal(result.approved,true,result.notes);assert.equal(result.draft.cta,'Ver detalhes');assert.equal(result.draft.homeCta,'Explorar a VitrineCity');assert.ok(result.draft.pages.at(-2).text.length<=45);
  assert.ok(result.draft.pages.every((_,i)=>[...storyPageVisibleText(result.draft,i)].length<=180));assert.equal(fixture.calls.image.length,1);
  assert.match(fixture.calls.text[0].system,/Compatibilidade com esta história já existente/);
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
