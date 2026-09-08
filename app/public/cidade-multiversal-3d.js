import * as THREE from '/vendor/three/three.module.js';

const FALLBACK_CITIES=[
  {slug:'silvania-go',name:'Silvânia',state:'Goiás',stateCode:'GO',status:'pilot'},
  {slug:'anapolis-go',name:'Anápolis',state:'Goiás',stateCode:'GO',status:'enabled'},
  {slug:'vianopolis-go',name:'Vianópolis',state:'Goiás',stateCode:'GO',status:'enabled'}
];
const FALLBACK_REALMS=[
  {slug:'centro-25d',title:'Centro Vitrine 2.5D',category:'experience',categoryLabel:'Experiência',badge:'CIDADE DIGITAL',entryPath:'/cidade-25d-demo.html',imagePath:'/assets/centro-vitrine-25d-v2.webp',description:'Explore ruas, prédios, lojas, serviços e atrações em uma cidade navegável em perspectiva 2.5D.'},
  {slug:'mapa-real',title:'Vitrine no Mundo Real',category:'mobility',categoryLabel:'Mobilidade',badge:'MAPA REAL',entryPath:'/mapa-real.html',imagePath:'/assets/mapa-mestre.jpg',description:'Veja empresas e pontos da plataforma no mapa real e conecte a experiência digital ao endereço físico.'},
  {slug:'vitriny-social',title:'Vitriny Social',category:'social',categoryLabel:'Social',badge:'REDE SOCIAL',entryPath:'/social.html',imagePath:'/assets/vitriny-city-norte.jpg',description:'Descubra pessoas, empresas, vídeos, publicações e tendências dentro da camada social da VitrineCity.'},
  {slug:'mercado',title:'Mercado & Lojas',category:'commerce',categoryLabel:'Comércio',badge:'MARKETPLACE',entryPath:'/loja.html',imagePath:'/assets/vitriny-city-leste.jpg',description:'Entre nas vitrines comerciais, conheça produtos e conecte descoberta, loja e compra no mesmo ecossistema.'},
  {slug:'entregas',title:'Vitrine Entregas',category:'mobility',categoryLabel:'Mobilidade',badge:'LOGÍSTICA',entryPath:'/entregas.html',imagePath:'/assets/vc-entregas-hero.png',description:'Camada logística para pedidos locais, entregadores, acompanhamento e conexão entre loja e cliente.'},
  {slug:'educacao',title:'Centro Educacional',category:'experience',categoryLabel:'Experiência',badge:'CONHECIMENTO',entryPath:'/centro-educacional.html',imagePath:'/assets/centro-educacional-premium-v2.png',description:'Cursos, materiais, conteúdos e experiências de aprendizado integrados à cidade digital.'},
  {slug:'neural',title:'Vitriny Neural',category:'intelligence',categoryLabel:'Inteligência',badge:'IA DA CIDADE',entryPath:'/jarvis-public.html',imagePath:'/assets/cidade-premium.jpg',description:'A camada de inteligência que pesquisa, orienta e conecta capacidades da plataforma em uma única interface.'},
  {slug:'navegar',title:'Portal de Navegação',category:'mobility',categoryLabel:'Mobilidade',badge:'ROTAS & CIDADES',entryPath:'/navegar.html',imagePath:'/assets/vitriny-city-base.jpg',description:'Ponto de passagem entre cidades, rotas e experiências geográficas do ecossistema VitrineCity.'}
];
const DISTRICTS={
  neural:{position:[0,0],height:18,accent:0x9e78ff,label:'NÚCLEO NEURAL'},
  'vitriny-social':{position:[-22,-18],height:13,accent:0xff5eae,label:'SOCIAL'},
  mercado:{position:[22,-18],height:11,accent:0xffc857,label:'MARKETPLACE'},
  entregas:{position:[29,5],height:10,accent:0x53ddc2,label:'ENTREGAS'},
  'mapa-real':{position:[21,25],height:12,accent:0x5aa9ff,label:'MAPA REAL'},
  navegar:{position:[-4,31],height:9,accent:0x66d9ff,label:'NAVEGAÇÃO'},
  educacao:{position:[-27,22],height:12,accent:0x78e08f,label:'EDUCAÇÃO'},
  'centro-25d':{position:[-31,1],height:10,accent:0xff8f70,label:'CENTRO 2.5D'}
};
const LAST_CITY_KEY='vitrinecity.multiversal.city';
const LAST_REALM_KEY='vitrinecity.multiversal.lastRealm';

const stage=document.getElementById('cityStage');
const canvas=document.getElementById('cityCanvas');
const loading=document.getElementById('cityLoading');
const labelsLayer=document.getElementById('cityLabels');
const citySelect=document.getElementById('citySelect');
const neuralState=document.getElementById('neuralState');
const activeCityName=document.getElementById('activeCityName');
const realmSummary=document.getElementById('realmSummary');
const dockCity=document.getElementById('dockCity');
const realmDock=document.getElementById('realmDock');
const panel=document.getElementById('realmPanel');
const realmImage=document.getElementById('realmImage');
const realmBadge=document.getElementById('realmBadge');
const realmTitle=document.getElementById('realmTitle');
const realmDescription=document.getElementById('realmDescription');
const realmCategory=document.getElementById('realmCategory');
const realmCity=document.getElementById('realmCity');
const enterRealm=document.getElementById('enterRealm');

let cities=[];
let realms=[];
let activeCitySlug='silvania-go';
let activeRealm=null;
let scene,camera,renderer,world,raycaster,mouse;
let realmGroups=new Map();
let clickableMeshes=[];
let labels=[];
let portalRings=[];
let cars=[];
let animationFrame=0;
let startTime=performance.now();
let cameraRadius=70;
let cameraTheta=.78;
let cameraPhi=.88;
let dragging=false;
let dragMoved=false;
let dragStart={x:0,y:0,theta:0,phi:0};
const activePointers=new Map();
let pinchDistance=0;
let hoveredMesh=null;
const target=new THREE.Vector3(0,3,0);

function safeJson(response){return response.json().catch(()=>({}));}
function selectedCity(){return cities.find(city=>city.slug===activeCitySlug)||cities[0]||null;}
function localPath(value,fallback){try{const url=new URL(String(value||''),location.origin);if(url.origin!==location.origin||!['http:','https:'].includes(url.protocol))return fallback;return `${url.pathname}${url.search}${url.hash}`;}catch{return fallback;}}
function appendCity(entryPath,citySlug){const safePath=localPath(entryPath,'/multiversal.html');const url=new URL(safePath,location.origin);url.searchParams.set('cidade',citySlug);return `${url.pathname}${url.search}${url.hash}`;}
function normalizeRealm(realm){const entryPath=localPath(realm.entryPath||realm.href,'/multiversal.html');const fallbackHref=appendCity(entryPath,activeCitySlug);return{...realm,category:realm.category||realm.type||'experience',categoryLabel:realm.categoryLabel||realm.typeLabel||realm.category||'Universo',entryPath,href:localPath(realm.href,fallbackHref),imagePath:localPath(realm.imagePath||realm.image,'/assets/vitriny-city-master.jpg')};}
function readLastRealm(){try{return JSON.parse(localStorage.getItem(LAST_REALM_KEY)||'{}');}catch{return{};}}
function rememberRealm(realm){try{localStorage.setItem(LAST_REALM_KEY,JSON.stringify({slug:realm.slug,citySlug:activeCitySlug,visitedAt:Date.now()}));}catch{/* A URL mantém a navegação funcional sem localStorage. */}}
function rememberCity(slug){try{localStorage.setItem(LAST_CITY_KEY,slug);}catch{/* A cidade permanece na URL quando o armazenamento local está indisponível. */}}
function updateLocationCity(slug){const url=new URL(location.href);url.searchParams.set('cidade',slug);history.replaceState({},'',`${url.pathname}${url.search}${url.hash}`);}
function make(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;}

async function sendMultiversalEvent(body){
  try{
    const response=await fetch('/api/multiversal/event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),keepalive:true});
    return response.ok?safeJson(response):null;
  }catch{return null;}
}

function currentRealmFromUrl(){const slug=new URLSearchParams(location.search).get('universo');return realms.find(realm=>realm.slug===slug)||null;}

async function loadContext(){
  const params=new URLSearchParams(location.search);
  let saved='';
  try{saved=localStorage.getItem(LAST_CITY_KEY)||'';}catch{/* URL é o fallback de contexto. */}
  try{
    const response=await fetch('/api/multiversal/cities',{headers:{Accept:'application/json'}});
    if(!response.ok)throw new Error('cities');
    const payload=await safeJson(response);
    cities=Array.isArray(payload.items)&&payload.items.length?payload.items:FALLBACK_CITIES;
    const requested=params.get('cidade')||saved||payload.defaultCity||'silvania-go';
    activeCitySlug=cities.some(city=>city.slug===requested)?requested:(payload.defaultCity||cities[0].slug);
  }catch{
    cities=FALLBACK_CITIES;
    const requested=params.get('cidade')||saved||'silvania-go';
    activeCitySlug=cities.some(city=>city.slug===requested)?requested:'silvania-go';
  }
  rememberCity(activeCitySlug);updateLocationCity(activeCitySlug);renderCitySelect();
  await loadRealms(activeCitySlug);
}

async function loadRealms(citySlug){
  try{
    const response=await fetch(`/api/multiversal/realms?cidade=${encodeURIComponent(citySlug)}`,{headers:{Accept:'application/json'}});
    if(!response.ok)throw new Error('realms');
    const payload=await safeJson(response);
    realms=Array.isArray(payload.items)&&payload.items.length?payload.items.map(normalizeRealm):[];
    if(!realms.length)throw new Error('empty');
  }catch{
    realms=FALLBACK_REALMS.map(realm=>normalizeRealm({...realm,href:appendCity(realm.entryPath,citySlug)}));
  }
  renderCityMeta();
  buildRealmCity();
  const focused=currentRealmFromUrl();if(focused)selectRealm(focused,false);
}

function renderCitySelect(){
  const options=cities.map(city=>{const option=make('option','',`${city.name} — ${city.stateCode||city.state||''}`);option.value=city.slug;option.selected=city.slug===activeCitySlug;return option;});
  citySelect.replaceChildren(...options);
}
function renderCityMeta(){
  const city=selectedCity();
  activeCityName.textContent=city?.name||'VitrineCity';
  dockCity.textContent=`${city?.name||'VitrineCity'} • ${city?.stateCode||''}`;
  realmSummary.textContent=`${realms.length} universos conectados`;
  realmCity.textContent=`${city?.name||'VitrineCity'} — ${city?.stateCode||city?.state||''}`;
  const buttons=realms.map(realm=>{
    const config=DISTRICTS[realm.slug]||{};
    const accent=`#${Number(config.accent||0x67e8f9).toString(16).padStart(6,'0')}`;
    const button=make('button','dock-realm');button.type='button';button.dataset.realm=realm.slug;button.style.setProperty('--accent',accent);
    button.append(make('i'),document.createTextNode(realm.title));
    button.onclick=()=>focusRealm(realm);
    return button;
  });
  realmDock.replaceChildren(...buttons);
}

function showWebglFallback(){
  const fallback=make('div','webgl-fallback');
  const copy=make('div');
  copy.append(make('h1','', 'Seu navegador não abriu a cidade 3D.'),make('p','', 'O restante da VitrineCity continua disponível normalmente.'));
  const link=make('a','', 'Abrir Portal Multiversal');link.href='/multiversal.html';copy.append(link);fallback.append(copy);stage.replaceChildren(fallback);
}

function initThree(){
  try{
    renderer=new THREE.WebGLRenderer({canvas,antialias:innerWidth>700,alpha:false,powerPreference:'high-performance'});
  }catch{return showWebglFallback();}
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,innerWidth<700?1.25:1.7));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.06;
  renderer.shadowMap.enabled=innerWidth>820;
  renderer.shadowMap.type=THREE.PCFSoftShadowMap;

  scene=new THREE.Scene();
  scene.background=new THREE.Color(0x06101d);
  scene.fog=new THREE.FogExp2(0x07111f,.0095);
  camera=new THREE.PerspectiveCamera(48,1,.1,240);
  raycaster=new THREE.Raycaster();mouse=new THREE.Vector2();

  const hemi=new THREE.HemisphereLight(0x9fc9ff,0x132016,1.6);scene.add(hemi);
  const sun=new THREE.DirectionalLight(0xcfe3ff,2.4);sun.position.set(-26,48,-18);sun.castShadow=renderer.shadowMap.enabled;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-55;sun.shadow.camera.right=55;sun.shadow.camera.top=55;sun.shadow.camera.bottom=-55;scene.add(sun);
  const rim=new THREE.PointLight(0x7e5cff,80,90,2);rim.position.set(0,20,4);scene.add(rim);

  world=new THREE.Group();scene.add(world);
  createBaseCity();
  updateCamera();resize();
  installControls();
  animate();
}

function material(color,roughness=.72,metalness=.12){return new THREE.MeshStandardMaterial({color,roughness,metalness});}
function createBaseCity(){
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(100,100),material(0x0b1b2a,.94,.02));ground.rotation.x=-Math.PI/2;ground.position.y=-.08;ground.receiveShadow=true;world.add(ground);
  const grid=new THREE.GridHelper(100,40,0x22496d,0x142d45);grid.position.y=.01;grid.material.opacity=.24;grid.material.transparent=true;world.add(grid);
  const roadMat=material(0x101b29,.92,.03),lineMat=material(0x4f6f8b,.6,.1);
  for(const [x,z,w,d] of [[0,0,8,94],[0,0,94,8],[-24,0,5,94],[24,0,5,94],[0,-24,94,5],[0,24,94,5]]){
    const road=new THREE.Mesh(new THREE.BoxGeometry(w,.08,d),roadMat);road.position.set(x,.02,z);road.receiveShadow=true;world.add(road);
  }
  for(let i=-42;i<=42;i+=8){
    const a=new THREE.Mesh(new THREE.BoxGeometry(.18,.04,3.2),lineMat);a.position.set(.05,.08,i);world.add(a);
    const b=new THREE.Mesh(new THREE.BoxGeometry(3.2,.04,.18),lineMat);b.position.set(i,.08,.05);world.add(b);
  }
  const plaza=new THREE.Mesh(new THREE.CylinderGeometry(10,10,.35,48),material(0x173047,.82,.08));plaza.position.y=.18;plaza.receiveShadow=true;world.add(plaza);
  const plazaRing=new THREE.Mesh(new THREE.TorusGeometry(7.3,.16,10,64),new THREE.MeshStandardMaterial({color:0x5dd8ff,emissive:0x2ca3d7,emissiveIntensity:1.8,roughness:.35}));plazaRing.rotation.x=Math.PI/2;plazaRing.position.y=.43;world.add(plazaRing);
  createStreetLights();createTraffic();
}

function createStreetLights(){
  const poleMat=material(0x253a4d,.45,.5),glowMat=new THREE.MeshStandardMaterial({color:0xd9f2ff,emissive:0x7ccfff,emissiveIntensity:2.8});
  const spots=[];for(let p=-40;p<=40;p+=10){spots.push([6,p],[-6,p],[p,6],[p,-6]);}
  for(const [x,z] of spots){const group=new THREE.Group();const pole=new THREE.Mesh(new THREE.CylinderGeometry(.07,.09,2.3,8),poleMat);pole.position.y=1.15;const light=new THREE.Mesh(new THREE.SphereGeometry(.16,8,8),glowMat);light.position.y=2.35;group.add(pole,light);group.position.set(x,0,z);world.add(group);}
}
function createTraffic(){
  const colors=[0x4ea8ff,0xffc857,0xff6688,0x62e6b8,0xb98cff,0xf2f5f8];
  for(let i=0;i<6;i++){const car=new THREE.Mesh(new THREE.BoxGeometry(1.1,.42,.58),material(colors[i],.35,.2));car.position.y=.32;car.userData={phase:i/6,speed:.025+(i%3)*.004};cars.push(car);world.add(car);}
}

function districtConfig(realm,index){if(DISTRICTS[realm.slug])return DISTRICTS[realm.slug];const angle=(index/Math.max(1,realms.length))*Math.PI*2;return{position:[Math.cos(angle)*31,Math.sin(angle)*31],height:9+(index%4)*2,accent:0x67e8f9,label:realm.badge};}
function createRealmBuilding(realm,index){
  const cfg=districtConfig(realm,index),[x,z]=cfg.position,height=cfg.height,width=realm.slug==='neural'?9:8+(index%2)*1.5,depth=realm.slug==='neural'?9:7.5+(index%3)*.7;
  const group=new THREE.Group();group.position.set(x,0,z);group.userData.realmSlug=realm.slug;
  const podium=new THREE.Mesh(new THREE.BoxGeometry(width+2,.55,depth+2),material(0x13293d,.7,.16));podium.position.y=.27;podium.castShadow=true;podium.receiveShadow=true;group.add(podium);
  const body=new THREE.Mesh(new THREE.BoxGeometry(width,height,depth),material(realm.slug==='neural'?0x1b2143:0x17283b,.5,.22));body.position.y=.55+height/2;body.castShadow=true;body.receiveShadow=true;body.userData.realmSlug=realm.slug;clickableMeshes.push(body);group.add(body);
  const accentMat=new THREE.MeshStandardMaterial({color:cfg.accent,emissive:cfg.accent,emissiveIntensity:1.45,roughness:.34,metalness:.18});
  const crown=new THREE.Mesh(new THREE.BoxGeometry(width*.84,.35,depth*.84),accentMat);crown.position.y=height+.75;crown.userData.realmSlug=realm.slug;clickableMeshes.push(crown);group.add(crown);
  const entrance=new THREE.Mesh(new THREE.BoxGeometry(width*.34,2.2,.28),accentMat);entrance.position.set(0,1.65,depth/2+.15);entrance.userData.realmSlug=realm.slug;clickableMeshes.push(entrance);group.add(entrance);
  const windowMat=new THREE.MeshStandardMaterial({color:0xa9deff,emissive:cfg.accent,emissiveIntensity:.7,roughness:.5});
  const rows=Math.max(2,Math.floor(height/2.5));for(let row=0;row<rows;row++){for(const side of [-1,1]){const strip=new THREE.Mesh(new THREE.BoxGeometry(width*.28,.38,.08),windowMat);strip.position.set(side*width*.23,2.6+row*1.8,depth/2+.05);group.add(strip);}}
  if(realm.slug==='neural'){
    const spire=new THREE.Mesh(new THREE.CylinderGeometry(.25,.65,5.5,10),accentMat);spire.position.y=height+3.6;group.add(spire);
    for(const radius of [7,9.5]){const ring=new THREE.Mesh(new THREE.TorusGeometry(radius,.08,8,72),accentMat.clone());ring.rotation.x=Math.PI/2;ring.position.y=4.4;ring.userData.spin=radius===7?.18:-.12;portalRings.push(ring);group.add(ring);}
  }else{
    const beacon=new THREE.Mesh(new THREE.SphereGeometry(.32,12,12),accentMat);beacon.position.set(0,height+1.25,0);group.add(beacon);
  }
  const label=make('button','realm-label');label.type='button';label.dataset.realm=realm.slug;
  label.append(make('small','',cfg.label||realm.badge),document.createTextNode(realm.title));
  label.onclick=()=>focusRealm(realm);labelsLayer.append(label);labels.push({element:label,realm,anchor:new THREE.Vector3(x,height+2.5,z)});
  realmGroups.set(realm.slug,group);world.add(group);
}

function clearRealmCity(){
  for(const group of realmGroups.values())world?.remove(group);realmGroups.clear();clickableMeshes=[];portalRings=[];labels.forEach(item=>item.element.remove());labels=[];
}
function buildRealmCity(){if(!world)return;clearRealmCity();realms.forEach(createRealmBuilding);realmSummary.textContent=`${realms.length} universos • toque em um prédio`;loading?.classList.add('ready');updateLabels();}

function updateCamera(){
  if(!camera)return;cameraPhi=Math.max(.32,Math.min(1.28,cameraPhi));cameraRadius=Math.max(31,Math.min(105,cameraRadius));
  const sinPhi=Math.sin(cameraPhi);camera.position.set(target.x+cameraRadius*sinPhi*Math.cos(cameraTheta),target.y+cameraRadius*Math.cos(cameraPhi),target.z+cameraRadius*sinPhi*Math.sin(cameraTheta));camera.lookAt(target);
}
function resetCamera(){cameraRadius=70;cameraTheta=.78;cameraPhi=.88;target.set(0,3,0);updateCamera();}
function zoomBy(delta){cameraRadius=Math.max(31,Math.min(105,cameraRadius+delta));updateCamera();}
function resize(){if(!renderer||!camera)return;const rect=stage.getBoundingClientRect();renderer.setSize(rect.width,rect.height,false);camera.aspect=Math.max(.1,rect.width/Math.max(1,rect.height));camera.updateProjectionMatrix();}

function pointerNdc(event){const rect=canvas.getBoundingClientRect();mouse.x=((event.clientX-rect.left)/rect.width)*2-1;mouse.y=-((event.clientY-rect.top)/rect.height)*2+1;}
function raycastRealm(event){pointerNdc(event);raycaster.setFromCamera(mouse,camera);const hit=raycaster.intersectObjects(clickableMeshes,false)[0];if(!hit)return null;return realms.find(realm=>realm.slug===hit.object.userData.realmSlug)||null;}
function installControls(){
  canvas.addEventListener('pointerdown',event=>{activePointers.set(event.pointerId,{x:event.clientX,y:event.clientY});canvas.setPointerCapture(event.pointerId);if(activePointers.size===1){dragging=true;dragMoved=false;dragStart={x:event.clientX,y:event.clientY,theta:cameraTheta,phi:cameraPhi};stage.classList.add('dragging');}else if(activePointers.size===2){const pts=[...activePointers.values()];pinchDistance=Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y);}});
  canvas.addEventListener('pointermove',event=>{if(activePointers.has(event.pointerId))activePointers.set(event.pointerId,{x:event.clientX,y:event.clientY});if(activePointers.size===2){const pts=[...activePointers.values()],distance=Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y);if(pinchDistance){zoomBy((pinchDistance-distance)*.055);dragMoved=true;}pinchDistance=distance;return;}if(dragging){const dx=event.clientX-dragStart.x,dy=event.clientY-dragStart.y;if(Math.abs(dx)+Math.abs(dy)>5)dragMoved=true;cameraTheta=dragStart.theta-dx*.006;cameraPhi=dragStart.phi+dy*.0045;updateCamera();return;}const realm=raycastRealm(event);if(hoveredMesh!==realm?.slug){hoveredMesh=realm?.slug||null;canvas.style.cursor=realm?'pointer':'grab';}});
  canvas.addEventListener('pointerup',event=>{const wasMoved=dragMoved;activePointers.delete(event.pointerId);if(activePointers.size<2)pinchDistance=0;if(activePointers.size===0){dragging=false;stage.classList.remove('dragging');if(!wasMoved){const realm=raycastRealm(event);if(realm)focusRealm(realm);}}});
  canvas.addEventListener('pointercancel',event=>{activePointers.delete(event.pointerId);dragging=false;pinchDistance=0;stage.classList.remove('dragging');});
  canvas.addEventListener('wheel',event=>{event.preventDefault();zoomBy(event.deltaY>0?4:-4);},{passive:false});
  window.addEventListener('resize',resize);
  document.getElementById('zoomIn').onclick=()=>zoomBy(-7);
  document.getElementById('zoomOut').onclick=()=>zoomBy(7);
  document.getElementById('resetView').onclick=resetCamera;
}

function projectAnchor(anchor){const p=anchor.clone().project(camera);return{x:(p.x*.5+.5)*stage.clientWidth,y:(-.5*p.y+.5)*stage.clientHeight,behind:p.z>1||p.z<-1};}
function updateLabels(){if(!camera)return;for(const item of labels){const pos=projectAnchor(item.anchor);item.element.style.left=`${pos.x}px`;item.element.style.top=`${pos.y}px`;item.element.classList.toggle('behind',pos.behind||pos.x<-80||pos.x>stage.clientWidth+80||pos.y<-40||pos.y>stage.clientHeight+60);item.element.classList.toggle('active',activeRealm?.slug===item.realm.slug);}}
function updateTraffic(elapsed){for(let i=0;i<cars.length;i++){const car=cars[i],t=(car.userData.phase+elapsed*car.userData.speed)%1,perimeter=144,position=t*perimeter;if(position<36){car.position.set(-18+position,.32,-4.7);car.rotation.y=Math.PI/2;}else if(position<72){car.position.set(18,.32,-4.7+(position-36));car.rotation.y=0;}else if(position<108){car.position.set(18-(position-72),.32,31.3);car.rotation.y=-Math.PI/2;}else{car.position.set(-18,.32,31.3-(position-108));car.rotation.y=Math.PI;}}}
function animate(){animationFrame=requestAnimationFrame(animate);const elapsed=(performance.now()-startTime)/1000;for(const ring of portalRings)ring.rotation.z=elapsed*ring.userData.spin;updateTraffic(elapsed);updateLabels();renderer.render(scene,camera);}

function focusRealm(realm){
  activeRealm=realm;const cfg=districtConfig(realm,realms.indexOf(realm)),[x,z]=cfg.position;target.set(x,cfg.height*.28,z);cameraRadius=Math.max(35,Math.min(cameraRadius,54));updateCamera();selectRealm(realm,true);
}
function selectRealm(realm,recordVisit=true){
  activeRealm=realm;realmBadge.textContent=realm.badge||'UNIVERSO';realmTitle.textContent=realm.title;realmDescription.textContent=realm.description||'';realmCategory.textContent=realm.categoryLabel||realm.category||'Ecossistema';const city=selectedCity();realmCity.textContent=`${city?.name||'VitrineCity'} — ${city?.stateCode||city?.state||''}`;
  realmImage.hidden=!realm.imagePath;if(realm.imagePath)realmImage.src=realm.imagePath;else realmImage.removeAttribute('src');panel.classList.add('show');panel.setAttribute('aria-hidden','false');
  document.querySelectorAll('.dock-realm').forEach(button=>button.classList.toggle('active',button.dataset.realm===realm.slug));labels.forEach(item=>item.element.classList.toggle('active',item.realm.slug===realm.slug));
  const url=new URL(location.href);url.searchParams.set('universo',realm.slug);history.replaceState({},'',`${url.pathname}${url.search}${url.hash}`);
  if(recordVisit)sendMultiversalEvent({kind:'place-visit',citySlug:activeCitySlug,realmSlug:realm.slug,placeSlug:realm.slug,placeType:'realm'});
}
async function enterActiveRealm(){
  if(!activeRealm)return;const previous=readLastRealm();rememberRealm(activeRealm);let destination=localPath(activeRealm.href||appendCity(activeRealm.entryPath,activeCitySlug),'/multiversal.html');
  try{
    const response=await fetch('/api/multiversal/transition',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({citySlug:activeCitySlug,fromRealm:previous?.citySlug===activeCitySlug&&previous?.slug!==activeRealm.slug?previous?.slug:null,toRealm:activeRealm.slug,sourcePath:`${location.pathname}${location.search}`})});
    const data=response.ok?await safeJson(response):null;if(data?.href)destination=localPath(data.href,destination);
  }catch{/* Telemetria não pode impedir a entrada no universo. */}
  location.assign(localPath(destination,'/multiversal.html'));
}

async function switchCity(nextSlug){
  if(nextSlug===activeCitySlug||!cities.some(city=>city.slug===nextSlug))return;const previous=activeCitySlug;activeCitySlug=nextSlug;rememberCity(nextSlug);updateLocationCity(nextSlug);renderCitySelect();panel.classList.remove('show');activeRealm=null;await loadRealms(nextSlug);sendMultiversalEvent({kind:'city-change',citySlug:nextSlug,fromCitySlug:previous});
}

function setNeuralState(online){
  neuralState.classList.toggle('online',online);
  const indicator=make('i');
  neuralState.replaceChildren(indicator,document.createTextNode(online?'Vitriny Neural conectada':'Neural em modo de navegação'));
}

citySelect.onchange=()=>switchCity(citySelect.value);
document.getElementById('closeIntro').onclick=()=>document.getElementById('cityIntro')?.remove();
document.getElementById('closePanel').onclick=()=>{panel.classList.remove('show');panel.setAttribute('aria-hidden','true');activeRealm=null;document.querySelectorAll('.dock-realm').forEach(button=>button.classList.remove('active'));};
enterRealm.onclick=enterActiveRealm;

async function bootstrap(){
  initThree();await loadContext();
  try{
    const response=await fetch(`/api/multiversal/context?cidade=${encodeURIComponent(activeCitySlug)}`,{headers:{Accept:'application/json'}}),data=response.ok?await safeJson(response):{};
    setNeuralState(data.neuralCapture===true);
  }catch{setNeuralState(false);}
  sendMultiversalEvent({kind:'enter',citySlug:activeCitySlug,realmSlug:currentRealmFromUrl()?.slug||''});
}

window.addEventListener('pagehide',()=>{if(animationFrame)cancelAnimationFrame(animationFrame);});
bootstrap();
