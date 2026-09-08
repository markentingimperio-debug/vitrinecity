import express from 'express';
import {createHash,randomBytes} from 'node:crypto';
import {SPATIAL_PRESENCE_DISTRICTS,normalizeSpatialPresenceDistrict} from './spatial-presence.js';
import {SPATIAL_CITIES,spatialCity} from './vitriny-spatial/city-registry.js';

export const SPATIAL_TELEMETRY_EVENTS=Object.freeze(['district_enter','district_exit','entity_open','portal_enter','render_sample']);
const EVENT_SET=new Set(SPATIAL_TELEMETRY_EVENTS);
const PROFILE_SET=new Set(['LITE','STANDARD','ULTRA','UNKNOWN']);
const FPS_SET=new Set(['poor','constrained','good','excellent','unknown']);
const TARGET_SET=new Set(['none','store','product','profile','course','service','campaign','content','restaurant','district','portal','business']);
const CITY_IDS=Object.freeze(SPATIAL_CITIES.map(city=>city.id));

const cleanEnum=(value,set,fallback)=>{const v=String(value||'').trim();return set.has(v)?v:fallback;};
export function normalizeSpatialTelemetryEvent(raw={}){
  const event=cleanEnum(raw.event,EVENT_SET,null),district=normalizeSpatialPresenceDistrict(raw.district);
  const cityId=spatialCity(String(raw.cityId||'vitrine-city').trim().toLowerCase())?.id||null;
  if(!event||!district||!cityId)return null;
  return Object.freeze({
    event,district,cityId,
    profile:cleanEnum(String(raw.profile||'UNKNOWN').toUpperCase(),PROFILE_SET,'UNKNOWN'),
    fpsBucket:cleanEnum(String(raw.fpsBucket||'unknown').toLowerCase(),FPS_SET,'unknown'),
    targetType:cleanEnum(String(raw.targetType||'none').toLowerCase(),TARGET_SET,'none')
  });
}

export function createSpatialTelemetryTracker({now=Date.now,bucketMs=300_000,retentionBuckets=12}={}){
  const buckets=new Map();
  const size=Math.max(60_000,Math.min(3_600_000,Number(bucketMs)||300_000));
  const keep=Math.max(2,Math.min(288,Number(retentionBuckets)||12));
  const bucketStart=time=>Math.floor(time/size)*size;
  const newCounters=()=>({
    total:0,
    byEvent:Object.fromEntries(SPATIAL_TELEMETRY_EVENTS.map(v=>[v,0])),
    byDistrict:Object.fromEntries(SPATIAL_PRESENCE_DISTRICTS.map(v=>[v,0])),
    byCity:Object.fromEntries(CITY_IDS.map(v=>[v,0])),
    byProfile:{LITE:0,STANDARD:0,ULTRA:0,UNKNOWN:0},
    byFps:{poor:0,constrained:0,good:0,excellent:0,unknown:0},
    byTarget:{none:0,store:0,product:0,profile:0,course:0,service:0,campaign:0,content:0,restaurant:0,district:0,portal:0,business:0}
  });
  const prune=time=>{const min=bucketStart(time)-size*(keep-1);for(const key of buckets.keys())if(key<min)buckets.delete(key);};
  const record=input=>{
    const normalized=normalizeSpatialTelemetryEvent(input);if(!normalized)throw new TypeError('telemetry_invalid');
    const time=Number(now()),start=bucketStart(time);prune(time);
    let bucket=buckets.get(start);if(!bucket){bucket=newCounters();buckets.set(start,bucket);}
    bucket.total++;bucket.byEvent[normalized.event]++;bucket.byDistrict[normalized.district]++;bucket.byCity[normalized.cityId]++;bucket.byProfile[normalized.profile]++;bucket.byFps[normalized.fpsBucket]++;bucket.byTarget[normalized.targetType]++;
    return Object.freeze({...normalized,accepted:true,bucketStart:new Date(start).toISOString()});
  };
  const snapshot=()=>{
    const time=Number(now());prune(time);const aggregate=newCounters();
    for(const bucket of buckets.values()){
      aggregate.total+=bucket.total;
      for(const key of Object.keys(aggregate.byEvent))aggregate.byEvent[key]+=bucket.byEvent[key]||0;
      for(const key of Object.keys(aggregate.byDistrict))aggregate.byDistrict[key]+=bucket.byDistrict[key]||0;
      for(const key of Object.keys(aggregate.byCity))aggregate.byCity[key]+=bucket.byCity[key]||0;
      for(const key of Object.keys(aggregate.byProfile))aggregate.byProfile[key]+=bucket.byProfile[key]||0;
      for(const key of Object.keys(aggregate.byFps))aggregate.byFps[key]+=bucket.byFps[key]||0;
      for(const key of Object.keys(aggregate.byTarget))aggregate.byTarget[key]+=bucket.byTarget[key]||0;
    }
    return Object.freeze({...aggregate,bucketSeconds:Math.round(size/1000),windowMinutes:Math.round(size*keep/60_000),updatedAt:new Date(time).toISOString()});
  };
  return Object.freeze({record,snapshot,bucketCount:()=>{prune(Number(now()));return buckets.size;}});
}

export function setupSpatialTelemetry(app,{now=Date.now}={}){
  const tracker=createSpatialTelemetryTracker({now});
  const json=express.json({limit:'2kb',strict:true}),windows=new Map(),salt=randomBytes(16).toString('hex');
  const key=req=>createHash('sha256').update(`${salt}|${String(req.ip||'')}`).digest('hex').slice(0,24);
  const allowed=req=>{
    const time=Number(now()),id=key(req),current=windows.get(id);
    if(!current||current.expiresAt<=time){windows.set(id,{count:1,expiresAt:time+60_000});return true;}
    current.count++;
    if(windows.size>20_000)for(const [k,v] of windows)if(v.expiresAt<=time)windows.delete(k);
    return current.count<=240;
  };
  app.post('/api/spatial/telemetry/event',json,(req,res)=>{
    if(!allowed(req))return res.status(429).set('Cache-Control','no-store').json({error:'telemetry_rate_limited'});
    try{tracker.record(req.body);return res.status(202).set('Cache-Control','no-store').json({ok:true});}
    catch{return res.status(400).set('Cache-Control','no-store').json({error:'telemetry_invalid'});}
  });
  if(app?.locals)app.locals.spatialTelemetry=tracker;
  return tracker;
}
