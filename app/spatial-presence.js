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

export function createSpatialPresenceTracker({now=Date.now,ttlMs=50_000,maxSessions=25_000,maxSubscribers=2_000}={}){
  const sessions=new Map(),subscribers=new Set();
  const ttl=Math.max(15_000,Math.min(180_000,Number(ttlMs)||50_000));
  const capacity=Math.max(100,Math.min(100_000,Number(maxSessions)||25_000));
  const subscriberCapacity=Math.max(10,Math.min(10_000,Number(maxSubscribers)||2_000));
  let version=0,lastSignature='0|'+SPATIAL_PRESENCE_DISTRICTS.map(()=>0).join('|');

  const currentSnapshot=(time=Number(now()))=>{
    const districts=Object.fromEntries(SPATIAL_PRESENCE_DISTRICTS.map(id=>[id,0]));
    for(const entry of sessions.values())districts[entry.district]++;
    return Object.freeze({
      total:sessions.size,
      districts:Object.freeze(districts),
      ttlSeconds:Math.round(ttl/1000),
      version,
      updatedAt:new Date(time).toISOString()
    });
  };
  const signature=state=>`${state.total}|${SPATIAL_PRESENCE_DISTRICTS.map(id=>state.districts[id]).join('|')}`;
  const emitIfChanged=time=>{
    const base=currentSnapshot(time),nextSignature=signature(base);
    if(nextSignature===lastSignature)return base;
    version++;
    const state=Object.freeze({...base,version});
    lastSignature=nextSignature;
    for(const listener of [...subscribers]){try{listener(state);}catch{}}
    return state;
  };
  const sweep=()=>{
    const time=Number(now());let changed=false;
    for(const [id,entry] of sessions)if(entry.expiresAt<=time){sessions.delete(id);changed=true;}
    return changed?emitIfChanged(time):currentSnapshot(time);
  };
  const heartbeat=(sessionId,districtValue)=>{
    const district=normalizeSpatialPresenceDistrict(districtValue),id=String(sessionId||'').trim();
    if(!district)throw new TypeError('invalid_district');
    if(!SESSION_RE.test(id))throw new TypeError('invalid_session');
    const before=sessions.get(id),time=Number(now());
    for(const [sid,entry] of sessions)if(entry.expiresAt<=time)sessions.delete(sid);
    if(!sessions.has(id)&&sessions.size>=capacity)throw new Error('presence_capacity');
    sessions.set(id,{district,expiresAt:time+ttl});
    const state=(!before||before.district!==district)?emitIfChanged(time):currentSnapshot(time);
    return Object.freeze({...state,district,count:state.districts[district]});
  };
  const leave=sessionId=>{
    const id=String(sessionId||'').trim(),time=Number(now());
    const removed=SESSION_RE.test(id)?sessions.delete(id):false;
    return removed?emitIfChanged(time):sweep();
  };
  const subscribe=(listener,{emitInitial=true}={})=>{
    if(typeof listener!=='function')throw new TypeError('presence_listener_required');
    if(subscribers.size>=subscriberCapacity)throw new Error('presence_subscriber_capacity');
    subscribers.add(listener);
    if(emitInitial)listener(sweep());
    return ()=>subscribers.delete(listener);
  };
  return Object.freeze({
    heartbeat,leave,snapshot:sweep,sweep,subscribe,
    size:()=>{sweep();return sessions.size;},
    subscriberCount:()=>subscribers.size
  });
}

export function setupSpatialPresence(app,{now=Date.now,ttlMs=50_000,maxSessions=25_000,maxSubscribers=2_000}={}){
  const tracker=createSpatialPresenceTracker({now,ttlMs,maxSessions,maxSubscribers});
  const rateWindows=new Map(),salt=randomBytes(16).toString('hex');
  const json=express.json({limit:'2kb',strict:true});
  const rateKey=req=>createHash('sha256').update(`${salt}|${String(req.ip||'')}`).digest('hex').slice(0,24);
  const allowed=(req,max=120)=>{
    const time=Number(now()),key=rateKey(req),duration=60_000,current=rateWindows.get(key);
    if(!current||current.expiresAt<=time){rateWindows.set(key,{count:1,expiresAt:time+duration});return true;}
    current.count++;
    if(rateWindows.size>20_000)for(const [id,entry] of rateWindows)if(entry.expiresAt<=time)rateWindows.delete(id);
    return current.count<=max;
  };
  const noStore=res=>res.set('Cache-Control','no-store, max-age=0');
  const sweeper=setInterval(()=>tracker.sweep(),10_000);sweeper.unref?.();

  app.get('/api/spatial/presence',(_req,res)=>noStore(res).json(tracker.snapshot()));
  app.get('/api/spatial/presence/stream',(req,res)=>{
    if(!allowed(req,30))return noStore(res).status(429).json({error:'presence_rate_limited'});
    res.setHeader('Content-Type','text/event-stream');
    res.setHeader('Cache-Control','no-store, no-transform');
    res.setHeader('Connection','keep-alive');
    res.setHeader('X-Accel-Buffering','no');
    res.flushHeaders?.();
    let closed=false,unsubscribe=()=>{};
    const send=state=>{if(closed)return;try{res.write(`event: presence\ndata: ${JSON.stringify(state)}\n\n`);}catch{}};
    try{unsubscribe=tracker.subscribe(send);}catch(error){return res.end(`event: error\ndata: ${JSON.stringify({error:error?.message||'presence_stream_unavailable'})}\n\n`);}
    const keepalive=setInterval(()=>{if(!closed)res.write(': keepalive\n\n');},15_000);keepalive.unref?.();
    const close=()=>{if(closed)return;closed=true;clearInterval(keepalive);unsubscribe();};
    req.on('close',close);res.on('close',close);
  });
  app.post('/api/spatial/presence/heartbeat',json,(req,res)=>{
    if(!allowed(req))return noStore(res).status(429).json({error:'presence_rate_limited'});
    try{return noStore(res).json(tracker.heartbeat(req.body?.sessionId,req.body?.district));}
    catch(error){
      if(error?.message==='presence_capacity')return noStore(res).status(503).json({error:'presence_capacity'});
      return noStore(res).status(400).json({error:error?.message||'presence_invalid'});
    }
  });
  app.post('/api/spatial/presence/leave',json,(req,res)=>noStore(res).json(tracker.leave(req.body?.sessionId)));
  return tracker;
}
