const DEFAULT_CAPABILITIES=[
  'code.analyze','code.plan','code.patch','code.review','code.test-plan',
  'growth.diagnose','growth.campaign-plan','growth.content-plan','growth.seo-plan','growth.experiment','growth.metric-review',
  'research.collect','research.compare','research.summarize','research.verify',
  'commerce.catalog-review','commerce.pricing-review','commerce.inventory-review','commerce.offer-plan','commerce.seller-diagnose',
  'support.draft-reply','support.classify','support.summarize','support.next-best-action','support.quality-review',
  'ranking.evaluate','ranking.rerank-plan','ranking.feature-review','ranking.experiment-plan'
];

function cleanBaseUrl(value){const url=new URL(String(value||''));if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Base URL do modelo inválida.');return url.href.replace(/\/$/,'');}
function cleanText(value,max,min=1){const v=String(value??'').trim();if(v.length<min||v.length>max)throw new Error('Configuração do modelo inválida.');return v;}
function normalizeContent(data){
  const content=data?.choices?.[0]?.message?.content;
  if(typeof content==='string')return content.trim();
  if(Array.isArray(content))return content.map(part=>typeof part==='string'?part:(part?.text||'')).join('').trim();
  throw new Error('Resposta do modelo sem conteúdo.');
}

function systemPrompt(capability){
  return `Você é um worker do Vitriny Neural. Execute somente a capacidade ${capability}. Responda em português do Brasil, de forma factual e operacional. Não invente dados ausentes. Não execute pagamentos, alterações destrutivas, deploy ou uso de credenciais. Quando faltarem fatos necessários, declare a limitação. Para código, prefira proposta/diff e testes; não afirme que publicou em produção.`;
}

export function createOpenAICompatibleProvider({id='local-model',baseUrl,apiKey='',model='local',capabilities=DEFAULT_CAPABILITIES,priority=50,costClass='local',local=true,temperature=.2,maxTokens=1200,fetchImpl=globalThis.fetch}={}){
  if(typeof fetchImpl!=='function')throw new TypeError('Provider requer fetch.');
  const url=cleanBaseUrl(baseUrl);
  const providerId=cleanText(id,64,2);
  const modelName=cleanText(model,160,1);
  const caps=[...new Set(capabilities.map(x=>cleanText(x,80,2)))];
  return {
    id:providerId,capabilities:caps,priority,costClass,local,
    async available(){return true;},
    async invoke({capability,input,signal}){
      if(!caps.includes(capability))throw new Error(`Capacidade não suportada pelo modelo: ${capability}`);
      const response=await fetchImpl(`${url}/v1/chat/completions`,{
        method:'POST',signal,
        headers:{'content-type':'application/json',...(apiKey?{authorization:`Bearer ${apiKey}`}:{})},
        body:JSON.stringify({
          model:modelName,temperature:Number(temperature),max_tokens:Number(maxTokens),
          messages:[{role:'system',content:systemPrompt(capability)},{role:'user',content:JSON.stringify(input??{})}]
        })
      });
      if(!response.ok){const body=await response.text().catch(()=> '');throw new Error(`Modelo HTTP ${response.status}: ${body.slice(0,240)}`);}
      const data=await response.json();
      return {text:normalizeContent(data),model:data?.model||modelName,usage:data?.usage||null};
    }
  };
}

export const openAICompatibleCapabilities=Object.freeze([...DEFAULT_CAPABILITIES]);
