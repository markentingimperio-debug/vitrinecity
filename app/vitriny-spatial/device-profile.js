function number(value,fallback){
  if(value==null||value==='')return fallback;
  const n=Number(value);return Number.isFinite(n)?n:fallback;
}

export const RENDER_PROFILES=Object.freeze({
  lite:Object.freeze({id:'lite',pixelRatio:1,chunkRadius:1,shadowMap:0,particles:0,maxBuildings:220,lodBias:1.8,targetFps:30}),
  standard:Object.freeze({id:'standard',pixelRatio:1.25,chunkRadius:1,shadowMap:1024,particles:120,maxBuildings:650,lodBias:1,targetFps:45}),
  ultra:Object.freeze({id:'ultra',pixelRatio:1.75,chunkRadius:2,shadowMap:2048,particles:400,maxBuildings:1600,lodBias:.65,targetFps:60})
});

export function assessDevice(input={}){
  const memory=Math.max(0,number(input.deviceMemory,0)),cores=Math.max(1,number(input.hardwareConcurrency,2));
  const pixelRatio=Math.max(1,Math.min(4,number(input.pixelRatio,1)));
  const width=Math.max(320,number(input.width,1280)),height=Math.max(320,number(input.height,720));
  const mobile=Boolean(input.mobile??(Math.min(width,height)<700));
  const webgpu=Boolean(input.webgpu);
  let score=0;
  score+=memory>=8?3:memory>=4?2:memory>=2?1:0;
  score+=cores>=8?3:cores>=4?2:1;
  score+=webgpu?2:0;
  score+=mobile?-1:1;
  score+=pixelRatio>2?-1:0;
  const recommended=score>=7?'ultra':score>=4?'standard':'lite';
  return {memory,cores,pixelRatio,width,height,mobile,webgpu,score,recommended,profile:RENDER_PROFILES[recommended]};
}

export function adaptProfile(currentId,{fps,targetFps=null}={}){
  const order=['lite','standard','ultra'];
  const rawIndex=order.indexOf(currentId),index=rawIndex<0?0:rawIndex;
  const current=RENDER_PROFILES[order[index]],measured=number(fps,current.targetFps),target=number(targetFps,current.targetFps);
  if(measured<target*.72&&index>0)return RENDER_PROFILES[order[index-1]];
  if(measured>target*1.18&&index<order.length-1)return RENDER_PROFILES[order[index+1]];
  return current;
}
