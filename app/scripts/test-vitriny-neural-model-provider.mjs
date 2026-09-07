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
  assert.match(requests[0].json.messages[0].content,/Não execute pagamentos/);
  assert.match(requests[0].json.messages[0].content,/não afirme que publicou em produção/i);
  const stats=registry.status().providers.find(x=>x.id==='mock-local').stats;
  assert.equal(stats.inputTokens,10);
  assert.equal(stats.outputTokens,12);
  assert.equal(stats.totalTokens,22);
  console.log(JSON.stringify({ok:true,model:result.output.model,usage:result.output.usage,metered:{inputTokens:stats.inputTokens,outputTokens:stats.outputTokens,totalTokens:stats.totalTokens}}));
}finally{await new Promise(resolve=>server.close(resolve));}
