import * as THREE from '/vendor/three/three.module.js';
import {createSpatialClientRuntime} from '/vitriny-spatial-client-core.js';
import {createSpatialApiChunkLoader,fetchSpatialCityContext,spatialCityFromLocation,spatialFallbackCity} from '/vitriny-spatial-api-client.js';
import {districtExperience} from '/vitriny-district-integrations.js';
import {fetchSpatialStores} from '/vitriny-spatial-store-registry.js';
import {SPATIAL_RETURN_KEY,createSpatialReturnState,isSafeInternalHref} from '/vitriny-spatial-session.js';
import {TRANSIT_CITY_IDS,fetchCityPortals,loadCityCheckpoint,saveCityCheckpoint,spatialMovementBasis,intersectsTransitPlaza} from '/vitriny-spatial-city-portals.js';
import {fallbackSpatialCityIdentity,normalizeSpatialCityIdentity} from './vitriny-spatial-city-identity.js';
import {mountSpatialCityEnvironment} from './vitriny-spatial-environment-renderer.js';

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
$('cityTitle').textContent=`${cityContext.name} Spatial`;
$('cityStatus').textContent=isActiveCity?'Hub do ecossistema':'PRÉVIA PROCEDURAL · sem comércio local ativo';
document.title=`Vitriny Multiverse · ${cityContext.name}`;
worldStat.textContent=`${cityContext.name} · ${isActiveCity?'HUB':'PREVIEW'}`;

const scene=new THREE.Scene();
scene.background=new THREE.Color(cityIdentity.palette.background);
scene.fog=new THREE.FogExp2(new THREE.Color(cityIdentity.palette.fog),0.0026);
const camera=new THREE.PerspectiveCamera(58,innerWidth/innerHeight,.1,1800);
let renderer;
try{renderer=new THREE.WebGLRenderer({antialias:profile.id!=='LITE',powerPreference:'high-performance'});}
catch(error){$('loadingText').textContent='3D indisponível neste aparelho. Use o World Gate ou a cidade clássica.';throw error;}
renderer.setPixelRatio(profile.pixel);renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;renderer.shadowMap.enabled=profile.shadows;
document.body.prepend(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xc9f3ff,0x061018,1.25));
const sun=new THREE.DirectionalLight(0xffffff,1.9);sun.position.set(120,180,90);sun.castShadow=profile.shadows;scene.add(sun);
const groundMat=new THREE.MeshStandardMaterial({color:cityIdentity.palette.ground,roughness:.86,metalness:.08});
const roadMat=new THREE.MeshStandardMaterial({color:cityIdentity.palette.road,roughness:.72,metalness:.12});
const sharedMaterials=new Set([groundMat,roadMat]),chunkGroups=new Map();
function mesh(geometry,material,parent,position){
  const object=new THREE.Mesh(geometry,material);if(position)object.position.set(...position);parent.add(object);return object;
}
function createChunkGroup(chunk){
  const group=new THREE.Group();group.name=chunk.id;
  const size=chunk.chunkSize,baseX=chunk.x*size,baseZ=chunk.z*size;
  const floor=mesh(new THREE.PlaneGeometry(size,size),groundMat,group,[baseX+size/2,-.02,baseZ+size/2]);
  floor.rotation.x=-Math.PI/2;floor.receiveShadow=profile.shadows;
  for(let i=1;i<profile.grid;i++){
    mesh(new THREE.BoxGeometry(4,.08,size),roadMat,group,[baseX+i*size/profile.grid,.02,baseZ+size/2]);
    mesh(new THREE.BoxGeometry(size,.08,4),roadMat,group,[baseX+size/2,.02,baseZ+i*size/profile.grid]);
  }
  for(const building of chunk.buildings){
    if(intersectsTransitPlaza(building))continue;
    const b=building,accent=palette[b.accentIndex%palette.length],g=new THREE.Group();
    g.position.set(b.position.x,0,b.position.z);g.userData={kind:b.kind,buildingId:b.id};
    const body=mesh(new THREE.BoxGeometry(b.size.width,b.size.height,b.size.depth),new THREE.MeshStandardMaterial({color:0x111c2a,metalness:.48,roughness:.32}),g,[0,b.size.height/2,0]);
    body.castShadow=profile.shadows;body.receiveShadow=profile.shadows;
    mesh(new THREE.BoxGeometry(b.size.width*.72,.28,b.size.depth*.72),new THREE.MeshBasicMaterial({color:accent,transparent:true,opacity:.72}),g,[0,b.size.height+.18,0]);
    const bands=Math.min(profile.id==='LITE'?2:5,Math.max(1,Math.floor(b.size.height/9)));
    for(let i=1;i<=bands;i++)mesh(new THREE.BoxGeometry(b.size.width+.04,.08,b.size.depth+.04),new THREE.MeshBasicMaterial({color:accent,transparent:true,opacity:.18+.08*b.detail}),g,[0,i*b.size.height/(bands+1),0]);
    group.add(g);
  }
  scene.add(group);chunkGroups.set(chunk.id,group);
}
function disposeGroup(group,{keepShared=true}={}){
  const geometries=new Set(),materials=new Set(),textures=new Set();
  group.traverse(object=>{
    if(object.geometry)geometries.add(object.geometry);
    for(const material of Array.isArray(object.material)?object.material:[object.material]){
      if(!material||(keepShared&&sharedMaterials.has(material)))continue;
      materials.add(material);if(material.map)textures.add(material.map);
    }
  });
  for(const item of [...textures,...materials,...geometries])item.dispose?.();
}
function removeChunk(id){const group=chunkGroups.get(id);if(!group)return;disposeGroup(group);scene.remove(group);chunkGroups.delete(id);}

const portalTargets=[],storeTargets=[],cityDestinations=new Map();
const plaza=new THREE.Group();plaza.name=`central-plaza:${cityId}`;scene.add(plaza);
const plazaFloor=mesh(new THREE.CircleGeometry(145,64),groundMat,plaza,[0,-.04,0]);plazaFloor.rotation.x=-Math.PI/2;
for(const [r,w,c,o] of [[24,1.7,cityIdentity.palette.accent,.65],[40,1.1,cityIdentity.palette.secondary,.3],[55,1.3,cityIdentity.palette.accent,.4],[72,1.1,cityIdentity.palette.secondary,.25]]){
  const ring=mesh(new THREE.RingGeometry(r-w,r,64),new THREE.MeshBasicMaterial({color:c,transparent:true,opacity:o,side:THREE.DoubleSide}),plaza,[0,.06,0]);ring.rotation.x=-Math.PI/2;
}
mesh(new THREE.CylinderGeometry(9,12,4,40),new THREE.MeshStandardMaterial({color:0x121d31,metalness:.72,roughness:.22}),plaza,[0,2,0]);
const neuralCore=mesh(new THREE.IcosahedronGeometry(7,2),new THREE.MeshPhysicalMaterial({color:cityIdentity.palette.accent,emissive:cityIdentity.palette.accent,emissiveIntensity:isActiveCity?1.25:.72,metalness:.2,roughness:.16}),plaza,[0,15,0]);
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
let cityEnvironmentMount=null;
mountSpatialCityEnvironment({scene,cityId,identity:cityIdentity,profileId:profile.id,shadows:profile.shadows}).then(result=>{if(disposed){result.dispose();return;}cityEnvironmentMount=result;}).catch(()=>{cityEnvironmentMount=null;});
function portalFrame(portal,accent,{city=false,enabled=true}={}){
  const width=city?10:8.2,height=city?10:7;
  const frame=new THREE.MeshStandardMaterial({color:0x19263a,metalness:.72,roughness:.22});
  for(const x of [-width/2,width/2])mesh(new THREE.BoxGeometry(.8,height,.8),frame,portal,[x,height/2,0]);
  mesh(new THREE.BoxGeometry(width+.8,.8,.8),frame,portal,[0,height,0]);
  mesh(new THREE.PlaneGeometry(width-1.2,height-1.4),new THREE.MeshBasicMaterial({color:accent,transparent:true,opacity:enabled?.55:.2,side:THREE.DoubleSide}),portal,[0,height/2,0]);
}
const districtIds=['commerce','social','creator','food','education','entertainment','business','services'];
for(let i=0;i<districtIds.length;i++){
  const id=districtIds[i],experience=districtExperience(id);if(!experience)continue;
  const a=i*Math.PI/4,portal=new THREE.Group();portal.position.set(Math.cos(a)*68,0,Math.sin(a)*68);portal.rotation.y=-a+Math.PI/2;
  portal.userData={portal:true,portalKind:'district',label:experience.label,id,path:`/v/br/go/${cityId}/${id}`,href:experience.href,description:isActiveCity?experience.description:`${experience.label} de ${cityContext.name} em preview procedural.`,enabled:isActiveCity};
  portalFrame(portal,palette[i],{enabled:isActiveCity});plaza.add(portal);portalTargets.push(portal);
}
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
  const body=mesh(new THREE.BoxGeometry(entity.size.width,entity.size.height,entity.size.depth),new THREE.MeshStandardMaterial({color:0x17304a,metalness:.55,roughness:.26,emissive:accent,emissiveIntensity:.04}),g,[0,entity.size.height/2,0]);body.castShadow=profile.shadows;body.receiveShadow=profile.shadows;
  mesh(new THREE.BoxGeometry(entity.size.width*.82,.42,entity.size.depth*.82),new THREE.MeshBasicMaterial({color:accent,transparent:true,opacity:.95}),g,[0,entity.size.height+.25,0]);
  mesh(new THREE.CylinderGeometry(.08,.08,5,6),new THREE.MeshBasicMaterial({color:accent,transparent:true,opacity:.55}),g,[0,entity.size.height+2.8,0]);
  liveStoreGroup.add(g);storeTargets.push(g);
}
async function loadLiveStores(){
  if(!isActiveCity){worldStat.textContent=`${cityContext.name} · PREVIEW PROCEDURAL`;return;}
  try{
    const entities=await fetchSpatialStores({limit:profile.id==='LITE'?20:48});if(disposed)return;
    for(const entity of entities)addLiveStore(entity);worldStat.textContent=`${cityContext.name} · ${entities.length} lojas vivas`;
  }catch{worldStat.textContent=`${cityContext.name} · lojas em modo offline`;}
}

const position=new THREE.Vector3(0,1.7,112),velocity=new THREE.Vector3(),keys=new Set();
let yaw=Math.PI,pitch=-.08,speed=24,dragging=false,lastX=0,lastY=0,pointerStartX=0,pointerStartY=0,activePortal=null;
let chunkSource=cityApiOnline?'api':'fallback',disposed=false,navigating=false,raf=0;
function restoreSpatialContext(){
  if(new URLSearchParams(location.search).get('return')!=='1')return;
  const state=loadCityCheckpoint(cityId);if(!state||state.worldKey!==worldKey)return;
  position.set(state.position.x,state.position.y,state.position.z);yaw=state.yaw;pitch=state.pitch;
  try{const url=new URL(location.href);url.searchParams.delete('return');history.replaceState({},'',url.pathname+url.search);}catch{}
}
restoreSpatialContext();
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
    chunkStat.textContent=`chunk ${state.center.x},${state.center.z} · ${state.loaded.length} ativos · ${chunkSource==='api'?'API':'fallback'}`;
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
  let node=raycaster.intersectObjects([...storeTargets,...portalTargets],true)[0]?.object||null;
  while(node&&!node.userData?.store&&!node.userData?.portal)node=node.parent;return node;
}
renderer.domElement.addEventListener('pointerdown',event=>{
  dragging=true;lastX=pointerStartX=event.clientX;lastY=pointerStartY=event.clientY;renderer.domElement.setPointerCapture(event.pointerId);
});
renderer.domElement.addEventListener('pointerup',event=>{
  const click=dragging&&Math.hypot(event.clientX-pointerStartX,event.clientY-pointerStartY)<6;dragging=false;
  if(!click)return;
  const target=targetAtPointer(event);if(!target)return;
  if(target.userData.portal){activePortal=target;enterActivePortal();return;}
  const reference=String(target.userData.reference||'');
  saveSpatialContext({spatialPath:`/v/br/go/${cityId}/commerce/${encodeURIComponent(reference)}`,districtId:'commerce',targetType:'store',targetId:reference});
  spatialEvent('entity_open','store');safeNavigate(target.userData.interiorHref||target.userData.href);
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
function animate(now){
  if(disposed)return;raf=requestAnimationFrame(animate);
  const dt=Math.min(.05,(now-last)/1000);last=now;if(document.hidden)return;
  frames++;if(now-fpsClock>=1000){fpsStat.textContent=`perfil ${profile.id} · ${Math.round(frames*1000/(now-fpsClock))} FPS`;frames=0;fpsClock=now;}
  const basis=spatialMovementBasis(yaw);forwardVector.set(basis.forward.x,0,basis.forward.z);rightVector.set(basis.right.x,0,basis.right.z);velocity.set(0,0,0);
  if(keys.has('KeyW')||keys.has('ArrowUp'))velocity.add(forwardVector);if(keys.has('KeyS')||keys.has('ArrowDown'))velocity.sub(forwardVector);
  if(keys.has('KeyD')||keys.has('ArrowRight'))velocity.add(rightVector);if(keys.has('KeyA')||keys.has('ArrowLeft'))velocity.sub(rightVector);
  if(velocity.lengthSq())position.add(velocity.normalize().multiplyScalar(speed*dt));
  position.x=Math.max(-100000,Math.min(100000,position.x));position.z=Math.max(-100000,Math.min(100000,position.z));
  lookTarget.set(basis.forward.x*Math.cos(pitch),Math.sin(pitch),basis.forward.z*Math.cos(pitch)).add(position);
  camera.position.copy(position);camera.lookAt(lookTarget);neuralCore.rotation.y+=dt*.45;cityLandmark.rotation.y+=dt*.12;
  updatePortal();syncChunks();renderer.render(scene,camera);
  if(firstFrame){firstFrame=false;$('loading').classList.add('hide');}
}
raf=requestAnimationFrame(animate);
loadCityConnections().catch(()=>{$('travelStatus').textContent='Conexões indisponíveis. Use o World Gate.';});
loadLiveStores();
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
addEventListener('pagehide',event=>{
  if(!navigating)saveSpatialContext();releaseControls();
  if(event.persisted)return;
  disposed=true;cancelAnimationFrame(raf);cityEnvironmentMount=null;disposeGroup(scene,{keepShared:false});renderer.dispose();
});
addEventListener('pageshow',()=>{navigating=false;last=performance.now();fpsClock=last;frames=0;});