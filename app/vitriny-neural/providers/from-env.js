import {createOpenAICompatibleProvider} from './openai-compatible.js';

function truthy(value){return ['1','true','yes','on'].includes(String(value||'').trim().toLowerCase());}
function text(env,name,fallback=''){const value=String(env?.[name]??fallback).trim();return value;}

export function createEnvModelProviders({env=process.env,fetchImpl=globalThis.fetch}={}){
  const providers=[];
  const explicitOrigin=text(env,'VITRINY_NEURAL_MODEL_ORIGIN');
  const jarvisEnabled=truthy(env?.JARVIS_LOCAL_MODEL);
  const primaryOrigin=explicitOrigin || (jarvisEnabled ? text(env,'JARVIS_MODEL_ORIGIN','http://jarvis-model:8080') : '');
  if(primaryOrigin){
    providers.push(createOpenAICompatibleProvider({
      id:text(env,'VITRINY_NEURAL_MODEL_ID','vitriny-local'),
      baseUrl:primaryOrigin,
      apiKey:text(env,'VITRINY_NEURAL_MODEL_API_KEY'),
      model:text(env,'VITRINY_NEURAL_MODEL_NAME',jarvisEnabled?'jarvis-local':'local'),
      priority:Number(text(env,'VITRINY_NEURAL_MODEL_PRIORITY','20'))||20,
      costClass:text(env,'VITRINY_NEURAL_MODEL_COST_CLASS','local'),
      local:truthy(env?.VITRINY_NEURAL_MODEL_REMOTE)?false:true,
      temperature:Number(text(env,'VITRINY_NEURAL_MODEL_TEMPERATURE','0.2'))||0.2,
      maxTokens:Number(text(env,'VITRINY_NEURAL_MODEL_MAX_TOKENS','1200'))||1200,
      fetchImpl
    }));
  }

  const fallbackOrigin=text(env,'VITRINY_NEURAL_FALLBACK_ORIGIN');
  if(fallbackOrigin){
    providers.push(createOpenAICompatibleProvider({
      id:text(env,'VITRINY_NEURAL_FALLBACK_ID','vitriny-fallback'),
      baseUrl:fallbackOrigin,
      apiKey:text(env,'VITRINY_NEURAL_FALLBACK_API_KEY'),
      model:text(env,'VITRINY_NEURAL_FALLBACK_MODEL','fallback'),
      priority:Number(text(env,'VITRINY_NEURAL_FALLBACK_PRIORITY','80'))||80,
      costClass:text(env,'VITRINY_NEURAL_FALLBACK_COST_CLASS','remote'),
      local:false,
      temperature:Number(text(env,'VITRINY_NEURAL_FALLBACK_TEMPERATURE','0.2'))||0.2,
      maxTokens:Number(text(env,'VITRINY_NEURAL_FALLBACK_MAX_TOKENS','1200'))||1200,
      fetchImpl
    }));
  }
  return providers;
}
