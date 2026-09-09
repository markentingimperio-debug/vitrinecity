import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../public/admin-agentes.html',import.meta.url),'utf8');
const render=html.slice(html.indexOf('function renderFactory('),html.indexOf('$("#factoryForm").onsubmit'));
function ui(publication,production_status='approved'){
  const nodes={'#factoryJobs':{},'#factoryBudget':{}},context={window:{},mediaProjects:[{id:1,title:'Projeto <teste>',format:'short_video',production_status,publication}],
    $:id=>nodes[id],updateFactoryModels:()=>{},usd:()=>'',esc:value=>String(value??'').replaceAll('<','&lt;').replaceAll('>','&gt;')};
  vm.runInNewContext(render+';renderFactory({});',context);return nodes['#factoryJobs'].innerHTML;
}
test('processing and missing status are never displayed as published',()=>{
  const result=ui({status:'processing',message:'Envio confirmado. Processando.',canReconcile:true},'published');assert.match(result,/Processando/);assert.doesNotMatch(result,/Publicado na Vitrine Social/);assert.doesNotMatch(result,/publish-vitriny/);assert.match(result,/sync-publication/);
  assert.match(ui(null,'published'),/Situação da publicação indisponível/);
});
test('unknown attempts cannot be resent and content is escaped',()=>{
  const result=ui({status:'unknown',message:'Envio <incerto>',canPublish:false,canReconcile:false});assert.doesNotMatch(result,/data-media-action/);assert.match(result,/Envio &lt;incerto&gt;/);assert.doesNotMatch(result,/<teste>/);
});
test('only explicit eligibility offers the publish action and confirmed status is shown',()=>{
  assert.match(ui({status:'not_started',message:'Ainda não enviado',canPublish:true}),/Enviar à Vitrine Social/);
  assert.match(ui({status:'published',message:'Publicado na Vitrine Social.',canPublish:false}),/Publicado na Vitrine Social\./);
});
test('all embedded scripts compile and action notifications use response state',()=>{
  for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))if(match[1].trim())new Function(match[1]);
  assert.match(html,/notify\(result\.publication\?\.message/);assert.match(html,/if\(!b\|\|b\.disabled\)return/);
});
const quizHtml=readFileSync(new URL('../public/admin-quizzes.html',import.meta.url),'utf8');
const quizScript=quizHtml.match(/<script>([\s\S]*?)<\/script>/)[1];
function quizUi(publication,status='approved',filter=''){
  const nodes={'#search':{value:''},'#status':{value:filter},'#list':{}};
  const script=quizScript.slice(0,quizScript.indexOf('async function load()'));
  const context={document:{querySelector:id=>nodes[id]}};
  vm.runInNewContext(script+';quizzes='+JSON.stringify([{id:1,media_project_id:4,theme:'Quiz <real>',status,publication,questions:[],scenes:[],distribution:[]}])+';render();',context);
  return nodes['#list'].innerHTML;
}
test('quiz library explains processing and shows check button and receipt without a public link',()=>{
  const value=quizUi({status:'processing',message:'Envio confirmado; aguarde.',receiptId:'a'.repeat(32),canReconcile:true,postId:'post-1'},'published');
  assert.match(value,/Processando vídeo/);assert.match(value,/Conferir envio/);assert.match(value,/Comprovante do vídeo/);assert.doesNotMatch(value,/Ver publicação|Vídeo pronto|Publicado na Vitrine Social/);
  assert.match(value,/Quiz &lt;real&gt;/);
});
test('quiz library only links confirmed publications and never offers resend for uncertainty',()=>{
  assert.match(quizUi({status:'published',message:'Publicado.',postId:'safe-id'}),/href="\/social\/post\/safe-id"/);
  assert.doesNotMatch(quizUi({status:'unknown',message:'Sem confirmação.',postId:'local-id',canReconcile:false}),/Ver publicação|data-check-publication|publish-vitriny/);
  assert.match(quizUi(null,'published'),/Publicação sem confirmação/);
});
test('published filter requires publication receipt status, not legacy quiz status',()=>{
  assert.match(quizUi({status:'processing'},'published','published'),/Nenhum quiz/);
  assert.match(quizUi({status:'processing',message:'Processando',canReconcile:true},'approved','publication:processing'),/Conferir envio/);
});
test('quiz check action is bounded to the existing receipt and mobile controls are labelled',()=>{
  new Function(quizScript);assert.match(quizScript,/sync-publication/);assert.doesNotMatch(quizScript,/publish-vitriny/);assert.match(quizScript,/if\(!button\|\|button.disabled\)return/);
  assert.match(quizHtml,/min-height:44px/);assert.match(quizHtml,/aria-label="Filtrar por situação"/);assert.match(quizHtml,/overflow-wrap:anywhere/);
});
