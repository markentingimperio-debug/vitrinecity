import {qualifyModel} from './provider-qualification.js';
import {assessNeuralReadiness} from './readiness.js';

const API='/api/admin/vitriny-neural';
const ALLOWED_SKILLS=new Set(['media.generate','code.engineer','growth.optimizer','research.supervised','commerce.advisor','support.assistant','ranking.optimizer']);
function safeBody(value){if(!value||typeof value!=='object'||Array.isArray(value))return{};const json=JSON.stringify(value);if(Buffer.byteLength(json,'utf8')>64*1024)throw Object.assign(new Error('Payload Neural acima do limite.'),{status:413});return JSON.parse(json);}

export function mountVitrinyNeuralAdmin({app,runtime=null,service=null,requireAdmin,sameOriginOnly}){
  const activeRuntime=service?.runtime||runtime;
  if(!app||!activeRuntime?.neural||!activeRuntime?.skills)throw new TypeError('Runtime Neural inválido.');
  app.use(API,requireAdmin,(req,res,next)=>{res.set('Cache-Control','no-store');if(req.method==='GET')return next();return sameOriginOnly(req,res,next);});
  app.get(API+'/status',(_req,res)=>res.json(service?.status?service.status():activeRuntime.status()));
  app.get(API+'/skills',(_req,res)=>res.json(activeRuntime.skills.status()));
  app.get(API+'/readiness',(_req,res)=>res.json({ok:true,readiness:service?.readiness?service.readiness():assessNeuralReadiness({runtime:activeRuntime})}));
  app.get(API+'/models/qualifications',(_req,res)=>{
    if(!service?.qualifications?.list)return res.status(503).json({error:'Histórico de qualificação indisponível.'});
    return res.json({ok:true,items:service.qualifications.list({limit:50})});
  });
  app.get(API+'/benchmark',(_req,res)=>{
    if(!service?.benchmarks?.status)return res.status(503).json({error:'Benchmark indisponível.'});
    return res.json({ok:true,...service.benchmarks.status()});
  });
  app.get(API+'/benchmark/:id',(req,res)=>{
    if(!service?.benchmarks?.get)return res.status(503).json({error:'Benchmark indisponível.'});
    const item=service.benchmarks.get(req.params.id);
    return item?res.json({ok:true,item}):res.status(404).json({error:'Benchmark não encontrado.'});
  });
  app.get(API+'/actions',(_req,res)=>{
    if(!service?.budget?.recent)return res.status(503).json({error:'Action budget indisponível.'});
    return res.json({ok:true,usage:service.budget.usage(),items:service.budget.recent(50)});
  });
  app.post(API+'/benchmark/start',(req,res)=>{
    try{
      if(!service?.benchmarks?.start)return res.status(503).json({error:'Benchmark indisponível.'});
      const item=service.benchmarks.start({actorId:req.user?.id??null});
      return res.status(202).json({ok:true,item});
    }catch(error){return res.status(error?.status||500).json({error:String(error?.message||'Não foi possível iniciar o benchmark.').slice(0,400)});}
  });
  app.post(API+'/readiness',(req,res)=>{
    try{
      const body=safeBody(req.body),report=body.report&&typeof body.report==='object'?body.report:body;
      const qualification=qualifyModel(report);
      return res.json({ok:true,qualification,readiness:assessNeuralReadiness({runtime:activeRuntime,qualification})});
    }catch(error){return res.status(error?.status||400).json({error:String(error?.message||'Relatório inválido.').slice(0,400)});}
  });
  app.post(API+'/policy/decide',(req,res)=>{
    try{
      const proposal=safeBody(req.body);
      if(service?.authorize)return res.json({ok:true,decision:service.authorize(proposal)});
      if(!activeRuntime.gate?.decide)return res.status(503).json({error:'Policy gate indisponível.'});
      return res.json({ok:true,decision:activeRuntime.gate.decide(proposal)});
    }catch(error){return res.status(error?.status||400).json({error:String(error?.message||'Proposta inválida.').slice(0,400)});}
  });
  app.post(API+'/models/qualify',(req,res)=>{
    try{
      const body=safeBody(req.body),report=body.report&&typeof body.report==='object'?body.report:body;
      if(service?.recordQualification){
        const saved=service.recordQualification({providerId:body.providerId,modelName:body.modelName||'',suite:body.suite||'',report});
        return res.json({ok:true,qualification:saved.qualification,record:{id:saved.id,providerId:saved.providerId,modelName:saved.modelName,score:saved.score,safetyScore:saved.safetyScore,productionEligible:saved.productionEligible,createdAt:saved.createdAt},readiness:service.readiness()});
      }
      return res.json({ok:true,qualification:qualifyModel(report)});
    }catch(error){return res.status(error?.status||400).json({error:String(error?.message||'Relatório inválido.').slice(0,400)});}
  });
  app.post(API+'/actions/:id/commit',(req,res)=>{
    if(!service?.commitAction)return res.status(503).json({error:'Controle de ações indisponível.'});
    return res.json({ok:true,result:service.commitAction(req.params.id)});
  });
  app.post(API+'/actions/:id/release',(req,res)=>{
    if(!service?.releaseAction)return res.status(503).json({error:'Controle de ações indisponível.'});
    return res.json({ok:true,result:service.releaseAction(req.params.id)});
  });
  app.post(API+'/skills/:id/run',async(req,res)=>{
    try{
      const id=String(req.params.id||'');if(!ALLOWED_SKILLS.has(id))return res.status(404).json({error:'Skill não disponível neste endpoint.'});
      const input=safeBody(req.body);
      const result=await activeRuntime.skills.run(id,input,{learningContext:{actor:'admin',userId:req.user?.id||null}});
      return res.json({ok:true,result});
    }catch(error){return res.status(error?.status||502).json({error:String(error?.message||'Falha na skill.').slice(0,400)});}
  });
  app.post(API+'/events',(req,res)=>{
    try{
      const body=safeBody(req.body);
      const result=service?.capture?service.capture({...body,source:'admin-neural'}):activeRuntime.neural.ingest({...body,source:'admin-neural'});
      return res.status(result.accepted?201:200).json(result);
    }catch(error){return res.status(error?.status||400).json({error:String(error?.message||'Evento inválido.').slice(0,400)});}
  });
  return {api:API};
}
