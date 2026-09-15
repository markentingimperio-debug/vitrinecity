import * as THREE from '/vendor/three/three.module.js';

const modelMaterial=(color,roughness=.75)=>new THREE.MeshStandardMaterial({color,roughness});
// Four shared silhouettes per quality level, not a skinned model per resident.
// Rings describe a continuous garment/jaw instead of overlapping round blobs.
const humanGeometry=new Map();
function ringSurface(rings,segments,{face=false}={}){
  const positions=[],indices=[];
  for(const [y,width,depth,center=0] of rings)for(let i=0;i<=segments;i++){
    const angle=i/segments*Math.PI*2,sin=Math.sin(angle),cos=Math.cos(angle);
    const nose=face?Math.max(0,1-Math.abs(y+.12)/.4)*Math.pow(Math.max(0,cos),40)*.49:0;
    positions.push(sin*width,y,cos*depth+center+nose);
  }
  for(let row=0;row<rings.length-1;row++)for(let i=0;i<segments;i++){
    const a=row*(segments+1)+i,b=a+segments+1;indices.push(a,a+1,b,b,a+1,b+1);
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();
  // Match normals at the closed seam; otherwise the face has a visible centre line.
  const normals=geometry.attributes.normal;
  for(let row=0;row<rings.length;row++){
    const a=row*(segments+1),b=a+segments,n=new THREE.Vector3().fromBufferAttribute(normals,a).add(new THREE.Vector3().fromBufferAttribute(normals,b)).normalize();normals.setXYZ(a,n.x,n.y,n.z);normals.setXYZ(b,n.x,n.y,n.z);
  }
  return geometry;
}
function humanShapes(lite){
  const key=lite?'LITE':'STANDARD';if(humanGeometry.has(key))return humanGeometry.get(key);
  const segments=lite?8:12;
  const shapes={
    body:ringSurface([[-.5,0,0],[-.49,.76,.83],[-.35,.8,.91],[.03,.87,1],[.25,1,.94],[.4,.92,.83],[.49,.43,.54],[.51,0,0]],segments),
    limb:ringSurface([[-1,0,0],[-.97,.68,.7],[-.74,.83,.85],[-.28,1,1],[-.09,.82,.84],[0,0,0]],segments),
    head:ringSurface([[-1,0,0,.2],[-.86,.4,.43,.17],[-.65,.7,.68,.1],[-.31,.88,.81,.05],[-.12,.94,.86,.01],[.08,.97,.86],[.46,.93,.87,-.035],[.76,.74,.74,-.07],[.94,.4,.44,-.08],[1,0,0,-.08]],lite?12:20,{face:true}),
    detail:new THREE.SphereGeometry(1,lite?8:12,lite?5:8)
  };
  for(const [name,geometry] of Object.entries(shapes))geometry.name=`human-${key.toLowerCase()}-${name}`;
  humanGeometry.set(key,shapes);return shapes;
}

export function createUrbanPerson({skinColor='#c88d61',outfitColor='#496878',variant=0,detailed=true,materialPool=null}={}){
  const group=new THREE.Group();group.name='urban-person';
  variant=Number.isFinite(variant)?Math.abs(Math.trunc(variant)):0;
  const shapes=humanShapes(!detailed),material=(color,roughness)=>{
    if(!materialPool)return modelMaterial(color,roughness);
    const key=new THREE.Color(color).getHexString()+':'+roughness;
    if(!materialPool.has(key))materialPool.set(key,modelMaterial(color,roughness));return materialPool.get(key);
  };
  const skin=material(skinColor,.78),shirt=material(outfitColor,.92),trousers=material(variant%2?'#41454a':'#293441',.96),hair=material(['#302821','#211f1d','#534236'][variant%3],.96),shoe=material('#303335',.88),white=material('#c7c3b9',.88),iris=material('#302b28',.74),lip=material(new THREE.Color(skinColor).multiplyScalar(.72),.84);
  const materials={skin,shirt,trousers,hair,shoe,white,iris,lip};
  const part=(parent,name,mat,shape,x,y,z,sx,sy,sz)=>{const mesh=new THREE.Mesh(shapes[shape],mat);mesh.name=name;mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);mesh.castShadow=detailed;mesh.receiveShadow=false;parent.add(mesh);return mesh;};
  const body=new THREE.Group();body.name='human-posture';group.add(body);
  // 1.80 m adult, seven head lengths; shoulder/waist silhouette stays continuous.
  part(body,'tailored-shirt',shirt,'body',0,1.213,0,.218,.525,.13);
  part(body,'trouser-waist',trousers,'body',0,.953,-.006,.177,.19,.122);
  part(body,'neck',skin,'limb',0,1.594,-.008,.054,.16,.052);
  const head=new THREE.Group();head.name='human-head';head.position.set(0,1.674,0);body.add(head);
  part(head,'face',skin,'head',0,0,0,.103,.126,.102);
  for(const side of [-1,1]){
    if(detailed){
      part(head,'ear',skin,'detail',side*.098,-.004,-.003,.014,.028,.018);
      part(head,'eye-white',white,'detail',side*.037,.019,.082,.019,.006,.007);
    }
    part(head,'eye',iris,'detail',side*.037,.019,.088,.007,.006,.0035);
    const brow=part(head,'brow',hair,'detail',side*.037,.038,.083,.023,.004,.003);brow.rotation.z=-side*.045;
  }
  part(head,'mouth',lip,'detail',0,-.054,.099,.023,.0028,.004);
  part(head,'hair-crown',hair,'head',0,.079,-.012,.106,.052,.098);
  part(head,'hair-back',hair,'detail',0,variant%3===1?-.008:.035,-.067,.099,variant%3===1?.106:.076,.044);
  const arms=[],legs=[],knees=[],elbows=[];
  for(const side of [-1,1]){
    const arm=new THREE.Group();arm.name='shoulder';arm.position.set(side*.207,1.435,0);body.add(arm);arms.push(arm);
    part(arm,'sleeve',shirt,'limb',0,0,0,.073,.19,.083);
    part(arm,'upper-arm',skin,'limb',0,-.14,0,.05,.16,.052);
    const elbow=new THREE.Group();elbow.name='elbow';elbow.position.set(0,-.286,0);arm.add(elbow);elbows.push(elbow);
    part(elbow,'forearm',skin,'limb',0,0,0,.043,.262,.043);
    const hand=part(elbow,'hand',skin,'detail',0,-.307,.003,.033,.073,.021);hand.rotation.z=side*.07;
    if(detailed){const thumb=part(elbow,'thumb',skin,'limb',-side*.028,-.259,.011,.013,.054,.014);thumb.rotation.z=-side*.33;}
    const leg=new THREE.Group();leg.name='hip';leg.position.set(side*.095,.932,0);body.add(leg);legs.push(leg);
    part(leg,'trouser-thigh',trousers,'limb',0,0,0,.083,.431,.099);
    const knee=new THREE.Group();knee.name='knee';knee.position.y=-.408;leg.add(knee);knees.push(knee);
    part(knee,'trouser-calf',trousers,'limb',0,.03,-.008,.06,.468,.069);
    const foot=part(knee,'shoe',shoe,'body',0,-.457,.038,.06,.234,.045);foot.rotation.x=Math.PI/2;
    if(detailed){const sole=part(knee,'sole',white,'body',0,-.493,.038,.061,.236,.009);sole.rotation.x=Math.PI/2;}
  }
  if(detailed){
    for(const side of [-1,1]){const collar=part(body,'collar',shirt,'body',side*.043,1.439,.05,.032,.083,.014);collar.rotation.z=side*.45;}
  }
  function pose(phase,moving,activity=''){
    phase=Number.isFinite(phase)?phase:0;
    const stride=moving?Math.sin(phase)*.34:0;
    for(let i=0;i<2;i++){
      const sign=i?1:-1;legs[i].rotation.x=sign*stride;knees[i].rotation.x=moving?Math.max(0,-Math.sin(phase+(i?0:Math.PI)))*.43:0;
      arms[i].rotation.x=-sign*stride*.62;arms[i].rotation.z=sign*.055;elbows[i].rotation.x=-.08-(moving?Math.max(0,sign*stride)*.3:0);
    }
    // Animate only a local posture group: caller-owned route/heading never drift.
    body.position.y=moving?Math.abs(Math.sin(phase))*.008:0;body.rotation.y=moving?Math.sin(phase)*.018:0;body.rotation.z=moving?Math.sin(phase)*.009:0;
    head.rotation.y=moving?-Math.sin(phase)*.012:activity==='talk'?Math.sin(phase*.18)*.035:0;head.rotation.x=activity==='work'?.1:0;
    if(!moving&&activity==='work')for(let i=0;i<2;i++){arms[i].rotation.x=-.61;elbows[i].rotation.x=-.53+Math.sin(phase*.45+i)*.025;}
    if(!moving&&activity==='talk'){arms[0].rotation.x=-.26;elbows[0].rotation.x=-.52+Math.sin(phase*.2)*.04;}
  }
  pose(0,false);return {group,materials,legs,arms,knees,elbows,pose};
}

export function createUrbanCrowd({parent,count=24,identities=null,profileId='STANDARD'}){
  const skins=['#e4b38f','#b57e59','#87593d','#583c30'],outfits=['#c1b69d','#507888','#815b62','#39465e','#788560','#c59960'];
  const lite=profileId==='LITE',materialPool=new Map();
  const people=Array.from({length:count},(_,i)=>createUrbanPerson({skinColor:skins[i%4],outfitColor:outfits[i%6],variant:i,...identities?.[i]?.appearance,detailed:!lite,materialPool}));
  const buckets=new Map();
  for(const person of people)person.group.traverse(mesh=>{if(!mesh.isMesh)return;const key=mesh.geometry.uuid;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(mesh);});
  const batches=[];
  for(const objects of buckets.values()){
    const batch=new THREE.InstancedMesh(objects[0].geometry,modelMaterial('#ffffff',.88),objects.length);batch.frustumCulled=false;batch.castShadow=!lite;batch.name='detailed-pedestrians';batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    objects.forEach((mesh,i)=>batch.setColorAt(i,mesh.material.color));parent.add(batch);batches.push({batch,objects});
  }
  let disposed=false;
  return {people,update(){if(disposed)return;for(const person of people)person.group.updateMatrixWorld(true);for(const {batch,objects} of batches){objects.forEach((mesh,i)=>batch.setMatrixAt(i,mesh.matrixWorld));batch.instanceMatrix.needsUpdate=true;}},dispose(){if(disposed)return;disposed=true;for(const {batch} of batches){parent.remove(batch);batch.material.dispose();batch.dispose();}for(const material of materialPool.values())material.dispose();materialPool.clear();}};
}

export function createUrbanVehicle({architecture,color='#aeb7be',variant=0}){
  const a=architecture,group=new THREE.Group();group.name='detailed-city-car';
  const paint=new THREE.MeshPhysicalMaterial({color,roughness:.24,metalness:.66,clearcoat:1,clearcoatRoughness:.16});
  const glazing=new THREE.MeshPhysicalMaterial({color:'#263e4a',metalness:.72,roughness:.12,clearcoat:1});
  const tire=modelMaterial('#242526',.91),rim=modelMaterial('#9fa8ad',.32),red=new THREE.MeshStandardMaterial({color:'#9d2929',emissive:'#bb2424',emissiveIntensity:.6});
  for(const m of [paint,glazing,tire,rim,red])a.materials.add(m);
  const suv=variant%3===1,h=suv?1.05:.85;
  a.roundedPart(group,paint,0,h,0,1.95,.67,4.5,.48);
  a.roundedPart(group,a.graphite,0,.59,0,1.91,.2,4.45,.35);
  a.roundedPart(group,glazing,0,h+.53,-.15,1.64,.65,suv?2.55:2.28,.48);
  a.roundedPart(group,paint,0,h+.89,-.28,1.58,.13,suv?2.3:1.78,.48);
  a.roundedPart(group,paint,0,h+.35,1.58,1.82,.2,1.24,.26);
  for(const side of [-1,1]){
    a.part(group,paint,side*.79,h+.57,-.2,.07,.64,.13);
    a.part(group,rim,side*.94,h+.08,.2,.03,.045,2.8);
    for(const z of [-.65,.66])a.part(group,rim,side*.97,h+.23,z,.04,.06,.22);
    a.roundedPart(group,paint,side*1.07,h+.49,.68,.28,.19,.35,.08);
    for(const z of [-1.43,1.4]){
      const wheel=new THREE.Group();wheel.position.set(side*.99,.47,z);group.add(wheel);
      const rubber=new THREE.Mesh(new THREE.CylinderGeometry(.43,.43,.23,20),tire);rubber.rotation.z=Math.PI/2;wheel.add(rubber);
      const hub=new THREE.Mesh(new THREE.CylinderGeometry(.29,.29,.245,16),rim);hub.rotation.z=Math.PI/2;wheel.add(hub);
      for(let i=0;i<5;i++){const spoke=a.part(wheel,a.graphite,side*.13,0,0,.02,.53,.07);spoke.rotation.x=i*Math.PI/5;}
    }
    a.roundedPart(group,a.warm,side*.67,h+.08,2.225,.48,.14,.05,.025);
    a.roundedPart(group,red,side*.68,h+.07,-2.24,.48,.14,.06,.025);
  }
  a.part(group,a.graphite,0,h-.14,2.26,.95,.22,.045);
  a.part(group,rim,0,h-.01,2.29,1.01,.035,.02);
  a.part(group,rim,0,.65,-2.29,.55,.12,.03);
  a.batch(group);return group;
}
