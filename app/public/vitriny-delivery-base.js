import * as THREE from '/vendor/three/three.module.js';

export function mountDeliveryBase({scene,architecture,cityId,cityName}){
  const group=new THREE.Group();group.name=`vc-entregas-${cityId}`;group.position.set(104,0,-90);group.rotation.y=-.85;
  group.userData={deliveryBase:true,label:`VC Entregas · ${cityName}`,operating:false};
  const {part,stone,graphite,wood,brass,warm,textSign,tree}=architecture;
  const blue=new THREE.MeshStandardMaterial({color:'#174577',metalness:.25,roughness:.4});
  const glass=new THREE.MeshStandardMaterial({color:'#80b4c5',transparent:true,opacity:.34,metalness:.4,roughness:.15,depthWrite:false});
  const rubber=new THREE.MeshStandardMaterial({color:'#20282b',roughness:.9});
  part(group,stone,0,.22,7,62,.44,58);
  part(group,stone,0,5.2,-4,48,10.4,29);
  part(group,graphite,0,10.55,-4,51,.5,32);
  part(group,blue,0,8.8,11,50,2.3,.8);
  textSign(group,'VC ENTREGAS',{width:36,height:2.5,y:8.8,z:11.45,subtitle:`BASE OPERACIONAL · ${cityName.toLocaleUpperCase('pt-BR')}`});
  part(group,warm,0,10.8,12,50,.1,.1);
  part(group,graphite,0,7.3,14,51,.3,8);
  for(const x of [-21,-6,8,22])part(group,blue,x,3.7,17.7,.25,7.4,.25);
  part(group,glass,-15,3.8,10.7,14,6.5,.08);
  for(const x of [-21,-15,-9])part(group,brass,x,3.6,10.8,.08,6.6,.1);
  textSign(group,'RECEPÇÃO',{width:9,height:.8,y:6.8,z:11});
  for(const x of [1,15]){
    part(group,graphite,x,3.5,10.8,11,6.6,.15);
    for(let y=1;y<6.5;y+=.45)part(group,stone,x,y,10.95,10.5,.29,.12);
    for(let i=0;i<4;i++)part(group,wood,x-3.8+(i%2)*2.2,.8+Math.floor(i/2)*1.4,14.1,1.8,1.4,1.4);
  }
  const parking=new THREE.Group();parking.position.set(0,0,25);group.add(parking);
  for(let i=0;i<7;i++){
    const xx=-23+i*7;part(parking,warm,xx,.47,0,.06,.03,7);part(parking,warm,xx+3.5,.47,-3.5,7,.03,.06);
    if(i>4)continue;
    const bike=new THREE.Group();bike.position.set(xx+3.5,.5,0);parking.add(bike);
    for(const z of [-.9,.9]){const wheel=new THREE.Mesh(new THREE.TorusGeometry(.42,.12,6,16),rubber);wheel.rotation.y=Math.PI/2;wheel.position.set(0,.46,z);bike.add(wheel);}
    part(bike,blue,0,.95,0,.6,.6,1.5);part(bike,graphite,0,1.28,-.15,.58,.12,.95);
    part(bike,brass,0,1.5,.75,1,.06,.09);part(bike,blue,0,1.5,-.9,.85,.65,.75);
  }
  for(const x of [-27,27])for(const z of [-14,7,25])tree(group,x,z,1.15);
  textSign(group,'EM IMPLANTAÇÃO',{width:17,height:1.5,y:2.5,z:35});
  scene.add(group);return group;
}
