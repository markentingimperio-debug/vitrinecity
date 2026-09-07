import {parseSpatialReturnState,SPATIAL_RETURN_KEY} from './vitriny-spatial-session.js';

const CITY_ID=/^[a-z0-9][a-z0-9-]{0,79}$/;
const WORLD_KEY=/^br:go:[a-z0-9][a-z0-9-]{0,79}$/;
const BOOKMARK_PREFIX='vitrinySpatialBookmark:';

/** Only metadata comes from the catalogue. Navigation paths are always derived here. */
export function normalizePortalCity(raw){
  if(!raw||typeof raw!=='object'||typeof raw.id!=='string'||!CITY_ID.test(raw.id))return null;
  if(raw.worldKey!==`br:go:${raw.id}`||!['active','preview'].includes(raw.status))return null;
  if(typeof raw.name!=='string'||!raw.name.trim())return null;
  return Object.freeze({id:raw.id,worldKey:raw.worldKey,name:raw.name.replace(/\s+/g,' ').trim().slice(0,100),status:raw.status,
    route:`/v/br/go/${raw.id}`,href:`/vitriny-multiverse-explore.html?city=${encodeURIComponent(raw.id)}&return=1`});
}

function validBookmark(state,worldKey,options){
  const parsed=parseSpatialReturnState(state,options);
  return parsed&&parsed.worldKey===worldKey?parsed:null;
}
export function saveCityBookmark(storage,state,options){
  const worldKey=state?.worldKey;
  if(!WORLD_KEY.test(String(worldKey||'')))return false;
  try{
    const parsed=validBookmark(state,worldKey,options);if(!parsed)return false;
    storage.setItem(BOOKMARK_PREFIX+worldKey,JSON.stringify(parsed));return true;
  }catch{return false;}
}
export function loadCityBookmark(storage,worldKey,options){
  if(!WORLD_KEY.test(String(worldKey||'')))return null;
  // Keep store -> city return compatible; a different world's state never wins.
  try{const legacy=validBookmark(storage.getItem(SPATIAL_RETURN_KEY),worldKey,options);if(legacy)return legacy;}catch{}
  try{return validBookmark(storage.getItem(BOOKMARK_PREFIX+worldKey),worldKey,options);}catch{return null;}
}

/** Motion, camera and chunk preloading must use one coordinate convention. */
export function spatialCameraBasis(yaw,pitch=0){
  const y=Number.isFinite(yaw)?yaw:Math.PI,p=Number.isFinite(pitch)?pitch:0;
  return {forward:{x:-Math.sin(y),y:0,z:Math.cos(y)},right:{x:-Math.cos(y),y:0,z:-Math.sin(y)},
    look:{x:-Math.sin(y)*Math.cos(p),y:Math.sin(p),z:Math.cos(y)*Math.cos(p)}};
}

/** Reserve room around the actual gateways; decorative buildings must not cover them. */
export function overlapsCityGate(building,gates=[]){
  const x=building?.position?.x,z=building?.position?.z,w=building?.size?.width,d=building?.size?.depth;
  if(![x,z,w,d].every(Number.isFinite)||w<0||d<0||!Array.isArray(gates))return false;
  return gates.slice(0,12).some(gate=>Number.isFinite(gate?.x)&&Number.isFinite(gate?.z)&&
    Math.abs(gate.x-x)<=w/2+11&&Math.abs(gate.z-z)<=d/2+11);
}

/** Keyboard/touch alternative to approaching a 3D gate. No extra API calls or tracking. */
export function createCityTravelMenu({cities=[],currentCityId,source='api',documentRef=globalThis.document,onTravel=()=>false}={}){
  const destinations=new Map(),buttons=[];
  for(const raw of Array.isArray(cities)?cities.slice(0,64):[]){
    const city=normalizePortalCity(raw);
    if(city&&city.id!==currentCityId&&!destinations.has(city.id))destinations.set(city.id,city);
    if(destinations.size>=12)break;
  }
  let disposed=false,locked=false;
  const panel=documentRef?.createElement?.('details'),status=documentRef?.createElement?.('p');
  const explanation=source==='api'?'Prévia não é comércio local ativo.':'Catálogo local: os destinos podem estar desatualizados. Prévia não é comércio local ativo.';
  const setLocked=value=>{locked=value;for(const button of buttons)button.disabled=value;};
  const travel=id=>{
    const destination=destinations.get(id);
    if(disposed||locked||!destination)return false;
    setLocked(true);
    try{
      if(onTravel(destination)===false){setLocked(false);return false;}
      return true;
    }catch{
      setLocked(false);if(status)status.textContent='Não foi possível viajar agora. Tente novamente.';return false;
    }
  };
  if(panel&&status){
    panel.id='vitrinyCityTravel';panel.style.marginTop='6px';
    const summary=documentRef.createElement('summary');summary.textContent='Viajar para outra cidade';
    Object.assign(summary.style,{cursor:'pointer',minHeight:'44px',padding:'10px 0',fontSize:'13px'});
    status.textContent=destinations.size?explanation:'Nenhum outro destino disponível.';status.setAttribute('role','status');
    Object.assign(status.style,{fontSize:'12px',maxWidth:'300px',lineHeight:'1.4',margin:'6px 0'});
    const list=documentRef.createElement('div');
    Object.assign(list.style,{display:'flex',flexWrap:'wrap',gap:'6px',maxWidth:'340px',maxHeight:'35vh',overflowY:'auto'});
    for(const destination of destinations.values()){
      const button=documentRef.createElement('button');button.type='button';
      const state=destination.status==='preview'?'Prévia · sem comércio local':'Mundo ativo';
      button.textContent=`${destination.name} · ${state}`;button.setAttribute('aria-label',`Viajar para ${destination.name}. ${state}.`);
      Object.assign(button.style,{minHeight:'44px',padding:'8px 12px',borderRadius:'9px',border:'1px solid #6ee7ff55',background:'#10243b',color:'#fff',cursor:'pointer',font:'inherit'});
      button.addEventListener('click',()=>travel(destination.id));list.appendChild(button);buttons.push(button);
    }
    panel.append(summary,status,list);
    (documentRef.querySelector?.('.panel.brand')||documentRef.body)?.appendChild(panel);
  }
  return Object.freeze({travel,reset:()=>{if(!disposed){setLocked(false);if(status)status.textContent=destinations.size?explanation:'Nenhum outro destino disponível.';}},
    dispose:()=>{if(disposed)return;disposed=true;panel?.remove?.();destinations.clear();buttons.length=0;}});
}
