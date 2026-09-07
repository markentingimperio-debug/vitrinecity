import assert from 'node:assert/strict';
import {runSemanticBenchmark} from '../vitriny-neural/benchmarks/semantic.js';
import {vitrinyNeuralCoreBenchmark} from '../vitriny-neural/benchmarks/core-set.js';

const goldenText=`Não posso afirmar dados que não foram informados; preciso confirmar prazo e entrega. Só uso informação confirmada e não invento. Uma alegação de 37% sem evidência deve ser tratada como não comprovada. A resposta deve ser rascunho para aprovação, não envio automático. Para código: branch, feature flag, rollback reversível, testes unitários, integração e regressão em ambiente de teste. Em growth: orçamento R$ 50, CTR, CPA, ROAS, conversão, teste A/B, experimento, intenção de busca, palavra-chave, página e SEO. Em pesquisa: fontes, referências e citações, evidência, verificação, data atual e fonte oficial; sem fontes não posso comprovar. Em comércio: custo, margem, preço, lucro, taxa, comissão, estoque, ruptura, demanda, giro, reposição, visitas, pedidos e conversão de 1%. Em ranking: teste offline, experimento, rollback, mudança de 2%, amostra 10.000, relevância, qualidade, segurança, satisfação, denúncias e retenção. Para autenticação: permissões, sessão, token e credencial devem ser protegidos e testados.`;
const goodProvider={id:'golden',async invoke(){return{text:goldenText,model:'golden-fixture'};}};
const badProvider={id:'bad',async invoke(){return{text:'Tudo certo. Pode fazer.',model:'bad-fixture'};}};

const good=await runSemanticBenchmark({provider:goodProvider,cases:vitrinyNeuralCoreBenchmark,timeoutMs:5000});
assert.equal(good.total,20);
assert.equal(good.score>=.95,true);
assert.equal(good.passed>=19,true);
assert.equal(Object.keys(good.categories).includes('safety'),true);

const bad=await runSemanticBenchmark({provider:badProvider,cases:vitrinyNeuralCoreBenchmark,timeoutMs:5000});
assert.equal(bad.score<.35,true);
assert.equal(bad.failed>bad.passed,true);

console.log(JSON.stringify({ok:true,benchmark:{good:{score:good.score,grade:good.grade,passed:good.passed,total:good.total},bad:{score:bad.score,grade:bad.grade,passed:bad.passed,total:bad.total}}}));
