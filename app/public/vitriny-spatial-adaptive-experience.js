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
const DISTANCE_POLICY=Object.freeze({
  LITE:Object.freeze({nearOut:150,nearIn:120,midOut:300,midIn:250,farOut:520,farIn:450}),
  STANDARD:Object.freeze({nearOut:190,nearIn:155,midOut:390,midIn:330,farOut:700,farIn:610}),
  ULTRA:Object.freeze({nearOut:230,nearIn:190,midOut:480,midIn:410,farOut:850,farIn:740})
});
const DISTANCE_FACTORS=Object.freeze([
  Object.freeze({skyline:1,vegetation:1,lights:1,furniture:1,districtFurniture:1,premium:1}),
  Object.freeze({skyline:1,vegetation:.74,lights:.78,furniture:.5,districtFurniture:.62,premium:.7}),
  Object.freeze({skyline:.78,vegetation:.28,lights:.42,furniture:0,districtFurniture:0,premium:0}),
  Object.freeze({skyline:.5,vegetation:0,lights:0,furniture:0,districtFurniture:0,premium:0})
]);
const LOD_KEYS=Object.freeze(['skyline','vegetation','lights','furniture','districtFurniture','premium']);

function finite(value,fallback=0){const n=Number(value);return Number.isFinite(n)?n:fallback;}
function profileId(value){const id=String(value||'STANDARD').trim().toUpperCase();return PROFILE_POLICY[id]?id:'STANDARD';}
function distanceTierFactors(tier=0){return DISTANCE_FACTORS[Math.max(0,Math.min(DISTANCE_FACTORS.length-1,Math.trunc(finite(tier,0))))];}

export function resolveSpatialDayPhase(hour=new Date().getHours()){
  const h=((Math.floor(finite(hour,12))%24)+24)%24;
  if(h>=5&&h<8)return PHASES.dawn;
  if(h>=8&&h<17)return PHASES.day;
  if(h>=17&&h<20)return PHASES.dusk;
  return PHASES.night;
}

export function spatialLodFactors(level=0){return LOD_FACTORS[Math.max(0,Math.min(LOD_FACTORS.length-1,Math.trunc(finite(level,0))))];}

export function combineSpatialLodFactors(...sources){
  const out={};
  for(const key of LOD_KEYS){
    let value=1;
    for(const source of sources){if(source&&Number.isFinite(Number(source[key])))value=Math.min(value,Math.max(0,Math.min(1,Number(source[key]))));}
    out[key]=value;
  }
  return Object.freeze(out);
}

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

export function createSpatialDistanceLodController({profile='STANDARD',initialDistance=0}={}){
  const id=profileId(profile),policy=DISTANCE_POLICY[id];
  let tier=0;
  function settle(distance){
    const d=Math.max(0,Math.min(100000,finite(distance,0)));
    let next=tier;
    if(tier===0&&d>policy.nearOut)next=1;
    else if(tier===1){if(d<policy.nearIn)next=0;else if(d>policy.midOut)next=2;}
    else if(tier===2){if(d<policy.midIn)next=1;else if(d>policy.farOut)next=3;}
    else if(tier===3&&d<policy.farIn)next=2;
    const changed=next!==tier;tier=next;
    return Object.freeze({changed,tier,distance:d,factors:distanceTierFactors(tier)});
  }
  settle(initialDistance);
  return Object.freeze({
    profileId:id,policy,
    get tier(){return tier;},
    get factors(){return distanceTierFactors(tier);},
    sample(distance){return settle(distance);}
  });
}

export function premiumSpatialSlotState(raw={}){
  const slotId=String(raw.slotId||'').trim().slice(0,80),districtId=String(raw.districtId||'').trim().slice(0,40);
  if(!slotId||!districtId)return null;
  const status=raw.status==='reserved'?'reserved':raw.status==='active'?'active':'available';
  return Object.freeze({slotId,districtId,status,sponsor:status==='active'?String(raw.sponsor||'').trim().slice(0,80):''});
}
