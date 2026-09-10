import * as THREE from '/vendor/three/three.module.js';

export function mountPromenadeGardens({scene,architecture,lite=false}){
  const a=architecture,group=new THREE.Group();group.name='promenade-gardens';
  const paving=a.pavingMaterial({color:'#bdb7a8',repeat:18,formal:true});
  // A pedestrian boulevard connects the existing store fronts to the civic tower.
  for(const [center,length] of [[-56,276],[159,82]])a.part(group,paving,-164,.51,center,92,.14,length);
  for(const x of [-171,-157])for(const [center,length] of [[-56,276],[159,82]])a.part(group,a.warm,x,.59,center,.08,.025,length);
  for(const z of [-152,-105,-5,69,163]){
    a.roundedPart(group,a.stone,-164,.93,z,8.5,.7,19,3.5);
    a.roundedPart(group,a.foliage[0],-164,1.33,z,7.7,.15,18.2,3.1);
    a.shrubs(group,-164,1.35,z,7,17);a.tree(group,-164,z-4,1.05,1.3);a.tree(group,-164,z+4,.84,1.3);
    for(const side of [-1,1])a.roundedPart(group,a.wood,-164+side*4.6,1.01,z,1,.2,11,.4);
  }
  const water=new THREE.MeshPhysicalMaterial({color:'#407987',roughness:.14,metalness:.5,clearcoat:1});a.materials.add(water);
  for(const z of [-47,31]){
    const island=new THREE.Group();island.position.set(-164,.59,z);group.add(island);
    const basin=new THREE.Mesh(new THREE.CylinderGeometry(7.4,7.8,.75,48),a.stone);basin.position.y=.4;island.add(basin);
    const surface=new THREE.Mesh(new THREE.CircleGeometry(6.9,48),water);surface.rotation.x=-Math.PI/2;surface.position.y=.82;island.add(surface);
    const edge=new THREE.Mesh(new THREE.TorusGeometry(7.15,.055,6,64),a.warm);edge.rotation.x=-Math.PI/2;edge.position.y=.86;island.add(edge);
    if(z<0){
      for(let i=0;i<9;i++){
        const angle=i*Math.PI*2/9,r=i?3.2:0,curve=new THREE.QuadraticBezierCurve3(new THREE.Vector3(Math.cos(angle)*r,.9,Math.sin(angle)*r),new THREE.Vector3(Math.cos(angle)*r*.7,5.2,Math.sin(angle)*r*.7),new THREE.Vector3(Math.cos(angle)*r*.32,.9,Math.sin(angle)*r*.32));
        const stream=new THREE.Mesh(new THREE.TubeGeometry(curve,12,.065,4,false),new THREE.MeshBasicMaterial({color:'#c9e6ec',transparent:true,opacity:.75}));island.add(stream);
      }
    }else{
      a.roundedPart(island,a.graphite,0,1.45,0,2.3,1.2,2.3,.6);
      for(const rotation of [[0,0,0],[0,Math.PI/2,0],[Math.PI/2,0,0]]){const orbit=new THREE.Mesh(new THREE.TorusGeometry(3.1,.08,8,64),a.brass);orbit.position.y=5.1;orbit.rotation.set(...rotation);island.add(orbit);}
      for(const latitude of [-1.6,1.6]){const ring=new THREE.Mesh(new THREE.TorusGeometry(2.65,.055,6,48),a.brass);ring.rotation.x=Math.PI/2;ring.position.y=5.1+latitude;island.add(ring);}
    }
  }
  // This planting uses the existing wide pavements. Crossings and store doors stay open.
  for(const x of [-183,-145])for(const z of [-105,-74,-25,44,120,169]){
    const bed=new THREE.Group();bed.position.set(x,0,z);group.add(bed);
    a.roundedPart(bed,a.stone,0,.6,0,5.2,.75,12,2);
    a.roundedPart(bed,a.foliage[0],0,1.04,0,4.55,.14,11.3,1.8);
    a.shrubs(bed,0,1.1,0,4.4,10.5);a.tree(bed,0,-2,1.28,1.05);a.tree(bed,.2,3,.86,1.05);
    a.part(bed,a.wood,x<-164?3.1:-3.1,.87,1,1.1,.24,7);
    a.part(bed,a.warm,0,.45,5.97,3.1,.04,.04);
    a.part(bed,a.brass,0,4.65,-7.1,.11,8.6,.11);
    a.part(bed,a.brass,0,8.91,-6,3.7,.14,2.4);
    a.part(bed,a.warm,0,8.81,-6,3.5,.065,2.15);
  }
  // Four civic garden islands frame the fountain, leaving the central paths unobstructed.
  for(const [x,z] of [[-39,-31],[39,-31],[-39,34],[39,34]]){
    a.roundedPart(group,paving,x,.35,z,21,.3,15,5);
    a.roundedPart(group,a.stone,x,.85,z,16,.8,10,4);
    a.roundedPart(group,a.foliage[1],x,1.3,z,15,.16,9,3.6);
    a.tree(group,x-4,z,1.6,1.2);a.tree(group,x+4,z-1,1.1,1.2);
    a.roundedPart(group,a.wood,x,.94,z+6,15,.24,1.1,.5);
    a.part(group,a.warm,x,.78,z+6.4,14,.05,.06);
  }
  a.batch(group);scene.add(group);return group;
}
