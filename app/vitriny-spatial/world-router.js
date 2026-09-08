const SEGMENT=/^[a-z0-9][a-z0-9-]{0,79}$/;

function cleanSegment(value,label){
  const segment=String(value??'').trim().toLowerCase();
  if(!SEGMENT.test(segment))throw new Error(`${label} inválido.`);
  return segment;
}

export function parseSpatialPath(pathname='/'){
  const raw=String(pathname||'/').split('?')[0].split('#')[0];
  const parts=raw.split('/').filter(Boolean);
  if(parts[0]!=='v')return null;
  const route={root:'v',country:null,region:null,city:null,district:null,place:null,depth:0};
  const names=['country','region','city','district','place'];
  for(let i=1;i<parts.length&&i<=names.length;i++){
    route[names[i-1]]=cleanSegment(parts[i],names[i-1]);
    route.depth=i;
  }
  if(parts.length>6)throw new Error('Rota espacial profunda demais.');
  return route;
}

export function spatialPath(input={}){
  const parts=['v'];
  for(const [key,label] of [['country','country'],['region','region'],['city','city'],['district','district'],['place','place']]){
    const value=input[key];
    if(value==null||value==='')break;
    parts.push(cleanSegment(value,label));
  }
  return '/'+parts.join('/');
}

export function spatialRouteKey(route){
  if(!route)return null;
  return [route.country,route.region,route.city,route.district,route.place].filter(Boolean).join(':')||'root';
}

export function createWorldRouter({defaultRoute={country:'br',region:'go',city:'vitrine-city'}}={}){
  const portals=new Map();
  function registerPortal({id,from,to,label='',kind='portal'}={}){
    const portalId=cleanSegment(id,'portal');
    if(portals.has(portalId))throw new Error(`Portal ${portalId} já existe.`);
    const fromPath=spatialPath(from||defaultRoute),toPath=spatialPath(to||defaultRoute);
    const portal=Object.freeze({id:portalId,from:fromPath,to:toPath,label:String(label||portalId).slice(0,120),kind:String(kind||'portal').slice(0,40)});
    portals.set(portalId,portal);return portal;
  }
  function resolve(value){
    const route=typeof value==='string'?parseSpatialPath(value):parseSpatialPath(spatialPath(value||defaultRoute));
    return route||parseSpatialPath(spatialPath(defaultRoute));
  }
  function followPortal(id,current){
    const portal=portals.get(cleanSegment(id,'portal'));if(!portal)throw new Error('Portal não encontrado.');
    const here=spatialPath(resolve(current));
    if(here!==portal.from)throw new Error('Portal não pertence à rota atual.');
    return resolve(portal.to);
  }
  return {resolve,registerPortal,followPortal,listPortals:()=>[...portals.values()],defaultRoute:resolve(defaultRoute)};
}
