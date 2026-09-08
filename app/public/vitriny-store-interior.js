import * as THREE from '/vendor/three/three.module.js';
import {fetchStoreInteriorData} from '/vitriny-store-interior-core.js';
import {normalizeSpatialStore} from '/vitriny-spatial-store-registry.js';
import {SPATIAL_RETURN_KEY,explorerReturnHref,isSafeInternalHref,parseSpatialReturnState} from '/vitriny-spatial-session.js';
import {spatialMovementBasis} from '/vitriny-spatial-city-portals.js';
import {createArchitectureKit} from '/vitriny-premium-architecture.js';

const palette=[0x6ee7ff,0x8f8cff,0xe48cff,0xffb36b,0x85e6a8,0x6f9cff,0xb58cff,0x6edbcf];
const profile=(()=>{const memory=Number(navigator.deviceMemory||0),cores=Number(navigator.hardwareConcurrency||2),mobile=matchMedia('(max-width:760px)').matches;let score=(memory>=8?3:memory>=4?2:memory>=2?1:0)+(cores>=8?3:cores>=4?2:1)+(mobile?-1:1);const id=score>=6?'ULTRA':score>=3?'STANDARD':'LITE';return{id,pixel:id==='ULTRA'?Math.min(devicePixelRatio,1.5):id==='STANDARD'?Math.min(devicePixelRatio,1.2):1,shadows:id!=='LITE',productLimit:id==='LITE'?12:id==='STANDARD'?20:24,labelScale:id==='LITE'?.88:1};})();
const params=new URLSearchParams(location.search),reference=String(params.get('store')||'').trim().slice(0,120),nameHint=String(params.get('name')||'').trim().slice(0,120);
const loading=document.getElementById('loading'),loadingText=document.getElementById('loadingText'),storeName=document.getElementById('storeName'),storeMeta=document.getElementById('storeMeta'),focusProduct=document.getElementById('focusProduct'),openStore=document.getElementById('openStore');

document.getElementById('backCity').onclick=()=>location.assign(explorerReturnHref());
try{const state=parseSpatialReturnState(sessionStorage.getItem(SPATIAL_RETURN_KEY));if(!state)document.getElementById('backCity').textContent='← Central Plaza';}catch{}

const scene=new THREE.Scene();scene.background=new THREE.Color('#b1b5b3');scene.fog=new THREE.FogExp2('#b1b5b3',.002);
const camera=new THREE.PerspectiveCamera(58,innerWidth/innerHeight,.1,180);
let renderer;try{renderer=new THREE.WebGLRenderer({antialias:profile.id!=='LITE',powerPreference:'high-performance'});}catch(error){loadingText.textContent='3D indisponível neste aparelho. Use o acesso à loja ou volte à cidade.';throw error;}renderer.setPixelRatio(profile.pixel);renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.95;renderer.shadowMap.enabled=profile.shadows;renderer.shadowMap.type=THREE.PCFSoftShadowMap;document.body.prepend(renderer.domElement);
scene.add(new THREE.HemisphereLight('#cbddea','#8a775a',1.6));const key=new THREE.DirectionalLight('#ffddb4',2.5);key.position.set(-12,22,18);key.castShadow=profile.shadows;key.shadow.mapSize.set(1024,1024);Object.assign(key.shadow.camera,{left:-30,right:30,top:30,bottom:-30,near:.1,far:90});key.shadow.normalBias=.04;scene.add(key);
const architecture=createArchitectureKit({renderer,scene,shadows:profile.shadows,lite:profile.id==='LITE'}),disposeReflections=architecture.reflections();

const floorMat=architecture.pavingMaterial({color:'#b8af98',repeat:5});
const wallMat=new THREE.MeshStandardMaterial({color:'#a39e8d',roughness:.75});
const trimMat=architecture.graphite;
const productTargets=[];
let disposed=false,raf=0;

function makeLabelTexture(product){
  const canvas=document.createElement('canvas');canvas.width=profile.id==='LITE'?384:512;canvas.height=profile.id==='LITE'?192:256;const ctx=canvas.getContext('2d'),sx=canvas.width/512,sy=canvas.height/256;ctx.scale(sx,sy);
  ctx.fillStyle='#07111e';ctx.fillRect(0,0,512,256);ctx.strokeStyle='#62e7ff';ctx.lineWidth=4;ctx.strokeRect(8,8,496,240);
  ctx.fillStyle='#86edff';ctx.font='700 22px system-ui';ctx.fillText(product.category.slice(0,28),28,48);
  ctx.fillStyle='#f6fbff';ctx.font='900 30px system-ui';const words=product.name.split(/\s+/);let line='',y=92;
  for(const word of words){const next=line?`${line} ${word}`:word;if(ctx.measureText(next).width>450&&line){ctx.fillText(line,28,y);y+=38;line=word;if(y>168)break;}else line=next;}if(line&&y<=168)ctx.fillText(line,28,y);
  ctx.fillStyle='#ffc628';ctx.font='900 27px system-ui';ctx.fillText((product.priceCents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}),28,220);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;if(profile.id!=='LITE')texture.anisotropy=renderer.capabilities.getMaxAnisotropy();return texture;
}

function addRoom(rows){
  const width=38,depth=Math.max(34,18+rows*8.5),height=12;
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(width,depth),floorMat);floor.rotation.x=-Math.PI/2;floor.position.set(0,0,-depth/2+8);floor.receiveShadow=profile.shadows;scene.add(floor);
  const back=new THREE.Mesh(new THREE.BoxGeometry(width,height,.6),wallMat);back.position.set(0,height/2,-depth+8);back.receiveShadow=profile.shadows;scene.add(back);
  const left=new THREE.Mesh(new THREE.BoxGeometry(.6,height,depth),wallMat);left.position.set(-width/2,height/2,-depth/2+8);scene.add(left);
  const right=left.clone();right.position.x=width/2;scene.add(right);
  const arch=new THREE.Mesh(new THREE.BoxGeometry(22,.5,.8),trimMat);arch.position.set(0,8.2,7);scene.add(arch);
  for(const x of [-17,17]){architecture.part(scene,architecture.wood,x,5,-depth/2+8,.5,10,depth);architecture.part(scene,architecture.warm,x,9.7,-depth/2+8,.08,.09,depth);}
  for(let z=-4;z>-depth+10;z-=9){architecture.part(scene,architecture.graphite,0,10,z,37,.22,.35);architecture.part(scene,architecture.warm,0,9.83,z,31,.04,.25);}
  architecture.textSign(scene,storeName.textContent,{width:26,height:3,y:8,z:-depth+8.4,subtitle:'VITRINE CITY · SHOWROOM'});
  architecture.tree(scene,-16,5,1.05);architecture.tree(scene,16,5,1.05);
  return {width,depth};
}

function addProduct(product){
  const accent=palette[product.accentIndex%palette.length],group=new THREE.Group();group.position.set(product.position.x,0,product.position.z);group.userData={product:true,href:product.href,label:product.name,priceCents:product.priceCents};
  architecture.part(group,architecture.wood,0,.6,0,4.8,1.2,2.4);
  architecture.part(group,architecture.warm,0,1.23,1.22,4.6,.045,.05);
  architecture.part(group,architecture.graphite,0,3.65,-.1,4.7,4.7,.18);
  if(product.imageUrl){
    const photo=new THREE.Mesh(new THREE.PlaneGeometry(4.4,4.4),new THREE.MeshBasicMaterial({color:'#e9e5da'}));photo.position.set(0,3.65,.015);group.add(photo);
    new THREE.TextureLoader().load(product.textureUrl,texture=>{if(disposed){texture.dispose();return;}texture.colorSpace=THREE.SRGBColorSpace;const ratio=texture.image.width/texture.image.height;photo.scale.set(ratio>1?1:ratio,ratio>1?1/ratio:1,1);photo.material.map=texture;photo.material.color.set('#ffffff');photo.material.needsUpdate=true;},undefined,()=>{});
  }
  const texture=makeLabelTexture(product),sign=new THREE.Mesh(new THREE.PlaneGeometry(4.9*profile.labelScale,2.45*profile.labelScale),new THREE.MeshBasicMaterial({map:texture,transparent:false}));sign.position.set(0,1.9,1.4);sign.userData.labelTexture=texture;group.add(sign);
  scene.add(group);productTargets.push(group);
}

function disposeScene(event){keys.clear();dragging=false;if(event.persisted)return;disposed=true;cancelAnimationFrame(raf);scene.traverse(obj=>{obj.geometry?.dispose?.();if(obj.material){for(const material of Array.isArray(obj.material)?obj.material:[obj.material]){material.map?.dispose?.();material.dispose?.();}}});architecture.dispose();disposeReflections();renderer.dispose();}
addEventListener('pagehide',disposeScene);

const position=new THREE.Vector3(0,2.2,12),velocity=new THREE.Vector3(),keys=new Set();let yaw=Math.PI,pitch=-.12,speed=10,dragging=false,lastX=0,lastY=0,pointerStartX=0,pointerStartY=0,room={width:38,depth:40};
function safeNavigate(href){if(!isSafeInternalHref(href))return false;location.assign(href);return true;}
function setKey(code,on){if(on)keys.add(code);else keys.delete(code);}
addEventListener('keydown',event=>{if(event.target?.closest?.('a,button,input,textarea,select,[contenteditable="true"]'))return;setKey(event.code,true);if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(event.code))event.preventDefault();});addEventListener('keyup',event=>setKey(event.code,false));
addEventListener('blur',()=>{keys.clear();dragging=false;});document.addEventListener('visibilitychange',()=>{if(document.hidden){keys.clear();dragging=false;}});

const pointer=new THREE.Vector2(),raycaster=new THREE.Raycaster();
function productAtPointer(event){pointer.x=event.clientX/innerWidth*2-1;pointer.y=-(event.clientY/innerHeight)*2+1;raycaster.setFromCamera(pointer,camera);const hit=raycaster.intersectObjects(productTargets,true)[0];let node=hit?.object||null;while(node&&!node.userData?.product)node=node.parent;return node?.userData?.product?node:null;}
renderer.domElement.addEventListener('pointerdown',event=>{dragging=true;lastX=event.clientX;lastY=event.clientY;pointerStartX=event.clientX;pointerStartY=event.clientY;renderer.domElement.setPointerCapture(event.pointerId);});
renderer.domElement.addEventListener('pointerup',event=>{const click=Math.hypot(event.clientX-pointerStartX,event.clientY-pointerStartY)<6;dragging=false;if(click){const product=productAtPointer(event);if(product)safeNavigate(product.userData.href);}});
renderer.domElement.addEventListener('pointermove',event=>{if(dragging){yaw+=(event.clientX-lastX)*.0042;pitch=Math.max(-.7,Math.min(.5,pitch-(event.clientY-lastY)*.0034));lastX=event.clientX;lastY=event.clientY;}else{const product=productAtPointer(event);focusProduct.textContent=product?`${product.userData.label} · ${(product.userData.priceCents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}`:'Clique em um produto para abrir os detalhes.';renderer.domElement.style.cursor=product?'pointer':'grab';}});
renderer.domElement.addEventListener('wheel',event=>{speed=Math.max(5,Math.min(20,speed-event.deltaY*.008));},{passive:true});

async function boot(){
  if(!reference){loadingText.textContent='Loja não informada.';loadingText.classList.add('error');return;}
  try{
    const data=await fetchStoreInteriorData({storeReference:reference,storeName:nameHint,limit:profile.productLimit}),store=normalizeSpatialStore(data.store);
    if(!store)throw new Error('store_invalid');
    storeName.textContent=store.name;storeMeta.textContent=`${[store.city,store.state].filter(Boolean).join(' · ')||'Vitrine City'} · ${data.products.length} produtos no showroom`;
    openStore.href=store.href;
    const columns=profile.id==='LITE'?3:4,rows=Math.max(1,Math.ceil(data.products.length/columns));room=addRoom(rows);
    for(const product of data.products)addProduct(product);
    if(!data.products.length)focusProduct.textContent='Esta loja ainda não possui produtos disponíveis para o showroom.';
    loading.classList.add('hide');
  }catch(error){loadingText.textContent=error?.name==='AbortError'?'Tempo excedido ao carregar a loja.':'Não foi possível carregar esta loja agora.';loadingText.classList.add('error');}
}
await boot();

let last=performance.now();
function animate(now){if(disposed)return;raf=requestAnimationFrame(animate);const dt=Math.min(.05,(now-last)/1000);last=now;if(document.hidden)return;
  const basis=spatialMovementBasis(yaw),forward=new THREE.Vector3(basis.forward.x,0,basis.forward.z),right=new THREE.Vector3(basis.right.x,0,basis.right.z);velocity.set(0,0,0);
  if(keys.has('KeyW')||keys.has('ArrowUp'))velocity.add(forward);if(keys.has('KeyS')||keys.has('ArrowDown'))velocity.sub(forward);if(keys.has('KeyD')||keys.has('ArrowRight'))velocity.add(right);if(keys.has('KeyA')||keys.has('ArrowLeft'))velocity.sub(right);
  if(velocity.lengthSq())velocity.normalize().multiplyScalar(speed*dt);position.add(velocity);position.x=Math.max(-room.width/2+1.4,Math.min(room.width/2-1.4,position.x));position.z=Math.max(-room.depth+10,Math.min(14,position.z));
  const look=new THREE.Vector3(Math.sin(-yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(-yaw)*Math.cos(pitch));camera.position.copy(position);camera.lookAt(position.clone().add(look));renderer.render(scene,camera);
}
raf=requestAnimationFrame(animate);
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setPixelRatio(profile.pixel);renderer.setSize(innerWidth,innerHeight);});
