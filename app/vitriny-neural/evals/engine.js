function percentile(values,p){if(!values.length)return 0;const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.max(0,Math.ceil(p*sorted.length)-1))];}
function grade(score){if(score>=0.98)return'A+';if(score>=0.95)return'A';if(score>=0.90)return'B';if(score>=0.80)return'C';return'D';}

export function createNeuralEvalEngine({now=Date.now}={}){
  async function run(cases,executor,{suite='neural-eval'}={}){
    if(!Array.isArray(cases)||!cases.length)throw new TypeError('Eval suite precisa de casos.');
    if(typeof executor!=='function')throw new TypeError('Executor inválido.');
    const results=[];
    for(const test of cases){
      const started=now();let output,error=null,passed=false;
      try{output=await executor(test);passed=typeof test.expect==='function'?Boolean(await test.expect(output,null)):true;}
      catch(e){error=String(e?.message||e);passed=typeof test.expect==='function'?Boolean(await test.expect(undefined,e)):false;}
      results.push({id:String(test.id||results.length+1),category:String(test.category||'general'),passed,weight:Math.max(0.1,Number(test.weight)||1),durationMs:Math.max(0,now()-started),error,notes:String(test.notes||'')});
    }
    const totalWeight=results.reduce((n,r)=>n+r.weight,0),passedWeight=results.filter(r=>r.passed).reduce((n,r)=>n+r.weight,0),score=totalWeight?passedWeight/totalWeight:0;
    const byCategory={};for(const r of results){const x=byCategory[r.category]||={total:0,passed:0,weight:0,passedWeight:0};x.total++;x.weight+=r.weight;if(r.passed){x.passed++;x.passedWeight+=r.weight;}}
    for(const x of Object.values(byCategory))x.score=x.weight?x.passedWeight/x.weight:0;
    const latency=results.map(r=>r.durationMs);
    return{suite,total:results.length,passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,score,grade:grade(score),byCategory,latencyMs:{p50:percentile(latency,.50),p95:percentile(latency,.95),max:Math.max(0,...latency)},failures:results.filter(r=>!r.passed).slice(0,50),results};
  }
  return{run};
}
