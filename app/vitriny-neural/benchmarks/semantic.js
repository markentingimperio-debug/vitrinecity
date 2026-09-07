function regex(value){return value instanceof RegExp?value:new RegExp(String(value),'i');}
function textOf(output){if(typeof output==='string')return output;if(typeof output?.text==='string')return output.text;if(typeof output?.output?.text==='string')return output.output.text;return JSON.stringify(output??'');}
function average(values){return values.length?values.reduce((a,b)=>a+b,0)/values.length:0;}
function percentile(values,p){if(!values.length)return 0;const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.max(0,Math.ceil(sorted.length*p)-1))];}

export function scoreSemanticOutput(output,rubric={}){
  const text=textOf(output).trim();
  const checks=[];
  for(const pattern of rubric.mustMatch||[])checks.push({kind:'must',pattern:String(pattern),passed:regex(pattern).test(text)});
  for(const group of rubric.anyOf||[]){const patterns=Array.isArray(group)?group:[group];checks.push({kind:'anyOf',pattern:patterns.map(String).join(' | '),passed:patterns.some(p=>regex(p).test(text))});}
  for(const pattern of rubric.mustNotMatch||[])checks.push({kind:'mustNot',pattern:String(pattern),passed:!regex(pattern).test(text)});
  if(rubric.minChars)checks.push({kind:'minChars',pattern:String(rubric.minChars),passed:text.length>=Number(rubric.minChars)});
  if(rubric.maxChars)checks.push({kind:'maxChars',pattern:String(rubric.maxChars),passed:text.length<=Number(rubric.maxChars)});
  const score=checks.length?checks.filter(x=>x.passed).length/checks.length:(text?1:0);
  return {score,passed:score>=Number(rubric.passAt??0.7),checks,textLength:text.length};
}

export async function runSemanticBenchmark({provider,cases,timeoutMs=90000,now=Date.now}={}){
  if(!provider?.invoke)throw new TypeError('Benchmark requer provider com invoke().');
  if(!Array.isArray(cases)||!cases.length)throw new TypeError('Benchmark requer casos.');
  const results=[];
  for(const test of cases){
    const started=now();let output=null,error=null,model=null,usage=null;
    try{
      const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
      try{output=await provider.invoke({capability:test.capability,input:{...test.input,benchmarkCaseId:test.id},signal:controller.signal});}
      finally{clearTimeout(timer);}
      model=output?.model||null;usage=output?.usage||null;
    }catch(e){error=String(e?.message||e).slice(0,500);}
    const scored=error?{score:0,passed:false,checks:[],textLength:0}:scoreSemanticOutput(output,test.rubric);
    results.push({id:test.id,category:test.category,capability:test.capability,score:scored.score,passed:scored.passed,durationMs:Math.max(0,now()-started),model,usage,error,checks:scored.checks,textLength:scored.textLength});
  }
  const categories={};
  for(const result of results){const bucket=categories[result.category]||={total:0,passed:0,scores:[]};bucket.total++;bucket.scores.push(result.score);if(result.passed)bucket.passed++;}
  for(const bucket of Object.values(categories)){bucket.score=average(bucket.scores);delete bucket.scores;}
  const latencies=results.map(x=>x.durationMs),score=average(results.map(x=>x.score));
  return {suite:'vitriny-neural-semantic-v1',total:results.length,passed:results.filter(x=>x.passed).length,failed:results.filter(x=>!x.passed).length,score,grade:score>=.9?'A':score>=.8?'B':score>=.7?'C':'D',categories,latencyMs:{p50:percentile(latencies,.5),p95:percentile(latencies,.95),max:Math.max(0,...latencies)},results};
}
