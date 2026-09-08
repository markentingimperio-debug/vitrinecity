import {generateBlock} from './vitriny-spatial/procedural-city.js';
import {SPATIAL_CITIES,SPATIAL_WORLDS,listSpatialCities,spatialCity,spatialCityDistrict} from './vitriny-spatial/city-registry.js';
import {publicSpatialCityEnvironment} from './vitriny-spatial/city-environment.js';

const INTEGER=/^-?\d+$/;
const CONTEXT_MODULES=Object.freeze([
  Object.freeze({id:'social',label:'Vitriny Social',entryPath:'/social.html',activeOnly:false}),
  Object.freeze({id:'marketplace',label:'Marketplace & Lojas',entryPath:'/loja.html',activeOnly:true}),
  Object.freeze({id:'map',label:'Mapa real',entryPath:'/mapa-real.html',activeOnly:false}),
  Object.freeze({id:'deliveries',label:'Vitrine Entregas',entryPath:'/entregas.html',activeOnly:true})
]);
function boundedInt(value,label,{min=-2048,max=2048}={}){
  const raw=String(value??'').trim();
  if(!INTEGER.test(raw))throw new TypeError(`${label}_invalid`);
  const n=Number(raw);if(!Number.isSafeInteger(n)||n<min||n>max)throw new RangeError(`${label}_out_of_range`);return n;
}
function cleanFilter(value,max=40){return String(value??'').trim().toLowerCase().slice(0,max);}
function publicCity(city){
  return {
    id:city.id,worldKey:city.worldKey,name:city.name,country:city.country,countryName:city.countryName,
    region:city.region,regionName:city.regionName,status:city.status,chunkSize:city.chunkSize,route:city.route,
    physicalIntegration:city.physicalIntegration,identity:city.identity,
    districts:city.districts.map(({id,label,kind,path})=>({id,label,kind,path}))
  };
}
function contextHref(entryPath,cityId){const separator=entryPath.includes('?')?'&':'?';return `${entryPath}${separator}cidade=${encodeURIComponent(cityId)}`;}
function cache(res,seconds=60){return res.set('Cache-Control',`public, max-age=${seconds}, stale-while-revalidate=${Math.max(seconds,300)}`);}
function noSniff(res){res.set('X-Content-Type-Options','nosniff');return res;}
function profileFromQuery(req){const profile=String(req.query.profile||'STANDARD').trim().toUpperCase();return ['LITE','STANDARD','ULTRA'].includes(profile)?profile:null;}

export function spatialNavigationContext(cityId='vitrine-city'){
  const city=spatialCity(cityId);if(!city)throw new Error('city_not_found');
  const active=city.status==='active';
  const modules=CONTEXT_MODULES.map(item=>Object.freeze({
    id:item.id,label:item.label,href:contextHref(item.entryPath,city.id),activeOnly:item.activeOnly,
    enabled:!item.activeOnly||active,contextMode:'navigation-only'
  }));
  return Object.freeze({
    apiVersion:1,contextMode:'navigation-only',city:Object.freeze(publicCity(city)),
    modules:Object.freeze(modules),
    capabilities:Object.freeze({social:true,map:true,marketplace:active,deliveries:active})
  });
}

export function spatialApiChunk(cityId,x,z){
  const city=spatialCity(cityId);if(!city)throw new Error('city_not_found');
  const chunkX=boundedInt(x,'chunk_x'),chunkZ=boundedInt(z,'chunk_z');
  const block=generateBlock({worldKey:city.worldKey,chunkX,chunkZ,chunkSize:city.chunkSize,grid:3,seed:city.seed,mix:city.mix});
  return Object.freeze({
    apiVersion:1,
    city:{id:city.id,worldKey:city.worldKey,name:city.name,status:city.status,route:city.route,themeId:city.identity?.themeId||null},
    chunk:{x:chunkX,z:chunkZ,id:`${city.worldKey}:${chunkX}:${chunkZ}`,size:city.chunkSize},
    buildings:block.buildings
  });
}

export function setupSpatialApi(app){
  if(!app||typeof app.get!=='function')throw new TypeError('spatial_api_app_required');
  app.get('/api/spatial/v1',(_req,res)=>cache(noSniff(res),300).json({
    apiVersion:1,name:'Vitriny Spatial API',worlds:'/api/spatial/v1/worlds',cities:'/api/spatial/v1/cities',context:'/api/spatial/v1/context',
    cityCount:SPATIAL_CITIES.length,capabilities:['multicity-registry','district-registry','procedural-chunks','city-identity','themed-environment','premium-zone-registry','city-navigation-context']
  }));
  app.get('/api/spatial/v1/worlds',(_req,res)=>cache(noSniff(res),300).json({apiVersion:1,items:SPATIAL_WORLDS}));
  app.get('/api/spatial/v1/context',(req,res)=>{
    const requested=cleanFilter(req.query.city||req.query.cidade||'vitrine-city');
    try{return cache(noSniff(res),60).json(spatialNavigationContext(requested));}
    catch(error){return noSniff(res).status(error?.message==='city_not_found'?404:400).json({error:String(error?.message||'context_invalid').slice(0,80)});}
  });
  app.get('/api/spatial/v1/cities',(req,res)=>{
    const country=cleanFilter(req.query.country),region=cleanFilter(req.query.region),status=cleanFilter(req.query.status);
    if(status&&!['active','preview'].includes(status))return noSniff(res).status(400).json({error:'status_invalid'});
    const items=listSpatialCities({country,region,status}).map(publicCity);
    return cache(noSniff(res),120).json({apiVersion:1,items,count:items.length});
  });
  app.get('/api/spatial/v1/cities/:cityId',(req,res)=>{
    const city=spatialCity(req.params.cityId);if(!city)return noSniff(res).status(404).json({error:'city_not_found'});
    return cache(noSniff(res),120).json({apiVersion:1,city:publicCity(city)});
  });
  app.get('/api/spatial/v1/cities/:cityId/environment',(req,res)=>{
    const city=spatialCity(req.params.cityId);if(!city)return noSniff(res).status(404).json({error:'city_not_found'});
    const profile=profileFromQuery(req);if(!profile)return noSniff(res).status(400).json({error:'profile_invalid'});
    try{return cache(noSniff(res),300).json({apiVersion:1,environment:publicSpatialCityEnvironment(city.id,{profileId:profile})});}
    catch(error){return noSniff(res).status(400).json({error:String(error?.message||'environment_invalid').slice(0,80)});}
  });
  app.get('/api/spatial/v1/cities/:cityId/premium-zones',(req,res)=>{
    const city=spatialCity(req.params.cityId);if(!city)return noSniff(res).status(404).json({error:'city_not_found'});
    const profile=profileFromQuery(req);if(!profile)return noSniff(res).status(400).json({error:'profile_invalid'});
    try{
      const environment=publicSpatialCityEnvironment(city.id,{profileId:profile}),items=environment.premiumSlots||[];
      return cache(noSniff(res),60).json({apiVersion:1,cityId:city.id,profileId:profile,items,count:items.length,activeCount:items.filter(item=>item.status==='active').length});
    }catch(error){return noSniff(res).status(400).json({error:String(error?.message||'premium_zones_invalid').slice(0,80)});}
  });
  app.get('/api/spatial/v1/cities/:cityId/districts',(req,res)=>{
    const city=spatialCity(req.params.cityId);if(!city)return noSniff(res).status(404).json({error:'city_not_found'});
    return cache(noSniff(res),120).json({apiVersion:1,cityId:city.id,items:publicCity(city).districts});
  });
  app.get('/api/spatial/v1/cities/:cityId/districts/:districtId',(req,res)=>{
    const city=spatialCity(req.params.cityId);if(!city)return noSniff(res).status(404).json({error:'city_not_found'});
    const district=spatialCityDistrict(city.id,req.params.districtId);if(!district)return noSniff(res).status(404).json({error:'district_not_found'});
    return cache(noSniff(res),120).json({apiVersion:1,cityId:city.id,district});
  });
  app.get('/api/spatial/v1/cities/:cityId/chunks/:x/:z',(req,res)=>{
    try{return cache(noSniff(res),300).json(spatialApiChunk(req.params.cityId,req.params.x,req.params.z));}
    catch(error){
      if(error?.message==='city_not_found')return noSniff(res).status(404).json({error:'city_not_found'});
      return noSniff(res).status(400).json({error:String(error?.message||'chunk_invalid').slice(0,80)});
    }
  });
}
