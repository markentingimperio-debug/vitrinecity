import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function renderArticle(overrides={}){
  const context={document:{getElementById:()=>({addEventListener(){}}),querySelectorAll:()=>[]},fetch:async()=>({ok:true,json:async()=>({})})};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(new URL('../public/descobrir.js',import.meta.url),'utf8'),context);
  return context.articleCard({title:'Uma matéria específica',summary:'Resumo',portal:'noticias',url:'/artigo/exemplo',imageUrl:'',...overrides});
}

test('discovery keeps a title and destination when an editorial cover is unavailable',()=>{
  const html=renderArticle();
  assert.match(html,/Uma matéria específica/);assert.match(html,/href="\/artigo\/exemplo"/);
  assert.doesNotMatch(html,/<img|vitriny-city-master|Ilustração por IA/);
});

test('a failed editorial image is hidden without downloading an unrelated fallback',()=>{
  const html=renderArticle({imageUrl:'/uploads/generated-videos/example.png',imageCredit:'Ilustração por IA'});
  assert.match(html,/this.parentElement.hidden=true/);assert.doesNotMatch(html,/vitriny-city-master|this.src=/);
  assert.match(html,/Ilustração por IA/);
});

test('recipe images keep their source and no inferred AI credit',()=>{
  const html=renderArticle({imageUrl:'/assets/recipes/cenoura.jpg',imageCredit:''});
  assert.match(html,/src="\/assets\/recipes\/cenoura.jpg"/);assert.doesNotMatch(html,/Ilustração por IA/);
});
