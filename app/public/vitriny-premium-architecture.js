import * as THREE from '/vendor/three/three.module.js';

// Dimensions use metres. These are presentation assets, never store registrations.
export function createArchitectureKit({renderer,scene,shadows=false,lite=false}){
  const materials=new Set(),geometries=new Set();
  const textures=new Set();let disposed=false;
  function pbr(asset,kind,repeat=1){const texture=new THREE.TextureLoader().load(`/assets/multiversal-materials/${asset}-${kind}.jpg`,loaded=>{if(disposed)loaded.dispose();},undefined,()=>{});texture.colorSpace=kind==='Diffuse'?THREE.SRGBColorSpace:THREE.NoColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(repeat,repeat);texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());textures.add(texture);return texture;}
  function standard(options){const m=new THREE.MeshStandardMaterial(options);materials.add(m);return m;}
  function glow(color,intensity=1){return standard({color,emissive:color,emissiveIntensity:intensity,roughness:.5});}
  function geometry(g){geometries.add(g);return g;}
  const box=geometry(new THREE.BoxGeometry(1,1,1));
  const leafShape=geometry(new THREE.IcosahedronGeometry(1,lite?0:1));
  const cylinder=geometry(new THREE.CylinderGeometry(1,1,1,8));
  const stone=standard({color:'#b9ad98',roughness:.86});
  const graphite=standard({color:'#353e42',metalness:.35,roughness:.42});
  const brass=standard({color:'#bca16a',metalness:.72,roughness:.3});
  const wood=standard({color:'#bbaa92',map:pbr('wood_floor','Diffuse',2),normalMap:lite?null:pbr('wood_floor','nor_gl',2),normalScale:new THREE.Vector2(.35,.35),roughnessMap:lite?null:pbr('wood_floor','Rough',2),roughness:.85,emissive:'#895b30',emissiveIntensity:.06});
  const interior=standard({color:'#ded1ad',roughness:.82,emissive:'#eec480',emissiveIntensity:.3});
  const warm=glow('#ffd891',1.7),white=glow('#f4eddb',.65);
  const glass=standard({color:'#aed3d7',metalness:.18,roughness:.14,transparent:true,opacity:.16,depthWrite:false});
  const foliage=['#4f743b','#658844','#405f32'].map(color=>standard({color,roughness:.96}));
  const goods=['#c0aa88','#b66c46','#49696f','#7c8750'].map(color=>standard({color,emissive:color,emissiveIntensity:.16,roughness:.8}));
  function part(parent,material,x,y,z,w,h,d,shape=box){const m=new THREE.Mesh(shape,material);m.position.set(x,y,z);m.scale.set(w,h,d);m.castShadow=shadows&&!material.transparent;m.receiveShadow=shadows;parent.add(m);return m;}
  function textSign(parent,label,{width=14,height=1.7,y=7,z=5,color='#f9e5b9',subtitle=''}={}){
    const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=160;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#252e31';ctx.fillRect(0,0,1024,160);
    ctx.fillStyle=color;ctx.textAlign='center';ctx.font='600 61px system-ui';ctx.fillText(String(label).toLocaleUpperCase('pt-BR'),512,subtitle?78:103,930);
    if(subtitle){ctx.font='400 22px system-ui';ctx.fillStyle='#b9c6c4';ctx.fillText(subtitle,512,126,930);}
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
    const mat=new THREE.MeshBasicMaterial({map:texture,toneMapped:false});
    const sign=new THREE.Mesh(new THREE.PlaneGeometry(width,height),mat);sign.position.set(0,y,z);parent.add(sign);return sign;
  }
  function tree(parent,x,z,scale=1,y=0){
    const g=new THREE.Group();g.position.set(x,y,z);g.scale.setScalar(scale);parent.add(g);
    part(g,graphite,0,.35,0,2.7,.7,2.7);
    part(g,wood,0,2.1,0,.18,3.9,.18,cylinder);
    const count=lite?3:7;
    for(let i=0;i<count;i++){const a=i*2.399;part(g,foliage[i%3],Math.cos(a)*(i?1.15:0),4.3+(i%3)*.55,Math.sin(a)*(i?1.05:0),1.45,1.45+(i%2)*.35,1.4,leafShape);}
    return g;
  }
  function boutique(parent,{width=19,depth=13,height=8.8,label='Vitrine City',variant=0,subtitle=''}={}){
    const w=width,d=depth,h=Math.max(6.8,Math.min(11,height)),front=d/2;
    const g=new THREE.Group();g.name='premium-boutique';parent.add(g);
    part(g,stone,0,.23,0,w+2.2,.46,d+2.2);
    part(g,stone,0,.13,front+1.5,w*.56,.26,1.3);
    part(g,warm,0,.4,front+1.09,w+1.8,.055,.065);
    part(g,interior,0,.53,0,w-.7,.16,d-.7);
    part(g,wood,0,h*.48,-d/2+.2,w-.5,h-.8,.35);
    part(g,graphite,0,h-.65,0,w+1,1.3,d+1);
    part(g,stone,0,h+.09,0,w+.5,.18,d+.5);
    for(const x of [-w/2,w/2])for(const z of [-d/2,front])part(g,graphite,x,h/2,z,.28,h,.28);
    part(g,glass,0,(h-1.4)/2+.5,front,w-.55,h-1.4,.035);
    for(const x of [-w/2,w/2])part(g,glass,x,(h-1.4)/2+.5,0,.035,h-1.4,d-.4);
    for(const x of [-w*.3,-1.2,1.2,w*.3])part(g,brass,x,(h-1.4)/2+.5,front+.03,.065,h-1.4,.065);
    for(const x of [-.85,.85])part(g,brass,x,2.1,front+.12,.045,.8,.08);
    part(g,warm,0,h+.22,front+.28,w+.8,.06,.06);
    for(const x of [-w/2,w/2])part(g,warm,x+.02,h/2,front+.18,.055,h-.8,.055);
    part(g,graphite,0,h-1.5,front+1,w+1,.15,2.4).rotation.x=-.05;
    part(g,warm,0,h-1.57,front+1.7,w*.91,.045,.06);
    textSign(g,label,{width:w*.91,height:1.34,y:h-.7,z:front+.54,subtitle});
    // Visible shelving, merchandise and display tables establish human scale.
    for(let row=0;row<3;row++){
      const yy=1.5+row*1.45;part(g,wood,0,yy,-d/2+1.1,w-2,.12,1.45);
      part(g,warm,0,yy-.1,-d/2+1.73,w-2,.04,.04);
      for(let col=0;col<(lite?5:9);col++){
        const n=lite?5:9,x=-w*.4+col*w*.8/(n-1),v=(col+row+variant)%4;
        part(g,goods[v],x,yy+.38,-d/2+1.1,.45+v*.1,.55+(v%2)*.25,.5);
      }
    }
    for(const x of [-w*.26,w*.26]){
      part(g,wood,x,1.22,0,w*.22,.22,2.2);
      for(const xx of [-.6,.6])part(g,graphite,x+xx,.8,0,.1,.8,1.4);
      for(let i=0;i<3;i++)part(g,goods[(variant+i)%4],x-.7+i*.7,1.6,0,.4,.55,.5);
      part(g,white,x,h-1.42,-1,w*.24,.04,1.8);
    }
    // Roof terrace: parapets, raised planting and small trees.
    if(!lite){
      for(const z of [-d*.3,d*.08])part(g,graphite,0,h+.45,z,w*.7,.7,1.3);
      for(let i=0;i<5;i++)part(g,foliage[(i+variant)%3],-w*.3+i*w*.15,h+1,-d*.3,1.5,.7,.7,leafShape);
      tree(g,-w*.32,-d*.28,.45,h+.3);tree(g,w*.32,-d*.28,.45,h+.3);
    }
    tree(g,-w/2-1.5,front-.4,.8);tree(g,w/2+1.5,front-.4,.8);
    return g;
  }
  function pavingMaterial({color='#aaa89b',repeat=12}={}){
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=512;const ctx=canvas.getContext('2d');
    ctx.fillStyle=color;ctx.fillRect(0,0,512,512);
    for(let row=0;row<8;row++)for(let col=0;col<8;col++){
      const v=((row*23+col*13)%13)-6;ctx.fillStyle=`rgba(${v>0?'255,255,255':'0,0,0'},${Math.abs(v)/180})`;ctx.fillRect(col*64+1,row*64+1,62,62);
    }
    ctx.strokeStyle='#4d514a55';ctx.lineWidth=1.4;for(let i=0;i<=8;i++){ctx.beginPath();ctx.moveTo(i*64,0);ctx.lineTo(i*64,512);ctx.moveTo(0,i*64);ctx.lineTo(512,i*64);ctx.stroke();}
    const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;map.wrapS=map.wrapT=THREE.RepeatWrapping;map.repeat.set(repeat,repeat);map.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
    const material=standard({map,roughness:.8,metalness:.03});
    const photo=pbr('pavement_02','Diffuse',repeat*2);material.map=photo;
    if(!lite){material.normalMap=pbr('pavement_02','nor_gl',repeat*2);material.normalScale=new THREE.Vector2(.35,.35);material.roughnessMap=pbr('pavement_02','Rough',repeat*2);}
    map.dispose();return material;
  }
  function reflections(){
    const faces=Array.from({length:6},(_,i)=>{
      const c=document.createElement('canvas');c.width=c.height=128;const x=c.getContext('2d'),g=x.createLinearGradient(0,0,0,128);
      g.addColorStop(0,i===3?'#4f5b59':'#8cb4db');g.addColorStop(.5,i===2?'#a9c7e8':'#edcdb1');g.addColorStop(1,'#535d65');x.fillStyle=g;x.fillRect(0,0,128,128);return c;
    });
    const cube=new THREE.CubeTexture(faces);cube.colorSpace=THREE.SRGBColorSpace;cube.needsUpdate=true;
    const pmrem=new THREE.PMREMGenerator(renderer),target=pmrem.fromCubemap(cube);scene.environment=target.texture;scene.environmentIntensity=.7;cube.dispose();pmrem.dispose();
    return ()=>{scene.environment=null;target.dispose();};
  }
  return {materials,geometries,part,tree,boutique,textSign,pavingMaterial,reflections,stone,graphite,brass,wood,warm,glass,foliage,dispose(){disposed=true;for(const texture of textures)texture.dispose();}};
}
