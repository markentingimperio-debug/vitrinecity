import * as THREE from '/vendor/three/three.module.js';
export function mountCinemaBuilding({scene,architecture}){
  const group=new THREE.Group();group.name='vitrinecity-cinema';group.position.set(116,0,154);group.rotation.y=Math.PI;
  group.userData={store:true,reference:'vitrinecity-cinema',label:'Cinema VitrineCity',href:'/vitriny-cinema.html'};
  const {part,stone,graphite,brass,warm,glass,textSign}=architecture;
  part(group,stone,0,.5,0,74,1,52);part(group,graphite,0,12,-3,64,23,40);
  const velvet=new THREE.MeshStandardMaterial({color:'#422431',roughness:.74});architecture.materials.add(velvet);
  part(group,velvet,0,11,17.2,59,19,.3);
  for(const x of [-31,-25,25,31]){part(group,brass,x,13,18.1,.38,25,.4);part(group,warm,x,13,18.4,.1,24,.1);}
  for(const [y,w]of [[25,66],[27,59],[29,51]]){part(group,graphite,0,y,-2,w,1.2,41);part(group,warm,0,y+.66,18.6,w,.12,.16);}
  part(group,glass,0,5,18.4,22,8,.08);for(const x of [-11,0,11])part(group,brass,x,5,18.5,.18,8,.2);
  part(group,graphite,0,10,23,40,1.2,13);part(group,warm,0,10.7,29.5,40,.15,.2);
  textSign(group,'CINEMA VITRINECITY',{width:51,height:6,y:19,z:18.6,color:'#f1d4a5',subtitle:'HISTÓRIAS EM OUTRA DIMENSÃO'});
  textSign(group,'ENTRAR NO CINEMA',{width:23,height:3,y:6,z:24,subtitle:'ESCOLHA SUA PRÓXIMA SESSÃO'});
  for(const [x,label]of [[-21,'KIDS'],[21,'AVENTURA']])textSign(group,label,{y:7,z:18.7,width:13,height:5,color:'#e1b5c2',subtitle:'CURTAS E TRAILERS'}).position.x=x;
  part(group,velvet,0,.65,26,18,.15,15);part(group,warm,0,.75,33,19,.05,.15);
  scene.add(group);return group;
}
