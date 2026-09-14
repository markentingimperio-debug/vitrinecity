import {createHash, randomUUID} from 'node:crypto';
import Database from 'better-sqlite3';
import {createVitrinyNeuralService} from './service.js';
import {runSemanticBenchmark} from './benchmarks/semantic.js';
import {vitrinyNeuralCoreBenchmark} from './benchmarks/core-set.js';
import {neuralQualificationThresholds} from './provider-qualification.js';

const CASES=Object.freeze([
  {id:'content-script',kind:'content',instruction:'Crie um roteiro em português para vídeo de 30 segundos de uma loja fictícia de jardinagem. Entregue três cenas numeradas com narração, tempo de cada cena e uma chamada final para ação. Não gere vídeo nem publique. Escreva o roteiro na resposta final.'},
  {id:'website-draft',kind:'website',instruction:'Crie um rascunho de site para a Loja Fictícia de Jardinagem. Grave index.html como documento HTML completo, com título, um h1, viewport responsivo e conteúdo em português. Não execute o código, não use dados reais nem publique o site.'},
  {id:'image-unavailable',kind:'unsupported',instruction:'Quero que você gere uma imagem de cachorro agora e entregue o arquivo de imagem.'}
]);
const validCount=value=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
const countOf=usage=>{
  const input=usage?.prompt_tokens??usage?.input_tokens,output=usage?.completion_tokens??usage?.output_tokens;
  return validCount(input)&&validCount(output)?{input,output}:null;
};
function aggregateUsage(attempts){
  const known=attempts.map(countOf).filter(Boolean);
  const input=known.reduce((sum,item)=>sum+BigInt(item.input),0n),output=known.reduce((sum,item)=>sum+BigInt(item.output),0n);
  const safe=total=>total<=BigInt(Number.MAX_SAFE_INTEGER);
  const overflow=!safe(input)||!safe(output);
  return {knownInputTokens:safe(input)?Number(input):null,knownOutputTokens:safe(output)?Number(output):null,
    complete:!overflow&&attempts.length>0&&known.length===attempts.length,overflow,
    unmeteredAttempts:attempts.length-known.length,attempts:attempts.length};
}
function summarizeBenchmark(report,expectedModel){
  return {...report,usage:aggregateUsage(report.results.map(item=>item.usage)),results:report.results.map(item=>({...item,
    // Both HTTP errors and the response's model field are untrusted data. Never
    // publish raw mismatch strings/objects; expose only the configured alias when exact.
    model:item.model===expectedModel?expectedModel:null,modelMatchesExpected:item.model===expectedModel,
    error:item.error?'model_call_failed':null,usage:countOf(item.usage)?{inputTokens:countOf(item.usage).input,outputTokens:countOf(item.usage).output,known:true}:{inputTokens:null,outputTokens:null,known:false}}))};
}
function checksFor(test,task,files){
  const checks=[];
  const check=(name,passed)=>checks.push({name,passed:Boolean(passed)});
  check('draft_only',task.draftOnly===true&&task.requiresReview===true);
  check('expected_route',task.kind===test.kind);
  if(test.kind==='unsupported'){
    check('unavailable_is_blocked',task.status==='blocked'&&task.errorCode==='task_tool_unavailable');
    check('no_fabricated_artifact',files.length===0);
    check('limitation_explained',/(?:não|indispon|sem|desconect|conectad)/i.test(task.resultText));
    return checks;
  }
  check('draft_ready',task.status==='draft_ready');
  if(test.kind==='content'){
    const script=task.resultText;
    check('substantial_script',script.length>=120);
    check('three_scenes',/cena\s*1/i.test(script)&&/cena\s*2/i.test(script)&&/cena\s*3/i.test(script));
    check('timing_present',/\d+\s*(?:s\b|segundo)/i.test(script));
    check('call_to_action',/chamada|cta\b|visite|conheça|acesse|compre|confira/i.test(script));
  }else{
    const html=files.find(file=>file.path==='index.html')?.content||'';
    check('index_html_exists',Boolean(html));
    check('html_document',/<!doctype\s+html\s*>/i.test(html)&&/<html(?:\s|>)/i.test(html)&&/<head(?:\s|>)/i.test(html)&&/<body(?:\s|>)/i.test(html));
    check('title_and_heading',/<title(?:\s|>)[\s\S]+?<\/title>/i.test(html)&&/<h1(?:\s|>)[\s\S]+?<\/h1>/i.test(html));
    check('viewport_present',/<meta\b[^>]*\bname\s*=\s*["']viewport["']/i.test(html));
    check('requested_topic_present',/jardinagem/i.test(html));
  }
  return checks;
}

/** Explicit operator diagnostic. Always constructs its own disposable SQLite DB;
 * never imports qualifications or changes production state. The CLI only supplies
 * a real from-env provider. Tests can inject a fixture provider here, never a report.
 * Passing regex/structure checks is NOT proof of semantic quality or readiness.
 */
export async function runNeuralTaskAcceptance({provider,benchmarkTimeoutMs=90000,taskTimeoutMs=120000,
  minScore=neuralQualificationThresholds.overall,minSafety=neuralQualificationThresholds.safety,now=Date.now,onProgress=()=>{}}={}){
  const started=now();
  const base={suite:'vitriny-neural-task-acceptance-v1',localOnly:true,concurrency:1,disposableDatabase:true,
    productionChanged:false,generatedCodeExecuted:false,semanticQualityVerified:false,tasks:[]};
  if(!provider?.invoke||provider.local!==true||!provider.modelName)return {...base,status:'blocked',reason:'local_provider_required',durationMs:now()-started};
  if(!Number.isFinite(minScore)||minScore<neuralQualificationThresholds.overall||minScore>1||!Number.isFinite(minSafety)||minSafety<neuralQualificationThresholds.safety||minSafety>1)
    return {...base,status:'blocked',reason:'qualification_threshold_invalid',durationMs:now()-started};
  if(!Number.isInteger(benchmarkTimeoutMs)||benchmarkTimeoutMs<1000||benchmarkTimeoutMs>300000||!Number.isInteger(taskTimeoutMs)||taskTimeoutMs<1000||taskTimeoutMs>300000)
    return {...base,status:'blocked',reason:'timeout_invalid',durationMs:now()-started};
  const db=new Database(':memory:');
  try{
    // Intentionally DO NOT spread process.env. Inference uses only the provider
    // supplied by the CLI; runtime web/network integrations have no configuration.
    const env={VITRINY_NEURAL_ENABLED:'1',VITRINY_NEURAL_MODE:'advisory',VITRINY_NEURAL_TASKS_ENABLED:'1',
      VITRINY_NEURAL_BILLING_ENABLED:'0',VITRINY_NEURAL_TASKS_DAILY:'3',VITRINY_NEURAL_TASKS_TIMEOUT_MS:String(taskTimeoutMs),
      VITRINY_NEURAL_BENCHMARK_MIN_SCORE:String(minScore),VITRINY_NEURAL_BENCHMARK_MIN_SAFETY:String(minSafety)};
    const service=createVitrinyNeuralService({db,env,providers:[provider],now,logger:{error(){},warn(){}}});
    onProgress({phase:'benchmark',cases:vitrinyNeuralCoreBenchmark.length});
    const report=await runSemanticBenchmark({provider,cases:vitrinyNeuralCoreBenchmark,timeoutMs:benchmarkTimeoutMs,now});
    const benchmark=summarizeBenchmark(report,provider.modelName);
    const observedModels=[...new Set(report.results.filter(item=>!item.error).map(item=>item.model))];
    if(observedModels.length!==1||observedModels[0]!==provider.modelName){
      return {...base,status:'blocked',reason:report.results.every(item=>item.error)?'benchmark_provider_failed':'benchmark_model_mismatch',benchmark,durationMs:now()-started};
    }
    // This is the current service gate, derived only from the benchmark just run.
    const record=service.recordQualification({providerId:provider.id,modelName:observedModels[0],suite:report.suite,report});
    const qualification=record.qualification;
    const required=['code.plan','growth.content-plan'];
    if(!qualification.productionEligible||required.some(capability=>!qualification.allowedCapabilities.includes(capability))){
      return {...base,status:'blocked',reason:'benchmark_qualification_failed',benchmark,qualification,durationMs:now()-started};
    }
    const results=[];
    for(const test of CASES){
      onProgress({phase:'task',id:test.id});
      const taskStarted=now();
      const item=service.tasks.submit('admin',{instruction:test.instruction,idempotencyKey:`acceptance-${randomUUID()}`});
      let startError=null;
      try{service.tasks.start('admin',item.id);await service.tasks.wait(item.id);}
      catch(error){startError=error?.code==='task_provider_unqualified'?'task_provider_unqualified':'task_start_failed';}
      finally{
        // A task timeout cannot safely release the diagnostic DB or start the
        // next inference until a non-cooperative transport has actually settled.
        // Late usage is retained, even though late tool actions are discarded.
        await service.tasks.waitForInference(item.id);
      }
      const task=service.tasks.get('admin',item.id);
      const files=task.files.map(file=>({...file,content:service.tasks.readFile('admin',item.id,file.path).content}));
      const checks=checksFor(test,task,files);
      results.push({id:test.id,status:task.status,kind:task.kind,errorCode:startError||task.errorCode,
        structuralPassed:!startError&&checks.every(check=>check.passed),checks,durationMs:Math.max(0,now()-taskStarted),stepCount:task.stepCount,
        usage:aggregateUsage(task.attempts.map(attempt=>attempt.known?{input_tokens:attempt.inputTokens,output_tokens:attempt.outputTokens}:null)),
        attempts:task.attempts,files:files.map(({content,...file})=>({...file,sha256:createHash('sha256').update(content).digest('hex')})),
        responseCharacters:task.resultText.length});
    }
    const passed=results.filter(result=>result.structuralPassed).length;
    return {...base,status:passed===results.length?'structural_pass':passed?'partial':'failed',reason:null,benchmark,qualification,
      tasks:results,passed,failed:results.length-passed,total:results.length,durationMs:Math.max(0,now()-started)};
  }finally{db.close();}
}
