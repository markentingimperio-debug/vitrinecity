import * as THREE from '/vendor/three/three.module.js';
import {AFFILIATE_CENTERS} from './vitriny-affiliate-centers-core.js';
export function mountCommerceAvenue({scene,architecture,billboards,facade}){
  const buildings=[];
  const promenade=new THREE.Group();promenade.name='avenida-dos-afiliados';scene.add(promenade);
  const paving=architecture.pavingMaterial({color:'#bab7a7',repeat:25});
  architecture.part(promenade,paving,-148,.22,-20,93,.25,256);
  architecture.part(promenade,architecture.graphite,-114,.37,-20,11,.1,254);
  for(let z=-139;z<108;z+=12)architecture.part(promenade,architecture.warm,-114,.43,z,.18,.015,4);
  for(let z=-137;z<110;z+=32){architecture.tree(promenade,-133,z,.8,.3);architecture.part(promenade,architecture.wood,-149,.9,z,4,.3,1.4);}
  AFFILIATE_CENTERS.forEach((center,index)=>{
    const group=new THREE.Group();group.name=`center-${center.id}`;group.position.set(-210,0,-115+index*64);group.rotation.y=Math.PI/2;
    group.userData={store:true,reference:`center-${center.id}`,label:center.title,href:center.href};
    const {part,stone,graphite,brass,glass,warm,textSign,tree}=architecture,{height}=center;
    const accent=new THREE.MeshStandardMaterial({color:center.color,metalness:.3,roughness:.38});architecture.materials.add(accent);
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
    part(group,stone,0,.6,0,48,1.2,39);part(group,facade,0,height/2,-2,38,height,28);
    for(const x of [-19,19])part(group,accent,x,height/2,-2,.45,height,29);
    for(let floor=1;floor<=3;floor++){part(group,graphite,0,floor*height/3,-2,40,.55,30);part(group,warm,0,floor*height/3+.32,13.1,39,.08,.08);}
    // Four architectural silhouettes with brand identity kept on unchanged official artwork.
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
    }else{
      for(let level=1;level<=3;level++){
        const y=level*10;part(group,stone,0,y,14,42-level*2,.6,7);
        for(const x of [-16,16])tree(group,x,14,.5,y+.3);
      }
      part(group,accent,0,height+1,-2,40,1,30);
    }
    part(group,graphite,0,6,15.3,44,12,5);part(group,glass,0,5,18,41,9,.06);
    part(group,architecture.wood,0,4.6,15,40,8,.4);part(group,warm,0,9,17.7,39,.05,.1);
    brandSign(11.8,18.3,39,7);brandSign(height+5.8,16,36,9);
    textSign(group,center.title,{width:22,height:2.8,y:6.5,z:18.8,color:'#f5ead5',subtitle:'SELEÇÃO AFILIADA · VITRINECITY'});
    textSign(group,'ENTRAR E EXPLORAR',{width:18,height:2.5,y:3.8,z:18.3,color:'#f2e2b6',subtitle:'PRODUTOS POR DEPARTAMENTO'});
    for(const x of [-23,23])tree(group,x,14,.8,1.1);
    billboards.registerCenter(group,center);
    scene.add(group);buildings.push({group,center,anchor:group.localToWorld(new THREE.Vector3(0,3,19))});
  });
  return buildings;
}
export function mountMusicArena({scene,architecture}){
  const group=new THREE.Group();group.name='vitrinecity-pulse-arena';group.position.set(-100,0,154);group.rotation.y=Math.PI;
  group.userData={store:true,reference:'pulse-arena',label:'Pulse Arena',href:'/vitriny-music-arena.html'};
  const {part,stone,graphite,brass,warm,textSign}=architecture;
  part(group,stone,0,.5,0,66,1,48);part(group,graphite,0,3,-4,52,5,25);
  const glow=new THREE.MeshBasicMaterial({color:'#bba7ef'});architecture.materials.add(glow);
  for(let i=0;i<3;i++){const ring=new THREE.Mesh(new THREE.TorusGeometry(18+i*4,.32,6,48,Math.PI),i%2?brass:glow);ring.position.set(0,5,-8+i*5);group.add(ring);}
  for(const x of [-25,25]){part(group,graphite,x,14,0,3,28,5);part(group,glow,x,14,3,1,26,.12);}
  textSign(group,'PULSE ARENA',{width:38,height:5,y:10,z:10,color:'#d1bff7',subtitle:'VITRINECITY · ELECTRONIC MUSIC'});
  textSign(group,'ENTRAR NA ARENA',{width:22,height:2.5,y:3,z:16,subtitle:'YOUTUBE · SPOTIFY'});part(group,warm,0,1,22,61,.1,.1);
  scene.add(group);return group;
}
