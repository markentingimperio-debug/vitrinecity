import * as THREE from '/vendor/three/three.module.js';

// Shared geometry keeps the detailed population inexpensive to instance.
const sphere=new THREE.SphereGeometry(1,14,10),tube=new THREE.CylinderGeometry(1,1,1,12),box=new THREE.BoxGeometry(1,1,1);
const modelMaterial=(color,roughness=.75)=>new THREE.MeshStandardMaterial({color,roughness});
function ellipsoid(parent,material,x,y,z,sx,sy,sz,geometry=sphere){const mesh=new THREE.Mesh(geometry,material);mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;}

export function createUrbanPerson({skinColor='#c88d61',outfitColor='#496878',variant=0,detailed=true}={}){
  const group=new THREE.Group();group.name='urban-person';
  const skin=modelMaterial(skinColor,.64),shirt=modelMaterial(outfitColor,.87),trousers=modelMaterial(variant%2?'#3e4548':'#283342',.95),hair=modelMaterial(['#362b23','#221f1c','#574031'][variant%3],.95),shoe=modelMaterial('#333334',.74),white=modelMaterial('#ebe7dd',.8),iris=modelMaterial('#342c24',.43),lip=modelMaterial(new THREE.Color(skinColor).multiplyScalar(.66),.68);
  const materials={skin,shirt,trousers,hair,shoe,white,iris,lip};
  // Adult proportions: shoulder girdle, ribcage, waist and pelvis are distinct volumes.
  ellipsoid(group,shirt,0,1.22,0,.235,.27,.135);
  ellipsoid(group,shirt,0,1.06,0,.185,.20,.124);
  ellipsoid(group,trousers,0,.92,-.005,.195,.125,.13);
  ellipsoid(group,skin,0,1.48,0,.063,.095,.06,tube);
  const head=new THREE.Group();head.position.set(0,1.65,0);group.add(head);
  ellipsoid(head,skin,0,0,0,.108,.15,.113);
  ellipsoid(head,skin,0,-.057,.038,.083,.078,.082);
  for(const side of [-1,1]){
    ellipsoid(head,skin,side*.109,-.005,-.001,.022,.038,.018);
    ellipsoid(head,white,side*.042,.012,.096,.027,.012,.014);
    ellipsoid(head,iris,side*.042,.013,.109,.010,.010,.004);
    const brow=ellipsoid(head,hair,side*.043,.043,.104,.029,.004,.005);brow.rotation.z=-side*.07;
  }
  ellipsoid(head,skin,0,-.005,.113,.018,.034,.026);
  ellipsoid(head,skin,0,-.025,.124,.021,.012,.013);
  ellipsoid(head,lip,0,-.064,.107,.029,.004,.004);
  ellipsoid(head,hair,0,.1,-.02,.112,.061,.103);
  for(const side of [-1,1])ellipsoid(head,hair,side*.1,.044,-.034,.016,.079,.067);
  if(variant%3===1)ellipsoid(head,hair,0,-.018,-.084,.12,.135,.054);
  const arms=[],legs=[],knees=[],elbows=[];
  for(const side of [-1,1]){
    const arm=new THREE.Group();arm.position.set(side*.235,1.38,0);group.add(arm);arms.push(arm);
    ellipsoid(arm,shirt,side*.007,-.073,0,.08,.13,.09);
    ellipsoid(arm,skin,side*.014,-.23,0,.054,.135,.055);
    const elbow=new THREE.Group();elbow.position.set(side*.014,-.335,0);arm.add(elbow);elbows.push(elbow);
    ellipsoid(elbow,skin,0,-.108,0,.044,.134,.048);
    ellipsoid(elbow,skin,0,-.253,.01,.04,.074,.024);
    ellipsoid(elbow,skin,-side*.034,-.231,.025,.017,.043,.016);
    const leg=new THREE.Group();leg.position.set(side*.104,.93,0);group.add(leg);legs.push(leg);
    ellipsoid(leg,trousers,0,-.19,0,.087,.235,.104);
    const knee=new THREE.Group();knee.position.y=-.4;leg.add(knee);knees.push(knee);
    ellipsoid(knee,trousers,0,-.19,-.012,.065,.235,.074);
    ellipsoid(knee,shoe,0,-.43,.054,.077,.055,.142);
    ellipsoid(knee,white,0,-.467,.058,.079,.017,.143);
    if(detailed){for(let i=0;i<3;i++)ellipsoid(knee,white,0,-.39+i*.008,.065+i*.018,.047,.004,.005,box);}
  }
  if(detailed){
    ellipsoid(group,shirt,-.1,1.28,.118,.045,.05,.014,box);
    for(const y of [1.14,1.26,1.37])ellipsoid(group,white,0,y,.136,.007,.007,.005);
    ellipsoid(group,lip,0,1.455,.06,.024,.005,.005);
  }
  function pose(phase,moving){
    const stride=moving?Math.sin(phase)*.47:0;
    for(let i=0;i<2;i++){const sign=i?1:-1;legs[i].rotation.x=sign*stride;knees[i].rotation.x=moving?Math.max(0,-Math.sin(phase+(i?0:Math.PI)))*.56:0;arms[i].rotation.x=-sign*stride*.7;elbows[i].rotation.x=-.12-(moving?Math.max(0,sign*stride)*.35:0);}
    head.rotation.y=moving?Math.sin(phase*.5)*.025:0;
  }
  pose(0,false);return {group,materials,legs,arms,knees,elbows,pose};
}

export function createUrbanCrowd({parent,count=24}){
  const skins=['#e4b38f','#b57e59','#87593d','#583c30'],outfits=['#c1b69d','#507888','#815b62','#39465e','#788560','#c59960'];
  const people=Array.from({length:count},(_,i)=>createUrbanPerson({skinColor:skins[i%4],outfitColor:outfits[i%6],variant:i,detailed:false}));
  const buckets=new Map();
  for(const person of people)person.group.traverse(mesh=>{if(!mesh.isMesh)return;const key=mesh.geometry.uuid;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(mesh);});
  const batches=[];
  for(const objects of buckets.values()){
    const batch=new THREE.InstancedMesh(objects[0].geometry,modelMaterial('#ffffff',.82),objects.length);batch.frustumCulled=false;batch.castShadow=true;batch.name='detailed-pedestrians';batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    objects.forEach((mesh,i)=>batch.setColorAt(i,mesh.material.color));parent.add(batch);batches.push({batch,objects});
  }
  return {people,update(){for(const person of people)person.group.updateMatrixWorld(true);for(const {batch,objects} of batches){objects.forEach((mesh,i)=>batch.setMatrixAt(i,mesh.matrixWorld));batch.instanceMatrix.needsUpdate=true;}},dispose(){const materials=new Set();for(const person of people)Object.values(person.materials).forEach(m=>materials.add(m));for(const m of materials)m.dispose();}};
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
