import test from 'node:test';
import assert from 'node:assert/strict';
import {renderWebStory,renderStoryDirectory,storyPageVisibleText} from '../web-story-render.js';
const options={origin:'https://vitrinecity.test',slug:'guia-visual'};
const fixture=()=>({title:'Aprenda a comparar',description:'Um guia visual com informações úteis para comparar com cuidado.',category:'Produtos',logo:'/assets/logo.png',poster:'/story-assets/cover.jpg',sourcePath:'/ofertas/oferta-teste',cta:'Ver oferta e condições',homeCta:'Explorar a VitrineCity',affiliateDisclosure:'Link de afiliado: podemos receber comissão.',sources:[{title:'Fonte pública',url:'https://example.org/artigo'}],pages:Array.from({length:10},(_,i)=>({text:'Confira as informações do catálogo.',image:'/assets/cover.jpg',width:900,height:1200,alt:'Descrição da imagem',imageCredit:i===1?'Foto do catálogo':'Ilustração IA'}))});
const pages=html=>[...html.matchAll(/<amp-story-page id="page-\d+">([\s\S]*?)<\/amp-story-page>/g)].map(match=>match[1]);
const visible=html=>html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();

test('home invitation closes the story and source, affiliate notice and sources stay on the penultimate page',()=>{
  const story=fixture(),html=renderWebStory(story,options),items=pages(html);
  assert.equal(items.length,10);assert.match(items[8],/href="https:\/\/vitrinecity.test\/ofertas\/oferta-teste"/);assert.match(items[8],/href="https:\/\/vitrinecity.test\/stories\/guia-visual\/fontes"/);assert.match(items[8],/Link de afiliado: podemos receber comissão/);
  assert.match(items[9],/<a href="https:\/\/vitrinecity.test\/">Explorar a VitrineCity<\/a>/);assert.ok(!items[9].includes('Link de afiliado'));assert.ok(!items[9].includes('/fontes'));
  assert.match(items[1],/Foto do catálogo/);assert.ok(!items[1].includes('Ilustração IA'));assert.match(items[0],/Ilustração IA/);
  for(let i=0;i<10;i++)assert.equal(visible(items[i]),storyPageVisibleText(story,i));
  assert.ok(storyPageVisibleText(story,8).length<=180);
});

test('legacy stories retain one final source CTA; disabling buttons never loses source disclosure',()=>{
  const story=fixture();delete story.homeCta;let items=pages(renderWebStory(story,options));assert.ok(!items[8].includes('amp-story-page-outlink'));assert.match(items[9],/Ver oferta e condições/);assert.ok(!items[9].includes('Explorar a VitrineCity'));
  story.cta=false;items=pages(renderWebStory(story,options));assert.ok(!items[9].includes('amp-story-page-outlink'));assert.match(items[9],/Link de afiliado/);assert.match(items[9],/Fontes/);
});

test('rendered text count includes escaping safely while invalid image-credit labels cannot inject markup',()=>{
  const story=fixture();story.title='<script>injetar</script>';story.pages[0].imageCredit='<script>not credit</script>';story.sourcePath='//evil.test';const html=renderWebStory(story,{...options,preview:true});
  assert.ok(!html.includes('<script>injetar'));assert.match(html,/&lt;script&gt;injetar/);assert.ok(!html.includes('not credit'));assert.match(html,/noindex,nofollow/);assert.ok(!html.includes('evil.test'));assert.match(html,/href="https:\/\/vitrinecity.test\/conteudo"/);
  assert.equal(storyPageVisibleText(story,-1),'');
});

test('directory keeps each page discoverable with its own canonical and bounded previous/next controls',()=>{
  const items=[{slug:'guia',title:'Título <seguro>',category:'Guias',poster:'/story-assets/cover.jpg'}];
  const middle=renderStoryDirectory(items,options.origin,{page:2,pages:3});assert.match(middle,/rel="canonical" href="https:\/\/vitrinecity.test\/stories\?page=2"/);assert.match(middle,/href="\/stories" rel="prev"/);assert.match(middle,/href="\/stories\?page=3" rel="next"/);assert.match(middle,/Título &lt;seguro&gt;/);
  assert.ok(!renderStoryDirectory(items,options.origin,{page:1,pages:3}).includes('rel="prev"'));
  assert.ok(!renderStoryDirectory(items,options.origin,{page:3,pages:3}).includes('rel="next"'));
  assert.ok(!renderStoryDirectory([],options.origin).includes('story-pagination'));assert.match(middle,/Conteúdos, produtos e serviços/);
});
