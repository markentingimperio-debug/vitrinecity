import assert from 'node:assert/strict';
import http from 'node:http';
import {createOpenAICompatibleProvider} from '../vitriny-neural/providers/openai-compatible.js';
import {createSkillRegistry} from '../vitriny-neural/skills/registry.js';
import {createCodeSkill} from '../vitriny-neural/skills/code.js';

const requests=[];
const server=http.createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  const json=JSON.parse(body||'{}');requests.push({url:req.url,headers:req.headers,json});
  res.setHeader('content-type','application/json');
  res.end(JSON.stringify({model:'mock-qwen',choices:[{message:{content:'Análise concluída sem alterar produção. Recomendo testes antes do merge.'}}],usage:{prompt_tokens:10,completion_tokens:12,total_tokens:22}}));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port;

try{
  const provider=createOpenAICompatibleProvider({id:'mock-local',baseUrl:`http://127.0.0.1:${port}`,model:'mock-qwen',apiKey:'test-key',local:true});
  const registry=createSkillRegistry();registry.registerSkill(createCodeSkill());registry.registerProvider(provider);
  const result=await registry.run('code.engineer',{action:'analyze',task:'avaliar módulo com segurança',dryRun:true});
  assert.equal(result.provider,'mock-local');
  assert.match(result.output.text,/Análise concluída/);
  assert.equal(requests.length,1);
  assert.equal(requests[0].url,'/v1/chat/completions');
  assert.equal(requests[0].headers.authorization,'Bearer test-key');
  assert.equal(requests[0].json.model,'mock-qwen');
  assert.equal(requests[0].json.chat_template_kwargs.enable_thinking,false);
  assert.match(requests[0].json.messages[0].content,/Não execute pagamentos/);
  assert.match(requests[0].json.messages[0].content,/não afirme que publicou em produção/i);

  registry.setProviderPolicy('mock-local',{enabled:false,allowedCapabilities:[],source:'failed_benchmark'});
  await assert.rejects(()=>registry.run('code.engineer',{action:'analyze',task:'teste operacional bloqueado',dryRun:true}),/Nenhum provider disponível/);
  const evaluation=await registry.run('code.engineer',{action:'analyze',task:'teste administrativo do modelo',dryRun:true},{evaluation:true,maxTokens:400});
  assert.equal(evaluation.provider,'mock-local');
  assert.equal(requests.length,2);
  assert.equal(requests[1].json.max_tokens,400);
  assert.equal(requests[1].json.chat_template_kwargs.enable_thinking,false);

  const stats=registry.status().providers.find(x=>x.id==='mock-local').stats;
  assert.equal(stats.inputTokens,20);
  assert.equal(stats.outputTokens,24);
  assert.equal(stats.totalTokens,44);
  console.log(JSON.stringify({ok:true,model:evaluation.output.model,thinking:false,evaluationBypassesOperationalBlock:true,maxTokens:requests[1].json.max_tokens,metered:{inputTokens:stats.inputTokens,outputTokens:stats.outputTokens,totalTokens:stats.totalTokens}}));
}finally{await new Promise(resolve=>server.close(resolve));}
