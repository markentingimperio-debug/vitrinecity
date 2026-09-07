import * as THREE from '/vendor/three/three.module.js';
import {spatialExplorerHref} from '/vitriny-spatial-api-client.js';

const palette=[0x6ee7ff,0x8f8cff,0xe48cff,0xffb36b];
const loading=document.getElementById('loading'),cityName=document.getElementById('cityName'),cityMeta=document.getElementById('cityMeta'),cityStatus=document.getElementById('cityStatus');
const profile=(()=>{const mobile=matchMedia('(max-width:760px)').matches,cores=Number(navigator.hardwareConcurrency||2),memory=Number(navigator.deviceMemory||0);const lite=mobile&&(cores<6||memory<4);return{pixel:lite?1:Math.min(devicePixelRatio,1.45),segments:lite?32:64};})();

const scene=new THREE.Scene();scene.background=new THREE.Color(0x02050c);scene.fog=new THREE.FogExp2(0x071020,.008);
const camera=new THREE.PerspectiveCamera(56,innerWidth/innerHeight,.1,500);camera.position.set(0,30,72);
const renderer=new THREE.WebGLRenderer({antialias:profile.pixel>1,powerPreference:'high-performance'});renderer.setPixelRatio(profile.pixel);renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;document.body.prepend(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xcaf5ff,0x05080f,1.4));const key=new THREE.DirectionalLight(0xffffff,1.7);key.position.set(30,55,24);scene.add(key);

const floor=new THREE.Mesh(new THREE.CircleGeometry(62,profile.segments),new THREE.MeshStandardMaterial({color:0x08131f,roughness:.78,metalness:.18}));floor.rotation.x=-Math.PI/2;scene.add(floor);
for(const r of [16,32,48]){const ring=new THREE.Mesh(new THREE.RingGeometry(r-.3,r,profile.segments),new THREE.MeshBasicMaterial({color:0x6ee7ff,transparent:true,opacity:.15,side:THREE.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.y=.03;scene.add(ring);}
const core=new THREE.Mesh(new THREE.IcosahedronGeometry(6,2),new THREE.MeshPhysicalMaterial({color:0x75eaff,emissive:0x145c7d,emissiveIntensity:1.5,roughness:.15,metalness:.25,clearcoat:.8}));core.position.y=10;scene.add(core);

function makeLabel(text,status,color){const canvas=document.createElement('canvas');canvas.width=512;canvas.height=180;const ctx=canvas.getContext('2d');ctx.fillStyle='#07111e';ctx.fillRect(0,0,512,180);ctx.strokeStyle=`#${color.toString(16).padStart(6,'0')}`;ctx.lineWidth=4;ctx.strokeRect(7,7,498,166);ctx.fillStyle='#f6fbff';ctx.font='900 34px system-ui';ctx.fillText(String(text).slice(0,24),25,72);ctx.fillStyle=status==='active'?'#7fffd4':'#9ab0c8';ctx.font='800 20px system-ui';ctx.fillText(status==='active'?'ATIVA · ENTRAR':'PREVIEW · EXPLORAR',25,125);const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;}
const targets=[];
function addPortal(city,index,total){const angle=index/total*Math.PI*2-Math.PI/2,r=38,x=Math.cos(angle)*r,z=Math.sin(angle)*r,color=palette[index%palette.length],group=new THREE.Group();group.position.set(x,0,z);group.rotation.y=-angle+Math.PI/2;group.userData={portal:true,city};
  const frameMat=new THREE.MeshStandardMaterial({color:0x16263a,metalness:.7,roughness:.24}),glowMat=new THREE.MeshBasicMaterial({color,transparent:true,opacity:city.status==='active'?.78:.42});
  for(const px of [-4.2,4.2]){const leg=new THREE.Mesh(new THREE.BoxGeometry(.9,8,.9),frameMat);leg.position.set(px,4,0);group.add(leg);}const top=new THREE.Mesh(new THREE.BoxGeometry(9.3,.9,.9),frameMat);top.position.y=8;group.add(top);const gate=new THREE.Mesh(new THREE.PlaneGeometry(7.2,6.2),glowMat);gate.position.y=4.3;group.add(gate);
  const texture=makeLabel(city.name,city.status,color),label=new THREE.Mesh(new THREE.PlaneGeometry(10,3.5),new THREE.MeshBasicMaterial({map:texture}));label.position.set(0,10.6,0);group.add(label);scene.add(group);targets.push(group);
}

let cities=[];
try{const response=await fetch('/api/spatial/v1/cities',{headers:{accept:'application/json'},cache:'no-store'});if(!response.ok)throw new Error('api');const data=await response.json();cities=Array.isArray(data.items)?data.items:[];cities.forEach((city,index)=>addPortal(city,index,cities.length));cityMeta.textContent=`${cities.length} cidades registradas na Spatial API v1`;loading.classList.add('hide');}catch{cityMeta.textContent='Spatial API temporariamente indisponível';cityStatus.textContent='MODO OFFLINE';setTimeout(()=>loading.classList.add('hide'),700);}

const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();let dragging=false,lastX=0,lastY=0,startX=0,startY=0,yaw=0,pitch=-.18;
function portalAt(event){pointer.x=event.clientX/innerWidth*2-1;pointer.y=-(event.clientY/innerHeight)*2+1;raycaster.setFromCamera(pointer,camera);const hit=raycaster.intersectObjects(targets,true)[0];let node=hit?.object||null;while(node&&!node.userData?.portal)node=node.parent;return node?.userData?.portal?node:null;}
function show(portal){if(!portal){cityName.textContent='Selecione um portal';cityMeta.textContent=`${cities.length||4} cidades registradas na Spatial API v1`;cityStatus.textContent='MULTICITY PREVIEW';return;}const city=portal.userData.city;cityName.textContent=city.name;cityMeta.textContent=`${city.regionName} · ${city.countryName} · ${city.districts.length} distritos · ${city.route}`;cityStatus.textContent=city.status==='active'?'CIDADE ATIVA · CLIQUE PARA ENTRAR':'PREVIEW PROCEDURAL · CLIQUE PARA EXPLORAR';}
renderer.domElement.addEventListener('pointerdown',e=>{dragging=true;lastX=e.clientX;lastY=e.clientY;startX=e.clientX;startY=e.clientY;renderer.domElement.setPointerCapture(e.pointerId);});
renderer.domElement.addEventListener('pointerup',e=>{const click=Math.hypot(e.clientX-startX,e.clientY-startY)<6;dragging=false;if(!click)return;const portal=portalAt(e);if(portal)location.assign(spatialExplorerHref(portal.userData.city.id));});
renderer.domElement.addEventListener('pointermove',e=>{if(dragging){yaw-=(e.clientX-lastX)*.004;pitch=Math.max(-.5,Math.min(.2,pitch-(e.clientY-lastY)*.0025));lastX=e.clientX;lastY=e.clientY;}else{const portal=portalAt(e);show(portal);renderer.domElement.style.cursor=portal?'pointer':'grab';}});

let last=performance.now();function animate(now){requestAnimationFrame(animate);const dt=Math.min(.05,(now-last)/1000);last=now;core.rotation.y+=dt*.35;const radius=74;camera.position.set(Math.sin(yaw)*radius,28+pitch*28,Math.cos(yaw)*radius);camera.lookAt(0,7,0);renderer.render(scene,camera);}requestAnimationFrame(animate);
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setPixelRatio(profile.pixel);renderer.setSize(innerWidth,innerHeight);});
