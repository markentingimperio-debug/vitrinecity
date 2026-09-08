const SPATIAL_MAP_CITY_NAMES=Object.freeze({
  silvania:'Silvânia',
  anapolis:'Anápolis',
  vianopolis:'Vianópolis',
  goiania:'Goiânia'
});

export function spatialMapCityName(cityId=''){
  return SPATIAL_MAP_CITY_NAMES[String(cityId||'').trim().toLowerCase()]||'';
}

export function spatialMapContextCity(locationLike=globalThis.location){
  try{
    const params=new URLSearchParams(String(locationLike?.search||''));
    return String(params.get('cidade')||params.get('city')||'').trim().toLowerCase();
  }catch{return'';}
}

export function applySpatialMapCityContext({cityId='',citySelect,stateSelect,statusNode}={}){
  const cityName=spatialMapCityName(cityId);
  if(!cityName||!citySelect?.options)return false;
  const option=[...citySelect.options].find(item=>String(item.value||'').trim().toLocaleLowerCase('pt-BR')===cityName.toLocaleLowerCase('pt-BR'));
  if(!option)return false;
  citySelect.value=option.value;
  if(statusNode)statusNode.dataset.spatialCityContext=String(cityId).trim().toLowerCase();
  citySelect.dispatchEvent?.(new Event('change',{bubbles:true}));
  return true;
}

export function mountSpatialMapCityContext({documentLike=globalThis.document,locationLike=globalThis.location,timeoutMs=5000}={}){
  if(!documentLike?.getElementById)return()=>{};
  const cityId=spatialMapContextCity(locationLike),cityName=spatialMapCityName(cityId);
  if(!cityName)return()=>{};
  const citySelect=documentLike.getElementById('city'),stateSelect=documentLike.getElementById('state'),statusNode=documentLike.getElementById('status');
  if(!citySelect)return()=>{};
  let stopped=false,timer=null,observer=null;
  const attempt=()=>{
    if(stopped)return false;
    const applied=applySpatialMapCityContext({cityId,citySelect,stateSelect,statusNode});
    if(applied){
      if(statusNode)statusNode.setAttribute('data-context-label',cityName);
      observer?.disconnect();if(timer)clearTimeout(timer);return true;
    }
    return false;
  };
  if(attempt())return()=>{};
  if(typeof MutationObserver==='function'){
    observer=new MutationObserver(attempt);observer.observe(citySelect,{childList:true,subtree:true});
  }
  timer=setTimeout(()=>{observer?.disconnect();},Math.max(500,Math.min(15000,Number(timeoutMs)||5000)));
  return()=>{stopped=true;observer?.disconnect();if(timer)clearTimeout(timer);};
}

if(typeof document!=='undefined')mountSpatialMapCityContext();
