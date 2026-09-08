import {publicSpatialCityIdentity} from './city-identity.js';
import {spatialCity} from './city-registry.js';

const PROFILE_COUNTS=Object.freeze({
  LITE:Object.freeze({skyline:12,vegetation:14,lights:12,furniture:8}),
  STANDARD:Object.freeze({skyline:22,vegetation:28,lights:24,furniture:14}),
  ULTRA:Object.freeze({skyline:36,vegetation:48,lights:40,furniture:24})
});
const CITY_STYLE=Object.freeze({
  'vitrine-city':Object.freeze({height:[24,72],skyline:['neural-tower','glass-spire','terrace'],vegetation:['canopy','garden'],furniture:['bench','kiosk']}),
  silvania:Object.freeze({height:[12,42],skyline:['garden-tower','terrace','arcade'],vegetation:['cerrado-tree','garden','canopy'],furniture:['bench','garden-seat']}),
  anapolis:Object.freeze({height:[18,58],skyline:['axis-tower','arcade','terrace'],vegetation:['canopy','garden'],furniture:['bench','transit-seat']}),
  goiania:Object.freeze({height:[22,66],skyline:['green-tower','glass-spire','terrace'],vegetation:['canopy','garden','palm'],furniture:['bench','garden-seat','kiosk']})
});

function hash32(value){let h=2166136261>>>0;for(const ch of String(value||'')){h^=ch.codePointAt(0);h=Math.imul(h,16777619)>>>0;}return h>>>0;}
function rng(seed){let a=hash32(seed)||1;return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function num(value,digits=3){return Number(Number(value).toFixed(digits));}
function profile(value){const id=String(value||'STANDARD').trim().toUpperCase();return PROFILE_COUNTS[id]?id:'STANDARD';}
function pointOnRing(random,index,count,{inner,outer,phase=0}){
  const angle=phase+(index/count)*Math.PI*2+(random()-.5)*.12;
  const radius=inner+(outer-inner)*(.25+.75*random());
  return {x:num(Math.cos(angle)*radius),z:num(Math.sin(angle)*radius)};
}
function safeTransitPoint(point){return !(Math.abs(point.x)<58&&point.z>74&&point.z<128);}
function pick(random,items){return items[Math.min(items.length-1,Math.floor(random()*items.length))];}

export function planSpatialCityEnvironment(cityId,{profileId='STANDARD'}={}){
  const city=spatialCity(cityId);if(!city)throw new Error('city_not_found');
  const identity=publicSpatialCityIdentity(city.id);if(!identity)throw new Error('city_identity_not_found');
  const quality=profile(profileId),counts=PROFILE_COUNTS[quality],style=CITY_STYLE[city.id]||CITY_STYLE['vitrine-city'];
  const random=rng(`environment:${city.seed}:${quality}`);
  const skyline=[];
  for(let i=0;i<counts.skyline;i++){
    let p=pointOnRing(random,i,counts.skyline,{inner:158,outer:288,phase:.17});
    if(!safeTransitPoint(p))p={x:p.x<0?p.x-74:p.x+74,z:p.z};
    const minH=style.height[0],maxH=style.height[1],height=minH+(maxH-minH)*(.25+.75*random());
    skyline.push(Object.freeze({
      id:`skyline:${city.id}:${i}`,kind:pick(random,style.skyline),position:Object.freeze({x:num(p.x),y:0,z:num(p.z)}),
      size:Object.freeze({width:num(8+random()*13),depth:num(8+random()*13),height:num(height)}),
      rotationY:num(random()*Math.PI*2,5),accentIndex:Math.floor(random()*8),windowDensity:num(.22+random()*.68)
    }));
  }
  const vegetation=[];
  for(let i=0;i<counts.vegetation;i++){
    const p=pointOnRing(random,i,counts.vegetation,{inner:88,outer:148,phase:.31});
    if(!safeTransitPoint(p))continue;
    vegetation.push(Object.freeze({id:`green:${city.id}:${i}`,kind:pick(random,style.vegetation),position:Object.freeze({x:num(p.x),y:0,z:num(p.z)}),scale:num(.72+random()*.9)}));
  }
  const lights=[];
  for(let i=0;i<counts.lights;i++){
    const p=pointOnRing(random,i,counts.lights,{inner:76,outer:82,phase:.05});
    lights.push(Object.freeze({id:`light:${city.id}:${i}`,position:Object.freeze({x:num(p.x),y:0,z:num(p.z)}),height:num(4.2+random()*2.2),intensity:num(.45+random()*.45)}));
  }
  const furniture=[];
  for(let i=0;i<counts.furniture;i++){
    const p=pointOnRing(random,i,counts.furniture,{inner:91,outer:116,phase:.6});
    if(!safeTransitPoint(p))continue;
    furniture.push(Object.freeze({id:`furniture:${city.id}:${i}`,kind:pick(random,style.furniture),position:Object.freeze({x:num(p.x),y:0,z:num(p.z)}),rotationY:num(Math.atan2(-p.x,-p.z),5)}));
  }
  const zones=Object.freeze([
    Object.freeze({id:'central-plaza',kind:'public',radius:82,label:'Central Plaza'}),
    Object.freeze({id:'transit-forecourt',kind:'mobility',bounds:Object.freeze({minX:-58,maxX:58,minZ:74,maxZ:128}),label:'Intercity Transit'}),
    Object.freeze({id:'premium-ring',kind:'premium',innerRadius:122,outerRadius:154,label:'Premium Ring'})
  ]);
  return Object.freeze({
    cityId:city.id,worldKey:city.worldKey,profileId:quality,themeId:identity.themeId,
    skyline:Object.freeze(skyline),vegetation:Object.freeze(vegetation),lights:Object.freeze(lights),furniture:Object.freeze(furniture),zones
  });
}

export function publicSpatialCityEnvironment(cityId,{profileId='STANDARD'}={}){
  return planSpatialCityEnvironment(cityId,{profileId});
}
