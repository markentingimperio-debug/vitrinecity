import {spatialExplorerHref,spatialFallbackCity} from './vitriny-spatial-api-client.js';

const cityIds=['vitrine-city','silvania','anapolis','vianopolis','goiania'];
const descriptions={
  'vitrine-city':['O futuro tem um lugar para você.','Atravesse o portal. Explore distritos, encontre pessoas e descubra negócios em uma cidade conectada.'],
  silvania:['A tradição encontra um novo horizonte.','A Coroa do Cerrado conecta natureza e arquitetura em uma cidade imaginada para novas possibilidades.'],
  anapolis:['Conexões que levam você mais longe.','Uma cidade de encontros, caminhos e movimento. Entre no Arco Conector e explore seu próximo destino.'],
  vianopolis:['Um portal para o extraordinário.','O Cerrado ganha uma nova dimensão. Descubra a identidade e os distritos da prévia de Vianópolis.'],
  goiania:['Uma nova órbita para a vida urbana.','Arquitetura, cultura e conexões na Órbita Metropolitana. Explore a prévia de uma cidade em transformação.']
};
const sceneHost=document.getElementById('planetScene'),status=document.getElementById('renderStatus');
const motionButton=document.getElementById('toggleMotion'),motionPreference=matchMedia('(prefers-reduced-motion:reduce)');
let selected=0,paused=motionPreference.matches,selectBeacon=()=>{};
function updateMotion(){motionButton.textContent=paused?'Ativar movimento':'Pausar movimento';motionButton.setAttribute('aria-pressed',String(paused));}
updateMotion();motionButton.addEventListener('click',()=>{paused=!paused;updateMotion();});
motionPreference.addEventListener('change',event=>{paused=event.matches;updateMotion();});
function selectCity(id){
  const index=cityIds.indexOf(id);if(index<0)return;selected=index;const city=spatialFallbackCity(id),active=city.status==='active';
  document.getElementById('cityIndex').textContent=String(index+1).padStart(2,'0');
  const name=document.getElementById('cityName');name.replaceChildren();
  if(id==='vitrine-city'){name.append('Vitrine',document.createElement('br'));const em=document.createElement('em');em.textContent='City.';name.append(em);}else{const em=document.createElement('em');em.textContent=city.name+'.';name.append(em);}
  document.getElementById('cityTagline').textContent=descriptions[id][0];document.getElementById('cityDescription').textContent=descriptions[id][1];
  document.getElementById('cityStatus').textContent=active?'HUB DO ECOSSISTEMA':'EXPLORAÇÃO EM PRÉVIA';
  document.getElementById('cityMeta').textContent=active?'8 distritos conectados':'Comércio local em preparação';
  const enter=document.getElementById('enterCity');enter.href=spatialExplorerHref(id);enter.setAttribute('aria-label',`Explorar ${city.name}`);
  document.querySelectorAll('[data-city]').forEach(link=>link.classList.toggle('selected',link.dataset.city===id));selectBeacon(index);
}
document.querySelectorAll('[data-city]').forEach(link=>{link.addEventListener('pointerenter',()=>selectCity(link.dataset.city));link.addEventListener('focus',()=>selectCity(link.dataset.city));});

async function startPlanet(){
  const THREE=await import('/vendor/three/three.module.js');
  const lite=matchMedia('(max-width:680px)').matches||Number(navigator.hardwareConcurrency||2)<6;
  const renderer=new THREE.WebGLRenderer({antialias:!lite,alpha:true,powerPreference:lite?'low-power':'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,lite?1.25:1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.2;sceneHost.append(renderer.domElement);
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(40,1,.1,1500);camera.position.set(0,5,94);
  const system=new THREE.Group();scene.add(system);system.rotation.z=-.23;system.rotation.y=.4;
  const planet=new THREE.Group();system.add(planet);
  scene.add(new THREE.AmbientLight(0x718f98,1.2));const sun=new THREE.DirectionalLight(0xe0f5db,3.6);sun.position.set(-30,35,45);scene.add(sun);
  const rim=new THREE.DirectionalLight(0x38bca6,2.6);rim.position.set(35,10,-15);scene.add(rim);
  const globe=new THREE.Mesh(new THREE.SphereGeometry(20,lite?48:80,lite?32:64),new THREE.MeshPhysicalMaterial({color:0x0b242d,roughness:.62,metalness:.42,clearcoat:.6}));planet.add(globe);
  planet.add(new THREE.Mesh(new THREE.SphereGeometry(20.04,40,24),new THREE.MeshBasicMaterial({color:0x80d6b9,wireframe:true,transparent:true,opacity:.07})));
  const atmosphere=new THREE.Mesh(new THREE.SphereGeometry(21.2,48,40),new THREE.ShaderMaterial({uniforms:{glowColor:{value:new THREE.Color(0x66d8bc)}},vertexShader:'varying vec3 vNormal; varying vec3 vPosition; void main(){vNormal=normalize(normalMatrix*normal);vec4 p=modelViewMatrix*vec4(position,1.0);vPosition=p.xyz;gl_Position=projectionMatrix*p;}',fragmentShader:'uniform vec3 glowColor; varying vec3 vNormal; varying vec3 vPosition; void main(){float rim=pow(1.0-abs(dot(normalize(vNormal),normalize(-vPosition))),3.5);gl_FragColor=vec4(glowColor,rim*0.5);}',transparent:true,blending:THREE.AdditiveBlending,depthWrite:false}));planet.add(atmosphere);
  const count=lite?650:1800,towers=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({color:0x2d494e,metalness:.72,roughness:.28}),count);
  const windows=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial({color:0xd5c69b}),count);
  const dummy=new THREE.Object3D(),normal=new THREE.Vector3(),up=new THREE.Vector3(0,1,0);let used=0;
  for(let i=0;i<count;i++){
    const phi=i*2.3999632297,y=1-2*(i+.5)/count,r=Math.sqrt(1-y*y);normal.set(Math.cos(phi)*r,y,Math.sin(phi)*r);
    if(Math.sin(normal.x*8+normal.z*3)+Math.cos(normal.y*11-normal.z*5)<-.25)continue;
    const h=.18+((Math.sin(i*127.1)*43758.5453)%1+1)%1*1.6;
    dummy.position.copy(normal).multiplyScalar(20+h/2);dummy.quaternion.setFromUnitVectors(up,normal);dummy.scale.set(.18,h,.18);dummy.updateMatrix();towers.setMatrixAt(used,dummy.matrix);
    dummy.position.copy(normal).multiplyScalar(20+h+.025);dummy.scale.set(.19,.06,.19);dummy.updateMatrix();windows.setMatrixAt(used,dummy.matrix);windows.setColorAt(used,new THREE.Color(used%4===0?0x77e4cf:0xe4c294));used++;
  }
  towers.count=windows.count=used;planet.add(towers,windows);
  for(const [radius,tilt,opacity,color] of [[27,.25,.45,0xa3ceb8],[32,-.5,.2,0xe1be87],[38,.8,.1,0x80aab5]]){
    const ring=new THREE.Mesh(new THREE.TorusGeometry(radius,.035,6,lite?120:200),new THREE.MeshBasicMaterial({color,transparent:true,opacity}));ring.rotation.x=Math.PI/2+tilt;system.add(ring);
  }
  const arcPoints=[];for(let i=0;i<=150;i++){const a=i/150*Math.PI*1.8;arcPoints.push(new THREE.Vector3(Math.cos(a)*28,Math.sin(a)*8,Math.sin(a)*28));}
  system.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(arcPoints),new THREE.LineBasicMaterial({color:0xe4c69b,transparent:true,opacity:.6})));
  const positions=[[-.3,.24,.923],[.64,.25,.72],[-.68,-.15,.71],[.25,-.51,.82],[.18,.77,.61]],beacons=[];
  for(let i=0;i<5;i++){
    const pos=new THREE.Vector3(...positions[i]).normalize(),group=new THREE.Group();group.position.copy(pos).multiplyScalar(22.5);group.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),pos);
    group.add(new THREE.Mesh(new THREE.RingGeometry(.55,.68,40),new THREE.MeshBasicMaterial({color:0xe2c99e,side:THREE.DoubleSide})),new THREE.Mesh(new THREE.SphereGeometry(.22,12,12),new THREE.MeshBasicMaterial({color:0xd8fff0})));
    group.userData.cityIndex=i;planet.add(group);beacons.push(group);
  }
  selectBeacon=index=>{beacons.forEach((b,i)=>{b.scale.setScalar(i===index?1.8:1);b.children[0].material.color.set(i===index?0xafffe2:0xddbd88);});};selectBeacon(selected);
  const stars=new Float32Array((lite?220:600)*3);for(let i=0;i<stars.length;i+=3){const t=i+1;stars[i]=Math.sin(t*127.1)*200;stars[i+1]=Math.cos(t*311.7)*140;stars[i+2]=-80-Math.abs(Math.sin(t*73.5))*200;}
  const starGeo=new THREE.BufferGeometry();starGeo.setAttribute('position',new THREE.BufferAttribute(stars,3));scene.add(new THREE.Points(starGeo,new THREE.PointsMaterial({color:0xa5bdc6,size:.22,transparent:true,opacity:.7,sizeAttenuation:true})));
  function resize(){const width=sceneHost.clientWidth,height=sceneHost.clientHeight,mobile=width<681;renderer.setSize(width,height);camera.aspect=width/height;camera.updateProjectionMatrix();system.position.set(mobile?0:14,mobile?21:12,0);system.scale.setScalar(mobile?.66:1);camera.position.z=mobile?105:94;}
  resize();addEventListener('resize',resize);
  let dragging=false,lastX=0,lastY=0,startX=0,startY=0,dragOffset=0;
  const pointer=new THREE.Vector2(),raycaster=new THREE.Raycaster();
  renderer.domElement.addEventListener('pointerdown',event=>{dragging=true;lastX=startX=event.clientX;lastY=startY=event.clientY;renderer.domElement.setPointerCapture(event.pointerId);});
  renderer.domElement.addEventListener('pointermove',event=>{if(!dragging)return;dragOffset+=(event.clientX-lastX)*.003;system.rotation.x=Math.max(-.5,Math.min(.5,system.rotation.x+(event.clientY-lastY)*.001));lastX=event.clientX;lastY=event.clientY;});
  renderer.domElement.addEventListener('pointerup',event=>{dragging=false;if(Math.hypot(event.clientX-startX,event.clientY-startY)>7)return;const box=renderer.domElement.getBoundingClientRect();pointer.set((event.clientX-box.left)/box.width*2-1,-(event.clientY-box.top)/box.height*2+1);raycaster.setFromCamera(pointer,camera);const hit=raycaster.intersectObjects(beacons,true)[0];if(hit){let node=hit.object;while(node&&node.userData.cityIndex===undefined)node=node.parent;if(node)selectCity(cityIds[node.userData.cityIndex]);}});
  for(const event of ['pointercancel','lostpointercapture'])renderer.domElement.addEventListener(event,()=>{dragging=false;});
  let frame=0,last=performance.now(),orbit=0,disposed=false;
  function animate(now){if(disposed)return;frame=requestAnimationFrame(animate);const dt=Math.min(.05,(now-last)/1000);last=now;if(document.hidden)return;if(!paused&&!dragging)orbit+=dt*.022;planet.rotation.y=orbit+dragOffset;renderer.render(scene,camera);}
  frame=requestAnimationFrame(animate);status.textContent='Arraste o planeta para explorar.';document.documentElement.dataset.planetReady='true';
  renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();paused=true;updateMotion();status.textContent='Use os links para continuar explorando.';});
  addEventListener('pagehide',event=>{if(event.persisted)return;disposed=true;cancelAnimationFrame(frame);removeEventListener('resize',resize);scene.traverse(object=>{object.geometry?.dispose();for(const m of Array.isArray(object.material)?object.material:[object.material])m?.dispose();});renderer.dispose();});
}
startPlanet().catch(()=>{status.textContent='Versão leve: escolha uma cidade abaixo.';motionButton.hidden=true;document.documentElement.dataset.planetReady='fallback';});
