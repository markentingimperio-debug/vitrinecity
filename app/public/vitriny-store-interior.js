import * as THREE from '/vendor/three/three.module.js';
import {fetchStoreInteriorData} from '/vitriny-store-interior-core.js';
import {normalizeSpatialStore} from '/vitriny-spatial-store-registry.js';
import {SPATIAL_RETURN_KEY,explorerReturnHref,isSafeInternalHref,parseSpatialReturnState} from '/vitriny-spatial-session.js';

const palette=[0x6ee7ff,0x8f8cff,0xe48cff,0xffb36b,0x85e6a8,0x6f9cff,0xb58cff,0x6edbcf];
const params=new URLSearchParams(location.search),reference=String(params.get('store')||'').trim().slice(0,120),nameHint=String(params.get('name')||'').trim().slice(0,120);
const loading=document.getElementById('loading'),loadingText=document.getElementById('loadingText'),storeName=document.getElementById('storeName'),storeMeta=document.getElementById('storeMeta'),focusProduct=document.getElementById('focusProduct'),openStore=document.getElementById('openStore');

document.getElementById('backCity').onclick=()=>location.assign(explorerReturnHref());
try{const state=parseSpatialReturnState(sessionStorage.getItem(SPATIAL_RETURN_KEY));if(!state)document.getElementById('backCity').textContent='← Central Plaza';}catch{}

const scene=new THREE.Scene();scene.background=new THREE.Color(0x050a13);scene.fog=new THREE.FogExp2(0x07101c,.018);
const camera=new THREE.PerspectiveCamera(58,innerWidth/innerHeight,.1,180);
const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.08;renderer.shadowMap.enabled=true;document.body.prepend(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xcff5ff,0x0b1118,1.35));const key=new THREE.DirectionalLight(0xffffff,1.7);key.position.set(12,22,10);key.castShadow=true;scene.add(key);

const floorMat=new THREE.MeshStandardMaterial({color:0x0d1724,roughness:.82,metalness:.08});
const wallMat=new THREE.MeshStandardMaterial({color:0x111d2d,roughness:.62,metalness:.18});
const trimMat=new THREE.MeshStandardMaterial({color:0x1d3553,roughness:.42,metalness:.4});
const productTargets=[];

function makeLabelTexture(product){
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=256;const ctx=canvas.getContext('2d');
  ctx.fillStyle='#07111e';ctx.fillRect(0,0,512,256);ctx.strokeStyle='#62e7ff';ctx.lineWidth=4;ctx.strokeRect(8,8,496,240);
  ctx.fillStyle='#86edff';ctx.font='700 22px system-ui';ctx.fillText(product.category.slice(0,28),28,48);
  ctx.fillStyle='#f6fbff';ctx.font='900 30px system-ui';const words=product.name.split(/\s+/);let line='',y=92;
  for(const word of words){const next=line?`${line} ${word}`:word;if(ctx.measureText(next).width>450&&line){ctx.fillText(line,28,y);y+=38;line=word;if(y>168)break;}else line=next;}if(line&&y<=168)ctx.fillText(line,28,y);
  ctx.fillStyle='#ffc628';ctx.font='900 27px system-ui';ctx.fillText((product.priceCents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}),28,220);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=renderer.capabilities.getMaxAnisotropy();return texture;
}

function addRoom(rows){
  const width=38,depth=Math.max(34,18+rows*8.5),height=12;
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(width,depth),floorMat);floor.rotation.x=-Math.PI/2;floor.position.set(0,0,-depth/2+8);floor.receiveShadow=true;scene.add(floor);
  const back=new THREE.Mesh(new THREE.BoxGeometry(width,height,.6),wallMat);back.position.set(0,height/2,-depth+8);back.receiveShadow=true;scene.add(back);
  const left=new THREE.Mesh(new THREE.BoxGeometry(.6,height,depth),wallMat);left.position.set(-width/2,height/2,-depth/2+8);scene.add(left);
  const right=left.clone();right.position.x=width/2;scene.add(right);
  const arch=new THREE.Mesh(new THREE.BoxGeometry(22,.5,.8),trimMat);arch.position.set(0,8.2,7);scene.add(arch);
  for(let x=-15;x<=15;x+=6){const light=new THREE.PointLight(0x8feaff,.65,18,2);light.position.set(x,8,-4);scene.add(light);}
  return {width,depth};
}

function addProduct(product){
  const accent=palette[product.accentIndex%palette.length],group=new THREE.Group();group.position.set(product.position.x,0,product.position.z);group.userData={product:true,href:product.href,label:product.name,priceCents:product.priceCents};
  const base=new THREE.Mesh(new THREE.CylinderGeometry(2.15,2.35,.8,24),new THREE.MeshStandardMaterial({color:0x15243a,metalness:.5,roughness:.3}));base.position.y=.4;base.castShadow=true;base.receiveShadow=true;group.add(base);
  const item=new THREE.Mesh(new THREE.BoxGeometry(2.8,2.8,2.8),new THREE.MeshPhysicalMaterial({color:0x172b42,emissive:accent,emissiveIntensity:.12,metalness:.22,roughness:.22,clearcoat:.65}));item.position.y=2.25;item.castShadow=true;item.receiveShadow=true;group.add(item);
  const halo=new THREE.Mesh(new THREE.TorusGeometry(2.05,.06,8,48),new THREE.MeshBasicMaterial({color:accent,transparent:true,opacity:.82}));halo.rotation.x=Math.PI/2;halo.position.y=.92;group.add(halo);
  const texture=makeLabelTexture(product),sign=new THREE.Mesh(new THREE.PlaneGeometry(4.9,2.45),new THREE.MeshBasicMaterial({map:texture,transparent:false}));sign.position.set(0,4.75,0);sign.userData.labelTexture=texture;group.add(sign);
  scene.add(group);productTargets.push(group);
}

function disposeScene(){scene.traverse(obj=>{obj.geometry?.dispose?.();if(obj.material){for(const material of Array.isArray(obj.material)?obj.material:[obj.material]){material.map?.dispose?.();material.dispose?.();}}});}
addEventListener('pagehide',disposeScene,{once:true});

const position=new THREE.Vector3(0,2.2,12),velocity=new THREE.Vector3(),keys=new Set();let yaw=Math.PI,pitch=-.12,speed=10,dragging=false,lastX=0,lastY=0,pointerStartX=0,pointerStartY=0,room={width:38,depth:40};
function safeNavigate(href){if(!isSafeInternalHref(href))return false;location.assign(href);return true;}
function setKey(code,on){if(on)keys.add(code);else keys.delete(code);}
addEventListener('keydown',event=>{setKey(event.code,true);if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(event.code))event.preventDefault();});addEventListener('keyup',event=>setKey(event.code,false));

const pointer=new THREE.Vector2(),raycaster=new THREE.Raycaster();
function productAtPointer(event){pointer.x=event.clientX/innerWidth*2-1;pointer.y=-(event.clientY/innerHeight)*2+1;raycaster.setFromCamera(pointer,camera);const hit=raycaster.intersectObjects(productTargets,true)[0];let node=hit?.object||null;while(node&&!node.userData?.product)node=node.parent;return node?.userData?.product?node:null;}
renderer.domElement.addEventListener('pointerdown',event=>{dragging=true;lastX=event.clientX;lastY=event.clientY;pointerStartX=event.clientX;pointerStartY=event.clientY;renderer.domElement.setPointerCapture(event.pointerId);});
renderer.domElement.addEventListener('pointerup',event=>{const click=Math.hypot(event.clientX-pointerStartX,event.clientY-pointerStartY)<6;dragging=false;if(click){const product=productAtPointer(event);if(product)safeNavigate(product.userData.href);}});
renderer.domElement.addEventListener('pointermove',event=>{if(dragging){yaw-=(event.clientX-lastX)*.0042;pitch=Math.max(-.7,Math.min(.5,pitch-(event.clientY-lastY)*.0034));lastX=event.clientX;lastY=event.clientY;}else{const product=productAtPointer(event);focusProduct.textContent=product?`${product.userData.label} · ${(product.userData.priceCents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}`:'Clique em um produto para abrir os detalhes.';renderer.domElement.style.cursor=product?'pointer':'grab';}});
renderer.domElement.addEventListener('wheel',event=>{speed=Math.max(5,Math.min(20,speed-event.deltaY*.008));},{passive:true});

async function boot(){
  if(!reference){loadingText.textContent='Loja não informada.';loadingText.classList.add('error');return;}
  try{
    const data=await fetchStoreInteriorData({storeReference:reference,storeName:nameHint,limit:24}),store=normalizeSpatialStore(data.store);
    if(!store)throw new Error('store_invalid');
    storeName.textContent=store.name;storeMeta.textContent=`${[store.city,store.state].filter(Boolean).join(' · ')||'Vitrine City'} · ${data.products.length} produtos no showroom`;
    openStore.href=store.href;
    const rows=Math.max(1,Math.ceil(data.products.length/4));room=addRoom(rows);
    for(const product of data.products)addProduct(product);
    if(!data.products.length)focusProduct.textContent='Esta loja ainda não possui produtos disponíveis para o showroom.';
    loading.classList.add('hide');
  }catch(error){loadingText.textContent=error?.name==='AbortError'?'Tempo excedido ao carregar a loja.':'Não foi possível carregar esta loja agora.';loadingText.classList.add('error');}
}
await boot();

let last=performance.now();
function animate(now){requestAnimationFrame(animate);const dt=Math.min(.05,(now-last)/1000);last=now;
  const forward=new THREE.Vector3(-Math.sin(yaw),0,-Math.cos(yaw)),right=new THREE.Vector3(Math.cos(yaw),0,-Math.sin(yaw));velocity.set(0,0,0);
  if(keys.has('KeyW')||keys.has('ArrowUp'))velocity.add(forward);if(keys.has('KeyS')||keys.has('ArrowDown'))velocity.sub(forward);if(keys.has('KeyD')||keys.has('ArrowRight'))velocity.add(right);if(keys.has('KeyA')||keys.has('ArrowLeft'))velocity.sub(right);
  if(velocity.lengthSq())velocity.normalize().multiplyScalar(speed*dt);position.add(velocity);position.x=Math.max(-room.width/2+1.4,Math.min(room.width/2-1.4,position.x));position.z=Math.max(-room.depth+10,Math.min(14,position.z));
  const look=new THREE.Vector3(Math.sin(-yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(-yaw)*Math.cos(pitch));camera.position.copy(position);camera.lookAt(position.clone().add(look));renderer.render(scene,camera);
}
requestAnimationFrame(animate);
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setSize(innerWidth,innerHeight);});
