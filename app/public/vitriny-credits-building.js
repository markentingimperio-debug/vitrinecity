import * as THREE from '/vendor/three/three.module.js';
export function mountCreditsBuilding({scene,architecture}){
  const group=new THREE.Group();group.name='vitrinecity-credits';group.position.set(126,0,-185);group.rotation.y=-.65;
  group.userData={store:true,reference:'vitrinecity-credits',label:'Banco VitrineCity · Créditos',href:'/central-creditos.html'};
  const {part,stone,graphite,brass,warm,glass,textSign}=architecture;
  part(group,stone,0,.5,0,55,1,39);part(group,graphite,0,14,-2,46,27,29);part(group,glass,0,13,12.7,43,24,.08);
  for(const x of [-21,-14,14,21]){part(group,brass,x,14,13,.5,28,.5);part(group,warm,x,14,13.4,.12,26,.1);}
  for(const y of [7,17,27])part(group,stone,0,y,-1,48,.65,33);
  part(group,brass,0,29,-1,49,2.5,33);part(group,warm,0,30.3,15.5,49,.12,.1);
  part(group,graphite,0,9,19,28,1,13);part(group,warm,0,9.55,25.5,28,.1,.1);
  textSign(group,'BANCO VITRINECITY',{width:41,height:5,y:23,z:16,color:'#f1d495',subtitle:'CENTRAL DE CRÉDITOS DA CIDADE'});
  textSign(group,'CRÉDITOS E RECOMPENSAS',{width:26,height:3,y:13,z:16.1,subtitle:'ANÚNCIOS · INTERAÇÃO'});
  textSign(group,'ENTRAR',{width:16,height:2.8,y:5,z:18,subtitle:'SALDO · BENEFÍCIOS · EXTRATO'});
  scene.add(group);return group;
}
