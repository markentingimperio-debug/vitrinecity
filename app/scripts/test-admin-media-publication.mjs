import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../public/admin-agentes.html',import.meta.url),'utf8');
const render=html.slice(html.indexOf('function renderFactory('),html.indexOf('$("#factoryForm").onsubmit'));
function ui(publication,production_status='approved',policy={}){
  const nodes={'#factoryJobs':{},'#factoryBudget':{},'#factoryFormat':{value:'short_video',querySelector:()=>({})}},context={window:{},mediaProjects:[{id:1,title:'Projeto <teste>',format:'short_video',production_status,publication,...policy}],aiProviderLabel:()=>'OpenAI',
    $:id=>nodes[id],updateFactoryModels:()=>{},usd:()=>'',esc:value=>String(value??'').replaceAll('<','&lt;').replaceAll('>','&gt;')};
  vm.runInNewContext(render+';renderFactory({});',context);return nodes['#factoryJobs'].innerHTML;
}
test('processing and missing status are never displayed as published',()=>{
  const result=ui({status:'processing',message:'Envio confirmado. Processando.',canReconcile:true},'published');assert.match(result,/Processando/);assert.doesNotMatch(result,/Publicado na Vitrine Social/);assert.doesNotMatch(result,/publish-vitriny/);assert.match(result,/sync-publication/);
  assert.match(ui(null,'published'),/Situação da publicação indisponível/);
});
test('provider-held jobs expose their reason without offering generation or polling',()=>{
  for(const status of ['script','editing']) {
    const result=ui({status:'not_started',canPublish:false},status,{generationAvailable:false,syncAvailable:false,generationBlockReason:'Projeto do provedor anterior preservado.'});
    assert.match(result,/provedor anterior preservado/);assert.doesNotMatch(result,/data-media-action="(?:generate|sync)"/);
  }
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

test('Google video controls offer only supported formats while OpenAI images retain square format',()=>{
  const modelScript=html.slice(html.indexOf('function updateFactoryModels('),html.indexOf('function renderFactory('));
  const option=value=>({value,disabled:false});
  const nodes={'#factoryFormat':{value:'short_video'},'#factoryModel':{},'#factoryRatio':{value:'1:1',options:['9:16','16:9','1:1'].map(option)},'#factoryDuration':{value:'5',options:['4','6','8'].map(option)},'#factoryVideoInfo':{}};
  const context=vm.createContext({window:{factoryConfig:{videoProvider:'google',videoDurationOptions:[4,6,8],videoAspectRatioOptions:['9:16','16:9'],videoAudioAlwaysOn:true,videoResolution:'720p'}},$:id=>nodes[id],esc:String,aiProviderLabel:value=>value==='google'?'Google Veo':'OpenAI'});
  vm.runInContext(modelScript+`;updateFactoryModels({image:'gpt-image-2',imageOptions:['gpt-image-2'],video:'veo-3.1-lite-generate-preview',videoOptions:['veo-3.1-lite-generate-preview']});`,context);
  assert.equal(nodes['#factoryRatio'].value,'9:16');assert.equal(nodes['#factoryRatio'].options[2].disabled,true);assert.equal(nodes['#factoryDuration'].value,'4');assert.equal(nodes['#factoryDuration'].disabled,false);assert.match(nodes['#factoryVideoInfo'].textContent,/Google Veo.*720p.*áudio incluído/);assert.match(nodes['#factoryModel'].innerHTML,/veo-3.1-lite/);assert.doesNotMatch(nodes['#factoryModel'].innerHTML,/gpt-image/);
  nodes['#factoryFormat'].value='image';vm.runInContext(`updateFactoryModels({image:'gpt-image-2',imageOptions:['gpt-image-2']});`,context);
  assert.equal(nodes['#factoryRatio'].options[2].disabled,false);assert.equal(nodes['#factoryDuration'].disabled,true);assert.equal(nodes['#factoryVideoInfo'].textContent,'');assert.match(nodes['#factoryModel'].innerHTML,/gpt-image-2/);
  context.window.factoryConfig={videoProvider:'openrouter',videoDurationOptions:[],videoAspectRatioOptions:['1:1','9:16','16:9']};nodes['#factoryFormat'].value='short_video';vm.runInContext('updateFactoryModels({})',context);assert(nodes['#factoryDuration'].options.every(item=>item.disabled===false));
});

test('Kling default is a manual silent 5-second clip with an explicit changing credit estimate',()=>{
  const modelScript=html.slice(html.indexOf('function updateFactoryModels('),html.indexOf('function renderFactory('));
  const nodes={'#factoryFormat':{value:'short_video'},'#factoryModel':{},'#factoryRatio':{value:'9:16',options:['9:16','16:9','1:1'].map(value=>({value}))},'#factoryDuration':{value:'4',options:['4','5','6','8'].map(value=>({value}))},'#factoryVideoInfo':{}};
  const context=vm.createContext({window:{factoryConfig:{videoProvider:'kling_studio',videoManualOnly:true,videoDefaultDuration:5,videoDurationOptions:Array.from({length:13},(_,i)=>i+3),videoAspectRatioOptions:['9:16','16:9','1:1'],videoResolution:'1080p',videoCreditsPerSecond:8}},$:id=>nodes[id],esc:String,aiProviderLabel:()=>'Kling Studio'});
  vm.runInContext(modelScript+`updateFactoryModels({video:'kling-video-v3_0',videoOptions:['kling-video-v3_0']});`,context);
  assert.equal(nodes['#factoryDuration'].value,'5');assert.match(nodes['#factoryVideoInfo'].textContent,/1080p.*sem áudio.*manual.*40 créditos pagos/);
  nodes['#factoryDuration'].value='8';nodes['#factoryDuration'].onchange();assert.match(nodes['#factoryVideoInfo'].textContent,/64 créditos pagos/);
});

test('Kling account balance is not mislabeled paid-only and generation stays hidden without verified connection',()=>{
  for(const connected of [true,false]){
    const nodes={'#factoryJobs':{},'#factoryBudget':{},'#factoryFormat':{value:'short_video',querySelector:()=>({})}};
    const config={provider:'openai',videoProvider:'kling_studio',configured:true,imageConfigured:true,videoEnabled:true,videoManualOnly:true,videoCreditsPerSecond:8,videoDurationOptions:[5,8],videoAccount:{connected,availableCredits:660,usablePaidCredits:null}};
    const context={window:{},mediaProjects:[{id:1,title:'Clipe manual',format:'short_video',production_status:'script',duration_seconds:5,generationAvailable:true}],$:id=>nodes[id],aiProviderLabel:value=>value==='kling_studio'?'Kling Studio':'OpenAI',updateFactoryModels(){},esc:String,usd:String,config};
    vm.runInNewContext(render+';renderFactory(config);',context);
    if(connected){assert.match(nodes['#factoryBudget'].textContent,/660 créditos informados pela conta; o total pago não é discriminado/);assert.match(nodes['#factoryJobs'].innerHTML,/estimativa 40 créditos pagos/);}
    else {assert.match(nodes['#factoryBudget'].textContent,/conexão da conta pendente/);assert.doesNotMatch(nodes['#factoryJobs'].innerHTML,/data-media-action="generate"/);}
  }
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
