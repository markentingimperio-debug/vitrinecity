const TYPES=new Set(['image','video','audio']);
const RATIOS=new Set(['1:1','4:5','9:16','16:9']);

function text(value,max,min=0){const v=String(value??'').trim();if(v.length<min||v.length>max)throw new Error('Texto inválido.');return v;}
function number(value,min,max,fallback){const n=Number(value??fallback);if(!Number.isFinite(n)||n<min||n>max)throw new Error('Valor numérico inválido.');return n;}

export function createMediaSkill({neural=null}={}){
  return {
    id:'media.generate',version:'1',risk:'low',
    capabilities:['image.generate','video.generate','audio.generate'],
    async execute({input,invoke,context={}}){
      const type=String(input?.type||'').trim();if(!TYPES.has(type))throw new Error('Tipo de mídia inválido.');
      const prompt=text(input.prompt,8000,3);
      const capability=`${type}.generate`;
      const common={prompt,language:text(input.language||'pt-BR',20,2),metadata:input.metadata&&typeof input.metadata==='object'?input.metadata:{}};
      let request;
      if(type==='image')request={...common,aspectRatio:RATIOS.has(input.aspectRatio)?input.aspectRatio:'1:1',count:Math.floor(number(input.count,1,4,1)),quality:text(input.quality||'standard',30,2)};
      else if(type==='video')request={...common,aspectRatio:RATIOS.has(input.aspectRatio)?input.aspectRatio:'9:16',durationSeconds:number(input.durationSeconds,1,120,8),resolution:text(input.resolution||'720p',20,2),audio:Boolean(input.audio??true)};
      else request={...common,voice:text(input.voice||'default',80,2),format:text(input.format||'mp3',12,2),speed:number(input.speed,0.5,2,1)};

      const started=Date.now();
      const result=await invoke(capability,request,{preferredProviders:Array.isArray(input.preferredProviders)?input.preferredProviders:[],timeoutMs:number(input.timeoutMs,1000,10*60*1000,120000)});
      const output={type,provider:result.provider,asset:result.output,durationMs:Date.now()-started,attempts:result.attempts};

      if(neural&&typeof neural.ingest==='function'){
        try{neural.ingest({type:`skill.${capability}.completed`,source:'vitriny-neural',entityType:'skill',entityId:'media.generate',priority:2,payload:{provider:result.provider,durationMs:output.durationMs,context:context.learningContext||{}}});}catch{}
      }
      return output;
    }
  };
}

export const mediaProviderContract=Object.freeze({
  capabilities:['image.generate','video.generate','audio.generate'],
  requiredMethods:['available','invoke'],
  note:'Providers são adaptadores substituíveis. Nenhuma skill depende de OpenRouter ou de um fornecedor específico.'
});
