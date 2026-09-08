import * as THREE from '/vendor/three/three.module.js';

const SKINS=['#f2c5a1','#c88d61','#946342','#593a2a'];
const OUTFITS=['#2f697b','#c4a15f','#705c84','#485747'];
const STORAGE_KEY='vitrinyVisitorAvatar:v1';

export function mountVisitorAvatar({scene,dialog,onEnter}){
  let appearance={skin:1,outfit:0};try{const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');if(saved&&Number.isInteger(saved.skin)&&Number.isInteger(saved.outfit)&&SKINS[saved.skin]&&OUTFITS[saved.outfit])appearance=saved;}catch{}
  const group=new THREE.Group();group.name='my-visitor-avatar';group.visible=false;scene.add(group);
  const skin=new THREE.MeshStandardMaterial({color:SKINS[appearance.skin],roughness:.75});
  const shirt=new THREE.MeshStandardMaterial({color:OUTFITS[appearance.outfit],roughness:.64});
  const trousers=new THREE.MeshStandardMaterial({color:'#26343b',roughness:.9});
  const hair=new THREE.MeshStandardMaterial({color:'#322c28',roughness:.98});
  const shoes=new THREE.MeshStandardMaterial({color:'#292b2a',roughness:.9});
  function mesh(parent,geometry,material,x,y,z){const object=new THREE.Mesh(geometry,material);object.position.set(x,y,z);object.castShadow=true;parent.add(object);return object;}
  mesh(group,new THREE.CylinderGeometry(.21,.18,.53,12),shirt,0,1.15,0);
  const head=mesh(group,new THREE.SphereGeometry(.15,16,12),skin,0,1.63,0);head.scale.set(.9,1.15,1);
  mesh(group,new THREE.SphereGeometry(.151,16,8,0,Math.PI*2,0,Math.PI*.58),hair,0,1.67,-.005);
  mesh(group,new THREE.CylinderGeometry(.065,.07,.1,10),skin,0,1.44,0);
  for(const x of [-.05,.05])mesh(group,new THREE.SphereGeometry(.012,6,6),hair,x,1.66,.138);
  const arms=[],legs=[];
  for(const side of [-1,1]){
    const arm=new THREE.Group();arm.position.set(side*.24,1.36,0);group.add(arm);arms.push(arm);
    mesh(arm,new THREE.CylinderGeometry(.065,.06,.27,8),shirt,0,-.13,0);
    mesh(arm,new THREE.CylinderGeometry(.052,.04,.27,8),skin,0,-.39,0);
    mesh(arm,new THREE.SphereGeometry(.055,8,6),skin,0,-.54,0);
    const leg=new THREE.Group();leg.position.set(side*.115,.91,0);group.add(leg);legs.push(leg);
    mesh(leg,new THREE.CylinderGeometry(.089,.065,.72,10),trousers,0,-.36,0);
    mesh(leg,new THREE.BoxGeometry(.16,.12,.28),shoes,0,-.82,.055);
  }
  const badge=mesh(group,new THREE.PlaneGeometry(.085,.11),new THREE.MeshStandardMaterial({color:'#ecd598',metalness:.45,roughness:.4}),-.095,1.25,.196);badge.rotation.y=-.15;
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
    const stride=moving?Math.sin(phase)*.48:0;legs[0].rotation.x=stride;legs[1].rotation.x=-stride;arms[0].rotation.x=-stride*.75;arms[1].rotation.x=stride*.75;group.position.y+=moving?Math.abs(Math.sin(phase))*.035:0;
  }};
}
