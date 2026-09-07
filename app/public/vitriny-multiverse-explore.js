import * as THREE from '/vendor/three/three.module.js';
import {createSpatialClientRuntime} from '/vitriny-spatial-client-core.js';
import {createSpatialApiChunkLoader,fetchSpatialCityContext,spatialCityFromLocation,spatialFallbackCity} from '/vitriny-spatial-api-client.js';
import {districtExperience} from '/vitriny-district-integrations.js';
import {fetchSpatialStores} from '/vitriny-spatial-store-registry.js';
import {SPATIAL_RETURN_KEY,createSpatialReturnState,isSafeInternalHref,parseSpatialReturnState} from '/vitriny-spatial-session.js';

const palette=[0x6ee7ff,0x8f8cff,0xe48cff,0xffb36b,0x85e6a8,0x6f9cff,0xb58cff,0x6edbcf];
const requestedCityId=spatialCityFromLocation();
let cityContext=spatialFallbackCity(requestedCityId),cityApiOnline=false;
try{cityContext=await fetchSpatialCityContext({cityId:requestedCityId});cityApiOnline=true;}catch{if(cityContext.id!==requestedCityId)cityContext=spatialFallbackCity('vitrine-city');}
const cityId=cityContext.id,worldKey=cityContext.worldKey,isActiveCity=cityContext.status==='active';
const profile=(()=>{const memory=Number(navigator.deviceMemory||0),cores=Number(navigator.hardwareConcurrency||2),mobile=matchMedia('(max-width:760px)').matches;let score=(memory>=8?3:memory>=4?2:memory>=2?1:0)+(cores>=8?3:cores>=4?2:1)+(mobile?-1:1);const id=score>=6?'ULTRA':score>=3?'STANDARD':'LITE';return{id,radius:id==='ULTRA'?2:1,pixel:id==='ULTRA'?Math.min(devicePixelRatio,1.6):id==='STANDARD'?Math.min(devicePixelRatio,1.25):1,shadows:id!=='LITE',grid:id==='LITE'?2:3};})();

const cityTitle=document.getElementById('cityTitle'),worldStat=document.getElementById('worldStat'),chunkStat=document.getElementById('chunkStat'),fpsStat=document.getElementById('fpsStat');
if(cityTitle)cityTitle.textContent=`${cityContext.name} Spatial`;
document.title=`Vitriny Multiverse · ${cityContext.name}`;
worldStat.textContent=`${cityContext.name} · ${cityContext.status==='active'?'ATIVA':'PREVIEW'}`;

const scene=new THREE.Scene();scene.background=new THREE.Color(cityId==='goiania'?0x030711:cityId==='silvania'?0x04100d:cityId==='anapolis'?0x07101a:0x02050c);scene.fog=new THREE.FogExp2(scene.background,0.0026);
const camera=new THREE.PerspectiveCamera(58,innerWidth/innerHeight,.1,1800);
const renderer=new THREE.WebGLRenderer({antialias:profile.id!=='LITE',powerPreference:'high-performance'});renderer.setPixelRatio(profile.pixel);renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;renderer.shadowMap.enabled=profile.shadows;document.body.prepend(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xc9f3ff,0x061018,1.25));const sun=new THREE.DirectionalLight(0xffffff,1.9);sun.position.set(120,180,90);sun.castShadow=profile.shadows;scene.add(sun);

const groundMat=new THREE.MeshStandardMaterial({color:0x09131c,roughness:.86,metalness:.08});
const roadMat=new THREE.MeshStandardMaterial({color:0x101a24,roughness:.72,metalness:.12});
const chunkGroups=new Map();
function createChunkGroup(chunk){
  const group=new THREE.Group();group.name=chunk.id;
  const size=chunk.chunkSize,baseX=chunk.x*size,baseZ=chunk.z*size;
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(size,size),groundMat);floor.rotation.x=-Math.PI/2;floor.position.set(baseX+size/2,-.02,baseZ+size/2);floor.receiveShadow=profile.shadows;group.add(floor);
  for(let i=1;i<profile.grid;i++){
    const x=baseX+i*(size/profile.grid),z=baseZ+i*(size/profile.grid);
    const rv=new THREE.Mesh(new THREE.BoxGeometry(4,.08,size),roadMat);rv.position.set(x,.02,baseZ+size/2);group.add(rv);
    const rh=new THREE.Mesh(new THREE.BoxGeometry(size,.08,4),roadMat);rh.position.set(baseX+size/2,.02,z);group.add(rh);
  }
  for(const b of chunk.buildings){
    const accent=palette[b.accentIndex%palette.length],g=new THREE.Group();g.position.set(b.position.x,0,b.position.z);g.userData={kind:b.kind,buildingId:b.id};
    const body=new THREE.Mesh(new THREE.BoxGeometry(b.size.width,b.size.height,b.size.depth),new THREE.MeshStandardMaterial({color:0x111c2a,metalness:.48,roughness:.32}));body.position.y=b.size.height/2;body.castShadow=profile.shadows;body.receiveShadow=profile.shadows;g.add(body);
    const crown=new THREE.Mesh(new THREE.BoxGeometry(b.size.width*.72,.28,b.size.depth*.72),new THREE.MeshBasicMaterial({color:accent,transparent:true,opacity:.72}));crown.position.y=b.size.height+.18;g.add(crown);
    const bands=Math.min(profile.id==='LITE'?2:5,Math.max(1,Math.floor(b.size.height/9)));for(let i=1;i<=bands;i++){const band=new THREE.Mesh(new THREE.BoxGeometry(b.size.width+.04,.08,b.size.depth+.04),new THREE.MeshBasicMaterial({color:accent,transparent:true,opacity:.18+.08*b.detail}));band.position.y=i*b.size.height/(bands+1);g.add(band);}
    group.add(g);
  }
  scene.add(group);chunkGroups.set(chunk.id,group);return group;
}
function removeChunk(id){const group=chunkGroups.get(id);if(!group)return;group.traverse(obj=>{obj.geometry?.dispose?.();if(obj.material){for(const material of Array.isArray(obj.material)?obj.material:[obj.material]){material.map?.dispose?.();material.dispose?.();}}});scene.remove(group);chunkGroups.delete(id);}

const districtAngles=[['commerce',0],['social',45],['creator',90],['food',135],['education',180],['entertainment',225],['business',270],['services',315]];
const districts=districtAngles.map(([id,angle])=>{const experience=districtExperience(id);if(!experience)throw new Error(`Distrito sem integração: ${id}`);return[experience.label,angle,id,experience];});
const portalTargets=[];
function addCentralPlaza(){
  const plaza=new THREE.Group();plaza.name=`central-plaza:${cityId}`;
  for(const [r,w,c,o] of [[24,1.7,0x6ee7ff,.65],[40,1.1,0x6f85ff,.3],[55,1.3,0xb58cff,.4],[72,1.1,0x6ee7ff,.25]]){const mesh=new THREE.Mesh(new THREE.RingGeometry(r-w,r,96),new THREE.MeshBasicMaterial({color:c,transparent:true,opacity:o,side:THREE.DoubleSide}));mesh.rotation.x=-Math.PI/2;mesh.position.y=.06;plaza.add(mesh);}
  const coreBase=new THREE.Mesh(new THREE.CylinderGeometry(9,12,4,40),new THREE.MeshStandardMaterial({color:0x121d31,metalness:.72,roughness:.22}));coreBase.position.y=2;plaza.add(coreBase);
  const core=new THREE.Mesh(new THREE.IcosahedronGeometry(7,2),new THREE.MeshPhysicalMaterial({color:0x74eaff,emissive:0x185f80,emissiveIntensity:isActiveCity?2:1.15,metalness:.2,roughness:.16}));core.position.y=15;core.userData.animate='core';plaza.add(core);
  for(let i=0;i<districts.length;i++){
    const [label,deg,id,experience]=districts[i],a=deg*Math.PI/180,r=68,x=Math.cos(a)*r,z=Math.sin(a)*r,accent=palette[i],enabled=isActiveCity;
    const portal=new THREE.Group();portal.position.set(x,0,z);portal.rotation.y=-a+Math.PI/2;portal.userData={portal:true,label,id,path:`/v/br/go/${cityId}/${id}`,href:experience.href,description:enabled?experience.description:`${label} de ${cityContext.name} em preview procedural.`,enabled};
    const frameMat=new THREE.MeshStandardMaterial({color:0x19263a,metalness:.72,roughness:.22}),glowMat=new THREE.MeshBasicMaterial({color:accent,transparent:true,opacity:enabled?.75:.25});
    for(const px of [-3.7,3.7]){const p=new THREE.Mesh(new THREE.BoxGeometry(.8,7,.8),frameMat);p.position.set(px,3.5,0);portal.add(p);}const top=new THREE.Mesh(new THREE.BoxGeometry(8.2,.8,.8),frameMat);top.position.y=7;portal.add(top);const glow=new THREE.Mesh(new THREE.PlaneGeometry(6.2,5.6),glowMat);glow.position.y=3.8;portal.add(glow);plaza.add(portal);portalTargets.push(portal);
  }
  scene.add(plaza);
}
addCentralPlaza();

const liveStoreGroup=new THREE.Group(),storeTargets=[];liveStoreGroup.name='commerce-live-stores';scene.add(liveStoreGroup);
function addLiveStore(entity){
  const accent=palette[entity.accentIndex%palette.length],g=new THREE.Group();g.position.set(entity.position.x,0,entity.position.z);g.userData={store:true,href:entity.href,interiorHref:entity.interiorHref,label:entity.name,reference:entity.reference};
  const body=new THREE.Mesh(new THREE.BoxGeometry(entity.size.width,entity.size.height,entity.size.depth),new THREE.MeshStandardMaterial({color:0x17304a,metalness:.55,roughness:.26,emissive:accent,emissiveIntensity:.04}));body.position.y=entity.size.height/2;body.castShadow=profile.shadows;body.receiveShadow=profile.shadows;g.add(body);
  const crown=new THREE.Mesh(new THREE.BoxGeometry(entity.size.width*.82,.42,entity.size.depth*.82),new THREE.MeshBasicMaterial({color:accent,transparent:true,opacity:.95}));crown.position.y=entity.size.height+.25;g.add(crown);
  const beacon=new THREE.Mesh(new THREE.CylinderGeometry(.08,.08,5,6),new THREE.MeshBasicMaterial({color:accent,transparent:true,opacity:.55}));beacon.position.y=entity.size.height+2.8;g.add(beacon);
  liveStoreGroup.add(g);storeTargets.push(g);
}
async function loadLiveStores(){
  if(cityId!=='vitrine-city'||!isActiveCity){worldStat.textContent=`${cityContext.name} · PREVIEW PROCEDURAL`;return;}
  try{const entities=await fetchSpatialStores({limit:profile.id==='LITE'?20:48});for(const entity of entities)addLiveStore(entity);worldStat.textContent=`${cityContext.name} · ${entities.length} lojas vivas`;}
  catch{worldStat.textContent=`${cityContext.name} · lojas em modo offline`;}
}
loadLiveStores();

const position=new THREE.Vector3(0,1.7,112),velocity=new THREE.Vector3(),keys=new Set();let yaw=Math.PI,pitch=-.08,speed=24,dragging=false,lastX=0,lastY=0,pointerStartX=0,pointerStartY=0,activePortal=null,chunkSource=cityApiOnline?'api':'fallback';
function restoreSpatialContext(){
  if(new URLSearchParams(location.search).get('return')!=='1')return false;
  let state=null;try{state=parseSpatialReturnState(sessionStorage.getItem(SPATIAL_RETURN_KEY));}catch{}
  if(!state||state.worldKey!==worldKey)return false;
  position.set(state.position.x,state.position.y,state.position.z);yaw=state.yaw;pitch=state.pitch;
  try{const url=new URL(location.href);url.searchParams.delete('return');history.replaceState({},'',url.pathname+(url.searchParams.size?`?${url.searchParams.toString()}`:''));}catch{}
  worldStat.textContent=`${cityContext.name} · posição restaurada`;return true;
}
restoreSpatialContext();

const apiLoader=createSpatialApiChunkLoader({cityId,onSource:source=>{chunkSource=source;}});
const runtime=createSpatialClientRuntime({worldKey,chunkSize:cityContext.chunkSize||128,radius:profile.radius,maxLoaded:profile.radius===2?25:9,loader:apiLoader,onUnload:id=>removeChunk(id)});
let updateBusy=false,lastChunkUpdate=0;
async function syncChunks(force=false){const now=performance.now();if(updateBusy||(!force&&now-lastChunkUpdate<350))return;updateBusy=true;lastChunkUpdate=now;try{const forward={x:-Math.sin(yaw),z:-Math.cos(yaw)},state=await runtime.update({x:position.x,z:position.z},forward);for(const chunk of state.resources)if(!chunkGroups.has(chunk.id))createChunkGroup(chunk);chunkStat.textContent=`chunk ${state.center.x},${state.center.z} · ${state.loaded.length} ativos · ${chunkSource==='api'?'API':'fallback'}`;fpsStat.textContent=`perfil ${profile.id} · raio ${profile.radius}`;}finally{updateBusy=false;}}
await syncChunks(true);

function setMove(name,on){const map={forward:'KeyW',back:'KeyS',left:'KeyA',right:'KeyD'},code=map[name];if(on)keys.add(code);else keys.delete(code);}
function saveSpatialContext({spatialPath=cityContext.route||`/v/br/go/${cityId}`,districtId='',targetType='',targetId=''}={}){
  try{const state=createSpatialReturnState({worldKey,spatialPath,districtId,targetType,targetId,position:{x:Number(position.x.toFixed(3)),y:Number(position.y.toFixed(3)),z:Number(position.z.toFixed(3))},yaw:Number(yaw.toFixed(5)),pitch:Number(pitch.toFixed(5))});sessionStorage.setItem(SPATIAL_RETURN_KEY,JSON.stringify(state));return true;}catch{return false;}
}
function safeNavigate(href){if(!isSafeInternalHref(href))return false;location.assign(href);return true;}
function spatialEvent(event,targetType){try{dispatchEvent(new CustomEvent('vitriny:spatial-event',{detail:{event,targetType}}));}catch{}}
function enterActivePortal(){
  if(!activePortal)return false;
  if(!activePortal.userData.enabled){document.getElementById('portalHint').textContent=`${activePortal.userData.label} está em preview em ${cityContext.name}; a infraestrutura espacial já está carregada, mas os dados locais ainda não foram publicados.`;return false;}
  saveSpatialContext({spatialPath:activePortal.userData.path,districtId:activePortal.userData.id,targetType:'district',targetId:activePortal.userData.id});spatialEvent('portal_enter','portal');return safeNavigate(activePortal.userData.href);
}
addEventListener('keydown',e=>{keys.add(e.code);if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code))e.preventDefault();if(e.code==='KeyE'&&!e.repeat)enterActivePortal();});addEventListener('keyup',e=>keys.delete(e.code));
for(const button of document.querySelectorAll('[data-move]')){const name=button.dataset.move;button.addEventListener('pointerdown',e=>{e.preventDefault();setMove(name,true);});for(const evt of ['pointerup','pointercancel','pointerleave'])button.addEventListener(evt,()=>setMove(name,false));}

const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
function storeAtPointer(event){pointer.x=event.clientX/innerWidth*2-1;pointer.y=-(event.clientY/innerHeight)*2+1;raycaster.setFromCamera(pointer,camera);const hit=raycaster.intersectObjects(storeTargets,true)[0];let node=hit?.object||null;while(node&&!node.userData?.store)node=node.parent;return node?.userData?.store?node:null;}
renderer.domElement.addEventListener('pointerdown',e=>{dragging=true;lastX=e.clientX;lastY=e.clientY;pointerStartX=e.clientX;pointerStartY=e.clientY;renderer.domElement.setPointerCapture(e.pointerId);});
renderer.domElement.addEventListener('pointerup',e=>{const click=Math.hypot(e.clientX-pointerStartX,e.clientY-pointerStartY)<6;dragging=false;if(click){const store=storeAtPointer(e);if(store){const reference=String(store.userData.reference||'');saveSpatialContext({spatialPath:`/v/br/go/${cityId}/commerce/${encodeURIComponent(reference)}`,districtId:'commerce',targetType:'store',targetId:reference});spatialEvent('entity_open','store');safeNavigate(store.userData.interiorHref||store.userData.href);}}});
renderer.domElement.addEventListener('pointermove',e=>{if(!dragging){const store=storeAtPointer(e);renderer.domElement.style.cursor=store?'pointer':'grab';return;}yaw-=(e.clientX-lastX)*.0045;pitch=Math.max(-.55,Math.min(.45,pitch-(e.clientY-lastY)*.003));lastX=e.clientX;lastY=e.clientY;});renderer.domElement.addEventListener('wheel',e=>{speed=Math.max(8,Math.min(55,speed-e.deltaY*.02));},{passive:true});

document.getElementById('enterPortal').onclick=enterActivePortal;
function updatePortal(){let best=null,bestD=Infinity;for(const portal of portalTargets){const d=portal.position.distanceTo(position);if(d<12&&d<bestD){best=portal;bestD=d;}}activePortal=best;const box=document.getElementById('portal');if(best){box.classList.add('show');document.getElementById('portalName').textContent=best.userData.label;document.getElementById('portalHint').textContent=best.userData.enabled?`${best.userData.description} · E ou botão para abrir`:`${best.userData.description} · exploração local em preview`;}else box.classList.remove('show');}

let frames=0,fpsClock=performance.now(),fps=0,last=performance.now();
function animate(now){requestAnimationFrame(animate);const dt=Math.min(.05,(now-last)/1000);last=now;frames++;if(now-fpsClock>=1000){fps=Math.round(frames*1000/(now-fpsClock));frames=0;fpsClock=now;fpsStat.textContent=`perfil ${profile.id} · ${fps} FPS`;}
  const forward=new THREE.Vector3(-Math.sin(yaw),0,-Math.cos(yaw)),right=new THREE.Vector3(Math.cos(yaw),0,-Math.sin(yaw));velocity.set(0,0,0);if(keys.has('KeyW')||keys.has('ArrowUp'))velocity.add(forward);if(keys.has('KeyS')||keys.has('ArrowDown'))velocity.sub(forward);if(keys.has('KeyD')||keys.has('ArrowRight'))velocity.add(right);if(keys.has('KeyA')||keys.has('ArrowLeft'))velocity.sub(right);if(velocity.lengthSq())velocity.normalize().multiplyScalar(speed*dt);position.add(velocity);
  const look=new THREE.Vector3(Math.sin(-yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(-yaw)*Math.cos(pitch));camera.position.copy(position);camera.lookAt(position.clone().add(look));scene.traverse(obj=>{if(obj.userData?.animate==='core')obj.rotation.y+=dt*.45;});updatePortal();syncChunks();renderer.render(scene,camera);
}
requestAnimationFrame(animate);addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setPixelRatio(profile.pixel);renderer.setSize(innerWidth,innerHeight);});setTimeout(()=>document.getElementById('loading').classList.add('hide'),300);
