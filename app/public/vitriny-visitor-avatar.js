import * as THREE from '/vendor/three/three.module.js';
import {createUrbanPerson} from './vitriny-urban-models.js';

const SKINS=['#f2c5a1','#c88d61','#946342','#593a2a'];
const OUTFITS=['#2f697b','#c4a15f','#705c84','#485747'];
const STORAGE_KEY='vitrinyVisitorAvatar:v1';

export function mountVisitorAvatar({scene,dialog,onEnter}){
  let appearance={skin:1,outfit:0};try{const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');if(saved&&Number.isInteger(saved.skin)&&Number.isInteger(saved.outfit)&&SKINS[saved.skin]&&OUTFITS[saved.outfit])appearance=saved;}catch{}
  const person=createUrbanPerson({skinColor:SKINS[appearance.skin],outfitColor:OUTFITS[appearance.outfit],detailed:true});
  const {group,legs,arms}=person,{skin,shirt}=person.materials;group.name='my-visitor-avatar';group.visible=false;scene.add(group);
  function mesh(parent,geometry,material,x,y,z){const object=new THREE.Mesh(geometry,material);object.position.set(x,y,z);object.castShadow=true;parent.add(object);return object;}
  const premium=new THREE.Group();premium.visible=false;group.add(premium);
  const gold=new THREE.MeshStandardMaterial({color:'#cfaf68',metalness:.78,roughness:.26}),glow=new THREE.MeshStandardMaterial({color:'#68e8ed',emissive:'#35aab4',emissiveIntensity:.65,metalness:.4,roughness:.25});
  mesh(premium,new THREE.CylinderGeometry(.218,.19,.5,12),gold,0,1.15,0);
  mesh(premium,new THREE.BoxGeometry(.25,.055,.045),glow,0,1.65,.143);
  for(const side of [-1,1]){mesh(premium,new THREE.BoxGeometry(.12,.07,.2),gold,side*.24,1.39,0);mesh(premium,new THREE.BoxGeometry(.026,.36,.035),glow,side*.12,1.16,.2);}
  let premiumExpiresAt=0,serverClockOffset=0,premiumSelected=false,premiumPreferenceSet=false,premiumRequest=null;
  const premiumLabel=document.createElement('label'),premiumCheck=document.createElement('input'),premiumText=document.createElement('span'),premiumLink=document.createElement('a');premiumCheck.type='checkbox';premiumCheck.disabled=true;premiumText.textContent='Traje Orbit premium · consultando acesso';premiumLabel.append(premiumCheck,premiumText);premiumLabel.style.cssText='display:flex;gap:12px;align-items:center;margin:18px 0';premiumLink.href='/central-creditos.html';premiumLink.textContent='Avatar premium · R$ 10 / 30 dias · até 30% em moedas';premiumLink.style.cssText='display:block;color:#f4d18c;margin:12px 0';dialog.querySelector('[data-enter-avatar]').before(premiumLabel,premiumLink);
  async function checkPremium(){if(premiumRequest)return;premiumRequest=new AbortController();try{const response=await fetch('/api/rewards/me',{credentials:'same-origin',cache:'no-store',signal:premiumRequest.signal});if(!response.ok)throw Error();const data=await response.json();const serverTime=Date.parse(response.headers.get('date')||'');serverClockOffset=Number.isFinite(serverTime)?serverTime-Date.now():0;premiumExpiresAt=data.avatar.active?Number(data.avatar.expiresAt):0;premiumCheck.disabled=!premiumExpiresAt;premiumText.textContent=premiumExpiresAt?'Traje Orbit premium · até '+new Date(premiumExpiresAt).toLocaleDateString('pt-BR'):'Traje Orbit premium · ativação na central';if(premiumExpiresAt&&!premiumPreferenceSet){premiumSelected=true;premiumPreferenceSet=true;premiumCheck.checked=true;}}catch{premiumExpiresAt=0;premiumCheck.disabled=true;premiumText.textContent='Traje Orbit premium · confira seu acesso na central';}finally{premiumRequest=null;}}
  premiumCheck.addEventListener('change',()=>{premiumPreferenceSet=true;premiumSelected=premiumCheck.checked;});checkPremium();let nextPremiumCheck=Date.now()+60000;
  window.addEventListener('pagehide',()=>{premiumRequest?.abort();});
  const skinSelect=dialog.querySelector('[name="skin"]'),outfitSelect=dialog.querySelector('[name="outfit"]');skinSelect.value=String(appearance.skin);outfitSelect.value=String(appearance.outfit);
  function update(){appearance={skin:Number(skinSelect.value),outfit:Number(outfitSelect.value)};skin.color.set(SKINS[appearance.skin]||SKINS[1]);shirt.color.set(OUTFITS[appearance.outfit]||OUTFITS[0]);try{localStorage.setItem(STORAGE_KEY,JSON.stringify(appearance));}catch{}}
  skinSelect.addEventListener('change',update);outfitSelect.addEventListener('change',update);
  dialog.querySelector('[data-close]').addEventListener('click',()=>dialog.close());
  dialog.querySelector('[data-enter-avatar]').addEventListener('click',()=>{update();dialog.close();onEnter();});
  let phase=0;
  return {group,tick(dt,{position,yaw,moving=false,visible=false}){if(Date.now()>=nextPremiumCheck){nextPremiumCheck=Date.now()+60000;checkPremium();}premium.visible=premiumSelected&&premiumCheck.checked&&Date.now()+serverClockOffset<premiumExpiresAt;group.visible=visible;if(!visible)return;group.position.set(position.x,.13,position.z);group.rotation.y=-yaw;if(moving)phase+=dt*9;
    person.pose(phase,moving);group.position.y+=moving?Math.abs(Math.sin(phase))*.035:0;
  }};
}
