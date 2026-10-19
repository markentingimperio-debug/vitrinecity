import {createOpenAICompatibleProvider} from './openai-compatible.js';
import {parseCapabilityList,specialistDefaultCapabilities,teacherDefaultCapabilities} from './capability-routing.js';

function truthy(value){return ['1','true','yes','on'].includes(String(value||'').trim().toLowerCase());}
function text(env,name,fallback=''){const value=String(env?.[name]??fallback).trim();return value;}

function configuredProvider({env,fetchImpl,prefix,defaults}){
  const origin=text(env,`${prefix}_ORIGIN`);
  if(!origin)return null;
  return createOpenAICompatibleProvider({
    id:text(env,`${prefix}_ID`,defaults.id),
    baseUrl:origin,
    apiKey:text(env,`${prefix}_API_KEY`),
    model:text(env,`${prefix}_MODEL`,defaults.model),
    capabilities:parseCapabilityList(env?.[`${prefix}_CAPABILITIES`],defaults.capabilities),
    priority:Number(text(env,`${prefix}_PRIORITY`,String(defaults.priority)))||defaults.priority,
    costClass:text(env,`${prefix}_COST_CLASS`,defaults.costClass),
    local:truthy(env?.[`${prefix}_REMOTE`])?false:defaults.local,
    temperature:Number(text(env,`${prefix}_TEMPERATURE`,'0.2'))||0.2,
    maxTokens:Number(text(env,`${prefix}_MAX_TOKENS`,String(defaults.maxTokens)))||defaults.maxTokens,
    fetchImpl
  });
}

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
      capabilities:parseCapabilityList(env?.VITRINY_NEURAL_MODEL_CAPABILITIES,teacherDefaultCapabilities),
      priority:Number(text(env,'VITRINY_NEURAL_MODEL_PRIORITY','20'))||20,
      costClass:text(env,'VITRINY_NEURAL_MODEL_COST_CLASS','local'),
      local:truthy(env?.VITRINY_NEURAL_MODEL_REMOTE)?false:true,
      temperature:Number(text(env,'VITRINY_NEURAL_MODEL_TEMPERATURE','0.2'))||0.2,
      maxTokens:Number(text(env,'VITRINY_NEURAL_MODEL_MAX_TOKENS','1200'))||1200,
      fetchImpl
    }));
  }

  const specialist=configuredProvider({env,fetchImpl,prefix:'VITRINY_NEURAL_SPECIALIST',defaults:{
    id:'vitriny-specialist',model:'specialist',capabilities:specialistDefaultCapabilities,
    priority:40,costClass:'specialist',local:false,maxTokens:2400
  }});
  if(specialist)providers.push(specialist);

  const teacher=configuredProvider({env,fetchImpl,prefix:'VITRINY_NEURAL_TEACHER',defaults:{
    id:'vitriny-teacher',model:'teacher',capabilities:teacherDefaultCapabilities,
    priority:60,costClass:'premium',local:false,maxTokens:4000
  }});
  if(teacher)providers.push(teacher);

  const fallbackOrigin=text(env,'VITRINY_NEURAL_FALLBACK_ORIGIN');
  if(fallbackOrigin){
    providers.push(createOpenAICompatibleProvider({
      id:text(env,'VITRINY_NEURAL_FALLBACK_ID','vitriny-fallback'),
      baseUrl:fallbackOrigin,
      apiKey:text(env,'VITRINY_NEURAL_FALLBACK_API_KEY'),
      model:text(env,'VITRINY_NEURAL_FALLBACK_MODEL','fallback'),
      capabilities:parseCapabilityList(env?.VITRINY_NEURAL_FALLBACK_CAPABILITIES,teacherDefaultCapabilities),
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
