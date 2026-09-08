import * as THREE from '/vendor/three/three.module.js';
import {createSpatialClientRuntime} from '/vitriny-spatial-client-core.js';
import {createSpatialApiChunkLoader,fetchSpatialCityContext,spatialCityFromLocation,spatialFallbackCity} from '/vitriny-spatial-api-client.js';
import {districtExperience} from '/vitriny-district-integrations.js';
import {fetchSpatialStores} from '/vitriny-spatial-store-registry.js';
import {SPATIAL_RETURN_KEY,createSpatialReturnState,isSafeInternalHref} from '/vitriny-spatial-session.js';
import {TRANSIT_CITY_IDS,fetchCityPortals,loadCityCheckpoint,saveCityCheckpoint,spatialMovementBasis,intersectsTransitPlaza} from '/vitriny-spatial-city-portals.js';
import {fallbackSpatialCityIdentity,normalizeSpatialCityIdentity} from './vitriny-spatial-city-identity.js';
import {mountSpatialCityEnvironment} from './vitriny-spatial-environment-renderer.js';
import {mountPremiumAtmosphere,createPremiumFacades} from './vitriny-spatial-premium-atmosphere.js';
import {createArchitectureKit} from './vitriny-premium-architecture.js';
import {mountCityHeadquarters,installHeadquartersDirectory} from './vitriny-city-headquarters.js';
import {mountSpatialBillboards} from './vitriny-spatial-billboards.js';
import {mountDeliveryBase} from './vitriny-delivery-base.js';

const palette=[0x6ee7ff,0x8f8cff,0xe48cff,0xffb36b,0x85e6a8,0x6f9cff,0xb58cff,0x6edbcf];
const requested=spatialCityFromLocation(),requestedCityId=TRANSIT_CITY_IDS.includes(requested)?requested:'vitrine-city';
let cityContext=spatialFallbackCity(requestedCityId),cityApiOnline=false;
try{cityContext=await fetchSpatialCityContext({cityId:requestedCityId,timeoutMs:2000});cityApiOnline=true;}
catch{if(cityContext.id!==requestedCityId)cityContext=spatialFallbackCity('vitrine-city');}
const cityId=cityContext.id,worldKey=cityContext.worldKey,isActiveCity=cityId==='vitrine-city'&&cityContext.status==='active';
const cityIdentity=normalizeSpatialCityIdentity(cityContext.identity||fallbackSpatialCityIdentity(cityId),cityId);
const profile=(()=>{
  const memory=Number(navigator.deviceMemory||0),cores=Number(navigator.hardwareConcurrency||2),mobile=matchMedia('(max-width:760px)').matches;
  const score=(memory>=8?3:memory>=4?2:memory>=2?1:0)+(cores>=8?3:cores>=4?2:1)+(mobile?-1:1);
  const id=score>=6?'ULTRA':score>=3?'STANDARD':'LITE';
  return{id,radius:id==='ULTRA'?2:1,pixel:id==='ULTRA'?Math.min(devicePixelRatio,1.6):id==='STANDARD'?Math.min(devicePixelRatio,1.25):1,shadows:id!=='LITE',grid:id==='LITE'?2:3};
})();
const $=id=>document.getElementById(id);
const worldStat=$('worldStat'),chunkStat=$('chunkStat'),fpsStat=$('fpsStat');
$('cityTitle').textContent=cityContext.name;
$('cityStatus').textContent=isActiveCity?'Hub do ecossistema':'PRÉVIA PROCEDURAL · sem comércio local ativo';
document.title=`Vitriny Multiverse · ${cityContext.name}`;
worldStat.textContent=`${cityContext.name} · ${isActiveCity?'HUB':'PREVIEW'}`;

const scene=new THREE.Scene();
scene.background=new THREE.Color('#c4ac9c');
scene.fog=new THREE.FogExp2(new THREE.Color('#c4ac9c'),0.0013);
const camera=new THREE.PerspectiveCamera(58,innerWidth/innerHeight,.1,1800);
let renderer;
try{renderer=new THREE.WebGLRenderer({antialias:profile.id!=='LITE',powerPreference:'high-performance'});}
catch(error){$('loadingText').textContent='3D indisponível neste aparelho. Use o World Gate ou a cidade clássica.';throw error;}
renderer.setPixelRatio(profile.pixel);renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.92;renderer.shadowMap.enabled=profile.shadows;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xbad4f4,0x806f53,1.45));
const sun=new THREE.DirectionalLight(0xffdab0,3.1);sun.position.set(-170,155,130);sun.castShadow=profile.shadows;
sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-220,right:220,top:220,bottom:-220,near:1,far:680});sun.shadow.bias=-.00025;sun.shadow.normalBias=.14;scene.add(sun);
const architecture=createArchitectureKit({renderer,scene,shadows:profile.shadows,lite:profile.id==='LITE'}),disposeReflections=architecture.reflections();
const groundMat=architecture.pavingMaterial({color:'#777b70',repeat:20});
const roadMat=new THREE.MeshStandardMaterial({color:'#303c43',roughness:.85,metalness:.03});
const sidewalkMat=architecture.pavingMaterial({color:'#a7a494',repeat:14});
const laneMat=new THREE.MeshBasicMaterial({color:'#d0c7ac'}),roofMat=new THREE.MeshStandardMaterial({color:'#65716e',roughness:.7});
const facades=createPremiumFacades();
const sharedMaterials=new Set([groundMat,roadMat,sidewalkMat,laneMat,roofMat,...facades,...architecture.materials]),chunkGroups=new Map();
const cityGround=new THREE.Mesh(new THREE.PlaneGeometry(2600,2600),groundMat);cityGround.rotation.x=-Math.PI/2;cityGround.position.y=-.08;cityGround.receiveShadow=profile.shadows;scene.add(cityGround);
const premiumAtmosphere=mountPremiumAtmosphere({scene,identity:cityIdentity,profileId:profile.id});
const reducedMotion=matchMedia('(prefers-reduced-motion:reduce)');
function mesh(geometry,material,parent,position){
  const object=new THREE.Mesh(geometry,material);if(position)object.position.set(...position);parent.add(object);return object;
}
function createChunkGroup(chunk){
  const group=new THREE.Group();group.name=chunk.id;
  const size=chunk.chunkSize,baseX=chunk.x*size,baseZ=chunk.z*size;
  const floor=mesh(new THREE.PlaneGeometry(size,size),groundMat,group,[baseX+size/2,-.02,baseZ+size/2]);
  floor.rotation.x=-Math.PI/2;floor.receiveShadow=profile.shadows;
  for(let i=0;i<3;i++){
    const axis=baseX+i*size/3,other=baseZ+i*size/3;
    mesh(new THREE.BoxGeometry(15,.12,size),sidewalkMat,group,[axis,.04,baseZ+size/2]);
    mesh(new THREE.BoxGeometry(size,.12,15),sidewalkMat,group,[baseX+size/2,.04,other]);
    mesh(new THREE.BoxGeometry(10,.13,size),roadMat,group,[axis,.06,baseZ+size/2]);
    mesh(new THREE.BoxGeometry(size,.13,10),roadMat,group,[baseX+size/2,.06,other]);
    for(let j=0;j<8;j++){
      mesh(new THREE.BoxGeometry(.25,.02,5),laneMat,group,[axis,.14,baseZ+j*16+7]);
      mesh(new THREE.BoxGeometry(5,.02,.25),laneMat,group,[baseX+j*16+7,.14,other]);
    }
  }
  for(const building of chunk.buildings){
    if(intersectsTransitPlaza(building))continue;
    const px=building.position.x,pz=building.position.z;
    if((px>82&&px<510&&Math.abs(pz)<68)||(Math.abs(px)<50&&pz>-195&&pz<-115)||(px>55&&px<160&&pz>-150&&pz<-45))continue;
    const b=building,accent=palette[b.accentIndex%palette.length],g=new THREE.Group();
    g.position.set(b.position.x,0,b.position.z);g.userData={kind:b.kind,buildingId:b.id};
    const facade=facades[Math.abs(Math.trunc(b.accentIndex||0))%facades.length];
    const geometry=new THREE.BoxGeometry(b.size.width,b.size.height,b.size.depth),uv=geometry.attributes.uv;
    for(let i=0;i<uv.count;i++){const side=Math.floor(i/4),width=side<2?b.size.depth:b.size.width;uv.setXY(i,uv.getX(i)*width/12,uv.getY(i)*b.size.height/24);}
    const body=mesh(geometry,[facade,facade,roofMat,roofMat,facade,facade],g,[0,b.size.height/2,0]);
    body.castShadow=profile.shadows;body.receiveShadow=profile.shadows;
    architecture.part(g,architecture.graphite,0,b.size.height+.3,0,b.size.width+1,.6,b.size.depth+1);
    for(const z of [-b.size.depth/2,b.size.depth/2])architecture.part(g,architecture.warm,0,b.size.height+.08,z,b.size.width,.065,.065);
    // Articulated ground floor and structural mullions replace uniform luminous boxes.
    for(const x of [-b.size.width/2,b.size.width/2])architecture.part(g,architecture.graphite,x,b.size.height/2,0,.25,b.size.height,b.size.depth+.1);
    architecture.part(g,architecture.stone,0,.35,0,b.size.width+2,.7,b.size.depth+2);
    if(Math.hypot(b.position.x,b.position.z)<210){
      for(let col=0;col<3;col++)architecture.part(g,architecture.brass,-b.size.width*.32+col*b.size.width*.32,2.7,b.size.depth/2+.15,.09,4.8,.09);
      architecture.part(g,architecture.graphite,0,5.3,b.size.depth/2+.6,b.size.width+.7,.35,1.7);
      architecture.tree(g,b.size.width/2+2,b.size.depth/2+1,.85);
    }
    group.add(g);
  }
  scene.add(group);chunkGroups.set(chunk.id,group);
}
function disposeGroup(group,{keepShared=true}={}){
  const geometries=new Set(),materials=new Set(),textures=new Set();
  group.traverse(object=>{
    if(object.geometry&&!(keepShared&&architecture.geometries.has(object.geometry)))geometries.add(object.geometry);
    for(const material of Array.isArray(object.material)?object.material:[object.material]){
      if(!material||(keepShared&&sharedMaterials.has(material)))continue;
      materials.add(material);if(material.map)textures.add(material.map);
    }
  });
  for(const item of [...textures,...materials,...geometries])item.dispose?.();
}
function removeChunk(id){const group=chunkGroups.get(id);if(!group)return;disposeGroup(group);scene.remove(group);chunkGroups.delete(id);}

const portalTargets=[],storeTargets=[],storeEntrances=[],cityDestinations=new Map();
const entranceLayer=document.createElement('div');entranceLayer.className='store-entrances';entranceLayer.setAttribute('aria-label','Entradas das lojas');document.body.append(entranceLayer);
const plaza=new THREE.Group();plaza.name=`central-plaza:${cityId}`;scene.add(plaza);
const plazaFloor=mesh(new THREE.CircleGeometry(82,64),sidewalkMat,plaza,[0,.18,0]);plazaFloor.rotation.x=-Math.PI/2;plazaFloor.receiveShadow=profile.shadows;
for(const [r,w,c,o] of [[24,.16,0xe4bb75,.7],[40,.13,0xb0c1bc,.3],[55,.15,0xe4bb75,.55],[72,.1,0xe4bb75,.4]]){
  const ring=mesh(new THREE.RingGeometry(r-w,r,64),new THREE.MeshBasicMaterial({color:c,transparent:true,opacity:o,side:THREE.DoubleSide}),plaza,[0,.21,0]);ring.rotation.x=-Math.PI/2;
}
mesh(new THREE.CylinderGeometry(3.2,4.7,1.2,40),architecture.graphite,plaza,[0,.6,0]);
const neuralCore=mesh(new THREE.IcosahedronGeometry(2.6,1),new THREE.MeshPhysicalMaterial({color:'#92c6c8',emissive:cityIdentity.palette.accent,emissiveIntensity:.22,metalness:.55,roughness:.16}),plaza,[0,4.4,0]);
function createCityLandmark(identity){
  const group=new THREE.Group();group.name=`city-landmark:${identity.landmark.id}`;group.userData={landmark:true,kind:identity.landmark.kind};
  const accent=identity.palette.accent,secondary=identity.palette.secondary,quality=profile.id==='LITE'?0:profile.id==='STANDARD'?1:2;
  const glow=new THREE.MeshStandardMaterial({color:0x142337,emissive:accent,emissiveIntensity:.72,metalness:.55,roughness:.22});
  const glow2=new THREE.MeshBasicMaterial({color:secondary,transparent:true,opacity:.62});
  if(identity.landmark.kind==='spire'){
    mesh(new THREE.CylinderGeometry(.7,2.2,34,quality?18:10),glow,group,[0,19,0]);
    const halo=mesh(new THREE.TorusGeometry(9,.22,quality?10:6,quality?64:28),glow2,group,[0,30,0]);halo.rotation.x=Math.PI/2;
    if(quality>0){const halo2=mesh(new THREE.TorusGeometry(12,.1,8,64),new THREE.MeshBasicMaterial({color:accent,transparent:true,opacity:.32}),group,[0,36,0]);halo2.rotation.x=Math.PI/2;}
  }else if(identity.landmark.kind==='crown'){
    for(let i=0;i<3;i++){const crown=mesh(new THREE.TorusGeometry(9+i*2,.28,quality?10:6,quality?56:28),i%2?glow2:glow,group,[0,7+i*4,0]);crown.rotation.x=Math.PI/2;}
    const petals=quality?8:5;for(let i=0;i<petals;i++){const a=i*Math.PI*2/petals;mesh(new THREE.CylinderGeometry(.2,.55,12,6),glow,group,[Math.cos(a)*8,7,Math.sin(a)*8]).rotation.z=Math.sin(a)*.28;}
  }else if(identity.landmark.kind==='arch'){
    for(const x of [-11,11])mesh(new THREE.BoxGeometry(1.4,20,1.4),glow,group,[x,10,-8]);
    const arch=mesh(new THREE.TorusGeometry(11,.72,quality?12:7,quality?72:32,Math.PI),glow,group,[0,20,-8]);arch.rotation.z=0;
    mesh(new THREE.BoxGeometry(20,.18,3),glow2,group,[0,2,-8]);
  }else{
    const center=mesh(new THREE.SphereGeometry(3.2,quality?24:12,quality?16:8),glow,group,[0,17,-5]);center.scale.y=1.35;
    const rotations=[[Math.PI/2,0,0],[1.1,.5,.2],[.8,-.6,.4]];for(let i=0;i<(quality?3:2);i++){const orbit=mesh(new THREE.TorusGeometry(10+i*2,.22,quality?10:6,quality?64:28),i%2?glow2:glow,group,[0,17,-5]);orbit.rotation.set(...rotations[i]);}
  }
  plaza.add(group);return group;
}
const cityLandmark=createCityLandmark(cityIdentity);
const headquarters=mountCityHeadquarters({scene,architecture,facade:facades[0],shadows:profile.shadows});
const billboards=mountSpatialBillboards({scene,architecture,active:isActiveCity,cityName:cityContext.name});
const deliveryBase=mountDeliveryBase({scene,architecture,cityId,cityName:cityContext.name});
const deliveryDialog=$('deliveryBaseDirectory');deliveryDialog.querySelector('small').textContent=`VC ENTREGAS · ${cityContext.name}`;
deliveryDialog.querySelector('p').textContent='Base em implantação: recepção, triagem, expedição, apoio aos entregadores e gestão logística. A presença deste prédio no cenário não indica que entregas locais estejam operacionais.';
const deliveryButton=$('openDeliveryBase');deliveryButton.hidden=!deliveryBase;
deliveryButton.addEventListener('click',()=>{releaseControls();position.set(62,13,-23);yaw=Math.PI-.56;pitch=-.06;updateViewButton();$('deliveryBaseDirectory').showModal();});
$('deliveryBaseDirectory').querySelector('[data-close]').addEventListener('click',()=>$('deliveryBaseDirectory').close());
installHeadquartersDirectory($('headquartersDirectory'));
$('openHeadquarters').addEventListener('click',()=>{releaseControls();$('headquartersDirectory').showModal();});
let cityEnvironmentMount=null;
mountSpatialCityEnvironment({scene,camera,cityId,identity:cityIdentity,profileId:profile.id,shadows:profile.shadows}).then(result=>{if(disposed){result.dispose();return;}cityEnvironmentMount=result;}).catch(()=>{cityEnvironmentMount=null;});
const districtIds=['commerce','social','creator','food','education','entertainment','business','services'];
for(let i=0;i<districtIds.length;i++){
  const id=districtIds[i],experience=districtExperience(id);if(!experience)continue;
  const a=i*Math.PI/4,portal=new THREE.Group();portal.position.set(Math.cos(a)*68,0,Math.sin(a)*68);portal.rotation.y=-a-Math.PI/2;
  portal.userData={portal:true,portalKind:'district',label:experience.label,id,path:`/v/br/go/${cityId}/${id}`,href:experience.href,description:isActiveCity?experience.description:`${experience.label} de ${cityContext.name} em preview procedural.`,enabled:isActiveCity};
  architecture.boutique(portal,{label:experience.label,width:i%2?20:24,depth:14,variant:i,subtitle:isActiveCity?'VITRINE CITY':'DISTRITO EM PREPARAÇÃO'});
  billboards.registerVenue(portal,{name:experience.label,description:isActiveCity?experience.description:'Distrito em preparação.',href:isActiveCity?experience.href:'/vitriny-multiverse-worlds.html',roof:8.8});
  plaza.add(portal);portalTargets.push(portal);
}
for(let i=0;i<20;i++){const a=i/20*Math.PI*2+.12;architecture.tree(plaza,Math.cos(a)*43,Math.sin(a)*43,1.05);}
function addCityPortal(destination,index){
  const portal=new THREE.Group();portal.name=destination.portalId;portal.position.set(destination.position.x,0,destination.position.z);
  portal.userData={portal:true,portalKind:'city',cityPortal:true,enabled:true,destinationId:destination.id,label:destination.name,description:destination.description,href:destination.href};
  const accent=palette[(index+2)%palette.length];
  const pedestal=mesh(new THREE.CylinderGeometry(6.3,7.4,1.1,profile.id==='LITE'?16:32),new THREE.MeshStandardMaterial({color:0x101c2b,metalness:.68,roughness:.24}),portal,[0,.55,0]);pedestal.receiveShadow=profile.shadows;
  const ring=mesh(new THREE.TorusGeometry(5.2,.46,profile.id==='LITE'?8:12,profile.id==='LITE'?24:48),new THREE.MeshStandardMaterial({color:0x16283c,emissive:accent,emissiveIntensity:destination.status==='active'?1.35:.72,metalness:.48,roughness:.2}),portal,[0,6.4,0]);ring.name='city-gate-ring';
  mesh(new THREE.CircleGeometry(4.65,profile.id==='LITE'?20:40),new THREE.MeshBasicMaterial({color:accent,transparent:true,opacity:destination.status==='active'?.28:.15,side:THREE.DoubleSide}),portal,[0,6.4,.06]);
  mesh(new THREE.CylinderGeometry(.08,.08,8,6),new THREE.MeshBasicMaterial({color:accent,transparent:true,opacity:.75}),portal,[0,14,0]);
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=160;
  const ctx=canvas.getContext('2d');
  if(ctx){
    ctx.fillStyle='#07111e';ctx.fillRect(0,0,512,160);ctx.fillStyle='#eaffff';ctx.font='bold 44px system-ui';ctx.textAlign='center';ctx.fillText(destination.name,256,65,470);
    ctx.fillStyle='#9fe8ff';ctx.font='24px system-ui';ctx.fillText(destination.status==='preview'?'EXPLORAR PRÉVIA':'VOLTAR AO HUB',256,115,470);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    const label=new THREE.Sprite(new THREE.SpriteMaterial({map:texture}));label.scale.set(15,4.7,1);label.position.y=14;portal.add(label);
  }
  plaza.add(portal);portalTargets.push(portal);cityDestinations.set(destination.id,destination);
}
async function loadCityConnections(){
  const result=await fetchCityPortals({currentCityId:cityId});
  if(disposed)return;
  const nav=$('cityLinks');nav.replaceChildren();
  for(const [index,destination] of result.portals.entries()){
    addCityPortal(destination,index);
    const link=document.createElement('a');link.href=destination.href;
    link.textContent=`${destination.name} · ${destination.status==='preview'?'prévia':'hub'}`;
    link.addEventListener('click',event=>{
      saveSpatialContext();
      if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||event.button!==0)return;
      event.preventDefault();travelToCity(destination.id);
    });nav.appendChild(link);
  }
  $('travelStatus').textContent=result.source==='api'?'Escolha um portal ou um destino abaixo.':'Catálogo offline · destinos em modo de prévia.';
}

const liveStoreGroup=new THREE.Group();liveStoreGroup.name='commerce-live-stores';scene.add(liveStoreGroup);
function addLiveStore(entity){
  const accent=palette[entity.accentIndex%palette.length],g=new THREE.Group();g.position.set(entity.position.x,0,entity.position.z);
  g.userData={store:true,href:entity.href,interiorHref:entity.interiorHref,label:entity.name,reference:entity.reference};
  g.rotation.y=-Math.PI/2;
  architecture.boutique(g,{label:entity.name,width:entity.size.width,depth:entity.size.depth,height:entity.size.height,variant:entity.accentIndex,subtitle:entity.city});
  billboards.registerStore(g,entity,{roof:9});
  liveStoreGroup.add(g);storeTargets.push(g);
  const entry=document.createElement('a');entry.className='store-entrance';entry.href=entity.href;entry.setAttribute('aria-label',`Visitar ${entity.name}`);
  const name=document.createElement('small');name.textContent=entity.name;const action=document.createElement('strong');action.textContent='Visitar loja  →';entry.append(name,action);
  entry.addEventListener('click',()=>saveSpatialContext({spatialPath:`/v/br/go/${cityId}/commerce/${encodeURIComponent(entity.reference)}`,districtId:'commerce',targetType:'store',targetId:entity.reference}));entranceLayer.append(entry);
  const anchor=g.localToWorld(new THREE.Vector3(0,2.5,entity.size.depth/2+.4));storeEntrances.push({element:entry,anchor});
}
async function loadLiveStores(){
  if(!isActiveCity){worldStat.textContent=`${cityContext.name} · PREVIEW PROCEDURAL`;return;}
  try{
    const entities=await fetchSpatialStores({limit:profile.id==='LITE'?20:48});if(disposed)return;
    const links=$('storeLinks');links.replaceChildren();
    for(const entity of entities){addLiveStore(entity);const link=document.createElement('a');link.href=entity.href;link.textContent=entity.name;links.append(link);}
    worldStat.textContent=`${cityContext.name} · ${entities.length} lojas conectadas`;
  }catch{worldStat.textContent=`${cityContext.name} · lojas em modo offline`;}
}

const position=new THREE.Vector3(0,38,132),velocity=new THREE.Vector3(),keys=new Set();
let yaw=Math.PI,pitch=.1,speed=16,dragging=false,lastX=0,lastY=0,pointerStartX=0,pointerStartY=0,activePortal=null;
let chunkSource=cityApiOnline?'api':'fallback',disposed=false,navigating=false,raf=0;
function restoreSpatialContext(){
  if(new URLSearchParams(location.search).get('return')!=='1')return;
  const state=loadCityCheckpoint(cityId);if(!state||state.worldKey!==worldKey)return;
  position.set(state.position.x,state.position.y,state.position.z);yaw=state.yaw;pitch=state.pitch;
  try{const url=new URL(location.href);url.searchParams.delete('return');history.replaceState({},'',url.pathname+url.search);}catch{}
}
restoreSpatialContext();
function updateViewButton(){const button=$('toggleView');if(button){button.textContent=position.y>10?'Explorar a pé':'Vista panorâmica';button.setAttribute('aria-pressed',String(position.y>10));}}
updateViewButton();
$('toggleView')?.addEventListener('click',()=>{if(position.y>10){position.set(23,2.2,53);yaw=Math.PI-.4;pitch=.035;}else{position.set(0,38,132);yaw=Math.PI;pitch=.1;}releaseControls();updateViewButton();});
$('visitStores')?.addEventListener('click',()=>{position.set(91,3.3,58);yaw=-Math.PI/2-.38;pitch=.02;releaseControls();updateViewButton();});
function saveSpatialContext({spatialPath=cityContext.route||`/v/br/go/${cityId}`,districtId='',targetType='',targetId=''}={}){
  const state=createSpatialReturnState({worldKey,spatialPath,districtId,targetType,targetId,position:{x:position.x,y:position.y,z:position.z},yaw,pitch});
  const saved=saveCityCheckpoint(state);
  try{sessionStorage.setItem(SPATIAL_RETURN_KEY,JSON.stringify(state));return true;}catch{return saved;}
}
function safeNavigate(href){if(navigating||!isSafeInternalHref(href))return false;navigating=true;location.assign(href);return true;}
function spatialEvent(event,targetType){try{dispatchEvent(new CustomEvent('vitriny:spatial-event',{detail:{event,targetType}}));}catch{}}
function travelToCity(destinationId){
  const destination=cityDestinations.get(destinationId);if(!destination||destination.id===cityId)return false;
  saveSpatialContext();spatialEvent('portal_enter','portal');return safeNavigate(destination.href);
}
function enterActivePortal(){
  if(!activePortal||!activePortal.userData.enabled)return false;
  if(activePortal.userData.cityPortal)return travelToCity(activePortal.userData.destinationId);
  saveSpatialContext({spatialPath:activePortal.userData.path,districtId:activePortal.userData.id,targetType:'district',targetId:activePortal.userData.id});
  spatialEvent('portal_enter','portal');return safeNavigate(activePortal.userData.href);
}

const apiLoader=createSpatialApiChunkLoader({cityId,timeoutMs:2000,onSource:source=>{chunkSource=source;}});
const runtime=createSpatialClientRuntime({worldKey,chunkSize:cityContext.chunkSize||128,radius:profile.radius,maxLoaded:profile.radius===2?25:9,loader:apiLoader,onUnload:id=>removeChunk(id)});
let updateBusy=false,lastChunkUpdate=-Infinity;
async function syncChunks(){
  const now=performance.now();if(disposed||updateBusy||now-lastChunkUpdate<350)return;
  updateBusy=true;lastChunkUpdate=now;
  try{
    const {forward}=spatialMovementBasis(yaw),state=await runtime.update({x:position.x,z:position.z},forward);
    if(disposed){await runtime.clear();return;}
    for(const chunk of state.resources)if(!chunkGroups.has(chunk.id))createChunkGroup(chunk);
    chunkStat.textContent=chunkSource==='api'?'Cenário conectado':'Cenário disponível offline';
  }catch{chunkStat.textContent='Cenário reconectando · portais continuam disponíveis';}
  finally{updateBusy=false;}
}
const moveMap={forward:'KeyW',back:'KeyS',left:'KeyA',right:'KeyD'};
addEventListener('keydown',event=>{
  if(event.target?.closest?.('input,textarea,select,button,a,summary,[contenteditable="true"]'))return;
  keys.add(event.code);if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(event.code))event.preventDefault();
  if(event.code==='KeyE'&&!event.repeat)enterActivePortal();
});
addEventListener('keyup',event=>keys.delete(event.code));
function releaseControls(){keys.clear();dragging=false;}
addEventListener('blur',releaseControls);document.addEventListener('visibilitychange',()=>{if(document.hidden)releaseControls();});
for(const button of document.querySelectorAll('[data-move]')){
  const code=moveMap[button.dataset.move];
  button.addEventListener('pointerdown',event=>{event.preventDefault();button.setPointerCapture?.(event.pointerId);keys.add(code);});
  for(const name of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(name,()=>keys.delete(code));
}
const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
function targetAtPointer(event){
  pointer.x=event.clientX/innerWidth*2-1;pointer.y=-(event.clientY/innerHeight)*2+1;
  raycaster.setFromCamera(pointer,camera);
  let node=raycaster.intersectObjects([...storeTargets,...portalTargets,headquarters,...billboards.targets,...(deliveryBase?[deliveryBase]:[])],true)[0]?.object||null;
  while(node&&!node.userData?.store&&!node.userData?.portal&&!node.userData?.headquarters&&!node.userData?.billboard&&!node.userData?.deliveryBase)node=node.parent;return node;
}
renderer.domElement.addEventListener('pointerdown',event=>{
  dragging=true;lastX=pointerStartX=event.clientX;lastY=pointerStartY=event.clientY;renderer.domElement.setPointerCapture(event.pointerId);
});
renderer.domElement.addEventListener('pointerup',event=>{
  const click=dragging&&Math.hypot(event.clientX-pointerStartX,event.clientY-pointerStartY)<6;dragging=false;
  if(!click)return;
  const target=targetAtPointer(event);if(!target)return;
  if(target.userData.headquarters){releaseControls();$('headquartersDirectory').showModal();return;}
  if(target.userData.deliveryBase){releaseControls();$('deliveryBaseDirectory').showModal();return;}
  if(target.userData.billboard){saveSpatialContext();billboards.activate(target);return;}
  if(target.userData.portal){activePortal=target;enterActivePortal();return;}
  const reference=String(target.userData.reference||'');
  saveSpatialContext({spatialPath:`/v/br/go/${cityId}/commerce/${encodeURIComponent(reference)}`,districtId:'commerce',targetType:'store',targetId:reference});
  spatialEvent('entity_open','store');safeNavigate(target.userData.href);
});
renderer.domElement.addEventListener('pointercancel',()=>{dragging=false;});
renderer.domElement.addEventListener('lostpointercapture',()=>{dragging=false;});
renderer.domElement.addEventListener('pointermove',event=>{
  if(!dragging){const target=targetAtPointer(event);renderer.domElement.style.cursor=target?'pointer':'grab';return;}
  yaw+=(event.clientX-lastX)*.0045;pitch=Math.max(-.55,Math.min(.45,pitch-(event.clientY-lastY)*.003));lastX=event.clientX;lastY=event.clientY;
});
renderer.domElement.addEventListener('wheel',event=>{speed=Math.max(8,Math.min(55,speed-event.deltaY*.02));},{passive:true});
$('enterPortal').onclick=enterActivePortal;
$('worldGateLink').addEventListener('click',()=>saveSpatialContext());
let shownPortal=null;
function updatePortal(){
  let best=null,bestDistance=12;
  for(const portal of portalTargets){const distance=portal.position.distanceTo(position);if(distance<bestDistance){best=portal;bestDistance=distance;}}
  activePortal=best;if(shownPortal===best)return;shownPortal=best;
  $('portal').classList.toggle('show',Boolean(best));if(!best)return;
  $('portalName').textContent=best.userData.label;$('portalHint').textContent=best.userData.description;
  $('enterPortal').disabled=!best.userData.enabled;
  $('enterPortal').textContent=best.userData.cityPortal?'Viajar para esta cidade':best.userData.enabled?'Abrir distrito':'Distrito em preparação';
}
let frames=0,fpsClock=performance.now(),last=performance.now(),firstFrame=true;
const forwardVector=new THREE.Vector3(),rightVector=new THREE.Vector3(),lookTarget=new THREE.Vector3();
const projectedEntrance=new THREE.Vector3();
function updateStoreEntrances(){
  for(const {element,anchor} of storeEntrances){
    projectedEntrance.copy(anchor).project(camera);const x=(projectedEntrance.x*.5+.5)*innerWidth,y=(-projectedEntrance.y*.5+.5)*innerHeight;
    const visible=position.distanceTo(anchor)<95&&projectedEntrance.z>-1&&projectedEntrance.z<1&&x>85&&x<innerWidth-85&&y>210&&y<innerHeight-115;
    element.hidden=!visible;if(visible)element.style.transform=`translate(-50%,-50%) translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
  }
}
function animate(now){
  if(disposed)return;raf=requestAnimationFrame(animate);
  const dt=Math.min(.05,(now-last)/1000);last=now;if(document.hidden)return;
  frames++;if(now-fpsClock>=1000){fpsStat.textContent=`${profile.id==='LITE'?'Visual leve':profile.id==='ULTRA'?'Visual detalhado':'Visual equilibrado'} · ${Math.round(frames*1000/(now-fpsClock))} FPS`;frames=0;fpsClock=now;}
  const basis=spatialMovementBasis(yaw);forwardVector.set(basis.forward.x,0,basis.forward.z);rightVector.set(basis.right.x,0,basis.right.z);velocity.set(0,0,0);
  if(keys.has('KeyW')||keys.has('ArrowUp'))velocity.add(forwardVector);if(keys.has('KeyS')||keys.has('ArrowDown'))velocity.sub(forwardVector);
  if(keys.has('KeyD')||keys.has('ArrowRight'))velocity.add(rightVector);if(keys.has('KeyA')||keys.has('ArrowLeft'))velocity.sub(rightVector);
  if(velocity.lengthSq())position.add(velocity.normalize().multiplyScalar(speed*dt));
  position.x=Math.max(-100000,Math.min(100000,position.x));position.z=Math.max(-100000,Math.min(100000,position.z));
  lookTarget.set(basis.forward.x*Math.cos(pitch),Math.sin(pitch),basis.forward.z*Math.cos(pitch)).add(position);
  camera.position.copy(position);camera.lookAt(lookTarget);if(!reducedMotion.matches){neuralCore.rotation.y+=dt*.45;}premiumAtmosphere.tick(dt,{paused:reducedMotion.matches});billboards.tick(dt,{paused:reducedMotion.matches});
  updatePortal();syncChunks();renderer.render(scene,camera);updateStoreEntrances();
  if(firstFrame){firstFrame=false;$('loading').classList.add('hide');}
}
raf=requestAnimationFrame(animate);
loadCityConnections().catch(()=>{$('travelStatus').textContent='Conexões indisponíveis. Use o World Gate.';});
loadLiveStores();
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
addEventListener('pagehide',event=>{
  if(!navigating)saveSpatialContext();releaseControls();
  if(event.persisted)return;
  disposed=true;cancelAnimationFrame(raf);billboards.dispose();architecture.dispose();cityEnvironmentMount?.dispose();cityEnvironmentMount=null;disposeGroup(scene,{keepShared:false});disposeReflections();renderer.dispose();
});
addEventListener('pageshow',()=>{navigating=false;last=performance.now();fpsClock=last;frames=0;});
