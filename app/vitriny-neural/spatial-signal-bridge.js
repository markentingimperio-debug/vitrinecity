import {SPATIAL_PRESENCE_DISTRICTS} from '../spatial-presence.js';

function safeSnapshot(source){try{return source?.snapshot?.()||null;}catch{return null;}}

export function createSpatialNeuralBridge({capture,telemetry,presence,now=Date.now,intervalMs=300_000}={}){
  if(typeof capture!=='function')throw new TypeError('Spatial Neural bridge requer capture.');
  const interval=Math.max(60_000,Math.min(3_600_000,Number(intervalMs)||300_000));
  let timer=null,running=false;

  const pulse=()=>{
    const time=Number(now()),bucket=Math.floor(time/interval),presenceState=safeSnapshot(presence),telemetryState=safeSnapshot(telemetry);
    if(!presenceState&&!telemetryState)return{accepted:0,attempted:0};
    const events=[];
    for(const district of SPATIAL_PRESENCE_DISTRICTS){
      const activeCount=Math.max(0,Number(presenceState?.districts?.[district]||0));
      const eventCount=Math.max(0,Number(telemetryState?.byDistrict?.[district]||0));
      if(!activeCount&&!eventCount)continue;
      events.push({
        type:'spatial.aggregate',source:'spatial',entityType:'district',entityId:district,
        payload:{activeCount,eventCount,windowMinutes:Number(telemetryState?.windowMinutes||0),channel:'multiverse'},
        dedupeKey:`spatial:${bucket}:${district}`,priority:1,occurredAt:new Date(time).toISOString()
      });
    }
    const renderSamples=Math.max(0,Number(telemetryState?.byEvent?.render_sample||0));
    if(renderSamples){
      events.push({
        type:'spatial.aggregate',source:'spatial',entityType:'runtime',entityId:'multiverse-render',
        payload:{
          renderSamples,
          fpsPoor:Number(telemetryState?.byFps?.poor||0),
          fpsConstrained:Number(telemetryState?.byFps?.constrained||0),
          fpsGood:Number(telemetryState?.byFps?.good||0),
          fpsExcellent:Number(telemetryState?.byFps?.excellent||0),
          windowMinutes:Number(telemetryState?.windowMinutes||0),channel:'spatial-render'
        },
        dedupeKey:`spatial:${bucket}:render`,priority:1,occurredAt:new Date(time).toISOString()
      });
    }
    let accepted=0;
    for(const event of events){try{const result=capture(event);if(result?.accepted!==false)accepted++;}catch{}}
    return{accepted,attempted:events.length};
  };
  const start=()=>{
    if(running)return false;running=true;timer=setInterval(pulse,interval);timer.unref?.();return true;
  };
  const stop=()=>{if(!running)return false;running=false;if(timer)clearInterval(timer);timer=null;return true;};
  return Object.freeze({pulse,start,stop,status:()=>({running,intervalMs:interval})});
}
