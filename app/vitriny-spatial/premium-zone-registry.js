const CITY_IDS=new Set(['vitrine-city','silvania','anapolis','vianopolis','goiania']);
const DISTRICT_IDS=new Set(['commerce','social','creator','food','education','entertainment','business','services']);
const SLOT_RE=/^premium:(vitrine-city|silvania|anapolis|vianopolis|goiania):(\d{1,2})$/;
const REF_RE=/^[a-zA-Z0-9:_-]{1,80}$/;

function clean(value,max=80){return String(value??'').trim().slice(0,max);}
function instant(value){if(value==null||value==='')return null;const n=Date.parse(String(value));return Number.isFinite(n)?n:null;}
function safeCity(value){const id=clean(value,40).toLowerCase();return CITY_IDS.has(id)?id:null;}
function safeDistrict(value){const id=clean(value,40).toLowerCase();return DISTRICT_IDS.has(id)?id:null;}

export function sanitizePremiumZoneAssignment(raw,{now=Date.now()}={}){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const slotId=clean(raw.slotId),match=SLOT_RE.exec(slotId),cityId=match?.[1]||null,districtId=safeDistrict(raw.districtId);
  if(!cityId||!districtId)return null;
  const requestedStatus=['available','reserved','active'].includes(raw.status)?raw.status:'available';
  const sponsor=clean(raw.sponsor),campaignRef=clean(raw.campaignRef);
  const startsAt=instant(raw.startsAt),endsAt=instant(raw.endsAt),approved=raw.approved===true;
  const validWindow=(startsAt==null||now>=startsAt)&&(endsAt==null||now<endsAt)&&(startsAt==null||endsAt==null||startsAt<endsAt);
  const activeAllowed=requestedStatus==='active'&&approved&&Boolean(sponsor)&&validWindow&&(!campaignRef||REF_RE.test(campaignRef));
  const status=activeAllowed?'active':requestedStatus==='available'?'available':'reserved';
  return Object.freeze({
    slotId,cityId,districtId,status,approved,
    sponsor:status==='active'?sponsor:'',campaignRef:status==='active'&&REF_RE.test(campaignRef)?campaignRef:'',
    startsAt:startsAt==null?'':new Date(startsAt).toISOString(),endsAt:endsAt==null?'':new Date(endsAt).toISOString()
  });
}

export function loadPremiumZoneAssignments({env=globalThis.process?.env||{},now=Date.now()}={}){
  const raw=String(env.VITRINY_SPATIAL_PREMIUM_ZONES_JSON||'').trim();
  if(!raw||raw.length>32768)return Object.freeze([]);
  try{
    const parsed=JSON.parse(raw);if(!Array.isArray(parsed))return Object.freeze([]);
    const bySlot=new Map();
    for(const item of parsed.slice(0,64)){
      const safe=sanitizePremiumZoneAssignment(item,{now});if(safe)bySlot.set(safe.slotId,safe);
    }
    return Object.freeze([...bySlot.values()]);
  }catch{return Object.freeze([]);}
}

export function resolvePremiumZoneSlots(cityId,slots,{assignments=[],now=Date.now()}={}){
  const id=safeCity(cityId);if(!id)throw new Error('city_not_found');
  const allowed=new Map();
  for(const item of Array.isArray(assignments)?assignments:[]){
    const safe=sanitizePremiumZoneAssignment(item,{now});if(safe?.cityId===id)allowed.set(safe.slotId,safe);
  }
  return Object.freeze((Array.isArray(slots)?slots:[]).slice(0,32).map(raw=>{
    const slotId=clean(raw?.slotId),districtId=safeDistrict(raw?.districtId),match=SLOT_RE.exec(slotId);
    if(!districtId||match?.[1]!==id)return null;
    const assignment=allowed.get(slotId);
    return Object.freeze({...raw,slotId,districtId,status:assignment?.status||'available',sponsor:assignment?.sponsor||'',campaignRef:assignment?.campaignRef||''});
  }).filter(Boolean));
}

export function publicPremiumZoneAssignments(cityId,{assignments=loadPremiumZoneAssignments(),now=Date.now()}={}){
  const id=safeCity(cityId);if(!id)throw new Error('city_not_found');
  return Object.freeze((Array.isArray(assignments)?assignments:[]).map(item=>sanitizePremiumZoneAssignment(item,{now})).filter(item=>item?.cityId===id).map(({slotId,districtId,status,sponsor,campaignRef,startsAt,endsAt})=>Object.freeze({slotId,districtId,status,sponsor,campaignRef,startsAt,endsAt})));
}
