import * as THREE from '/vendor/three/three.module.js';

// Curtain walls reflect their surroundings; lit rooms are modelled behind storefronts.
// The atlas contains only glazing variation and slender structural mullions.
export function createPremiumFacades({mobile=false}={}){
  return [0,1,2].map(variant=>{
    const canvas=document.createElement('canvas');canvas.width=mobile?256:512;canvas.height=mobile?512:1024;
    const ctx=canvas.getContext('2d');ctx.scale(canvas.width/256,canvas.height/512);
    const gradient=ctx.createLinearGradient(0,0,256,512);
    gradient.addColorStop(0,['#417caa','#3c817f','#9b7951'][variant]);
    gradient.addColorStop(.52,['#285f8c','#286762','#795735'][variant]);
    gradient.addColorStop(1,['#153c61','#173f40','#4c3525'][variant]);
    ctx.fillStyle=gradient;ctx.fillRect(0,0,256,512);
    for(let col=0;col<8;col++){
      const x=col*32;
      ctx.fillStyle='rgba(205,226,233,'+(.018+(col*7+variant*11)%9*.005)+')';
      ctx.fillRect(x+1,0,30,512);
      ctx.fillStyle='#24373f';ctx.fillRect(x,0,.75,512);
      ctx.fillStyle='#c3ced144';ctx.fillRect(x+1,0,.5,512);
    }
    for(let row=0;row<8;row++){
      const y=row*64;
      ctx.fillStyle='#20333d';ctx.fillRect(0,y,256,1.3);
      ctx.fillStyle='#9caaaa55';ctx.fillRect(0,y+1.3,256,.6);
      // Recessed opaque spandrel strips are subtle; no bright tiled window icons.
      ctx.fillStyle='#162a3333';ctx.fillRect(0,y+58,256,5);
    }
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    texture.anisotropy=mobile?2:4;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
    const material=new THREE.MeshStandardMaterial({map:texture,color:'#c5dced',metalness:.64,roughness:.19,envMapIntensity:1.0});
    material.name='architectural-curtain-glass-'+variant;
    return material;
  });
}

// Decorative architecture stays outside the plaza and does not create shops or commercial rights.
export function mountPremiumAtmosphere({scene,identity,profileId='STANDARD'}){
  const lite=profileId==='LITE',group=new THREE.Group();group.name='premium-city-atmosphere';
  const accent=new THREE.Color(identity.palette.accent),gold=new THREE.Color('#d9bf8a');
  const glass=new THREE.MeshStandardMaterial({color:'#546873',metalness:.6,roughness:.23});
  const metal=new THREE.MeshStandardMaterial({color:'#889191',metalness:.72,roughness:.32});
  const luminous=new THREE.MeshBasicMaterial({color:accent}),warm=new THREE.MeshBasicMaterial({color:gold});
  const box=new THREE.BoxGeometry(1,1,1),windowTransforms=[];
  function add(geometry,material,parent,x,y,z,sx=1,sy=1,sz=1){const mesh=new THREE.Mesh(geometry,material);mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);parent.add(mesh);return mesh;}
  const towerCount=lite?8:14;
  for(let i=0;i<towerCount;i++){
    const a=-Math.PI+.13+i/(towerCount-1)*(Math.PI-.26),r=355+(i%3)*37,h=65+(i*37)%94,tower=new THREE.Group();tower.position.set(Math.cos(a)*r,0,Math.sin(a)*r);tower.rotation.y=-a;group.add(tower);
    const tiers=i%3===0?3:1;
    for(let tier=0;tier<tiers;tier++){
      const width=14+(i%4)*4-tier*3.4,depth=18+(i%3)*3-tier*2.3,base=tier*h/tiers,height=h/tiers;
      add(box,glass,tower,0,base+height/2,0,width,height,depth);
      add(box,metal,tower,0,base+height,0,width+.3,.35,depth+.3);
      add(box,metal,tower,-width/2,base+height/2,0,.45,height,depth+.2);
      for(let row=0;row<(lite?6:12);row++)for(let col=0;col<4;col++){
        if((row*7+col*11+i*3)%13>1)continue;
        const p=new THREE.Vector3(-width*.34+col*width*.22,base+3+row*(height-5)/(lite?6:12),depth/2+.12);tower.localToWorld(p);windowTransforms.push({p,rotation:-a,width:width*.13,warm:true});
      }
    }
    if(i%4===0){add(box,metal,tower,-3,h+8,0,.35,17,.35);add(box,metal,tower,0,h+1.5,0,7,3,6);}
    if(i%4===2)add(box,metal,tower,8,h*.53,0,.55,h*1.06,19+(i%3)*3);
  }
  const windows=new THREE.InstancedMesh(box,new THREE.MeshBasicMaterial({color:'#ffffff'}),windowTransforms.length),dummy=new THREE.Object3D();
  windowTransforms.forEach((w,i)=>{dummy.position.copy(w.p);dummy.rotation.set(0,w.rotation,0);dummy.scale.set(w.width,.65,.13);dummy.updateMatrix();windows.setMatrixAt(i,dummy.matrix);windows.setColorAt(i,w.warm?gold:accent);});windows.instanceMatrix.needsUpdate=true;group.add(windows);
  const bridge=new THREE.Mesh(new THREE.TorusGeometry(260,1.3,6,lite?50:90,Math.PI),metal);bridge.rotation.x=-Math.PI/2;bridge.position.y=28;bridge.visible=false;group.add(bridge);
  const track=new THREE.Mesh(new THREE.TorusGeometry(260,.09,4,lite?50:90,Math.PI),warm);track.rotation.x=-Math.PI/2;track.position.y=29.4;track.visible=false;group.add(track);

  const train=add(new THREE.CapsuleGeometry(1,8,3,8),luminous,group,260,30,0);train.rotation.z=Math.PI/2;train.visible=false;
  const sky=new THREE.Group();sky.name='orbital-horizon';group.add(sky);
  const dome=new THREE.Mesh(new THREE.SphereGeometry(1450,24,16),new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,uniforms:{top:{value:new THREE.Color('#3b7bb8')},horizon:{value:new THREE.Color('#ead4b5')}},vertexShader:'varying vec3 vDirection;void main(){vDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:'uniform vec3 top;uniform vec3 horizon;varying vec3 vDirection;float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}void main(){vec3 dir=normalize(vDirection);float t=pow(max(dir.y,0.0),0.3);vec3 sky=mix(horizon,top,t);vec2 p=dir.xz/(max(dir.y,0.0)+.28)*3.0;float cloud=noise(p)*.54+noise(p*2.03)*.27+noise(p*4.07)*.13+noise(p*8.11)*.06;float mask=smoothstep(.61,.78,cloud)*smoothstep(.02,.22,dir.y);sky=mix(sky,mix(vec3(.83,.69,.52),vec3(.93,.92,.88),t),mask*.7);float sun=max(dot(dir,normalize(vec3(.62,.21,-1.0))),0.0);sky+=vec3(.9,.51,.19)*pow(sun,38.0)*.6+vec3(1.0,.78,.44)*pow(sun,1700.0)*2.0;gl_FragColor=vec4(sky,1.0);\n#include <colorspace_fragment>\n}'}));dome.renderOrder=-10;sky.add(dome);
  scene.add(new THREE.AmbientLight('#bdcddd',.06));
  const planet=new THREE.Mesh(new THREE.SphereGeometry(48,lite?24:48,lite?18:32),new THREE.MeshStandardMaterial({color:'#8195ad',emissive:'#263646',emissiveIntensity:.25,roughness:.94,fog:false}));planet.position.set(-600,365,-950);planet.visible=false;sky.add(planet);
  const ring=new THREE.Mesh(new THREE.TorusGeometry(74,.45,6,lite?100:180),new THREE.MeshBasicMaterial({color:'#bacbd6',transparent:true,opacity:.5,fog:false}));ring.position.copy(planet.position);ring.rotation.set(.8,.3,-.5);ring.visible=false;sky.add(ring);
  const starCount=lite?180:450,starArray=new Float32Array(starCount*3);
  for(let i=0;i<starCount;i++){const a=i*2.39996,y=220+(i%27)*19;starArray[i*3]=Math.cos(a)*1100;starArray[i*3+1]=y;starArray[i*3+2]=Math.sin(a)*1100;}
  const starGeometry=new THREE.BufferGeometry();starGeometry.setAttribute('position',new THREE.BufferAttribute(starArray,3));sky.add(new THREE.Points(starGeometry,new THREE.PointsMaterial({color:'#bfdbd2',size:1.8,transparent:true,opacity:.08,fog:false})));
  scene.add(group);let angle=0;
  return {tick(dt,{paused=false}={}){if(!paused){angle=(angle+dt*.035)%Math.PI;train.position.set(Math.cos(angle)*260,30,-Math.sin(angle)*260);train.rotation.y=angle;}},group};
}
