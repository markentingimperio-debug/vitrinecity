import {createVitrinyNeuralService} from './service.js';
import {mountVitrinyNeuralAdmin} from './admin-api.js';
import {createSpatialNeuralBridge} from './spatial-signal-bridge.js';

function truthy(value){return ['1','true','yes','on'].includes(String(value??'').trim().toLowerCase());}
function pseudonymSalt(env){
  const value=String(env?.VITRINY_NEURAL_PSEUDONYM_SALT||'').trim();
  if(truthy(env?.VITRINY_NEURAL_ENABLED)&&value.length<16)throw new Error('VITRINY_NEURAL_PSEUDONYM_SALT precisa ter pelo menos 16 caracteres quando a Neural estiver habilitada.');
  return value||'disabled-neural-no-personal-events';
}

export function setupVitrinyNeural({app,db,requireAdmin,sameOriginOnly,env=process.env,fetchImpl=globalThis.fetch,logger=console,nodeId='vitrinecity-api'}={}){
  if(!app||!db||typeof requireAdmin!=='function'||typeof sameOriginOnly!=='function')throw new TypeError('Integração Neural requer app, db e middlewares administrativos.');
  try{
    const service=createVitrinyNeuralService({db,env,fetchImpl,nodeId,pseudonymSalt:pseudonymSalt(env),logger});
    mountVitrinyNeuralAdmin({app,service,requireAdmin,sameOriginOnly});
    if(service.config.enabled){service.observer.start();service.webResearch?.schedule?.();service.spatialEvents.start();}
    const capture=(event)=>{
      try{return service.capture(event);}catch(error){logger?.warn?.('[vitriny-neural] event rejected',String(error?.message||error));return{accepted:false,reason:'capture_failed'};}
    };
    let spatialBridge=null;
    if(service.config.enabled&&app.locals?.spatialTelemetry){
      spatialBridge=createSpatialNeuralBridge({capture,telemetry:app.locals.spatialTelemetry,presence:app.locals.spatialPresence});
      spatialBridge.start();
    }
    logger?.info?.(`[vitriny-neural] initialized mode=${service.config.mode} enabled=${service.config.enabled} webResearch=${service.webResearch?.status?.().enabled===true} spatialBridge=${Boolean(spatialBridge)}`);
    return{
      enabled:service.config.enabled,service,capture,spatialBridge,status:()=>service.status(),
      stop:()=>{spatialBridge?.stop?.();service.observer.stop();service.webResearch?.stop?.();service.spatialEvents.stop();return true;}
    };
  }catch(error){
    logger?.error?.('[vitriny-neural] initialization failed',String(error?.message||error));
    if(truthy(env.VITRINY_NEURAL_REQUIRED))throw error;
    return{enabled:false,service:null,capture:()=>({accepted:false,reason:'neural_unavailable'}),spatialBridge:null,status:()=>({service:{enabled:false,mode:'unavailable'},error:'initialization_failed'}),stop:()=>false};
  }
}
