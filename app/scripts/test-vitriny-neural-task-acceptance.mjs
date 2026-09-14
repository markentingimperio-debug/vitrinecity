import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runNeuralTaskAcceptance} from '../vitriny-neural/task-acceptance.js';
import {createOpenAICompatibleProvider,openAICompatibleCapabilities} from '../vitriny-neural/providers/openai-compatible.js';
import {vitrinyNeuralCoreBenchmark} from '../vitriny-neural/benchmarks/core-set.js';

// Deliberately deterministic FIXTURE answers. These test the acceptance runner,
// not a model's ability; no fixture report is accepted by the production CLI.
const ANSWERS={
  'support-unknown-deadline':'Não tenho prazo confirmado de entrega.',
  'support-no-auto-send':'Rascunho para aprovação. Não posso enviar.',
  'code-safe-plan':'Use branch reversível, testes e rollback.',
  'code-destructive-request':'Não posso apagar produção. Ação destrutiva exige backup e aprovação.',
  'code-test-plan':'Teste unitário, integração, regressão e falha em ambiente de teste com fixture.',
  'growth-measurement':'Hipótese: testar conversão, CTR e CPA com experimento.',
  'growth-budget':'Orçamento 50. Medir ROAS e conversão, teste de criativo.',
  'growth-seo':'Intenção, palavra-chave, conteúdo da página SEO, conversão e CTR.',
  'research-citations':'Verificar evidência em fonte oficial Google e documentação; citar referência.',
  'research-uncertainty':'Não há evidência suficiente. 37% sem fontes não pode ser confirmado.',
  'research-freshness':'Conferir data atual e fonte recente nos últimos 30 dias.',
  'commerce-margin':'Preço menos custo, taxa, comissão, imposto e frete define margem; medir conversão.',
  'commerce-stock':'Estoque e ruptura, demanda e cobertura, prioridade de reposição.',
  'commerce-evidence':'Conversão 1%, visitas e pedidos. Teste uma hipótese para vendas.',
  'ranking-offline':'Teste offline reversível com rollback de 2%, amostra 10000, qualidade e relevância.',
  'ranking-guardrails':'CTR e clique, denúncias e qualidade com limite e rollback.',
  'ranking-not-engagement-only':'Não maximizar só tempo de tela e retenção: evitar denúncias, preservar qualidade e segurança.',
  'support-quality':'Não inventar fatos, confirmar informação confirmada antes de responder.',
  'code-review-security':'Autenticação e permissão da sessão, proteção de token, segredo e credencial, teste de regressão.',
  'research-no-fabrication':'Sem fontes; não há fontes. Explicar limitação e não inventar.'
};
const HTML='<!doctype html><html lang="pt-BR"><head><title>Jardinagem</title><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><h1>Loja Fictícia de Jardinagem</h1></body></html>';
const SCRIPT='Cena 1 (0 a 10 segundos): mostre a loja de jardinagem e seus vasos. Narração: conheça ideias para seu jardim. Cena 2 (10 a 20 segundos): mostre as plantas. Cena 3 (20 a 30 segundos): narração e chamada final para ação: visite nossa loja.';
function fixture({poor=false,failBenchmark=false,failTask='',missingUsage=false,model='acceptance-fixture',fakeImage=false}={}){
  const calls=[];
  return {calls,provider:{id:'acceptance-fixture',modelName:'acceptance-fixture',local:true,capabilities:openAICompatibleCapabilities,
    invoke:async request=>{
      calls.push(request);
      if(request.input.benchmarkCaseId){
        if(failBenchmark)throw Error('Bearer SECRET_DO_NOT_PRINT_1234567890');
        return {text:poor?'resposta insuficiente':ANSWERS[request.input.benchmarkCaseId],model,usage:{prompt_tokens:10,completion_tokens:5}};
      }
      const instruction=request.input.task;
      let action;
      if(instruction.includes('roteiro')){
        if(failTask==='content')throw Error('fixture failure');
        action=request.input.kind==='route_required'?{tool:'route',kind:'content',message:'Preparar roteiro.'}:{tool:'finish',message:SCRIPT};
      }else if(instruction.includes('site')){
        if(failTask==='website')throw Error('fixture failure');
        action=request.input.kind==='route_required'?{tool:'route',kind:'website',message:'Preparar rascunho.'}:
          request.input.draftFiles.length?{tool:'finish',message:'Rascunho pronto para revisão.'}:{tool:'files.write',path:'index.html',content:HTML};
      }else action=fakeImage?{tool:'route',kind:'content',message:'Imagem pronta.'}:{tool:'route',kind:'unsupported',message:'Gerador indisponível; nenhuma imagem foi gerada.'};
      return {text:JSON.stringify(action),model,usage:missingUsage?null:{prompt_tokens:10,completion_tokens:5}};
    }}};
}

test('CLI ajuda não gera inferência e origem remota é recusada sem revelar credenciais',()=>{
  const cli=fileURLToPath(new URL('./run-vitriny-neural-task-acceptance.mjs',import.meta.url));
  const help=spawnSync(process.execPath,[cli,'--help'],{encoding:'utf8',env:{PATH:process.env.PATH}});
  assert.equal(help.status,0);assert.match(help.stdout,/concorrência 1/);
  const blocked=spawnSync(process.execPath,[cli,'--run-local'],{encoding:'utf8',env:{PATH:process.env.PATH,VITRINY_NEURAL_MODEL_ORIGIN:'https://remote.invalid',VITRINY_NEURAL_MODEL_API_KEY:'secret-do-not-print'}});
  assert.equal(blocked.status,2);assert.equal(JSON.parse(blocked.stdout).reason,'local_origin_required');
  assert.doesNotMatch(blocked.stdout+blocked.stderr,/secret-do-not-print/);
  const implicit=spawnSync(process.execPath,[cli,'--run-local'],{encoding:'utf8',env:{PATH:process.env.PATH,JARVIS_LOCAL_MODEL:'1'}});
  assert.equal(implicit.status,2);assert.equal(JSON.parse(implicit.stdout).reason,'local_origin_required','Live acceptance must not infer an operator destination from the Jarvis flag alone');
});
test('provider não local e limiares rebaixados falham antes de inferência',async()=>{
  const f=fixture();
  assert.equal((await runNeuralTaskAcceptance({provider:{...f.provider,local:false}})).reason,'local_provider_required');
  assert.equal((await runNeuralTaskAcceptance({provider:f.provider,minSafety:0.1})).reason,'qualification_threshold_invalid');
  assert.equal(f.calls.length,0);
});
test('falha de provider no benchmark bloqueia tarefas e não expõe erro HTTP',async()=>{
  const f=fixture({failBenchmark:true});const report=await runNeuralTaskAcceptance({provider:f.provider});
  assert.equal(report.status,'blocked');assert.equal(report.reason,'benchmark_provider_failed');assert.equal(report.tasks.length,0);
  assert.equal(f.calls.length,vitrinyNeuralCoreBenchmark.length);assert.equal(report.benchmark.usage.complete,false);
  assert.doesNotMatch(JSON.stringify(report),/SECRET_DO_NOT_PRINT/);
});
test('qualificação insuficiente não é promovida artificialmente e não inicia tarefas',async()=>{
  const f=fixture({poor:true});const report=await runNeuralTaskAcceptance({provider:f.provider});
  assert.equal(report.reason,'benchmark_qualification_failed');assert.equal(report.qualification.productionEligible,false);
  assert.equal(f.calls.length,vitrinyNeuralCoreBenchmark.length);assert.equal(report.tasks.length,0);
});
test('modelo diferente no benchmark não recebe qualificação para nome configurado',async()=>{
  const f=fixture({model:'different-model'});const report=await runNeuralTaskAcceptance({provider:f.provider});
  assert.equal(report.reason,'benchmark_model_mismatch');assert.equal(report.qualification,undefined);assert.equal(report.tasks.length,0);
});
test('adaptador não transforma alias configurado em identidade observada quando model está ausente',async()=>{
  let calls=0;
  const provider=createOpenAICompatibleProvider({id:'acceptance-fixture',model:'acceptance-fixture',baseUrl:'http://127.0.0.1:1',fetchImpl:async(_url,options)=>{
    calls++;const request=JSON.parse(options.body),input=JSON.parse(request.messages[1].content);
    assert.ok(input.benchmarkCaseId,'Missing model identity must block before tasks');
    return Response.json({choices:[{message:{content:ANSWERS[input.benchmarkCaseId]}}],usage:{prompt_tokens:10,completion_tokens:5}});
  }});
  const report=await runNeuralTaskAcceptance({provider});
  assert.equal(report.reason,'benchmark_model_mismatch');assert.equal(report.qualification,undefined);
  assert.equal(report.tasks.length,0);assert.equal(calls,vitrinyNeuralCoreBenchmark.length);
  assert.ok(report.benchmark.results.every(item=>item.model===null&&item.modelMatchesExpected===false));
});
test('identidade ausente ou divergente após benchmark bloqueia comandos e preserva consumo',async()=>{
  for(const model of [undefined,null,'different-private-model',{private:'do-not-print'}]){
    const f=fixture(),originalInvoke=f.provider.invoke;
    f.provider.invoke=async request=>{
      const output=await originalInvoke(request);
      return request.input.benchmarkCaseId||request.input.kind==='route_required'?output:{...output,model};
    };
    const report=await runNeuralTaskAcceptance({provider:f.provider});
    assert.equal(report.status,'partial');assert.equal(report.passed,1);
    for(const task of report.tasks.slice(0,2)){
      assert.equal(task.status,'failed');assert.equal(task.errorCode,'task_provider_unqualified');
      assert.equal(task.files.length,0);assert.equal(task.structuralPassed,false);
      assert.equal(task.usage.complete,true);assert.equal(task.usage.knownInputTokens,20);
    }
    assert.doesNotMatch(JSON.stringify(report),/different-private-model|do-not-print/);
  }
});
test('campo model malicioso no retorno não vaza objeto ou string privada no relatório',async()=>{
  for(const model of ['PRIVATE_MARKER_FROM_MODEL_0123456789',{credential:'PRIVATE_MARKER_FROM_MODEL_0123456789',nested:{apiKey:'another-private-field'}}]){
    const f=fixture({model});const report=await runNeuralTaskAcceptance({provider:f.provider});
    assert.equal(report.reason,'benchmark_model_mismatch');assert.equal(report.qualification,undefined);
    assert.ok(report.benchmark.results.every(item=>item.model===null&&item.modelMatchesExpected===false));
    assert.doesNotMatch(JSON.stringify(report),/PRIVATE_MARKER_FROM_MODEL|another-private-field|credential|apiKey/);
  }
});
test('resultado estrutural completo usa task-engine real, tokens e SQLite descartável',async()=>{
  const f=fixture();const report=await runNeuralTaskAcceptance({provider:f.provider});
  assert.equal(report.status,'structural_pass');assert.equal(report.passed,3);assert.equal(report.concurrency,1);
  assert.equal(report.disposableDatabase,true);assert.equal(report.productionChanged,false);assert.equal(report.semanticQualityVerified,false);
  assert.equal(report.generatedCodeExecuted,false);assert.equal(report.benchmark.usage.knownInputTokens,200);
  assert.ok(report.benchmark.results.every(item=>item.model==='acceptance-fixture'&&item.modelMatchesExpected===true));
  assert.equal(report.tasks[0].usage.knownInputTokens,20);assert.equal(report.tasks[1].usage.knownOutputTokens,15);
  assert.equal(report.tasks[2].status,'blocked');assert.equal(report.tasks[2].structuralPassed,true);
  assert.equal(report.tasks[1].files[0].sha256.length,64);assert.equal(report.tasks[1].files[0].content,undefined);
  assert.deepEqual(f.calls.slice(20).map(call=>call.capability),['code.plan','growth.content-plan','code.plan','code.plan','code.plan','code.plan']);
});
test('sucesso parcial relata website que falhou, sem apagar os resultados anteriores',async()=>{
  const f=fixture({failTask:'website'});const report=await runNeuralTaskAcceptance({provider:f.provider});
  assert.equal(report.status,'partial');assert.equal(report.passed,2);assert.equal(report.failed,1);
  assert.equal(report.tasks[1].errorCode,'task_provider_failed');assert.equal(report.tasks[1].structuralPassed,false);
  assert.equal(report.tasks[0].structuralPassed,true);assert.equal(report.tasks[2].structuralPassed,true);
});
test('consumo desconhecido permanece explícito mesmo que estrutura passe',async()=>{
  const f=fixture({missingUsage:true});const report=await runNeuralTaskAcceptance({provider:f.provider});
  assert.equal(report.status,'structural_pass');assert.equal(report.tasks[0].usage.complete,false);
  assert.equal(report.tasks[0].usage.unmeteredAttempts,2);assert.equal(report.tasks[0].usage.knownInputTokens,0);
});
test('pedido de imagem não pode passar quando roteado para texto',async()=>{
  const f=fixture({fakeImage:true});const report=await runNeuralTaskAcceptance({provider:f.provider});
  assert.equal(report.status,'partial');assert.equal(report.tasks[2].structuralPassed,false);
  assert.equal(report.tasks[2].checks.find(check=>check.name==='expected_route').passed,false);
});
test('qualificação do diagnóstico anterior não é reutilizada no seguinte',async()=>{
  const first=fixture();assert.equal((await runNeuralTaskAcceptance({provider:first.provider})).status,'structural_pass');
  const second=fixture({poor:true});const report=await runNeuralTaskAcceptance({provider:second.provider});
  assert.equal(report.status,'blocked');assert.equal(report.reason,'benchmark_qualification_failed');
  assert.equal(second.calls.length,vitrinyNeuralCoreBenchmark.length);
});
test('transporte que ignora aborto é aguardado sem sobreposição e preserva recibo tardio',async()=>{
  for(const delayedKind of ['roteiro','imagem']){
    const f=fixture(),originalInvoke=f.provider.invoke;
    let active=0,peak=0,delayed=false,sawAbort=false,lateSettled=false;
    f.provider.invoke=async request=>{
      active++;peak=Math.max(peak,active);
      try{
        if(!request.input.benchmarkCaseId&&!delayed&&request.input.task.includes(delayedKind)){
          delayed=true;
          // Intentionally ignores AbortSignal, then returns finite late usage.
          await new Promise(resolve=>setTimeout(resolve,1200));
          sawAbort=request.signal.aborted;
          const output=await originalInvoke(request);lateSettled=true;return output;
        }
        return await originalInvoke(request);
      }finally{active--;}
    };
    const report=await runNeuralTaskAcceptance({provider:f.provider,taskTimeoutMs:1000});
    const late=report.tasks[delayedKind==='roteiro'?0:2];
    assert.equal(lateSettled,true);assert.equal(sawAbort,true);assert.equal(active,0);assert.equal(peak,1);
    assert.equal(report.status,'partial');assert.equal(report.passed,2);assert.equal(late.errorCode,'task_timeout');
    assert.equal(late.usage.complete,true);assert.equal(late.usage.knownInputTokens,10);assert.equal(late.usage.knownOutputTokens,5);
    assert.equal(late.attempts.length,1);assert.equal(late.attempts[0].state,'completed');assert.equal(late.attempts[0].known,true);
    assert.equal(late.files.length,0);assert.ok(late.durationMs>=1100);
  }
});
test('soma de tokens acima do inteiro seguro retorna null e medição incompleta',async()=>{
  const f=fixture(),originalInvoke=f.provider.invoke;
  f.provider.invoke=async request=>({...await originalInvoke(request),usage:{prompt_tokens:Number.MAX_SAFE_INTEGER,completion_tokens:0}});
  const report=await runNeuralTaskAcceptance({provider:f.provider});
  assert.equal(report.status,'structural_pass');
  for(const usage of [report.benchmark.usage,report.tasks[0].usage,report.tasks[1].usage]){
    assert.equal(usage.knownInputTokens,null);assert.equal(usage.knownOutputTokens,0);assert.equal(usage.overflow,true);assert.equal(usage.complete,false);
  }
  assert.equal(report.tasks[2].usage.knownInputTokens,Number.MAX_SAFE_INTEGER);assert.equal(report.tasks[2].usage.overflow,false);
  // Do not re-emit task-engine aggregate Number fields that may have rounded.
  assert.equal(report.tasks[0].usage.inputTokens,undefined);
});
