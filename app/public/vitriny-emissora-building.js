import * as THREE from '/vendor/three/three.module.js';
import {EMISSORA_BUILDING} from './vitriny-emissora-core.js';

export function mountEmissoraBuilding({scene,architecture}){
  const venue=EMISSORA_BUILDING,group=new THREE.Group();
  group.name=venue.reference;group.position.set(venue.position.x,venue.position.y,venue.position.z);group.rotation.y=venue.rotation;
  group.userData={store:true,reference:venue.reference,label:venue.label,href:venue.href};
  const {part,stone,graphite,brass,warm,glass,textSign}=architecture;
  // Shared box geometry and existing materials keep the mobile cost bounded.
  part(group,stone,0,.55,0,58,1.1,48);
  part(group,graphite,0,8,-1,48,15,32);
  part(group,stone,0,16.1,-1,51,1.2,35);
  part(group,glass,0,7.2,15.25,44,12,.06);
  part(group,stone,-22,7.5,15.45,3,14,.5);
  part(group,stone,22,7.5,15.45,3,14,.5);
  for(const x of [-16,-8,8,16])part(group,brass,x,7.2,15.45,.15,12,.16);
  for(const y of [4,10])part(group,brass,0,y,15.45,43,.12,.16);
  // An asymmetric editorial tower and a restrained, static roof antenna.
  part(group,graphite,-12,22,-6,18,11,19);
  part(group,stone,-12,27.8,-6,20,.8,20);
  for(const x of [-19,-15,-11,-7])part(group,glass,x,22,3.6,2.9,8,.05);
  part(group,brass,-12,32,-6,.35,8,.35);
  for(const [y,width]of [[30.2,8],[32.1,5.6],[34,3.4]])part(group,brass,-12,y,-6,width,.16,.22);
  part(group,brass,-12,36.4,-6,.18,1.4,.18);
  // Recessed entrance, canopy and a clear path to the existing door behavior.
  part(group,stone,0,.7,21,18,.3,11);
  part(group,glass,0,4.3,17.7,9,7.2,.06);
  for(const x of [-4.5,0,4.5])part(group,brass,x,4.3,17.9,.12,7.2,.16);
  for(const x of [-.6,.6])part(group,brass,x,3.5,18.1,.07,.9,.16);
  part(group,graphite,0,9,19.2,26,.9,9);
  part(group,warm,0,9.5,23.8,25,.08,.12);
  part(group,warm,0,.9,26.3,18,.04,.08);
  part(group,warm,0,16.8,16.7,49,.07,.12);
  textSign(group,'EMISSORA VITRINECITY',{width:45,height:5.2,y:13,z:16.1,color:'#f7e7c2',subtitle:'CONTEÚDO EDITORIAL DA CIDADE'});
  textSign(group,'ABRIR EMISSORA',{width:21,height:2.8,y:6,z:20,subtitle:'EXPLORE OS CONTEÚDOS'});
  scene.add(group);return group;
}
