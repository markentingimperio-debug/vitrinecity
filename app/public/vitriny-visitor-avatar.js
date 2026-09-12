import * as THREE from '/vendor/three/three.module.js';
import {createUrbanPerson} from './vitriny-urban-models.js';

const SKINS=['#f2c5a1','#c88d61','#946342','#593a2a'];
const OUTFITS=['#2f697b','#c4a15f','#705c84','#485747'];
const STORAGE_KEY='vitrinyVisitorAvatar:v1';

export function mountVisitorAvatar({scene,dialog,onEnter}){
  let appearance={skin:1,outfit:0};try{const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');if(saved&&Number.isInteger(saved.skin)&&Number.isInteger(saved.outfit)&&SKINS[saved.skin]&&OUTFITS[saved.outfit])appearance={skin:saved.skin,outfit:saved.outfit};}catch{}
  const fallback=createUrbanPerson({skinColor:SKINS[appearance.skin],outfitColor:OUTFITS[appearance.outfit],detailed:true});
  const group=new THREE.Group();group.name='my-visitor-avatar';group.visible=false;group.add(fallback.group);scene.add(group);
  const premium=new THREE.Group();premium.visible=false;fallback.group.add(premium);
  const gold=new THREE.MeshStandardMaterial({color:'#cfaf68',metalness:.78,roughness:.26}),glow=new THREE.MeshStandardMaterial({color:'#68e8ed',emissive:'#35aab4',emissiveIntensity:.65,metalness:.4,roughness:.25});
  function mesh(geometry,material,x,y,z){const object=new THREE.Mesh(geometry,material);object.position.set(x,y,z);object.castShadow=true;premium.add(object);}
  mesh(new THREE.CylinderGeometry(.218,.19,.5,12),gold,0,1.15,0);mesh(new THREE.BoxGeometry(.25,.055,.045),glow,0,1.65,.143);
  for(const side of [-1,1]){mesh(new THREE.BoxGeometry(.12,.07,.2),gold,side*.24,1.39,0);mesh(new THREE.BoxGeometry(.026,.36,.035),glow,side*.12,1.16,.2);}
  let realistic=null,modelTask=null,disposed=false,phase=0;
  let preview=null,previewPerson=null,previewTask=null,previewFrame=0,previewWalking=false,previewYaw=0,previewLast=0,previewUnavailable=false;
  let premiumExpiresAt=0,serverClockOffset=0,premiumSelected=false,premiumPreferenceSet=false,premiumRequest=null,nextPremiumCheck=Date.now()+60000;
  const premiumLabel=document.createElement('label'),premiumCheck=document.createElement('input'),premiumText=document.createElement('span'),premiumLink=document.createElement('a');
  premiumCheck.type='checkbox';premiumCheck.disabled=true;premiumText.textContent='Traje Orbit premium · consultando acesso';premiumLabel.append(premiumCheck,premiumText);premiumLabel.style.cssText='display:flex;gap:12px;align-items:center;margin:18px 0';premiumLink.href='/central-creditos.html';premiumLink.textContent='Avatar premium · R$ 10 / 30 dias · até 30% em moedas';premiumLink.style.cssText='display:block;color:#f4d18c;margin:12px 0';dialog.querySelector('[data-enter-avatar]').before(premiumLabel,premiumLink);
  const skinSelect=dialog.querySelector('[name="skin"]'),outfitSelect=dialog.querySelector('[name="outfit"]');skinSelect.value=String(appearance.skin);outfitSelect.value=String(appearance.outfit);
  function paid(){return premiumSelected&&premiumCheck.checked&&Number.isFinite(premiumExpiresAt)&&Date.now()+serverClockOffset<premiumExpiresAt;}
  function applyAppearance(){
    fallback.materials.skin.color.set(SKINS[appearance.skin]);fallback.materials.shirt.color.set(OUTFITS[appearance.outfit]);
    for(const person of [realistic,previewPerson]){person?.setAppearance(SKINS[appearance.skin],OUTFITS[appearance.outfit]);person?.setPremium(paid());}
    premium.visible=paid();renderPreview();
  }
  function update(){appearance={skin:SKINS[Number(skinSelect.value)]?Number(skinSelect.value):1,outfit:OUTFITS[Number(outfitSelect.value)]?Number(outfitSelect.value):0};applyAppearance();try{localStorage.setItem(STORAGE_KEY,JSON.stringify(appearance));}catch{}}
  async function checkPremium(){
    if(premiumRequest||disposed)return;premiumRequest=new AbortController();
    try{
      const response=await fetch('/api/rewards/me',{credentials:'same-origin',cache:'no-store',signal:premiumRequest.signal});if(!response.ok)throw Error();const data=await response.json();if(disposed)return;
      const serverTime=Date.parse(response.headers.get('date')||'');serverClockOffset=Number.isFinite(serverTime)?serverTime-Date.now():0;
      const expiry=Number(data?.avatar?.expiresAt);premiumExpiresAt=data?.avatar?.active===true&&Number.isFinite(expiry)&&expiry>Date.now()+serverClockOffset?expiry:0;
      premiumCheck.disabled=!premiumExpiresAt;premiumText.textContent=premiumExpiresAt?'Traje Orbit premium · até '+new Date(premiumExpiresAt).toLocaleDateString('pt-BR'):'Traje Orbit premium · ativação na central';
      if(premiumExpiresAt&&!premiumPreferenceSet){premiumSelected=true;premiumPreferenceSet=true;premiumCheck.checked=true;}
    }catch{if(disposed)return;premiumExpiresAt=0;premiumCheck.disabled=true;premiumText.textContent='Traje Orbit premium · confira seu acesso na central';}
    finally{premiumRequest=null;if(!disposed)applyAppearance();}
  }
  function ensureModel(){
    if(modelTask)return modelTask;
    modelTask=import('./vitriny-realistic-avatar.js').then(module=>module.loadRealisticVisitor({skinColor:SKINS[appearance.skin],outfitColor:OUTFITS[appearance.outfit]})).then(person=>{
      if(disposed){person.dispose();return null;}realistic=person;fallback.group.visible=false;group.add(person.group);applyAppearance();return person;
    }).catch(()=>{if(preview)preview.status.textContent='Modelo detalhado indisponível agora. O avatar básico continua disponível para passear.';return null;});
    return modelTask;
  }
  function renderPreview(){
    if(!preview||!dialog.open||disposed)return;
    if(previewPerson){previewPerson.group.rotation.y=previewYaw;previewPerson.setPremium(paid());}
    const width=Math.max(1,preview.stage.clientWidth),height=Math.max(1,preview.stage.clientHeight);if(preview.width!==width||preview.height!==height){preview.width=width;preview.height=height;preview.renderer.setSize(width,height,false);preview.camera.aspect=width/height;preview.camera.updateProjectionMatrix();}preview.renderer.render(preview.scene,preview.camera);
  }
  function stopPreview(){cancelAnimationFrame(previewFrame);previewFrame=0;previewLast=0;}
  function animatePreview(time){
    if(!dialog.open||!previewWalking||disposed){stopPreview();return;}
    previewPerson?.tick(previewLast?(time-previewLast)/1000:1/60,true);previewLast=time;renderPreview();previewFrame=requestAnimationFrame(animatePreview);
  }
  function ensurePreview(){
    if(disposed||!dialog.open)return;ensureModel();if(previewUnavailable)return;
    if(!preview){
      if(!document.querySelector('link[data-visitor-preview]')){const css=document.createElement('link');css.rel='stylesheet';css.href='/vitriny-visitor-avatar.css';css.dataset.visitorPreview='true';document.head.append(css);}
      const section=document.createElement('section'),stage=document.createElement('div'),status=document.createElement('p'),controls=document.createElement('div');section.className='visitor-preview';stage.className='visitor-preview-stage';status.className='visitor-preview-status';status.setAttribute('role','status');status.textContent='Preparando seu avatar…';controls.className='visitor-preview-controls';
      const button=(text,action)=>{const b=document.createElement('button');b.type='button';b.textContent=text;b.addEventListener('click',action);controls.append(b);return b;};
      button('Girar',()=>{previewYaw+=Math.PI/4;renderPreview();});button('Ver de frente',()=>{previewYaw=0;renderPreview();});
      const walkButton=button('Ver caminhada',()=>{previewWalking=!previewWalking;walkButton.setAttribute('aria-pressed',String(previewWalking));walkButton.textContent=previewWalking?'Parar caminhada':'Ver caminhada';stopPreview();if(previewWalking)previewFrame=requestAnimationFrame(animatePreview);else{for(let i=0;i<50;i++)previewPerson?.tick(1/60,false);renderPreview();}});walkButton.setAttribute('aria-pressed','false');
      section.append(stage,controls,status);dialog.querySelector('.avatar-options').before(section);
      try{
        const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.08;renderer.domElement.setAttribute('role','img');renderer.domElement.setAttribute('aria-label','Prévia tridimensional do seu avatar com as cores escolhidas');stage.append(renderer.domElement);
        const previewScene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(34,1,.05,20);camera.position.set(0,1.14,3.6);camera.lookAt(0,.99,0);
        previewScene.add(new THREE.HemisphereLight('#e2f1f3','#515a52',2));const key=new THREE.DirectionalLight('#fff1df',3);key.position.set(-3,5,4);previewScene.add(key);const rim=new THREE.DirectionalLight('#c6e1ec',1.8);rim.position.set(3,4,-2);previewScene.add(rim);
        const ground=new THREE.Mesh(new THREE.CircleGeometry(.65,40),new THREE.MeshBasicMaterial({color:'#243d42',transparent:true,opacity:.8}));ground.rotation.x=-Math.PI/2;ground.position.y=-.012;previewScene.add(ground);
        preview={renderer,scene:previewScene,camera,stage,status,ground};renderPreview();
      }catch{previewUnavailable=true;status.textContent='A prévia 3D não está disponível neste dispositivo. Você ainda pode escolher as cores e passear.';controls.hidden=true;stage.hidden=true;return;}
    }
    if(!previewTask)previewTask=import('./vitriny-realistic-avatar.js').then(module=>module.loadRealisticVisitor({skinColor:SKINS[appearance.skin],outfitColor:OUTFITS[appearance.outfit]})).then(person=>{
      if(disposed){person.dispose();return;}previewPerson=person;preview.scene.add(person.group);preview.status.textContent='Escolha as cores abaixo. Use os botões para observar o rosto, a roupa e o movimento.';applyAppearance();
    }).catch(()=>{if(preview)preview.status.textContent='Não foi possível carregar a prévia. O avatar básico continua disponível para passear.';});
    renderPreview();if(previewWalking&&!previewFrame)previewFrame=requestAnimationFrame(animatePreview);
  }
  skinSelect.addEventListener('change',update);outfitSelect.addEventListener('change',update);
  premiumCheck.addEventListener('change',()=>{premiumPreferenceSet=true;premiumSelected=premiumCheck.checked;applyAppearance();});
  dialog.querySelector('[data-close]').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',stopPreview);
  dialog.querySelector('[data-enter-avatar]').addEventListener('click',()=>{update();ensureModel();dialog.close();onEnter();});
  const observer=new MutationObserver(()=>{if(dialog.open)ensurePreview();else stopPreview();});observer.observe(dialog,{attributes:true,attributeFilter:['open']});
  window.addEventListener('resize',renderPreview);window.addEventListener('pageshow',()=>{if(dialog.open)ensurePreview();});
  function dispose(){if(disposed)return;disposed=true;stopPreview();premiumRequest?.abort();observer.disconnect();window.removeEventListener('resize',renderPreview);realistic?.dispose();previewPerson?.dispose();preview?.ground.geometry.dispose();preview?.ground.material.dispose();preview?.renderer.dispose();for(const material of Object.values(fallback.materials))material.dispose();for(const object of premium.children)object.geometry.dispose();gold.dispose();glow.dispose();group.removeFromParent();}
  window.addEventListener('pagehide',event=>{if(event.persisted)stopPreview();else dispose();});checkPremium();if(dialog.open)ensurePreview();
  return {group,dispose,tick(dt,{position,yaw,moving=false,visible=false}){
    if(disposed)return;if(Date.now()>=nextPremiumCheck){nextPremiumCheck=Date.now()+60000;checkPremium();}
    const verified=paid();premium.visible=verified;realistic?.setPremium(verified);group.visible=visible;if(!visible)return;ensureModel();group.position.set(position.x,.13,position.z);group.rotation.y=-yaw;
    if(realistic)realistic.tick(dt,moving);else{if(moving)phase+=dt*9;fallback.pose(phase,moving);group.position.y+=moving?Math.abs(Math.sin(phase))*.035:0;}
  }};
}
