const PHASES=Object.freeze({
  dawn:Object.freeze({id:'dawn',ambient:.78,sun:.82,emissive:.72,fog:1.08,label:'amanhecer'}),
  day:Object.freeze({id:'day',ambient:1,sun:1,emissive:.42,fog:1,label:'dia'}),
  dusk:Object.freeze({id:'dusk',ambient:.66,sun:.58,emissive:.82,fog:1.12,label:'entardecer'}),
  night:Object.freeze({id:'night',ambient:.38,sun:.18,emissive:1,fog:1.18,label:'noite'})
});
const PROFILE_POLICY=Object.freeze({
  LITE:Object.freeze({initialLevel:1,degradeBelow:34,recoverAbove:48,maxLevel:2}),
  STANDARD:Object.freeze({initialLevel:0,degradeBelow:42,recoverAbove:54,maxLevel:2}),
  ULTRA:Object.freeze({initialLevel:0,degradeBelow:48,recoverAbove:57,maxLevel:2})
});
const LOD_FACTORS=Object.freeze([
  Object.freeze({skyline:1,vegetation:1,lights:1,furniture:1,districtFurniture:1,premium:1}),
  Object.freeze({skyline:.82,vegetation:.68,lights:.72,furniture:.55,districtFurniture:.7,premium:.7}),
  Object.freeze({skyline:.58,vegetation:.42,lights:.48,furniture:0,districtFurniture:.35,premium:.35})
]);

function finite(value,fallback=0){const n=Number(value);return Number.isFinite(n)?n:fallback;}
function profileId(value){const id=String(value||'STANDARD').trim().toUpperCase();return PROFILE_POLICY[id]?id:'STANDARD';}

export function resolveSpatialDayPhase(hour=new Date().getHours()){
  const h=((Math.floor(finite(hour,12))%24)+24)%24;
  if(h>=5&&h<8)return PHASES.dawn;
  if(h>=8&&h<17)return PHASES.day;
  if(h>=17&&h<20)return PHASES.dusk;
  return PHASES.night;
}

export function spatialLodFactors(level=0){return LOD_FACTORS[Math.max(0,Math.min(LOD_FACTORS.length-1,Math.trunc(finite(level,0))))];}

export function createSpatialLodController({profile='STANDARD',stableSamples=3}={}){
  const id=profileId(profile),policy=PROFILE_POLICY[id],stable=Math.max(2,Math.min(8,Math.trunc(finite(stableSamples,3))));
  let level=policy.initialLevel,low=0,high=0;
  return Object.freeze({
    profileId:id,
    policy,
    get level(){return level;},
    get factors(){return spatialLodFactors(level);},
    sample(fps){
      const value=Math.max(0,Math.min(240,finite(fps,0))),before=level;
      if(value<policy.degradeBelow){low++;high=0;}else if(value>policy.recoverAbove){high++;low=0;}else{low=0;high=0;}
      if(low>=stable&&level<policy.maxLevel){level++;low=0;high=0;}
      else if(high>=stable&&level>0){level--;low=0;high=0;}
      return Object.freeze({changed:before!==level,level,factors:spatialLodFactors(level),fps:value});
    }
  });
}

export function premiumSpatialSlotState(raw={}){
  const slotId=String(raw.slotId||'').trim().slice(0,80),districtId=String(raw.districtId||'').trim().slice(0,40);
  if(!slotId||!districtId)return null;
  const status=raw.status==='reserved'?'reserved':raw.status==='active'?'active':'available';
  return Object.freeze({slotId,districtId,status,sponsor:status==='active'?String(raw.sponsor||'').trim().slice(0,80):''});
}
