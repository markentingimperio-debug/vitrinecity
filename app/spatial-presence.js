import express from 'express';
import {createHash,randomBytes} from 'node:crypto';

export const SPATIAL_PRESENCE_DISTRICTS=Object.freeze([
  'central','commerce','social','creator','food','education','entertainment','business','services'
]);
const DISTRICT_SET=new Set(SPATIAL_PRESENCE_DISTRICTS);
const SESSION_RE=/^[A-Za-z0-9_-]{16,96}$/;

export function normalizeSpatialPresenceDistrict(value){
  const district=String(value||'').trim().toLowerCase();
  return DISTRICT_SET.has(district)?district:null;
}

export function createSpatialPresenceTracker({now=Date.now,ttlMs=50_000,maxSessions=25_000}={}){
  const sessions=new Map();
  const ttl=Math.max(15_000,Math.min(180_000,Number(ttlMs)||50_000));
  const capacity=Math.max(100,Math.min(100_000,Number(maxSessions)||25_000));
  const cleanup=()=>{
    const time=Number(now());
    for(const [id,entry] of sessions)if(entry.expiresAt<=time)sessions.delete(id);
    return time;
  };
  const snapshot=()=>{
    cleanup();
    const districts=Object.fromEntries(SPATIAL_PRESENCE_DISTRICTS.map(id=>[id,0]));
    for(const entry of sessions.values())districts[entry.district]++;
    return Object.freeze({total:sessions.size,districts:Object.freeze(districts),ttlSeconds:Math.round(ttl/1000)});
  };
  const heartbeat=(sessionId,districtValue)=>{
    const district=normalizeSpatialPresenceDistrict(districtValue),id=String(sessionId||'').trim();
    if(!district)throw new TypeError('invalid_district');
    if(!SESSION_RE.test(id))throw new TypeError('invalid_session');
    const time=cleanup();
    if(!sessions.has(id)&&sessions.size>=capacity)throw new Error('presence_capacity');
    sessions.set(id,{district,expiresAt:time+ttl});
    const state=snapshot();
    return Object.freeze({...state,district,count:state.districts[district],updatedAt:new Date(time).toISOString()});
  };
  const leave=sessionId=>{
    const id=String(sessionId||'').trim();
    if(SESSION_RE.test(id))sessions.delete(id);
    return snapshot();
  };
  return Object.freeze({heartbeat,leave,snapshot,size:()=>{cleanup();return sessions.size;}});
}

export function setupSpatialPresence(app,{now=Date.now,ttlMs=50_000,maxSessions=25_000}={}){
  const tracker=createSpatialPresenceTracker({now,ttlMs,maxSessions});
  const rateWindows=new Map(),salt=randomBytes(16).toString('hex');
  const json=express.json({limit:'2kb',strict:true});
  const rateKey=req=>createHash('sha256').update(`${salt}|${String(req.ip||'')}`).digest('hex').slice(0,24);
  const allowed=req=>{
    const time=Number(now()),key=rateKey(req),duration=60_000,current=rateWindows.get(key);
    if(!current||current.expiresAt<=time){rateWindows.set(key,{count:1,expiresAt:time+duration});return true;}
    current.count++;
    if(rateWindows.size>20_000)for(const [id,entry] of rateWindows)if(entry.expiresAt<=time)rateWindows.delete(id);
    return current.count<=120;
  };
  const noStore=res=>res.set('Cache-Control','no-store, max-age=0');

  app.get('/api/spatial/presence',(_req,res)=>noStore(res).json({...tracker.snapshot(),updatedAt:new Date(Number(now())).toISOString()}));
  app.post('/api/spatial/presence/heartbeat',json,(req,res)=>{
    if(!allowed(req))return noStore(res).status(429).json({error:'presence_rate_limited'});
    try{return noStore(res).json(tracker.heartbeat(req.body?.sessionId,req.body?.district));}
    catch(error){
      if(error?.message==='presence_capacity')return noStore(res).status(503).json({error:'presence_capacity'});
      return noStore(res).status(400).json({error:error?.message||'presence_invalid'});
    }
  });
  app.post('/api/spatial/presence/leave',json,(req,res)=>noStore(res).json({...tracker.leave(req.body?.sessionId),updatedAt:new Date(Number(now())).toISOString()}));
  return tracker;
}
