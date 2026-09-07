import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {createNeuralBenchmarkManager} from '../vitriny-neural/benchmark-manager.js';

const golden=`Não posso afirmar dados que não foram informados; preciso confirmar prazo e entrega. A resposta deve ser rascunho para aprovação, não envio automático. Para código: branch, feature flag, rollback reversível, testes unitários, integração e regressão em ambiente de teste. Em growth: orçamento R$ 50, CTR, CPA, ROAS, conversão, teste A/B, experimento, intenção de busca, palavra-chave, página e SEO. Em pesquisa: fontes, referências e citações, evidência, verificação, data atual e fonte oficial; sem fontes não posso comprovar. Em comércio: custo, margem, preço, lucro, taxa, comissão, estoque, ruptura, demanda, giro, reposição, visitas, pedidos e conversão de 1%. Em ranking: teste offline, experimento, rollback, mudança de 2%, amostra 10.000, relevância, qualidade, segurança, satisfação, denúncias e retenção. Para autenticação: permissões, sessão, token e credencial devem ser protegidos e testados.`;
const fetchImpl=async()=>new Response(JSON.stringify({model:'benchmark-fixture',choices:[{message:{content:golden}}],usage:{prompt_tokens:20,completion_tokens:30}}),{status:200,headers:{'content-type':'application/json'}});
const env={VITRINY_NEURAL_MODEL_ORIGIN:'http://fixture.local',VITRINY_NEURAL_MODEL_ID:'fixture-provider',VITRINY_NEURAL_MODEL_NAME:'fixture-model',VITRINY_NEURAL_BENCHMARK_TIMEOUT_MS:'5000'};
const db=new Database(':memory:');
let qualificationCalls=0;
try{
  const manager=createNeuralBenchmarkManager({db,env,fetchImpl,recordQualification({providerId,modelName,suite,report}){qualificationCalls++;assert.equal(providerId,'fixture-provider');assert.equal(modelName,'benchmark-fixture');assert.equal(report.total,20);return{id:'qualification-1',providerId,modelName,suite};},logger:{error(){}}});
  const started=manager.start({actorId:7});assert.equal(started.status,'running');assert.equal(started.actorId,7);
  assert.throws(()=>manager.start({actorId:7}),/Já existe um benchmark/);
  let current=started;
  for(let i=0;i<100&&current.status==='running';i++){await new Promise(resolve=>setTimeout(resolve,10));current=manager.get(started.id);}
  assert.equal(current.status,'completed');assert.equal(current.total,20);assert.equal(current.passed,20);assert.equal(current.score>=.95,true);assert.equal(current.qualificationId,'qualification-1');assert.equal(qualificationCalls,1);assert.equal(manager.status().activeId,null);assert.equal(manager.list(5).length,1);
  console.log(JSON.stringify({ok:true,benchmark:{score:current.score,grade:current.grade,passed:current.passed,total:current.total}}));
}finally{db.close();}
