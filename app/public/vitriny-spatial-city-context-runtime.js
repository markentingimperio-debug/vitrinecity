import {spatialFallbackCity} from './vitriny-spatial-api-client.js';
import {fetchSpatialNavigationContext,spatialContextCityFromLocation,spatialEcosystemDestinations} from './vitriny-spatial-city-context.js';

const nav=document.getElementById('ecosystemLinks');
const statusNode=document.getElementById('ecosystemContextStatus');

function textNode(tag,className,text){
  const node=document.createElement(tag);if(className)node.className=className;node.textContent=text;return node;
}

function render(context,{offline=false}={}){
  if(!nav)return;
  const city=context.city,items=context.modules;
  const nodes=[];
  for(const item of items){
    if(item.enabled){
      const link=textNode('a','',item.label);link.href=item.href;link.dataset.cityContext=city.id;nodes.push(link);continue;
    }
    const disabled=textNode('span','context-disabled',`${item.label} · aguardando ativação local`);
    disabled.setAttribute('aria-disabled','true');disabled.title=item.reason;nodes.push(disabled);
  }
  nav.replaceChildren(...nodes);
  if(statusNode)statusNode.textContent=`${offline?'Contexto offline':'Contexto'}: ${city.name} · ${city.status==='active'?'operação ativa':'preview seguro'}`;
  document.documentElement.dataset.vitrinyCityContext=city.id;
}

const cityId=spatialContextCityFromLocation(),fallbackCity=spatialFallbackCity(cityId);
const fallback=Object.freeze({
  apiVersion:1,contextMode:'navigation-only',source:'local-fallback',city:fallbackCity,
  modules:spatialEcosystemDestinations({cityId:fallbackCity.id,cityStatus:fallbackCity.status})
});
render(fallback,{offline:true});
try{
  const live=await fetchSpatialNavigationContext({cityId,timeoutMs:1800});
  render(live);
}catch{
  render(fallback,{offline:true});
}
