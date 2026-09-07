import * as THREE from '/vendor/three/three.module.js';

const districts=[
  ['Commerce District',0],['Social District',45],['Creator District',90],['Food Avenue',135],
  ['Education District',180],['Entertainment District',225],['Business District',270],['Services District',315]
];

function profile(){
  const memory=Number(navigator.deviceMemory||0),cores=Number(navigator.hardwareConcurrency||2),mobile=matchMedia('(max-width: 700px)').matches;
  let score=(memory>=8?3:memory>=4?2:memory>=2?1:0)+(cores>=8?3:cores>=4?2:1)+(mobile?-1:1);
  const id=score>=6?'ULTRA':score>=3?'STANDARD':'LITE';
  return {id,pixelRatio:id==='ULTRA'?Math.min(devicePixelRatio,1.75):id==='STANDARD'?Math.min(devicePixelRatio,1.25):1,skyline:id==='ULTRA'?70:id==='STANDARD'?42:24,shadows:id!=='LITE'};
}

const renderProfile=profile();
document.getElementById('status').textContent=`PERFIL · ${renderProfile.id}`;

const scene=new THREE.Scene();
scene.fog=new THREE.FogExp2(0x07101d,0.0048);
scene.background=new THREE.Color(0x030713);

const camera=new THREE.PerspectiveCamera(48,innerWidth/innerHeight,.1,1200);
let yaw=.72,pitch=.56,distance=185,target=new THREE.Vector3(0,12,0);

const renderer=new THREE.WebGLRenderer({antialias:renderProfile.id!=='LITE',powerPreference:'high-performance'});
renderer.setPixelRatio(renderProfile.pixelRatio);renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.18;
renderer.shadowMap.enabled=renderProfile.shadows;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const hemi=new THREE.HemisphereLight(0xbfeeff,0x06101b,1.35);scene.add(hemi);
const sun=new THREE.DirectionalLight(0xffffff,2.2);sun.position.set(90,140,70);sun.castShadow=renderProfile.shadows;sun.shadow.mapSize.set(1024,1024);scene.add(sun);

const ground=new THREE.Mesh(new THREE.CircleGeometry(260,96),new THREE.MeshStandardMaterial({color:0x0b1720,roughness:.78,metalness:.18}));
ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;scene.add(ground);

function ring(radius,width,color,opacity=.9){
  const mesh=new THREE.Mesh(new THREE.RingGeometry(radius-width,radius,96),new THREE.MeshBasicMaterial({color,transparent:true,opacity,side:THREE.DoubleSide}));
  mesh.rotation.x=-Math.PI/2;mesh.position.y=.025;scene.add(mesh);return mesh;
}
ring(24,1.8,0x6de8ff,.68);ring(39,1.1,0x5f7dff,.34);ring(54,1.4,0xb275ff,.42);ring(72,1.4,0x6de8ff,.28);

const water=new THREE.Mesh(new THREE.RingGeometry(15,22,96),new THREE.MeshPhysicalMaterial({color:0x0878a4,roughness:.12,metalness:.1,transmission:.18,transparent:true,opacity:.78}));
water.rotation.x=-Math.PI/2;water.position.y=.08;scene.add(water);

const coreGroup=new THREE.Group();scene.add(coreGroup);
const coreBase=new THREE.Mesh(new THREE.CylinderGeometry(9,12,4,48),new THREE.MeshStandardMaterial({color:0x111a31,metalness:.75,roughness:.22}));coreBase.position.y=2;coreBase.castShadow=true;coreGroup.add(coreBase);
const core=new THREE.Mesh(new THREE.IcosahedronGeometry(7.2,2),new THREE.MeshPhysicalMaterial({color:0x74eaff,emissive:0x1b6d91,emissiveIntensity:2.2,metalness:.24,roughness:.14,transmission:.12}));core.position.y=15;core.castShadow=true;coreGroup.add(core);
const halo=new THREE.Mesh(new THREE.TorusGeometry(11,.16,10,96),new THREE.MeshBasicMaterial({color:0xb18cff,transparent:true,opacity:.85}));halo.position.y=15;halo.rotation.x=Math.PI/2.7;coreGroup.add(halo);
const halo2=halo.clone();halo2.material=halo.material.clone();halo2.material.color.set(0x62e8ff);halo2.rotation.set(.25,.65,0);coreGroup.add(halo2);

function building(x,z,w,d,h,accent){
  const group=new THREE.Group();group.position.set(x,0,z);
  const body=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshStandardMaterial({color:0x101a29,metalness:.62,roughness:.26}));body.position.y=h/2;body.castShadow=true;body.receiveShadow=true;group.add(body);
  const crown=new THREE.Mesh(new THREE.BoxGeometry(w*.78,.45,d*.78),new THREE.MeshBasicMaterial({color:accent,transparent:true,opacity:.72}));crown.position.y=h+.2;group.add(crown);
  const strips=Math.max(2,Math.floor(h/7));
  for(let i=1;i<strips;i++){
    const band=new THREE.Mesh(new THREE.BoxGeometry(w+0.05,.12,d+0.05),new THREE.MeshBasicMaterial({color:accent,transparent:true,opacity:.22}));band.position.y=i*h/strips;group.add(band);
  }
  scene.add(group);return group;
}

const accentPalette=[0x64e8ff,0x8c8cff,0xff8cd7,0xffb96a,0x8ff0b1,0x72a4ff,0xbf8cff,0x6be3d1];
const districtObjects=[];
for(let i=0;i<districts.length;i++){
  const angle=districts[i][1]*Math.PI/180,r=92,x=Math.cos(angle)*r,z=Math.sin(angle)*r,accent=accentPalette[i];
  const g=building(x,z,22+(i%3)*4,18+(i%2)*5,24+(i%4)*8,accent);g.userData={district:districts[i][0]};districtObjects.push(g);
  const portal=new THREE.Group();portal.position.set(Math.cos(angle)*68,0,Math.sin(angle)*68);portal.rotation.y=-angle+Math.PI/2;
  const postMat=new THREE.MeshStandardMaterial({color:0x172237,metalness:.72,roughness:.2});
  const glowMat=new THREE.MeshBasicMaterial({color:accent,transparent:true,opacity:.85});
  for(const sx of [-3.7,3.7]){const p=new THREE.Mesh(new THREE.BoxGeometry(.8,7,.8),postMat);p.position.set(sx,3.5,0);portal.add(p);}
  const top=new THREE.Mesh(new THREE.BoxGeometry(8.2,.8,.8),postMat);top.position.y=7;portal.add(top);
  const glow=new THREE.Mesh(new THREE.PlaneGeometry(6.3,5.7),glowMat);glow.position.y=3.8;portal.add(glow);scene.add(portal);
}

for(let i=0;i<renderProfile.skyline;i++){
  const angle=(i/renderProfile.skyline)*Math.PI*2+(i%5)*.021,r=132+(i%7)*10,x=Math.cos(angle)*r,z=Math.sin(angle)*r;
  const h=12+((i*17)%36),w=9+((i*7)%11),d=9+((i*5)%10),accent=accentPalette[i%accentPalette.length];building(x,z,w,d,h,accent);
}

for(let i=0;i<40;i++){
  const a=(i/40)*Math.PI*2,r=34+(i%3)*2,x=Math.cos(a)*r,z=Math.sin(a)*r;
  const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.22,.34,2.4,6),new THREE.MeshStandardMaterial({color:0x4b3526,roughness:.9}));trunk.position.set(x,1.2,z);scene.add(trunk);
  const crown=new THREE.Mesh(new THREE.SphereGeometry(1.3,8,6),new THREE.MeshStandardMaterial({color:0x2e8a5c,roughness:.85}));crown.position.set(x,3.1,z);scene.add(crown);
}

const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
renderer.domElement.addEventListener('pointermove',event=>{
  pointer.x=event.clientX/innerWidth*2-1;pointer.y=-(event.clientY/innerHeight)*2+1;raycaster.setFromCamera(pointer,camera);
  const hits=raycaster.intersectObjects(districtObjects,true);const root=hits[0]?.object?.parent;
  const name=root?.userData?.district;document.getElementById('districtName').textContent=name||'Vitriny Neural Core';document.getElementById('districtHint').textContent=name?'Portal espacial · distrito interligado':'Núcleo central · portais para oito distritos';
});

let dragging=false,lastX=0,lastY=0;
renderer.domElement.addEventListener('pointerdown',e=>{dragging=true;lastX=e.clientX;lastY=e.clientY;renderer.domElement.setPointerCapture(e.pointerId);});
renderer.domElement.addEventListener('pointerup',()=>dragging=false);
renderer.domElement.addEventListener('pointermove',e=>{if(!dragging)return;yaw-=(e.clientX-lastX)*.005;pitch=Math.max(.18,Math.min(1.15,pitch+(e.clientY-lastY)*.004));lastX=e.clientX;lastY=e.clientY;});
renderer.domElement.addEventListener('wheel',e=>{distance=Math.max(72,Math.min(310,distance+e.deltaY*.12));},{passive:true});

function updateCamera(){camera.position.set(target.x+Math.cos(yaw)*Math.cos(pitch)*distance,target.y+Math.sin(pitch)*distance,target.z+Math.sin(yaw)*Math.cos(pitch)*distance);camera.lookAt(target);}
let last=performance.now();
function animate(now){requestAnimationFrame(animate);const dt=Math.min(.05,(now-last)/1000);last=now;core.rotation.y+=dt*.45;halo.rotation.z+=dt*.22;halo2.rotation.y-=dt*.18;updateCamera();renderer.render(scene,camera);}
requestAnimationFrame(animate);
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setPixelRatio(renderProfile.pixelRatio);renderer.setSize(innerWidth,innerHeight);});
setTimeout(()=>document.getElementById('loading').classList.add('hide'),250);
