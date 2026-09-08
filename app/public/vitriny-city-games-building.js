import * as THREE from '/vendor/three/three.module.js';
export function mountGamesBuilding({scene,architecture}){
  const group=new THREE.Group();group.name='vitrinecity-games';group.position.set(-106,0,-95);group.rotation.y=.65;group.userData={store:true,reference:'vitrinecity-games',label:'VitrineCity Games',href:'/vitriny-games.html'};
  const {part,graphite,brass,warm,glass,stone,textSign,tree}=architecture;
  part(group,stone,0,.6,0,49,1.2,33);part(group,graphite,0,8,-1,42,15,27);part(group,glass,0,7,12.65,38,12,.05);
  for(const x of [-18,-12,-6,6,12,18])part(group,brass,x,7,12.8,.12,12,.12);
  for(let i=0;i<4;i++)part(group,warm,0,3.2+i*3,13.4,42,.055,.08);
  part(group,graphite,0,16.4,-2,44,2,29);part(group,warm,0,17.5,12.6,43,.1,.1);
  textSign(group,'VITRINECITY GAMES',{width:37,height:3.4,y:14.5,z:13.5,subtitle:'ENTRE · JOGUE · EXPLORE'});
  textSign(group,'MINI FAZENDA',{width:16,height:4,y:7.5,z:13.6,color:'#cde7b1',subtitle:'PLANTE. CUIDE. EVOLUA.'});
  for(const x of [-17,17]){part(group,brass,x,23,-2,.4,12,.4);part(group,brass,x,29,-2,1,1,27);}
  part(group,brass,0,29,-2,35,.4,.4);part(group,warm,0,29.3,-2,35,.1,.1);
  for(const x of [-22,22])tree(group,x,12,1.1,1.1);scene.add(group);return group;
}
