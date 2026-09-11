import {SPATIAL_PRESENCE_DISTRICTS} from '../spatial-presence.js';
import {SPATIAL_CITIES} from '../vitriny-spatial/city-registry.js';

const PROCESSOR='spatial_observation_v1';
const ENTITIES={district:new Set(SPATIAL_PRESENCE_DISTRICTS),city:new Set(SPATIAL_CITIES.map(c=>c.id)),runtime:new Set(['multiverse-render'])};
const CHANNELS={district:'multiverse',city:'multiverse-city',runtime:'spatial-render'};
const FPS=['Poor','Constrained','Good','Excellent'];
const SCOPE="type='spatial.aggregate' AND source='spatial'";
const integer=value=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;

function project(row){
  if(!Object.hasOwn(ENTITIES,row.entity_type)||!ENTITIES[row.entity_type].has(row.entity_id))return{error:'invalid_entity'};
  const occurred=Date.parse(row.occurred_at);
  if(typeof row.occurred_at!=='string'||!Number.isFinite(occurred)||new Date(occurred).toISOString()!==row.occurred_at)return{error:'invalid_occurred_at'};
  let payload;
  try{payload=JSON.parse(row.payload_json);}catch{return{error:'invalid_payload'};}
  if(!payload||typeof payload!=='object'||Array.isArray(payload))return{error:'invalid_payload'};
  if(payload.channel!==CHANNELS[row.entity_type])return{error:'invalid_channel'};
  const fields=row.entity_type==='runtime'?['renderSamples',...FPS.map(c=>'fps'+c)]:['activeCount','eventCount'];
  if(!['windowMinutes',...fields].every(key=>integer(payload[key])))return{error:'invalid_numeric_fields'};
  const signals=[],observedAt=new Date(occurred).toISOString();
  const add=(metric,value,semantics,universe)=>signals.push({metric,value,metadata:{
    processor:PROCESSOR,semantics,nominalWindowMinutes:payload.windowMinutes,
    aggregate:true,notAdditive:true,automaticLearning:false,
    provenance:'reported_telemetry',confidenceMeaning:'projection_fidelity_not_verified_traffic',...(universe?{universe}:{})
  }});
  if(row.entity_type==='runtime'){
    add('spatial.render.samples',payload.renderSamples,'rolling_bucket_snapshot','render_sample_events');
    // byFps includes every telemetry event, not only render_sample. Even equal
    // totals do not prove a shared population, so no FPS ratios are produced.
    for(const category of FPS)add('spatial.fps.'+category.toLowerCase()+'.events',payload['fps'+category],'rolling_bucket_snapshot','all_telemetry_events');
  }else{
    add('spatial.presence.current',payload.activeCount,'point_in_time');
    add('spatial.events.rolling_window',payload.eventCount,'rolling_bucket_snapshot');
  }
  return{signals,observedAt,dimension:row.entity_type+':'+row.entity_id};
}

export function createSpatialEventProcessor({db,enabled=false,canRun=()=>true,now=Date.now,intervalMs=60_000,limit=25,logger=console}={}){
  if(!db?.prepare||!db?.transaction)throw new TypeError('spatial_processor_sqlite_required');
  if(!integer(intervalMs)||intervalMs<1||intervalMs>2_147_483_647||!integer(limit)||limit<1||limit>200||typeof now!=='function'||typeof canRun!=='function')throw new TypeError('spatial_processor_options_invalid');
  const active=enabled===true;
  let timer=null,busy=false,lastError=null;
  const permitted=()=>{try{return canRun()===true;}catch{return false;}};
  const status=()=>{
    const counts=db.prepare(`SELECT COUNT(CASE WHEN status='processed' THEN 1 END) processed,
      COUNT(CASE WHEN status='pending' THEN 1 END) pending,
      COUNT(CASE WHEN status='failed' AND error_message='spatial_observation_needs_review' THEN 1 END) review
      FROM neural_events WHERE ${SCOPE}`).get();
    return{enabled:active,running:timer!==null,paused:active&&!permitted(),...counts,intervalMs,limit,lastError,
      semantics:'aggregate_observation_only',automaticLearning:false};
  };
  const tick=()=>{
    const empty={processed:0,review:0,signals:0};
    if(!active||busy||db.inTransaction||!permitted())return{...empty,skipped:true};
    busy=true;
    try{
      const time=now();
      if(!integer(time)||!Number.isFinite(new Date(time).getTime()))throw new Error('invalid_clock');
      const at=new Date(time).toISOString();
      const result=db.transaction(()=>{
        if(!permitted())return{...empty,skipped:true};
        // Selection and all inserts/receipts share this write lock. Never claim
        // or recover processing leases, and never call the generic retry worker.
        const rows=db.prepare(`SELECT id,entity_type,entity_id,payload_json,occurred_at FROM neural_events
          WHERE status='pending' AND ${SCOPE} ORDER BY priority DESC,received_at,id LIMIT ?`).all(limit);
        const insert=db.prepare(`INSERT INTO neural_signals(metric,dimension,value,confidence,window_start,window_end,metadata_json,created_at,node_id)
          VALUES(?,?,?,1,?,?,?,?,?)`);
        const ack=db.prepare(`UPDATE neural_events SET status=?,outcome_json=?,error_message=?,processed_at=?,attempt_count=attempt_count+1
          WHERE id=? AND status='pending' AND ${SCOPE}`);
        const totals={...empty};
        for(const row of rows){
          const projection=project(row),receipt={processor:PROCESSOR,status:projection.error?'needs_review':'observed',automaticLearning:false,signalIds:[]};
          if(projection.error){receipt.error=projection.error;totals.review++;}
          else{
            for(const signal of projection.signals){
              const inserted=insert.run(signal.metric,projection.dimension,signal.value,
                projection.observedAt,projection.observedAt,JSON.stringify(signal.metadata),at,PROCESSOR);
              receipt.signalIds.push(Number(inserted.lastInsertRowid));
            }
            receipt.observationCount=projection.signals.length;receipt.observedAt=projection.observedAt;
            totals.processed++;totals.signals+=projection.signals.length;
          }
          const changed=ack.run(projection.error?'failed':'processed',JSON.stringify(receipt),
            projection.error?'spatial_observation_needs_review':'',at,row.id).changes;
          if(changed!==1)throw new Error('spatial_observation_ack_failed');
        }
        return totals;
      }).immediate();
      lastError=null;
      return result;
    }catch{
      lastError='spatial_observation_transaction_failed';
      try{logger?.warn?.(lastError);}catch{}
      return{...empty,error:lastError};
    }finally{busy=false;}
  };
  const start=()=>{if(!active||timer!==null)return false;timer=setInterval(tick,intervalMs);timer.unref?.();return true;};
  const stop=()=>{if(timer===null)return false;clearInterval(timer);timer=null;return true;};
  return Object.freeze({tick,start,stop,status});
}
