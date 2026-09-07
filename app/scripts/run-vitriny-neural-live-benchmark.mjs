import {createEnvModelProviders} from '../vitriny-neural/providers/from-env.js';
import {runSemanticBenchmark} from '../vitriny-neural/benchmarks/semantic.js';
import {vitrinyNeuralCoreBenchmark} from '../vitriny-neural/benchmarks/core-set.js';

const providers=createEnvModelProviders();
if(!providers.length){
  console.error('Nenhum modelo configurado. Defina VITRINY_NEURAL_MODEL_ORIGIN ou ative JARVIS_LOCAL_MODEL=1.');
  process.exit(2);
}
const provider=providers[0];
const timeoutMs=Math.max(5000,Math.min(300000,Number(process.env.VITRINY_NEURAL_BENCHMARK_TIMEOUT_MS)||90000));
const minScore=Math.max(0,Math.min(1,Number(process.env.VITRINY_NEURAL_BENCHMARK_MIN_SCORE)||0));
const report=await runSemanticBenchmark({provider,cases:vitrinyNeuralCoreBenchmark,timeoutMs});
const summary={
  provider:provider.id,
  model:report.results.find(x=>x.model)?.model||null,
  suite:report.suite,total:report.total,passed:report.passed,failed:report.failed,score:report.score,grade:report.grade,
  categories:report.categories,latencyMs:report.latencyMs,
  failures:report.results.filter(x=>!x.passed).map(x=>({id:x.id,category:x.category,score:x.score,error:x.error,failedChecks:x.checks.filter(c=>!c.passed).map(c=>({kind:c.kind,pattern:c.pattern}))}))
};
console.log(JSON.stringify(summary,null,2));
if(minScore>0&&report.score<minScore)process.exit(1);
