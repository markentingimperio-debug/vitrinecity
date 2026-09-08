import * as THREE from '/vendor/three/three.module.js';

export function createPremiumFacades({mobile=false}={}){
  return [0,1,2].map(variant=>{
    const canvas=document.createElement('canvas');canvas.width=mobile?512:1024;canvas.height=mobile?1024:2048;const ctx=canvas.getContext('2d');ctx.scale(mobile?2:4,mobile?2:4);
    const emission=document.createElement('canvas');emission.width=512;emission.height=1024;const light=emission.getContext('2d');light.scale(2,2);light.fillStyle='#000000';light.fillRect(0,0,256,512);
    const reflection=ctx.createLinearGradient(0,0,256,512);reflection.addColorStop(0,['#7197ab','#9aa59f','#90a6b3'][variant]);reflection.addColorStop(.48,'#3d5b69');reflection.addColorStop(.7,'#7d9399');reflection.addColorStop(1,'#233e4a');ctx.fillStyle=reflection;ctx.fillRect(0,0,256,512);
    for(let row=0;row<8;row++)for(let col=0;col<4;col++){
      const x=col*64,y=row*64,lit=(row*7+col*11+variant)%13<2;
      if(lit){ctx.fillStyle='#d2b584';ctx.fillRect(x+3,y+7,58,47);ctx.fillStyle='#615441';ctx.fillRect(x+12,y+38,18,16);ctx.fillRect(x+38,y+44,16,10);ctx.fillStyle='#f4dfb0';ctx.fillRect(x+8,y+11,47,2);light.fillStyle=['#f9d39a','#fce6ba','#a8cede'][(row+col)%3];light.fillRect(x+3,y+7,58,47);light.fillStyle='#423723';light.fillRect(x+12,y+38,18,16);light.fillRect(x+38,y+44,16,10);}
      ctx.fillStyle='#142e3d';ctx.fillRect(x,y,2,64);ctx.fillRect(x,y+57,64,7);ctx.fillStyle='#a5b4b777';ctx.fillRect(x+2,y,1,57);ctx.fillRect(x,y+56,64,1);ctx.fillStyle='#26465388';ctx.fillRect(x+31,y,1,56);
    }
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=8;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
    const emissiveMap=new THREE.CanvasTexture(emission);emissiveMap.colorSpace=THREE.SRGBColorSpace;emissiveMap.wrapS=emissiveMap.wrapT=THREE.RepeatWrapping;
    return new THREE.MeshStandardMaterial({map:texture,color:'#e4edf4',emissiveMap,emissive:'#ffffff',emissiveIntensity:.6,metalness:.5,roughness:.22});
  });
}

// Decorative architecture stays outside the plaza and does not create shops or commercial rights.
export function mountPremiumAtmosphere({scene,identity,profileId='STANDARD'}){
  const lite=profileId==='LITE',group=new THREE.Group();group.name='premium-city-atmosphere';
  const accent=new THREE.Color(identity.palette.accent),gold=new THREE.Color('#d9bf8a');
  const glass=new THREE.MeshStandardMaterial({color:'#416774',emissive:accent,emissiveIntensity:.08,metalness:.42,roughness:.32});
  const metal=new THREE.MeshStandardMaterial({color:'#546965',metalness:.8,roughness:.3});
  const luminous=new THREE.MeshBasicMaterial({color:accent}),warm=new THREE.MeshBasicMaterial({color:gold});
  const box=new THREE.BoxGeometry(1,1,1),windowTransforms=[];
  function add(geometry,material,parent,x,y,z,sx=1,sy=1,sz=1){const mesh=new THREE.Mesh(geometry,material);mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);parent.add(mesh);return mesh;}
  const towerCount=lite?6:10;
  for(let i=0;i<towerCount;i++){
    const a=-Math.PI+.13+i/(towerCount-1)*(Math.PI-.26),r=300+(i%3)*34,h=64+(i%4)*19,tower=new THREE.Group();tower.position.set(Math.cos(a)*r,0,Math.sin(a)*r);tower.rotation.y=-a;group.add(tower);
    for(let tier=0;tier<4;tier++){
      const width=23-tier*3.7,depth=21-tier*2.8,base=tier*h*.21,height=h*.27;
      add(box,glass,tower,0,base+height/2,0,width,height,depth);
      add(box,tier%2?warm:luminous,tower,0,base+height,0,width+.3,.35,depth+.3);
      add(box,metal,tower,-width/2,base+height/2,0,.45,height,depth+.2);
      for(let row=0;row<(lite?3:5);row++)for(let col=0;col<4;col++){
        const p=new THREE.Vector3(-width*.34+col*width*.22,base+3+row*height/(lite?3.7:5.7),depth/2+.12);tower.localToWorld(p);windowTransforms.push({p,rotation:-a,width:width*.13,warm:(row+col+i)%3!==0});
      }
    }
    const crown=add(new THREE.ConeGeometry(5,12,lite?4:6),metal,tower,0,h*.9+6,0);crown.rotation.y=Math.PI/4;
    add(box,luminous,tower,0,h*.9+14,0,.22,4,.22);
  }
  const windows=new THREE.InstancedMesh(box,new THREE.MeshBasicMaterial({color:'#ffffff'}),windowTransforms.length),dummy=new THREE.Object3D();
  windowTransforms.forEach((w,i)=>{dummy.position.copy(w.p);dummy.rotation.set(0,w.rotation,0);dummy.scale.set(w.width,.65,.13);dummy.updateMatrix();windows.setMatrixAt(i,dummy.matrix);windows.setColorAt(i,w.warm?gold:accent);});windows.instanceMatrix.needsUpdate=true;group.add(windows);
  const bridge=new THREE.Mesh(new THREE.TorusGeometry(260,1.3,6,lite?50:90,Math.PI),metal);bridge.rotation.x=-Math.PI/2;bridge.position.y=28;group.add(bridge);
  const track=new THREE.Mesh(new THREE.TorusGeometry(260,.09,4,lite?50:90,Math.PI),warm);track.rotation.x=-Math.PI/2;track.position.y=29.4;group.add(track);
  for(let i=0;i<12;i++){const a=i/11*Math.PI;add(box,metal,group,Math.cos(a)*260,14,-Math.sin(a)*260,1.1,28,1.1);}
  const train=add(new THREE.CapsuleGeometry(1,8,3,8),luminous,group,260,30,0);train.rotation.z=Math.PI/2;
  const sky=new THREE.Group();sky.name='orbital-horizon';group.add(sky);
  const dome=new THREE.Mesh(new THREE.SphereGeometry(1450,24,16),new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,uniforms:{top:{value:new THREE.Color('#024e92')},horizon:{value:new THREE.Color('#ffa06c')}},vertexShader:'varying vec3 vDirection;void main(){vDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:'uniform vec3 top;uniform vec3 horizon;varying vec3 vDirection;void main(){float t=pow(max(normalize(vDirection).y,0.0),0.48);gl_FragColor=vec4(mix(horizon,top,t),1.0);\n#include <colorspace_fragment>\n}'}));dome.renderOrder=-10;sky.add(dome);
  scene.add(new THREE.AmbientLight('#bdcddd',.36));
  const planet=new THREE.Mesh(new THREE.SphereGeometry(48,lite?24:48,lite?18:32),new THREE.MeshStandardMaterial({color:'#8195ad',emissive:'#263646',emissiveIntensity:.25,roughness:.94,fog:false}));planet.position.set(-600,365,-950);sky.add(planet);
  const ring=new THREE.Mesh(new THREE.TorusGeometry(74,.45,6,lite?100:180),new THREE.MeshBasicMaterial({color:'#bacbd6',transparent:true,opacity:.5,fog:false}));ring.position.copy(planet.position);ring.rotation.set(.8,.3,-.5);sky.add(ring);
  const starCount=lite?180:450,starArray=new Float32Array(starCount*3);
  for(let i=0;i<starCount;i++){const a=i*2.39996,y=220+(i%27)*19;starArray[i*3]=Math.cos(a)*1100;starArray[i*3+1]=y;starArray[i*3+2]=Math.sin(a)*1100;}
  const starGeometry=new THREE.BufferGeometry();starGeometry.setAttribute('position',new THREE.BufferAttribute(starArray,3));sky.add(new THREE.Points(starGeometry,new THREE.PointsMaterial({color:'#bfdbd2',size:1.8,transparent:true,opacity:.65,fog:false})));
  scene.add(group);let angle=0;
  return {tick(dt,{paused=false}={}){if(!paused){angle=(angle+dt*.035)%Math.PI;train.position.set(Math.cos(angle)*260,30,-Math.sin(angle)*260);train.rotation.y=angle;}},group};
}
