import {qualifyModel} from './provider-qualification.js';

const API='/api/admin/vitriny-neural';
const ALLOWED_SKILLS=new Set(['media.generate','code.engineer','growth.optimizer','research.supervised','commerce.advisor','support.assistant','ranking.optimizer']);
function safeBody(value){if(!value||typeof value!=='object'||Array.isArray(value))return{};const json=JSON.stringify(value);if(Buffer.byteLength(json,'utf8')>64*1024)throw Object.assign(new Error('Payload Neural acima do limite.'),{status:413});return JSON.parse(json);}

export function mountVitrinyNeuralAdmin({app,runtime,requireAdmin,sameOriginOnly}){
  if(!app||!runtime?.neural||!runtime?.skills)throw new TypeError('Runtime Neural inválido.');
  app.use(API,requireAdmin,(req,res,next)=>{res.set('Cache-Control','no-store');if(req.method==='GET')return next();return sameOriginOnly(req,res,next);});
  app.get(API+'/status',(_req,res)=>res.json(runtime.status()));
  app.get(API+'/skills',(_req,res)=>res.json(runtime.skills.status()));
  app.post(API+'/policy/decide',(req,res)=>{
    try{
      if(!runtime.gate?.decide)return res.status(503).json({error:'Policy gate indisponível.'});
      const proposal=safeBody(req.body);
      return res.json({ok:true,decision:runtime.gate.decide(proposal)});
    }catch(error){return res.status(error?.status||400).json({error:String(error?.message||'Proposta inválida.').slice(0,400)});}
  });
  app.post(API+'/models/qualify',(req,res)=>{
    try{
      const report=safeBody(req.body);
      return res.json({ok:true,qualification:qualifyModel(report)});
    }catch(error){return res.status(error?.status||400).json({error:String(error?.message||'Relatório inválido.').slice(0,400)});}
  });
  app.post(API+'/skills/:id/run',async(req,res)=>{
    try{
      const id=String(req.params.id||'');if(!ALLOWED_SKILLS.has(id))return res.status(404).json({error:'Skill não disponível neste endpoint.'});
      const input=safeBody(req.body);
      const result=await runtime.skills.run(id,input,{learningContext:{actor:'admin',userId:req.user?.id||null}});
      return res.json({ok:true,result});
    }catch(error){return res.status(error?.status||502).json({error:String(error?.message||'Falha na skill.').slice(0,400)});}
  });
  app.post(API+'/events',(req,res)=>{
    try{
      const body=safeBody(req.body);
      const result=runtime.neural.ingest({...body,source:'admin-neural'});
      return res.status(result.accepted?201:200).json(result);
    }catch(error){return res.status(error?.status||400).json({error:String(error?.message||'Evento inválido.').slice(0,400)});}
  });
  return {api:API};
}
