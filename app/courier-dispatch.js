const EARTH_METERS=6371000;
const radians=value=>Number(value)*Math.PI/180;

export function haversineMeters(a,b){
  const lat1=radians(a.latitude),lat2=radians(b.latitude),dLat=lat2-lat1,dLng=radians(b.longitude)-radians(a.longitude);
  const value=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;
  return Math.round(2*EARTH_METERS*Math.asin(Math.sqrt(value)));
}

export function eligibleCouriers(couriers,store,{now=Date.now(),freshMs=5*60*1000,excludedIds=[]}={}){
  const excluded=new Set(excludedIds.map(Number));
  return couriers.filter(item=>item.status==='active'&&Boolean(item.available)&&!excluded.has(Number(item.id))&&
    Number.isFinite(Number(item.latitude))&&Number.isFinite(Number(item.longitude))&&now-Date.parse(item.locationAt)<=freshMs&&
    String(item.city||'').trim().toLowerCase()===String(store.city||'').trim().toLowerCase()&&String(item.state||'').toUpperCase()===String(store.state||'').toUpperCase())
    .map(item=>({...item,distanceMeters:haversineMeters(item,store)})).sort((a,b)=>a.distanceMeters-b.distanceMeters||Number(a.id)-Number(b.id));
}

export function offerExpired(expiresAt,now=Date.now()){return !Number.isFinite(Date.parse(expiresAt))||Date.parse(expiresAt)<=now;}
