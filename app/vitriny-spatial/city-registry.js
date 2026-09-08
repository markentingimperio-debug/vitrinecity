import {spatialPath} from './world-router.js';
import {publicSpatialCityIdentity} from './city-identity.js';

const DISTRICTS=Object.freeze([
  {id:'commerce',label:'Commerce District',kind:'commerce'},
  {id:'social',label:'Social District',kind:'social'},
  {id:'creator',label:'Creator District',kind:'creator'},
  {id:'food',label:'Food Avenue',kind:'food'},
  {id:'education',label:'Education District',kind:'education'},
  {id:'entertainment',label:'Entertainment District',kind:'entertainment'},
  {id:'business',label:'Business District',kind:'business'},
  {id:'services',label:'Services District',kind:'services'}
]);

const CITY_DEFINITIONS=[
  {id:'vitrine-city',name:'Vitrine City',status:'active',seed:'vitrine-city-v1',mix:['retail','food','office','services']},
  {id:'silvania',name:'Silvânia',status:'preview',seed:'silvania-go-v1',mix:['retail','food','services','residential']},
  {id:'anapolis',name:'Anápolis',status:'preview',seed:'anapolis-go-v1',mix:['retail','office','services','education']},
  {id:'vianopolis',name:'Vianópolis',status:'preview',seed:'vianopolis-go-v1',mix:['retail','services','food','residential']},
  {id:'goiania',name:'Goiânia',status:'preview',seed:'goiania-go-v1',mix:['office','retail','entertainment','services']}
];

function freezeCity(input){
  const route={country:'br',region:'go',city:input.id},identity=publicSpatialCityIdentity(input.id);
  return Object.freeze({
    id:input.id,
    worldKey:`br:go:${input.id}`,
    name:input.name,
    country:'br',countryName:'Brasil',
    region:'go',regionName:'Goiás',
    status:input.status,
    seed:input.seed,
    chunkSize:128,
    route:spatialPath(route),
    physicalIntegration:'logical',
    identity,
    mix:Object.freeze([...input.mix]),
    districts:Object.freeze(DISTRICTS.map(d=>Object.freeze({...d,path:spatialPath({...route,district:d.id})})))
  });
}

export const SPATIAL_CITIES=Object.freeze(CITY_DEFINITIONS.map(freezeCity));
const BY_ID=new Map(SPATIAL_CITIES.map(city=>[city.id,city]));
const BY_WORLD_KEY=new Map(SPATIAL_CITIES.map(city=>[city.worldKey,city]));

export const SPATIAL_WORLDS=Object.freeze([
  Object.freeze({
    id:'vitriny-brasil',
    name:'Vitriny Brasil',
    country:'br',
    status:'preview',
    route:'/v/br',
    cityCount:SPATIAL_CITIES.length
  })
]);

export function spatialCity(id){return BY_ID.get(String(id||'').trim().toLowerCase())||null;}
export function spatialCityByWorldKey(worldKey){return BY_WORLD_KEY.get(String(worldKey||'').trim().toLowerCase())||null;}
export function listSpatialCities({country,region,status}={}){
  const c=String(country||'').trim().toLowerCase(),r=String(region||'').trim().toLowerCase(),s=String(status||'').trim().toLowerCase();
  return SPATIAL_CITIES.filter(city=>(!c||city.country===c)&&(!r||city.region===r)&&(!s||city.status===s));
}
export function spatialCityDistrict(cityId,districtId){
  const city=spatialCity(cityId);if(!city)return null;
  return city.districts.find(item=>item.id===String(districtId||'').trim().toLowerCase())||null;
}
