import {createVitrinyNeuralService} from './service.js';
import {mountVitrinyNeuralAdmin} from './admin-api.js';

function truthy(value){return ['1','true','yes','on'].includes(String(value??'').trim().toLowerCase());}

export function setupVitrinyNeural({app,db,requireAdmin,sameOriginOnly,env=process.env,fetchImpl=globalThis.fetch,logger=console,nodeId='vitrinecity-api'}={}){
  if(!app||!db||typeof requireAdmin!=='function'||typeof sameOriginOnly!=='function')throw new TypeError('Integração Neural requer app, db e middlewares administrativos.');
  try{
    const service=createVitrinyNeuralService({db,env,fetchImpl,nodeId,pseudonymSalt:String(env.VITRINY_NEURAL_PSEUDONYM_SALT||'vitriny-neural-v1')});
    mountVitrinyNeuralAdmin({app,service,requireAdmin,sameOriginOnly});
    const capture=(event)=>{
      try{return service.capture(event);}catch(error){logger?.warn?.('[vitriny-neural] event rejected',String(error?.message||error));return{accepted:false,reason:'capture_failed'};}
    };
    logger?.info?.(`[vitriny-neural] initialized mode=${service.config.mode} enabled=${service.config.enabled}`);
    return{enabled:service.config.enabled,service,capture,status:()=>service.status()};
  }catch(error){
    logger?.error?.('[vitriny-neural] initialization failed',String(error?.message||error));
    if(truthy(env.VITRINY_NEURAL_REQUIRED))throw error;
    return{enabled:false,service:null,capture:()=>({accepted:false,reason:'neural_unavailable'}),status:()=>({service:{enabled:false,mode:'unavailable'},error:'initialization_failed'})};
  }
}
