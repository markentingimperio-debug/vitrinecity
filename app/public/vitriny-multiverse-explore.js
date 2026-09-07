import * as THREE from '/vendor/three/three.module.js';
import {createSpatialClientRuntime} from '/vitriny-spatial-client-core.js';

const palette=[0x6ee7ff,0x8f8cff,0xe48cff,0xffb36b,0x85e6a8,0x6f9cff,0xb58cff,0x6edbcf];
const worldKey='br:go:vitrine-city';
const profile=(()=>{const memory=Number(navigator.deviceMemory||0),cores=Number(navigator.hardwareConcurrency||2),mobile=matchMedia('(max-width:760px)').matches;let score=(memory>=8?3:memory>=4?2:memory>=2?1:0)+(cores>=8?3:cores>=4?2:1)+(mobile?-1:1);const id=score>=6?'ULTRA':score>=3?'STANDARD':'LITE';return{id,radius:id==='ULTRA'?2:1,pixel:id==='ULTRA'?Math.min(devicePixelRatio,1.6):id==='STANDARD'?Math.min(devicePixelRatio,1.25):1,shadows:id!=='LITE',grid:id==='LITE'?2:3};})();

const scene=new THREE.Scene();scene.background=new THREE.Color(0x02050c);scene.fog=new THREE.FogExp2(0x07101c,0.0026);
const camera=new THREE.PerspectiveCamera(58,innerWidth/innerHeight,.1,1800);
const renderer=new THREE.WebGLRenderer({antialias:profile.id!=='LITE',powerPreference:'high-performance'});renderer.setPixelRatio(profile.pixel);renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;renderer.shadowMap.enabled=profile.shadows;document.body.prepend(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xc9f3ff,0x061018,1.25));const sun=new THREE.DirectionalLight(0xffffff,1.9);sun.position.set(120,180,90);sun.castShadow=profile.shadows;scene.add(sun);

const groundMat=new THREE.MeshStandardMaterial({color:0x09131c,roughness:.86,metalness:.08});
const roadMat=new THREE.MeshStandardMaterial({color:0x101a24,roughness:.72,metalness:.12});
const chunkGroups=new Map();
function createChunkGroup(chunk){
  const group=new THREE.Group();group.name=chunk.id;
  const size=chunk.chunkSize,baseX=chunk.x*size,baseZ=chunk.z*size;
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(size,size),groundMat);floor.rotation.x=-Math.PI/2;floor.position.set(baseX+size/2,-.02,baseZ+size/2);floor.receiveShadow=true;group.add(floor);
  for(let i=1;i<profile.grid;i++){
    const x=baseX+i*(size/profile.grid);const z=baseZ+i*(size/profile.grid);
    const rv=new THREE.Mesh(new THREE.BoxGeometry(4,.08,size),roadMat);rv.position.set(x,.02,baseZ+size/2);group.add(rv);
    const rh=new THREE.Mesh(new THREE.BoxGeometry(size,.08,4),roadMat);rh.position.set(baseX+size/2,.02,z);group.add(rh);
  }
  for(const b of chunk.buildings){
    const accent=palette[b.accentIndex%palette.length],g=new THREE.Group();g.position.set(b.position.x,0,b.position.z);g.userData={kind:b.kind,buildingId:b.id};
    const body=new THREE.Mesh(new THREE.BoxGeometry(b.size.width,b.size.height,b.size.depth),new THREE.MeshStandardMaterial({color:0x111c2a,metalness:.48,roughness:.32}));body.position.y=b.size.height/2;body.castShadow=profile.shadows;body.receiveShadow=true;g.add(body);
    const crown=new THREE.Mesh(new THREE.BoxGeometry(b.size.width*.72,.28,b.size.depth*.72),new THREE.MeshBasicMaterial({color:accent,transparent:true,opacity:.72}));crown.position.y=b.size.height+.18;g.add(crown);
    const bands=Math.min(profile.id==='LITE'?2:5,Math.max(1,Math.floor(b.size.height/9)));for(let i=1;i<=bands;i++){const band=new THREE.Mesh(new THREE.BoxGeometry(b.size.width+.04,.08,b.size.depth+.04),new THREE.MeshBasicMaterial({color:accent,transparent:true,opacity:.18+.08*b.detail}));band.position.y=i*b.size.height/(bands+1);g.add(band);}
    group.add(g);
  }
  scene.add(group);chunkGroups.set(chunk.id,group);return group;
}
function removeChunk(id){const group=chunkGroups.get(id);if(!group)return;group.traverse(obj=>{obj.geometry?.dispose?.();if(obj.material){const mats=Array.isArray(obj.material)?obj.material:[obj.material];for(const m of mats)m.dispose?.();}});scene.remove(group);chunkGroups.delete(id);}

const districts=[['Commerce District',0,'commerce'],['Social District',45,'social'],['Creator District',90,'creator'],['Food Avenue',135,'food'],['Education District',180,'education'],['Entertainment District',225,'entertainment'],['Business District',270,'business'],['Services District',315,'services']];
const portalTargets=[];
function addCentralPlaza(){
  const plaza=new THREE.Group();plaza.name='central-plaza';
  for(const [r,w,c,o] of [[24,1.7,0x6ee7ff,.65],[40,1.1,0x6f85ff,.3],[55,1.3,0xb58cff,.4],[72,1.1,0x6ee7ff,.25]]){const mesh=new THREE.Mesh(new THREE.RingGeometry(r-w,r,96),new THREE.MeshBasicMaterial({color:c,transparent:true,opacity:o,side:THREE.DoubleSide}));mesh.rotation.x=-Math.PI/2;mesh.position.y=.06;plaza.add(mesh);}
  const coreBase=new THREE.Mesh(new THREE.CylinderGeometry(9,12,4,40),new THREE.MeshStandardMaterial({color:0x121d31,metalness:.72,roughness:.22}));coreBase.position.y=2;plaza.add(coreBase);
  const core=new THREE.Mesh(new THREE.IcosahedronGeometry(7,2),new THREE.MeshPhysicalMaterial({color:0x74eaff,emissive:0x185f80,emissiveIntensity:2,metalness:.2,roughness:.16}));core.position.y=15;core.userData.animate='core';plaza.add(core);
  for(let i=0;i<districts.length;i++){
    const [label,deg,id]=districts[i],a=deg*Math.PI/180,r=68,x=Math.cos(a)*r,z=Math.sin(a)*r,accent=palette[i];
    const portal=new THREE.Group();portal.position.set(x,0,z);portal.rotation.y=-a+Math.PI/2;portal.userData={portal:true,label,id,path:`/v/br/go/vitrine-city/${id}`};
    const frameMat=new THREE.MeshStandardMaterial({color:0x19263a,metalness:.72,roughness:.22});const glowMat=new THREE.MeshBasicMaterial({color:accent,transparent:true,opacity:.75});
    for(const px of [-3.7,3.7]){const p=new THREE.Mesh(new THREE.BoxGeometry(.8,7,.8),frameMat);p.position.set(px,3.5,0);portal.add(p);}const top=new THREE.Mesh(new THREE.BoxGeometry(8.2,.8,.8),frameMat);top.position.y=7;portal.add(top);const glow=new THREE.Mesh(new THREE.PlaneGeometry(6.2,5.6),glowMat);glow.position.y=3.8;portal.add(glow);plaza.add(portal);portalTargets.push(portal);
  }
  scene.add(plaza);
}
addCentralPlaza();

const position=new THREE.Vector3(0,1.7,112),velocity=new THREE.Vector3(),keys=new Set();let yaw=Math.PI,pitch=-.08,speed=24,dragging=false,lastX=0,lastY=0,activePortal=null;
const runtime=createSpatialClientRuntime({worldKey,chunkSize:128,radius:profile.radius,maxLoaded:profile.radius===2?25:9,loader:(id,opts)=>import('/vitriny-spatial-client-core.js').then(m=>m.generateSpatialChunk(id,{...opts,grid:profile.grid})),onUnload:(id)=>removeChunk(id)});
let updateBusy=false,lastChunkUpdate=0;
async function syncChunks(force=false){const now=performance.now();if(updateBusy||(!force&&now-lastChunkUpdate<350))return;updateBusy=true;lastChunkUpdate=now;try{const forward={x:-Math.sin(yaw),z:-Math.cos(yaw)},state=await runtime.update({x:position.x,z:position.z},forward);for(const chunk of state.resources)if(!chunkGroups.has(chunk.id))createChunkGroup(chunk);document.getElementById('chunkStat').textContent=`chunk ${state.center.x},${state.center.z} · ${state.loaded.length} ativos`;document.getElementById('fpsStat').textContent=`perfil ${profile.id} · raio ${profile.radius}`;}finally{updateBusy=false;}}
await syncChunks(true);

function setMove(name,on){const map={forward:'KeyW',back:'KeyS',left:'KeyA',right:'KeyD'};const code=map[name];if(on)keys.add(code);else keys.delete(code);}
addEventListener('keydown',e=>{keys.add(e.code);if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code))e.preventDefault();});addEventListener('keyup',e=>keys.delete(e.code));
for(const button of document.querySelectorAll('[data-move]')){const name=button.dataset.move;button.addEventListener('pointerdown',e=>{e.preventDefault();setMove(name,true);});for(const evt of ['pointerup','pointercancel','pointerleave'])button.addEventListener(evt,()=>setMove(name,false));}
renderer.domElement.addEventListener('pointerdown',e=>{dragging=true;lastX=e.clientX;lastY=e.clientY;renderer.domElement.setPointerCapture(e.pointerId);});renderer.domElement.addEventListener('pointerup',()=>dragging=false);renderer.domElement.addEventListener('pointermove',e=>{if(!dragging)return;yaw-=(e.clientX-lastX)*.0045;pitch=Math.max(-.55,Math.min(.45,pitch-(e.clientY-lastY)*.003));lastX=e.clientX;lastY=e.clientY;});renderer.domElement.addEventListener('wheel',e=>{speed=Math.max(8,Math.min(55,speed-e.deltaY*.02));},{passive:true});

document.getElementById('enterPortal').onclick=()=>{if(!activePortal)return;history.pushState({},'',activePortal.userData.path);document.getElementById('portalHint').textContent=`Destino ${activePortal.userData.path} · navegação espacial preparada`;};
function updatePortal(){let best=null,bestD=Infinity;for(const portal of portalTargets){const d=portal.position.distanceTo(position);if(d<12&&d<bestD){best=portal;bestD=d;}}activePortal=best;const box=document.getElementById('portal');if(best){box.classList.add('show');document.getElementById('portalName').textContent=best.userData.label;document.getElementById('portalHint').textContent='Portal interligado · pronto para transição';}else box.classList.remove('show');}

let frames=0,fpsClock=performance.now(),fps=0,last=performance.now();
function animate(now){requestAnimationFrame(animate);const dt=Math.min(.05,(now-last)/1000);last=now;frames++;if(now-fpsClock>=1000){fps=Math.round(frames*1000/(now-fpsClock));frames=0;fpsClock=now;document.getElementById('fpsStat').textContent=`perfil ${profile.id} · ${fps} FPS`;}
  const forward=new THREE.Vector3(-Math.sin(yaw),0,-Math.cos(yaw)),right=new THREE.Vector3(Math.cos(yaw),0,-Math.sin(yaw));velocity.set(0,0,0);if(keys.has('KeyW')||keys.has('ArrowUp'))velocity.add(forward);if(keys.has('KeyS')||keys.has('ArrowDown'))velocity.sub(forward);if(keys.has('KeyD')||keys.has('ArrowRight'))velocity.add(right);if(keys.has('KeyA')||keys.has('ArrowLeft'))velocity.sub(right);if(velocity.lengthSq())velocity.normalize().multiplyScalar(speed*dt);position.add(velocity);
  const look=new THREE.Vector3(Math.sin(-yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(-yaw)*Math.cos(pitch));camera.position.copy(position);camera.lookAt(position.clone().add(look));
  scene.traverse(obj=>{if(obj.userData?.animate==='core')obj.rotation.y+=dt*.45;});updatePortal();syncChunks();renderer.render(scene,camera);
}
requestAnimationFrame(animate);addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setPixelRatio(profile.pixel);renderer.setSize(innerWidth,innerHeight);});setTimeout(()=>document.getElementById('loading').classList.add('hide'),300);
