import * as THREE from '/vendor/three/three.module.js';
import {dressBoutique} from './vitriny-building-signatures.js';
import {roundedFootprintGeometry,batchArchitecturalParts,leafyCanopyGeometry} from './vitriny-architectural-geometry.js';
import {createPremiumFacades} from './vitriny-spatial-premium-atmosphere.js';

// Dimensions use metres. These are presentation assets, never store registrations.
export function createArchitectureKit({renderer,scene,shadows=false,lite=false}){
  const materials=new Set(),geometries=new Set();
  const textures=new Set();let disposed=false;
  function pbr(asset,kind,repeat=1){const texture=new THREE.TextureLoader().load(`/assets/multiversal-materials/${asset}-${kind}.jpg`,loaded=>{if(disposed)loaded.dispose();},undefined,()=>{});texture.colorSpace=kind==='Diffuse'?THREE.SRGBColorSpace:THREE.NoColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(repeat,repeat);texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());textures.add(texture);return texture;}
  function standard(options){const m=new THREE.MeshStandardMaterial(options);materials.add(m);return m;}
  function glow(color,intensity=1){return standard({color,emissive:color,emissiveIntensity:intensity,roughness:.5});}
  function geometry(g){geometries.add(g);return g;}
  const box=geometry(new THREE.BoxGeometry(1,1,1));
  const leafShape=geometry(leafyCanopyGeometry(lite));
  const cylinder=geometry(new THREE.CylinderGeometry(1,1,1,8));
  // Fine limestone grain stays subtle on both wide slabs and narrow reveals.
  const stoneCanvas=document.createElement('canvas');stoneCanvas.width=stoneCanvas.height=256;
  const stoneContext=stoneCanvas.getContext('2d'),stonePixels=stoneContext.createImageData(256,256);
  for(let i=0;i<256*256;i++){const x=i%256,y=Math.floor(i/256),grain=Math.sin(x*12.9898+y*78.233)*43758.5453,shade=Math.floor((grain-Math.floor(grain))*13)+237;stonePixels.data.set([shade,shade-2,shade-7,255],i*4);}
  stoneContext.putImageData(stonePixels,0,0);
  const stoneMap=new THREE.CanvasTexture(stoneCanvas);stoneMap.colorSpace=THREE.SRGBColorSpace;stoneMap.wrapS=stoneMap.wrapT=THREE.RepeatWrapping;stoneMap.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());textures.add(stoneMap);
  const stone=standard({color:'#cbb58f',map:stoneMap,roughness:.78});
  const graphite=standard({color:'#172e3b',metalness:.45,roughness:.34});
  const brass=standard({color:'#c49a46',metalness:.72,roughness:.3});
  const wood=standard({color:'#ae7c4e',map:pbr('wood_floor','Diffuse',2),normalMap:lite?null:pbr('wood_floor','nor_gl',2),normalScale:new THREE.Vector2(.35,.35),roughnessMap:lite?null:pbr('wood_floor','Rough',2),roughness:.85,emissive:'#895b30',emissiveIntensity:.025});
  const interior=standard({color:'#cba36f',roughness:.82,emissive:'#ffbd68',emissiveIntensity:.16});
  const warm=glow('#ffc66b',1.25),white=glow('#eed6ad',.38);
  const glass=standard({color:'#aed3d7',metalness:.18,roughness:.14,transparent:true,opacity:.16,depthWrite:false});
  const foliage=['#355139','#617747','#486237'].map(color=>standard({color,roughness:.93,side:THREE.DoubleSide}));
  const curtainMaterials=createPremiumFacades({mobile:lite});
  for(const material of curtainMaterials){materials.add(material);if(material.map)textures.add(material.map);if(material.emissiveMap)textures.add(material.emissiveMap);}
  const curtain=curtainMaterials[0],roundShapes=new Map();
  const goods=['#c0aa88','#b66c46','#49696f','#7c8750'].map(color=>standard({color,emissive:color,emissiveIntensity:.16,roughness:.8}));
  function part(parent,material,x,y,z,w,h,d,shape=box){const m=new THREE.Mesh(shape,material);m.position.set(x,y,z);m.scale.set(w,h,d);m.castShadow=shadows&&!material.transparent;m.receiveShadow=shadows;m.userData.architecturalPart=true;parent.add(m);return m;}
  function roundedPart(parent,material,x,y,z,w,h,d,r=1.4){
    const key=[w,h,d,r].join(':');if(!roundShapes.has(key)){
      const shape=roundedFootprintGeometry(w,d,r,lite?3:6),uv=shape.attributes.uv,n=shape.attributes.normal;
      for(let i=0;i<uv.count;i++)if(Math.abs(n.getY(i))<.9)uv.setY(i,uv.getY(i)*h/24);
      roundShapes.set(key,geometry(shape));
    }
    return part(parent,material,x,y,z,1,h,1,roundShapes.get(key));
  }
  function shrubs(parent,x,y,z,width=5,depth=1){for(let i=0;i<(lite?4:8);i++){const angle=i*2.399;part(parent,foliage[i%3],x+Math.cos(angle)*width*.35,y+.3+(i%3)*.12,z+Math.sin(angle)*depth*.28,.52+(i%2)*.14,.45,.55,leafShape);}}
  function terrace(parent,{x=0,y=0,z=0,width=18,depth=12,green=true}={}){
    roundedPart(parent,stone,x,y,z,width,.38,depth,1.8);
    roundedPart(parent,warm,x,y-.13,z,width+.035,.05,depth+.035,1.8);
    for(const side of [-1,1]){
      part(parent,glass,x,y+.72,z+side*(depth/2-.3),width-2,1.1,.05);
      part(parent,brass,x,y+1.28,z+side*(depth/2-.3),width-2,.045,.06);
      if(green){roundedPart(parent,graphite,x+side*width*.32,y+.4,z,width*.2,.6,depth*.5,.5);tree(parent,x+side*width*.32,z,.36,y+.7);shrubs(parent,x+side*width*.32,y+.7,z,width*.2,depth*.5);}
    }
  }
  function textSign(parent,label,{width=14,height=1.7,y=7,z=5,color='#f9e5b9',subtitle=''}={}){
    const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=160;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#252e31';ctx.fillRect(0,0,1024,160);
    ctx.fillStyle=color;ctx.textAlign='center';ctx.font='500 61px system-ui';ctx.fillText(String(label),512,subtitle?78:103,930);
    if(subtitle){ctx.font='400 22px system-ui';ctx.fillStyle='#b9c6c4';ctx.fillText(subtitle,512,126,930);}
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
    const mat=new THREE.MeshBasicMaterial({map:texture,toneMapped:false});
    const sign=new THREE.Mesh(new THREE.PlaneGeometry(width,height),mat);sign.position.set(0,y,z);parent.add(sign);return sign;
  }
  function tree(parent,x,z,scale=1,y=0){
    const g=new THREE.Group();g.position.set(x,y,z);g.scale.setScalar(scale);parent.add(g);
    roundedPart(g,stone,0,.25,0,2.8,.5,2.8,.7);
    part(g,wood,0,2.2,0,.2,4.3,.2,cylinder);
    const count=lite?5:11;
    for(let i=0;i<count;i++){
      const a=i*2.399,r=i?1.12:0,yy=4.1+(i%4)*.42;
      part(g,foliage[i%3],Math.cos(a)*r,yy,Math.sin(a)*r,1.15+(i%3)*.16,.9+(i%2)*.3,1.08,leafShape);
      if(i>0&&i<4){const b=part(g,wood,Math.cos(a)*.45,3.3,Math.sin(a)*.45,.075,1.8,.075,cylinder);b.rotation.set(Math.sin(a)*.5,0,-Math.cos(a)*.5);}
    }
    return g;
  }
  function boutique(parent,{width=19,depth=13,height=8.8,label='Vitrine City',variant=0,subtitle='',catalog=false}={}){
    const w=width,d=depth,h=Math.max(6.8,Math.min(11,height)),front=d/2;
    const g=new THREE.Group();g.name='premium-boutique';parent.add(g);
    roundedPart(g,stone,0,.23,0,w+2.2,.46,d+2.2,1.5);
    part(g,stone,0,.13,front+1.5,w*.56,.26,1.3);
    part(g,warm,0,.4,front+1.09,w+1.8,.055,.065);
    part(g,interior,0,.53,0,w-.7,.16,d-.7);
    part(g,wood,0,h*.48,-d/2+.2,w-.5,h-.8,.35);
    roundedPart(g,graphite,0,h-.65,0,w+1,1.3,d+1,1.5);
    roundedPart(g,stone,0,h+.09,0,w+.5,.18,d+.5,1.5);
    for(const x of [-w/2,w/2])for(const z of [-d/2,front])part(g,graphite,x,h/2,z,.28,h,.28);
    part(g,glass,0,(h-1.4)/2+.5,front,w-.55,h-1.4,.035);
    for(const x of [-w/2,w/2])part(g,glass,x,(h-1.4)/2+.5,0,.035,h-1.4,d-.4);
    for(const x of [-w*.3,-1.2,1.2,w*.3])part(g,brass,x,(h-1.4)/2+.5,front+.03,.065,h-1.4,.065);
    for(const x of [-.85,.85])part(g,brass,x,2.1,front+.12,.045,.8,.08);
    part(g,warm,0,h+.22,front+.28,w+.8,.06,.06);
    for(const x of [-w/2,w/2])part(g,warm,x+.02,h/2,front+.18,.055,h-.8,.055);
    roundedPart(g,stone,0,h-1.5,front+.5,w+1,.22,3.5,.9);
    part(g,warm,0,h-1.57,front+1.7,w*.91,.045,.06);
    textSign(g,label,{width:w*.91,height:1.34,y:h-.7,z:front+.54,subtitle});
    // Visible shelving, merchandise and display tables establish human scale.
    for(let row=0;row<3;row++){
      const yy=1.5+row*1.45;part(g,wood,0,yy,-d/2+1.1,w-2,.12,1.45);
      part(g,warm,0,yy-.1,-d/2+1.73,w-2,.04,.04);
      for(let col=0;col<(catalog?0:lite?5:9);col++){
        const n=lite?5:9,x=-w*.4+col*w*.8/(n-1),v=(col+row+variant)%4;
        part(g,goods[v],x,yy+.38,-d/2+1.1,.45+v*.1,.55+(v%2)*.25,.5);
      }
    }
    for(const x of [-w*.26,w*.26]){
      part(g,wood,x,1.22,0,w*.22,.22,2.2);
      for(const xx of [-.6,.6])part(g,graphite,x+xx,.8,0,.1,.8,1.4);
      if(!catalog)for(let i=0;i<3;i++)part(g,goods[(variant+i)%4],x-.7+i*.7,1.6,0,.4,.55,.5);
      part(g,white,x,h-1.42,-1,w*.24,.04,1.8);
    }
    // Roof terrace: parapets, raised planting and small trees.
    if(!lite){
      for(const z of [-d*.3,d*.08])part(g,graphite,0,h+.45,z,w*.7,.7,1.3);
      for(let i=0;i<5;i++)part(g,foliage[(i+variant)%3],-w*.3+i*w*.15,h+1,-d*.3,1.5,.7,.7,leafShape);
      tree(g,-w*.32,-d*.28,.45,h+.3);tree(g,w*.32,-d*.28,.45,h+.3);
    }
    tree(g,-w/2-2.6,front-1.8,.66);tree(g,w/2+2.6,front-1.8,.66);
    dressBoutique({group:g,architecture:{part,roundedPart,terrace,curtain,tree,textSign,materials,stone,graphite,brass,wood,warm,glass},width:w,depth:d,height:h,label,lite,catalog});
    batchArchitecturalParts(g);
    return g;
  }
  function pavingMaterial({color='#aaa89b',repeat=12,formal=false}={}){
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=512;const ctx=canvas.getContext('2d');
    ctx.fillStyle=color;ctx.fillRect(0,0,512,512);
    for(let row=0;row<8;row++)for(let col=0;col<8;col++){
      const v=((row*23+col*13)%13)-6;ctx.fillStyle=`rgba(${v>0?'255,255,255':'0,0,0'},${Math.abs(v)/180})`;ctx.fillRect(col*64+1,row*64+1,62,62);
    }
    ctx.strokeStyle='#4d514a55';ctx.lineWidth=1.4;for(let i=0;i<=8;i++){ctx.beginPath();ctx.moveTo(i*64,0);ctx.lineTo(i*64,512);ctx.moveTo(0,i*64);ctx.lineTo(512,i*64);ctx.stroke();}
    const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;map.wrapS=map.wrapT=THREE.RepeatWrapping;map.repeat.set(repeat,repeat);map.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
    const material=standard({map,roughness:.8,metalness:.03});
    if(formal){textures.add(map);material.roughness=.67;material.metalness=.05;return material;}
    const photo=pbr('pavement_02','Diffuse',repeat*2);material.map=photo;
    if(!lite){material.normalMap=pbr('pavement_02','nor_gl',repeat*2);material.normalScale=new THREE.Vector2(.35,.35);material.roughnessMap=pbr('pavement_02','Rough',repeat*2);}
    map.dispose();return material;
  }
  function reflections(){
    const faces=Array.from({length:6},(_,i)=>{
      const c=document.createElement('canvas');c.width=c.height=256;const x=c.getContext('2d'),g=x.createLinearGradient(0,0,0,256);
      g.addColorStop(0,i===3?'#6d7665':'#93bedb');g.addColorStop(.53,i===2?'#b2d2e6':'#f2dcc0');g.addColorStop(1,'#797c6c');x.fillStyle=g;x.fillRect(0,0,256,256);
      if(i!==2&&i!==3)for(let j=0;j<14;j++){const h=25+(j*37+i*19)%85;x.fillStyle=j%3?'#344d60':'#809db0';x.fillRect(j*20,172-h,16,h);x.fillStyle='#dce6e6';x.fillRect(j*20+2,174-h,2,h-4);}
      if(i===0){const sun=x.createRadialGradient(175,80,0,175,80,45);sun.addColorStop(0,'#fffdf0');sun.addColorStop(.18,'#ffeac3');sun.addColorStop(1,'#ffeac300');x.fillStyle=sun;x.fillRect(125,30,100,100);}
      return c;
    });
    const cube=new THREE.CubeTexture(faces);cube.colorSpace=THREE.SRGBColorSpace;cube.needsUpdate=true;
    const pmrem=new THREE.PMREMGenerator(renderer),target=pmrem.fromCubemap(cube);scene.environment=target.texture;scene.environmentIntensity=.7;cube.dispose();pmrem.dispose();
    return ()=>{scene.environment=null;target.dispose();};
  }
  return {materials,geometries,part,roundedPart,terrace,shrubs,curtain,tree,boutique,textSign,pavingMaterial,reflections,stone,graphite,brass,wood,warm,glass,foliage,batch:batchArchitecturalParts,dispose(){disposed=true;for(const texture of textures)texture.dispose();}};
}
