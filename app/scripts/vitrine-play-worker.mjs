#!/usr/bin/env node
/** Durable runner for a separately configured LIA/provider adapter.
 * No provider is silently selected, and missing adapters fail closed.
 * An adapter must export estimateMaxCostBrl(stage) and run(job).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {STAGES} from '../vitrine-play.js';

export async function startWorker(env=process.env) {
  const base=new URL(env.VITRINE_PLAY_SITE_URL||'https://vitrinecity.com');
  if(base.protocol!=='https:'||base.username||base.password||base.pathname!=='/')throw Error('Use uma origem HTTPS em VITRINE_PLAY_SITE_URL.');
  const token=String(env.VITRINE_PLAY_WORKER_TOKEN||'');if(token.length<32)throw Error('Defina uma credencial dedicada de pelo menos 32 caracteres.');
  const adapterPath=env.VITRINE_PLAY_ADAPTER;
  if(!adapterPath||!path.isAbsolute(adapterPath))throw Error('Falta VITRINE_PLAY_ADAPTER: módulo local auditado para os provedores da LIA. Nenhuma geração iniciada.');
  const adapter=await import(pathToFileURL(adapterPath));
  if(typeof adapter.estimateMaxCostBrl!=='function'||typeof adapter.run!=='function')throw Error('Adapter incompatível: estimateMaxCostBrl e run são obrigatórios.');
  const receipts=path.resolve(env.VITRINE_PLAY_RECEIPTS_DIR||'/data/vitrine-play-receipts');
  await fs.mkdir(receipts,{recursive:true,mode:0o700});
  async function post(route,body) {
    const response=await fetch(new URL('/api/worker/vitrine-play'+route,base),{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});
    const result=await response.json();if(!response.ok)throw Error('Vitrine Play HTTP '+response.status+': '+String(result.error||'Falha').slice(0,200));return result;
  }
  async function flushReceipts() {
    for(const name of await fs.readdir(receipts)){
      if(!/^[a-f0-9-]+\.json$/.test(name))continue;
      const file=path.join(receipts,name),r=JSON.parse(await fs.readFile(file,'utf8'));
      await post('/jobs/'+encodeURIComponent(r.id)+'/complete',r.body);
      await fs.unlink(file);console.log('Resultado confirmado:',r.id);
    }
  }
  async function iteration() {
    // Re-submit receipts, never re-run a successful paid generation.
    await flushReceipts();
    for(const stage of STAGES){
      const maxCostBrl=await adapter.estimateMaxCostBrl(stage);
      if(maxCostBrl===null)continue; // Explicitly unsupported stage.
      if(!Number.isFinite(maxCostBrl)||maxCostBrl<0||maxCostBrl>10000)throw Error('Estimativa inválida: '+stage);
      const {job}=await post('/claim',{stage,maxCostBrl});if(!job)continue;
      let output;
      try {
        output=await adapter.run({...job,idempotencyKey:job.id,signal:AbortSignal.timeout(25*60*1000)});
        if(!output?.result||!Number.isFinite(output.actualCostBrl)||output.actualCostBrl<0||Math.round(output.actualCostBrl*100)>job.maxCostCents)throw Error('Adapter não entregou resultado e custo dentro do limite.');
      }catch(error){
        // Provider may have charged; do not declare zero cost or requeue.
        await post('/jobs/'+encodeURIComponent(job.id)+'/fail',{leaseToken:job.leaseToken,error:'Falha ou custo incerto no adapter. Conferir recibos do provedor.'});
        console.error('Tarefa requer reconciliação:',job.id);continue;
      }
      const receipt={id:job.id,body:{leaseToken:job.leaseToken,result:output.result,actualCostBrl:output.actualCostBrl}};
      const file=path.join(receipts,job.id+'.json'),tmp=file+'.tmp';
      await fs.writeFile(tmp,JSON.stringify(receipt),{mode:0o600});await fs.rename(tmp,file);
      await flushReceipts();
    }
  }
  do{await iteration();if(env.VITRINE_PLAY_WORKER_ONCE==='1')break;await sleep(15000);}while(true);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  startWorker().catch(error=>{console.error(error.message);process.exitCode=1;});
}
