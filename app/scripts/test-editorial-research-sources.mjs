import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import Database from 'better-sqlite3';
import {createWebStoryResearch,extractStoryRecipe,extractStoryResearchArticle,storyResearchTopicMatches,storyResearchUrl} from '../web-story-research.js';

const now=Date.parse('2026-09-09T19:00:00Z'),stamp=new Date(now).toISOString(),url='https://panelinha.com.br/receita/bolo-de-cenoura',sha=s=>createHash('sha256').update(s).digest('hex');
const paragraph='O Banco Central anunciou uma mudança na taxa de juros e apresentou os dados utilizados para a decisão. A instituição publicou as informações oficiais e os critérios da análise, com detalhes sobre o acompanhamento dos preços e da inflação. A decisão passa a orientar a política monetária até a próxima reunião. ';
const article=(title='Banco Central anuncia nova taxa de juros',body=paragraph,date=stamp)=>`<html><head><meta property="article:published_time" content="${date}"></head><article><h1>${title}</h1><p>${body}</p><p>A documentação permite consultar os números e as justificativas apresentadas pelos responsáveis. ${body}</p></article></html>`;
const steps=['Bata a cenoura com os ovos e o óleo até formar uma mistura homogênea. Transfira para a tigela e adicione a farinha aos poucos, mexendo delicadamente.','Coloque a massa na forma preparada e leve ao forno até que o centro esteja assado. Faça o teste do palito e espere amornar antes de desenformar o bolo.'];
const ld=(extra={})=>'<script type="application/ld+json">'+JSON.stringify({'@type':'Recipe',name:'Bolo de cenoura',recipeIngredient:['3 cenouras','3 ovos'],recipeInstructions:steps.map(text=>({'@type':'HowToStep',text})),...extra})+'</script>';
const rawRecipe=(quoted=false)=>{const attr=s=>quoted?'"'+s+'"':s;return `<html><h1 class="headerRecipeImageH1 insideCarousel">Bolo de cenoura com cobertura</h1><h3 class="tCs tDivT">Para o bolo</h3><ul class=js_ga_ob id=${attr('recipe_bk_0_in')}><li>3 cenouras m&eacute;dias</li><li>2 x&iacute;caras de farinha</li></ul><ol class=${attr('olStd')} style="counter-reset:item 0"><li>${steps[0]}</li></ol><aside>Publicidade</aside><ol class=${attr('olStd')} style="counter-reset:item 1"><li>${steps[1]}</li></ol><h3 class="tCs tDivT">Para a cobertura</h3><ul id=${attr('recipe_bk_1_in')}><li>3 colheres de a&ccedil;&uacute;car</li><li>1 colher de chocolate</li></ul><ol class=${attr('olStd')} style="counter-reset:item 0"><li>Leve os ingredientes da cobertura ao fogo baixo e mexa at&eacute; engrossar, sem deixar a mistura queimar.</li></ol><nav><ul><li>Receita de salada não pertence ao bolo</li></ul></nav></html>`;};
function fixture({respond,results,paused=false}={}){
  const db=new Database(':memory:');let allowed=!paused;const calls=[],searches=[];
  const research=createWebStoryResearch({db,now:()=>now,canRun:()=>allowed,requirePreparedEvidence:true,fetchImpl:async(url,options)=>{calls.push(url);assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');return await respond?.(url,options)||new Response(article(),{headers:{'content-type':'text/html'}});},searchSources:async args=>{searches.push(args);return typeof results==='function'?results(args):results||[{url:'https://www.bbc.com/portuguese/juros',title:'descoberta'},{url:'https://agenciabrasil.ebc.com.br/economia/noticia/juros',title:'descoberta'}];}});
  const add=(index=1,title='Banco Central aumenta juros no Brasil',refs=[])=>research.addDiscoveredTopic({id:'channel-video'+String(index).padStart(6,'0'),title,group:'news',publishedAt:stamp,refs});
  return {db,research,calls,searches,add,pause:()=>allowed=false,close:()=>db.close()};
}
test('Recipe JSON-LD preserves complete exact recipe and rejects mixed, missing, unknown or oversized steps',()=>{
  const r=extractStoryRecipe(ld(),url);assert.deepEqual(r.steps,steps);assert.deepEqual(r.ingredients,['3 cenouras','3 ovos']);
  for(const html of [ld()+ld(),ld({recipeInstructions:[{'@type':'HowToStep',text:steps[0]},{'@type':'Unknown',text:steps[1]}]}),ld({recipeIngredient:[]}),ld({url:'https://panelinha.com.br/receita/outra'}),ld({recipeInstructions:Array(61).fill(steps[0])})])assert.throws(()=>extractStoryRecipe(html,url),/research_recipe_incomplete/);
  assert.throws(()=>extractStoryRecipe(ld(),'https://evil.test/receita/bolo'),/research_recipe_origin_denied/);
});
test('real Panelinha layout with bare or quoted attributes preserves both components and split preparation lists',()=>{
  for(const quoted of [true,false]){const r=extractStoryRecipe(rawRecipe(quoted),url);assert.equal(r.components.length,2);assert.equal(r.ingredients.length,4);assert.equal(r.steps.length,3);assert.equal(r.components[0].steps.length,2);assert.match(r.ingredients[0],/cenouras médias/);assert.match(r.ingredients[2],/açúcar/);assert.doesNotMatch(JSON.stringify(r),/Publicidade|Receita de salada|&[a-z]+;/);}
});
test('partial HTML recipe, absent component ingredients, lost initial step or nav-only recipe is held',()=>{
  const html=rawRecipe();for(const bad of [html.replace('</html>',''),html.replace(/<ul id=recipe_bk_1_in>[\s\S]*?<\/ul>/,''),html.replace(/<ol class=olStd style="counter-reset:item 0">[\s\S]*?<\/ol>/,''),'<html><h1>Bolo de cenoura</h1><ul><li>Ingredientes</li></ul><ol><li>'+steps[0]+'</li></ol></html>'])assert.throws(()=>extractStoryRecipe(bad,url),/research_recipe_incomplete/);
});
test('article extracts actual source date and structured body, never navigation, maintenance or paywall',()=>{
  assert.equal(storyResearchUrl('https://www.bbc.com/portuguese/topics/cmdm4ynm24kt'),'');assert.equal(storyResearchUrl('https://www.bbc.com/portuguese/'),'');assert.equal(storyResearchUrl('https://www.bbc.com/portuguese/articles/ckgp21dzrk4o'),'https://www.bbc.com/portuguese/articles/ckgp21dzrk4o');
  assert.equal(extractStoryResearchArticle(article()).publishedAt,stamp);
  const html='<script type="application/ld+json">'+JSON.stringify({'@type':'NewsArticle',headline:'Banco Central e juros',datePublished:'2025-01-01',articleBody:paragraph.repeat(3)})+'</script>';
  assert.equal(extractStoryResearchArticle(html).publishedAt,'2025-01-01T00:00:00.000Z');
  for(const bad of ['<html><nav>'+paragraph.repeat(5)+'</nav></html>',article('Site em manutenção'),html.replace('"datePublished"','"isAccessibleForFree":false,"datePublished"')])assert.throws(()=>extractStoryResearchArticle(bad),/research_no_article|research_access_restricted/);
});
test('topic matching rejects generic Brazil overlap and retains relevant compound names',()=>{
  const football={title:'Brasil vence partida de futebol',excerpt:'A seleção do Brasil venceu a partida de futebol e o público do Brasil acompanhou a disputa. '.repeat(8)};
  assert.equal(storyResearchTopicMatches('Banco Central aumenta juros no Brasil',football),false);assert.equal(storyResearchTopicMatches('Saiba como no Brasil',football),false);
  assert.equal(storyResearchTopicMatches('Banco Central aumenta juros no Brasil',extractStoryResearchArticle(article())),true);
  assert.equal(storyResearchTopicMatches('Real Madrid confirma calendário de jogos',{title:'Real Madrid confirma calendário',excerpt:'O Real Madrid divulgou seu calendário de jogos. '.repeat(15)}),true);
  assert.equal(storyResearchTopicMatches('Palmeiras',{title:'Palmeiras joga',excerpt:'O Palmeiras confirmou a partida. Palmeiras atualizou o calendário.'}),true);
});
test('fallback fetches real articles from two families before automatic eligibility, no snippets or quota',async()=>{
  const x=fixture();x.add();assert.equal(x.research.list({automatic:true}).length,0);assert.deepEqual(await x.research.prepareCandidates(),{checked:1,ready:1});
  const candidate=x.research.list({automatic:true})[0];assert.equal(candidate.evidenceReady,true);assert.equal(candidate.sources.length,2);assert.equal(candidate.facts.evidence[0].publishedAt,stamp);assert.equal(x.searches.length,1);assert.equal(x.calls.length,2);assert.equal(x.db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='web_story_automation_jobs'").get().n,0);x.close();
});
test('two unrelated fetched sources sharing Brazil never qualify, including legacy cached proof',async()=>{
  const body='A seleção do Brasil venceu a partida de futebol durante o campeonato. Os jogadores do Brasil comemoraram o resultado com os torcedores presentes no estádio. ';const x=fixture({respond:async()=>new Response(article('Brasil vence partida de futebol',body.repeat(3)),{headers:{'content-type':'text/html'}})});x.add();await x.research.prepareCandidates();assert.equal(x.research.list({automatic:true}).length,0);
  const excerpt=body.repeat(5),evidence=[['bbc','https://www.bbc.com/a'],['ebc','https://agenciabrasil.ebc.com.br/a']].map(([publisher,url])=>({publisher,url,title:'Brasil vence futebol',excerpt,excerptHash:sha(excerpt),checkedAt:stamp}));
  x.db.prepare('UPDATE web_story_trend_topics SET evidence_json=?,checked_at=?').run(JSON.stringify(evidence),stamp);assert.equal(x.research.list()[0].evidenceReady,false);assert.equal(x.research.automaticEligible(x.research.list()[0]),false);assert.equal(JSON.parse(x.db.prepare('SELECT evidence_json FROM web_story_trend_topics').get().evidence_json).length,2,'historical cache is retained');x.close();
});
test('old articles, snippets only or two domains of one publisher cannot qualify as current news',async()=>{
  for(const options of [{respond:async()=>new Response(article(undefined,undefined,'2020-01-01'),{headers:{'content-type':'text/html'}})},{respond:async()=>new Response('<main><p>Um resumo não é a matéria completa.</p></main>',{headers:{'content-type':'text/html'}}),results:[{url:'https://www.bbc.com/a',snippet:paragraph.repeat(3)},{url:'https://agenciabrasil.ebc.com.br/a',snippet:paragraph.repeat(3)}]},{results:[{url:'https://agenciabrasil.ebc.com.br/noticia/a'},{url:'https://tvbrasil.ebc.com.br/noticia/b'}]}]){const x=fixture(options);x.add();await x.research.prepareCandidates();assert.equal(x.research.list()[0].evidenceReady,false);assert.equal(x.research.list({automatic:true}).length,0);x.close();}
});
test('hourly research checks at most three topics; one hour cooldown and public origin limits remain',async()=>{
  const x=fixture({results:Array.from({length:15},(_,i)=>({url:'https://evil.test/'+i}))});for(let n=1;n<=5;n++)x.add(n);assert.deepEqual(await x.research.prepareCandidates(),{checked:3,ready:0});assert.equal(x.searches.length,3);assert.equal(x.calls.length,0);assert.deepEqual(await x.research.prepareCandidates(),{checked:2,ready:0});assert.deepEqual(await x.research.prepareCandidates(),{checked:0,ready:0});x.close();
});
test('pause or source change after an async search cannot store new proof or issue subsequent GETs',async()=>{
  let complete;const promise=new Promise(done=>complete=done);const x=fixture({results:()=>promise});x.add();const work=x.research.prepareCandidates();x.pause();complete([{url:'https://www.bbc.com/a'}]);await assert.rejects(work,/research_aborted/);assert.equal(x.calls.length,0);assert.equal(x.research.list()[0].evidenceReady,false);x.close();
  let count=0;const y=fixture({respond:async()=>{if(++count===1)y.db.prepare("UPDATE web_story_trend_topics SET title='Outro assunto completamente diferente'").run();return new Response(article(),{headers:{'content-type':'text/html'}});}});y.add();await assert.rejects(y.research.prepareCandidates(),/research_source_changed/);assert.equal(y.research.list()[0].evidenceReady,false);y.close();
});
