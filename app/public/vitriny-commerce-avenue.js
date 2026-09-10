import * as THREE from '/vendor/three/three.module.js';
import {AFFILIATE_CENTERS} from './vitriny-affiliate-centers-core.js';
import {dressCommercialCenter} from './vitriny-building-signatures.js';
export function mountCommerceAvenue({scene,architecture,billboards,facade}){
  const buildings=[];
  const promenade=new THREE.Group();promenade.name='avenida-dos-afiliados';scene.add(promenade);
  const paving=architecture.pavingMaterial({color:'#d2c9b7',repeat:25,formal:true});
  architecture.part(promenade,paving,-162,.22,12,94,.25,320);
  architecture.part(promenade,architecture.graphite,-164,.37,12,12,.1,318);
  for(let z=-139;z<172;z+=12)architecture.part(promenade,architecture.warm,-164,.43,z,.18,.015,4);
  for(let z=-137;z<174;z+=32)for(const x of [-184,-144]){architecture.tree(promenade,x,z,.7,.3);architecture.part(promenade,architecture.wood,x+3,.9,z,3,.3,1.1);}
  AFFILIATE_CENTERS.forEach((center,index)=>{
    const group=new THREE.Group();group.name=`center-${center.id}`;group.position.set(-210,0,-115+index*64);group.rotation.y=Math.PI/2;
    group.userData={store:true,reference:`center-${center.id}`,label:center.title,href:center.href};
    const {part,stone,graphite,brass,glass,warm,textSign,tree}=architecture,{height}=center;
    const accent=new THREE.MeshStandardMaterial({color:new THREE.Color(center.color).lerp(new THREE.Color("#b3b3a0"),.68),metalness:.3,roughness:.38});architecture.materials.add(accent);
    const logoTexture=new THREE.TextureLoader().load(center.logo);logoTexture.colorSpace=THREE.SRGBColorSpace;logoTexture.anisotropy=8;
    if(center.logoCrop){const crop=center.logoCrop;logoTexture.repeat.set(crop.width,crop.height);logoTexture.offset.set(crop.x,1-crop.y-crop.height);}
    const logoMaterial=new THREE.MeshBasicMaterial({map:logoTexture,transparent:true,depthWrite:false,toneMapped:false});architecture.materials.add(logoMaterial);
    const backdrop=new THREE.MeshBasicMaterial({color:center.brandBackground,toneMapped:false});architecture.materials.add(backdrop);
    function brandSign(y,z,width,signHeight){
      part(group,graphite,0,y,z,width+.6,signHeight+.6,.5);
      part(group,backdrop,0,y,z+.29,width,signHeight,.08);
      const logoWidth=Math.min(width*.9,(signHeight-1)*center.logoRatio);
      const logo=new THREE.Mesh(new THREE.PlaneGeometry(logoWidth,logoWidth/center.logoRatio),logoMaterial);logo.position.set(0,y,z+.35);group.add(logo);
    }
    architecture.roundedPart(group,stone,0,.6,0,48,1.2,39,4);architecture.roundedPart(group,architecture.curtain,0,height/2,-2,38,height,28,4);
    for(const x of [-18,18])for(const z of [-12,9])part(group,stone,x,height/2,z,.65,height,.7);
    for(let floor=1;floor<=3;floor++)architecture.terrace(group,{y:floor*height/3,z:-2,width:42-floor,depth:33,green:true});
    // Five architectural silhouettes with brand identity kept on unchanged official artwork.
    if(center.id==='mercadolivre'){
      for(const x of [-12,12])part(group,accent,x,height-1,-2,5,5,31);
      part(group,accent,0,height+2,-2,39,1.3,31);
    }else if(center.id==='shopee'){
      for(let level=0;level<3;level++)part(group,accent,0,13+level*8,0,45-level*3,1.2,33-level*2);
      for(const x of [-15,15]){part(group,accent,x,height+4,-4,1.3,8,1.3);}
      part(group,accent,0,height+8,-4,31,1.3,1.3);
    }else if(center.id==='cakto'){
      for(const x of [-14,-7,7,14])part(group,accent,x,height/2,12.8,.5,height,.6);
      part(group,graphite,0,height+2,-5,24,4,21);
    }else if(center.id==='tiktok'){
      const cyan=new THREE.MeshStandardMaterial({color:'#25f4ee',emissive:'#25f4ee',emissiveIntensity:.3});architecture.materials.add(cyan);
      for(const x of [-16,16])part(group,x<0?cyan:accent,x,height/2,13.2,.12,height,.15);
      architecture.roundedPart(group,stone,0,height+.6,-2,41,.6,30,4);
    }else{
      for(let level=1;level<=3;level++){
        const y=level*10;part(group,stone,0,y,14,42-level*2,.6,7);
        for(const x of [-16,16])tree(group,x,14,.5,y+.3);
      }
      part(group,accent,0,height+1,-2,40,1,30);
    }
    // Open, warm shopfronts share the same entrance and real department links.
    part(group,stone,0,.9,15.3,44,.35,6);
    part(group,architecture.wood,0,4.6,13,40,8,.4);
    part(group,glass,0,5,18,41,9,.06);
    for(const x of [-20,-12,-4,4,12,20])part(group,brass,x,5,18.1,.12,9,.18);
    for(const y of [2.4,4.8,7.2]){part(group,stone,0,y,14,38,.14,1.4);part(group,warm,0,y-.1,14.8,37,.05,.08);}
    part(group,warm,0,9,17.7,39,.05,.1);
    brandSign(11.3,18.3,32,4.2);brandSign(height+2.8,16,26,4.5);
    textSign(group,center.title,{width:22,height:2.8,y:6.5,z:18.8,color:'#f5ead5',subtitle:'SELEÇÃO AFILIADA · VITRINECITY'});
    textSign(group,'ENTRAR E EXPLORAR',{width:18,height:2.5,y:3.8,z:18.3,color:'#f2e2b6',subtitle:'PRODUTOS POR DEPARTAMENTO'});
    for(const x of [-23,23])tree(group,x,14,.8,1.1);
    dressCommercialCenter({group,architecture,center});
    billboards.registerCenter(group,center);
    architecture.batch(group);scene.add(group);buildings.push({group,center,anchor:group.localToWorld(new THREE.Vector3(0,3,19))});
  });
  return buildings;
}
export function mountMusicArena({scene,architecture}){
  const group=new THREE.Group();group.name='vitrinecity-pulse-arena';group.position.set(-57,0,196);group.rotation.y=Math.PI;
  group.userData={store:true,reference:'pulse-arena',label:'Pulse Arena',href:'/vitriny-music-arena.html'};
  const {part,stone,graphite,brass,warm,textSign}=architecture;
  part(group,stone,0,.5,0,66,1,48);part(group,graphite,0,3,-4,52,5,25);
  const glow=new THREE.MeshBasicMaterial({color:'#bba7ef'});architecture.materials.add(glow);
  for(let i=0;i<3;i++){const ring=new THREE.Mesh(new THREE.TorusGeometry(18+i*4,.32,6,48,Math.PI),i%2?brass:glow);ring.position.set(0,5,-8+i*5);group.add(ring);}
  for(const x of [-25,25]){part(group,graphite,x,14,0,3,28,5);part(group,glow,x,14,3,1,26,.12);}
  textSign(group,'PULSE ARENA',{width:38,height:5,y:10,z:10,color:'#d1bff7',subtitle:'VITRINECITY · MÚSICA PARA CADA MOMENTO'});
  textSign(group,'ENTRAR NA ARENA',{width:22,height:2.5,y:3,z:16,subtitle:'PLAYLISTS · RÁDIOS · DJ SETS'});part(group,warm,0,1,22,61,.1,.1);
  scene.add(group);return group;
}
