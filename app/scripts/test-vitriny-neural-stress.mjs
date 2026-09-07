import assert from 'node:assert/strict';
import {createVitrinyNeural} from '../vitriny-neural/core.js';
import {createVitrinyNeuralMemoryStore} from '../vitriny-neural/memory-store.js';
import {createSkillRegistry} from '../vitriny-neural/skills/registry.js';
import {createMediaSkill} from '../vitriny-neural/skills/media.js';
import {createCodeSkill} from '../vitriny-neural/skills/code.js';
import {createGrowthSkill} from '../vitriny-neural/skills/growth.js';
import {createResearchSkill} from '../vitriny-neural/skills/research.js';
import {createCommerceSkill} from '../vitriny-neural/skills/commerce.js';
import {createSupportSkill} from '../vitriny-neural/skills/support.js';
import {createRankingSkill} from '../vitriny-neural/skills/ranking.js';
import {createNeuralEvalEngine} from '../vitriny-neural/evals/engine.js';

let clock=Date.parse('2026-09-07T02:00:00.000Z');
const now=()=>clock++;
const store=createVitrinyNeuralMemoryStore();
const neural=createVitrinyNeural({store,nodeId:'stress-node',now});

const UNIQUE=5000,DUPLICATES=1000;
const started=Date.now();
for(let i=0;i<UNIQUE;i++){
  const r=neural.ingest({type:'content.view',source:'stress',entityType:'post',entityId:`p${i}`,dedupeKey:`stress:view:${i}`,priority:i%10,payload:{watchSeconds:i%66,completed:i%3===0}});
  assert.equal(r.accepted,true);
}
for(let i=0;i<DUPLICATES;i++){
  const r=neural.ingest({type:'content.view',source:'stress',entityType:'post',entityId:`p${i}`,dedupeKey:`stress:view:${i}`,payload:{watchSeconds:99}});
  assert.equal(r.duplicate,true);
}
assert.equal(store.inspect().events.length,UNIQUE);

let secretBlocked=false;
try{neural.ingest({type:'security.test',source:'stress',payload:{token:'ghp_abcdefghijklmnopqrstuvwx123456'}});}catch{secretBlocked=true;}
assert.equal(secretBlocked,true);

let rounds=0;
do{
  const before=store.inspect().events.filter(x=>x.status==='pending').length;
  if(!before)break;
  await neural.workBatch(async event=>{
    const id=Number(event.entityId.slice(1));
    if(id<5)throw new Error('forced permanent failure');
    if(id>=5&&id<25&&event.attemptCount<3)throw new Error('forced transient failure');
    return{ok:true};
  },{workerId:'stress-worker',limit:200,leaseMs:5000});
  rounds++;
  if(rounds>200)throw new Error('stress worker did not converge');
}while(true);
const after=store.inspect().events;
assert.equal(after.filter(x=>x.status==='processed').length,UNIQUE-5);
assert.equal(after.filter(x=>x.status==='dead_letter').length,5);
assert.equal(after.filter(x=>x.status==='processed'&&x.attemptCount===3).length>=20,true);

const auto=neural.lesson({domain:'ranking',hypothesis:'Peso de conclusão melhora ranking em teste offline repetido.',evidence:{offline:true},reward:.4,confidence:.97,sourceEventCount:9000,verified:true,lowRisk:true});
assert.equal(auto.status,'approved');
const reviewed=neural.lesson({domain:'commerce',hypothesis:'Alterar política comercial deve exigir revisão humana.',evidence:{sample:5000},reward:.2,confidence:.99,sourceEventCount:5000,verified:true,lowRisk:false});
assert.equal(reviewed.status,'candidate');
let approvalBlocked=false;try{neural.approveLesson(reviewed.id,{actor:'stress',confirmed:false});}catch{approvalBlocked=true;}assert.equal(approvalBlocked,true);

const skills=createSkillRegistry({now,circuitFailureThreshold:3,circuitCooldownMs:60000});
for(const skill of [createMediaSkill({neural}),createCodeSkill({neural}),createGrowthSkill({neural}),createResearchSkill({neural}),createCommerceSkill({neural}),createSupportSkill({neural}),createRankingSkill({neural})])skills.registerSkill(skill);
const capabilities=[...new Set(skills.status().skills.flatMap(x=>x.capabilities))];
skills.registerProvider({id:'forced-broken',capabilities,priority:1,available:async()=>true,invoke:async()=>{throw new Error('forced provider outage');}});
skills.registerProvider({id:'synthetic-good',capabilities,priority:2,local:true,costClass:'test',available:async()=>true,invoke:async({capability,input})=>({capability,accepted:true,input})});

const capabilityRuns=[];
capabilityRuns.push(await skills.run('media.generate',{type:'image',prompt:'foto de produto limpa',aspectRatio:'1:1'}));
capabilityRuns.push(await skills.run('media.generate',{type:'video',prompt:'vídeo curto de produto',durationSeconds:8}));
capabilityRuns.push(await skills.run('media.generate',{type:'audio',prompt:'Olá Vitrine City',voice:'pt-BR'}));
capabilityRuns.push(await skills.run('code.engineer',{action:'analyze',task:'analisar um módulo sem alterar produção',dryRun:true}));
capabilityRuns.push(await skills.run('growth.optimizer',{action:'diagnose',objective:'aumentar conversão com mensuração'}));
capabilityRuns.push(await skills.run('research.supervised',{action:'collect',question:'comparar estratégias com fontes confiáveis'}));
capabilityRuns.push(await skills.run('commerce.advisor',{action:'catalog-review',objective:'melhorar catálogo',catalog:[]}));
const support=await skills.run('support.assistant',{action:'draft-reply',message:'Qual o prazo?',confirmedFacts:{}});capabilityRuns.push(support);assert.equal(support.sendAutomatically,false);
const ranking=await skills.run('ranking.optimizer',{action:'evaluate',objective:'melhorar relevância',sampleSize:10000});capabilityRuns.push(ranking);assert.equal(ranking.offlineOnly,true);
assert.equal(capabilityRuns.every(x=>x.provider==='synthetic-good'),true);
assert.equal(skills.status().providers.find(x=>x.id==='forced-broken').stats.circuit,'open');

const adversarial=[];
for(const test of [
  ()=>skills.run('media.generate',{type:'binary',prompt:'x'}),
  ()=>skills.run('code.engineer',{action:'delete-production',task:'x'}),
  ()=>skills.run('code.engineer',{action:'analyze',task:'use ghp_abcdefghijklmnopqrstuvwx123456'}),
  ()=>skills.run('growth.optimizer',{action:'unknown',objective:'x'}),
  ()=>skills.run('research.supervised',{action:'collect',question:''})
]){let blocked=false;try{await test();}catch{blocked=true;}adversarial.push(blocked);}
assert.equal(adversarial.every(Boolean),true);

const evalEngine=createNeuralEvalEngine({now});
const evalCases=[
  {id:'dedupe',category:'integrity',expect:()=>store.inspect().events.length===UNIQUE},
  {id:'retry',category:'resilience',expect:()=>after.filter(x=>x.status==='processed'&&x.attemptCount===3).length>=20},
  {id:'dead-letter',category:'resilience',expect:()=>after.filter(x=>x.status==='dead_letter').length===5},
  {id:'secret-block',category:'safety',expect:()=>secretBlocked},
  {id:'human-gate',category:'safety',expect:()=>approvalBlocked&&reviewed.status==='candidate'},
  {id:'low-risk-learning',category:'learning',expect:()=>auto.status==='approved'},
  {id:'provider-fallback',category:'resilience',expect:()=>capabilityRuns.every(x=>x.provider==='synthetic-good')},
  {id:'circuit-breaker',category:'resilience',expect:()=>skills.status().providers.find(x=>x.id==='forced-broken').stats.circuit==='open'},
  {id:'skill-coverage',category:'capabilities',expect:()=>skills.status().skills.length===7&&capabilities.length>=20},
  {id:'adversarial-inputs',category:'safety',expect:()=>adversarial.every(Boolean)}
];
const evaluation=await evalEngine.run(evalCases,async test=>test,{suite:'vitriny-neural-forced-v1'});
assert.equal(evaluation.score,1);

const elapsedMs=Date.now()-started;
const report={
  ok:true,
  stress:{uniqueEvents:UNIQUE,duplicatesRejected:DUPLICATES,processed:UNIQUE-5,deadLetters:5,workerRounds:rounds,elapsedMs},
  evaluation:{score:evaluation.score,grade:evaluation.grade,passed:evaluation.passed,total:evaluation.total,byCategory:evaluation.byCategory},
  skills:{registered:skills.status().skills.length,capabilities:capabilities.length,providers:skills.status().providers.map(x=>({id:x.id,stats:x.stats}))},
  precision:{contractAndSafetyAccuracy:evaluation.score,semanticModelAccuracy:null,semanticModelAccuracyReason:'Nenhum modelo real é chamado neste teste; medir qualidade semântica exige provider/modelo configurado e dataset de benchmark.'}
};
console.log(JSON.stringify(report));
