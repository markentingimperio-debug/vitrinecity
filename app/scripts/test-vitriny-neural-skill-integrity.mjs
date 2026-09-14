import test from 'node:test';
import assert from 'node:assert/strict';
import {createSkillRegistry} from '../vitriny-neural/skills/registry.js';
import {createGrowthSkill} from '../vitriny-neural/skills/growth.js';
import {createCodeSkill} from '../vitriny-neural/skills/code.js';
import {createResearchSkill} from '../vitriny-neural/skills/research.js';
import {createCommerceSkill} from '../vitriny-neural/skills/commerce.js';
import {createSupportSkill} from '../vitriny-neural/skills/support.js';
import {createRankingSkill} from '../vitriny-neural/skills/ranking.js';
import {isIncompleteResponse} from '../vitriny-neural/response-state.js';

const cases=[
 [createGrowthSkill,'objective',2000], [createCodeSkill,'task',6000],
 [createResearchSkill,'question',5000], [createCommerceSkill,'objective',2000],
 [createSupportSkill,'message',6000], [createRankingSkill,'objective',1800]
];
for(const [create,field,max] of cases){
 const skill=create();
 test(`${skill.id} preserves multiline prose and rejects oversized/control input before inference`,async()=>{
  const message='Primeira linha.\nSegunda linha.\r\n\tDetalhe informado.';let seen,calls=0;
  const invoke=async(_cap,input)=>{calls++;seen=input;return {provider:'fixture',output:{text:'Rascunho'},attempts:[]};};
  await skill.execute({input:{[field]:message},invoke});assert.equal(seen[field],message);
  const before=calls;
  for(const invalid of ['x'.repeat(max+1),'Texto\u0000não permitido','Texto\u001bnão permitido','Texto\u007fnão permitido','\u000bTexto','Texto\u000c']){
   await assert.rejects(skill.execute({input:{[field]:invalid},invoke}));
  }
  assert.equal(calls,before);
 });
 test(`${skill.id} emits incomplete rather than a completed learning event`,async()=>{
  const events=[],instance=create({neural:{ingest:event=>events.push(event)}});
  const registry=createSkillRegistry();registry.registerSkill(instance);
  let primary=0,backup=0;
  registry.registerProvider({id:'partial-model',priority:1,local:true,capabilities:instance.capabilities,invoke:async()=>{primary++;return {text:'Parte do rascunho',finishReason:'length',usage:{prompt_tokens:10,completion_tokens:5}};}});
  registry.registerProvider({id:'backup-model',priority:2,local:true,capabilities:instance.capabilities,invoke:async()=>{backup++;return {text:'Não deveria chamar'};}});
  const result=await registry.run(instance.id,{[field]:'Prepare um rascunho.'},{evaluation:true});
  assert.equal(result.output.text,'Parte do rascunho');assert.equal(result.output.incomplete,true);
  assert.equal(primary,1);assert.equal(backup,0);assert.equal(events.length,1);assert.match(events[0].type,/\.incomplete$/);
  assert.equal(result.attempts.at(-1).ok,false);assert.equal(result.attempts.at(-1).incomplete,true);
  const stats=registry.status().providers.find(p=>p.id==='partial-model').stats;
  assert.equal(stats.success,0);assert.equal(stats.incomplete,1);assert.equal(stats.totalTokens,15);
 });
}
test('an incomplete response preserves the accounting completion receipt and does not retry',async()=>{
 const registry=createSkillRegistry(),events=[];
 registry.registerProvider({id:'filtered-model',local:true,capabilities:['support.draft-reply'],invoke:async()=>({text:'',finishReason:'content_filter',usage:{prompt_tokens:7,completion_tokens:1}})});
 const result=await registry.invoke('support.draft-reply',{}, {onAttempt:event=>events.push(event)});
 assert.deepEqual(events.map(x=>x.type),['started','completed']);assert.equal(events[1].known,true);
 assert.equal(events[1].inputTokens,7);assert.equal(events[1].outputTokens,1);assert.equal(result.output.incomplete,true);
});
test('completed answers remain completed and path metadata remains single-line',async()=>{
 const events=[],skill=createCodeSkill({neural:{ingest:e=>events.push(e)}}),registry=createSkillRegistry();registry.registerSkill(skill);
 registry.registerProvider({id:'complete-model',local:true,capabilities:skill.capabilities,invoke:async()=>({text:'Plano completo',finishReason:'stop',usage:{prompt_tokens:4,completion_tokens:2}})});
 await registry.run(skill.id,{task:'Revisar código\nPreservar arquivos.'});assert.match(events[0].type,/\.completed$/);
 assert.equal(registry.status().providers[0].stats.success,1);
 await assert.rejects(registry.run(skill.id,{task:'Revisar código',files:['app.js\noutra.js']}));
 await assert.rejects(registry.run(skill.id,{task:'Revisar código',files:['\napp.js']}));
 await assert.rejects(registry.run(skill.id,{task:'Revisar código',branch:'main\t'}));
});

test('business context accepts multiline prose while channel, domain and repository metadata remain single-line',async()=>{
 const businessContext='Situação informada.\r\nSem prazo definido.\n\tDetalhe.';
 for(const [create,field] of [[createGrowthSkill,'objective'],[createSupportSkill,'message']]){
  let seen;
  const instance=create(),invoke=async(_cap,input)=>{seen=input;return {output:{text:'Rascunho'},attempts:[]};};
  await instance.execute({input:{[field]:'Prepare um rascunho.',businessContext},invoke});
  assert.equal(seen.businessContext,businessContext);
  await assert.rejects(instance.execute({input:{[field]:'Prepare um rascunho.',channel:'chat\n'},invoke}));
  await assert.rejects(instance.execute({input:{[field]:'Prepare um rascunho.',businessContext:'\u000bContexto'},invoke}));
 }
 const invoke=async()=>{assert.fail('Invalid metadata must fail before inference');};
 await assert.rejects(createResearchSkill().execute({input:{question:'Compare fontes.',domains:['example.com\n']},invoke}));
 await assert.rejects(createCodeSkill().execute({input:{task:'Revisar código.',repository:'\trepository'},invoke}));
});

test('multiline code tasks retain the existing private-key and token rejection',async()=>{
 const invoke=async()=>{assert.fail('Secret-like input must fail before inference');};
 for(const secret of ['-----BEGIN RSA PRIVATE KEY-----','github_pat_'+ '0'.repeat(20),'ghp_'+ '0'.repeat(20)]){
  await assert.rejects(createCodeSkill().execute({input:{task:`Revisar estes dados.\n${secret}\nPreservar arquivos.`},invoke}));
 }
});

test('response state recognizes explicit partials and finish reasons without classifying completed prose as incomplete',()=>{
 for(const output of [{incomplete:true},{finishReason:'length'},{finishReason:'content_filter',incomplete:false}])assert.equal(isIncompleteResponse(output),true);
 for(const output of [undefined,null,{},'length',{text:'length and content_filter'},{finishReason:'stop',incomplete:false},{incomplete:'true'}])assert.equal(isIncompleteResponse(output),false);
});

test('incomplete calls lower reliability separately from transport failure and keep elapsed/usage totals',async()=>{
 let clock=100,index=0;
 const registry=createSkillRegistry({now:()=>clock});
 registry.registerProvider({id:'measured-model',priority:1,capabilities:['support.draft-reply'],invoke:async()=>{
  const current=index++;clock+=[5,7,11][current];
  if(current===2)throw new Error('Transport unavailable');
  return {text:'Resposta',finishReason:current===0?'stop':'length',usage:{prompt_tokens:3,completion_tokens:2}};
 }});
 await registry.invoke('support.draft-reply',{});
 await registry.invoke('support.draft-reply',{});
 await assert.rejects(registry.invoke('support.draft-reply',{}));
 const stats=registry.status().providers[0].stats;
 assert.equal(stats.success,1);assert.equal(stats.incomplete,1);assert.equal(stats.fail,1);
 assert.equal(stats.reliability,2/5);assert.equal(stats.avgMs,23/3);
 assert.equal(stats.inputTokens,6);assert.equal(stats.outputTokens,4);assert.equal(stats.totalTokens,10);
 registry.registerProvider({id:'untried-model',priority:1,capabilities:['support.draft-reply'],invoke:async()=>({text:'Completo'})});
 assert.deepEqual((await registry.candidates('support.draft-reply')).map(provider=>provider.id),['untried-model','measured-model']);
});
