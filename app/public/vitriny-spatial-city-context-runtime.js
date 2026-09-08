import {fetchSpatialCityContext,spatialFallbackCity} from './vitriny-spatial-api-client.js';
import {spatialContextCityFromLocation,spatialEcosystemDestinations} from './vitriny-spatial-city-context.js';

const nav=document.getElementById('ecosystemLinks');
const statusNode=document.getElementById('ecosystemContextStatus');

function textNode(tag,className,text){
  const node=document.createElement(tag);if(className)node.className=className;node.textContent=text;return node;
}

function render(city){
  if(!nav)return;
  const items=spatialEcosystemDestinations({cityId:city.id,cityStatus:city.status});
  const nodes=[];
  for(const item of items){
    if(item.enabled){
      const link=textNode('a','',item.label);link.href=item.href;link.dataset.cityContext=city.id;nodes.push(link);continue;
    }
    const disabled=textNode('span','context-disabled',`${item.label} · aguardando ativação local`);
    disabled.setAttribute('aria-disabled','true');disabled.title=item.reason;nodes.push(disabled);
  }
  nav.replaceChildren(...nodes);
  if(statusNode)statusNode.textContent=`Contexto: ${city.name} · ${city.status==='active'?'operação ativa':'preview seguro'}`;
  document.documentElement.dataset.vitrinyCityContext=city.id;
}

const cityId=spatialContextCityFromLocation();
let city=spatialFallbackCity(cityId);
render(city);
try{
  const live=await fetchSpatialCityContext({cityId,timeoutMs:1800});
  if(live?.id===cityId){city=live;render(city);}
}catch{
  if(statusNode)statusNode.textContent=`Contexto offline: ${city.name} · ${city.status==='active'?'operação ativa':'preview seguro'}`;
}
