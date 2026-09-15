import * as THREE from '/vendor/three/three.module.js';
import {createUrbanCrowd} from './vitriny-urban-models.js?v=20260915-residents-1';
import {createResidentCatalog,residentPose,RESIDENT_DEPARTMENTS} from './vitriny-city-residents-core.js';

// This scene has no task executor. Its only live actions are directory selection
// and navigation handled by the existing city. Movement is explicitly fictional.
export function mountCityResidents({scene,architecture,profileId='STANDARD'}){
  const root=new THREE.Group();root.name='virtual-residents-simulation';scene.add(root);
  let catalog=createResidentCatalog(),crowd=null,visible=[],selectedId='',elapsed=0,posed=false;
  const lite=profileId==='LITE',limit=lite?16:40;
  const venues=[];
  for(const [index,building] of RESIDENT_DEPARTMENTS.filter(d=>d.newBuilding).entries()){
    const venue=new THREE.Group();venue.position.set(building.position.x,0,building.position.z);
    venue.name=`resident-venue-${building.id}`;venue.userData={store:true,reference:venue.name,label:building.name,href:building.href};
    architecture.boutique(venue,{label:building.name,width:29,depth:25,height:12,variant:index,subtitle:building.id==='studio'?'YOUTUBE · INSTAGRAM · TIKTOK':'CONTEÚDO E SERVIÇOS'});
    if(building.id==='studio')for(const [i,label] of ['YouTube','Instagram','TikTok'].entries()){const sign=architecture.textSign(venue,label,{width:8,height:1.4,y:3.4,z:13.1});sign.position.x=(i-1)*9;}
    scene.add(venue);venues.push(venue);
  }
  const marker=new THREE.Mesh(new THREE.RingGeometry(1.1,1.35,24),new THREE.MeshBasicMaterial({color:'#e6c985',side:THREE.DoubleSide}));
  marker.rotation.x=-Math.PI/2;marker.visible=false;root.add(marker);
  function rebuild(){
    crowd?.dispose();
    const selected=catalog.residents.find(p=>p.id===selectedId);
    visible=(selected?[selected,...catalog.residents.filter(p=>p.id!==selectedId)]:catalog.residents).slice(0,limit);
    crowd=createUrbanCrowd({parent:root,count:visible.length,identities:visible});posed=false;
  }
  function tick(dt,{paused=false}={}){
    if(paused&&posed)return;posed=true;if(!paused)elapsed+=Math.min(Math.max(dt,0),.1);
    for(const [i,person] of visible.entries()){
      const building=catalog.departments.find(b=>b.id===person.departmentId),pose=residentPose(person,building,elapsed),model=crowd.people[i];
      model.group.position.set(pose.x,.3,pose.z);model.group.rotation.y=pose.yaw;model.pose(paused?0:elapsed*5.8,pose.moving&&!paused);
      model.group.name=`resident-${person.id}`;model.group.userData={residentId:person.id,simulated:true};
      if(person.id===selectedId){marker.visible=true;marker.position.set(pose.x,.33,pose.z);}
    }
    crowd.update();
  }
  rebuild();tick(0,{paused:true});
  return {venues,tick,setCatalog(value){catalog=value;rebuild();tick(0,{paused:true});},select(id){selectedId=id;marker.visible=false;rebuild();tick(0,{paused:true});const p=catalog.residents.find(p=>p.id===id);return p?residentPose(p,catalog.departments.find(d=>d.id===p.departmentId),elapsed):null;},dispose(){crowd?.dispose();marker.geometry.dispose();marker.material.dispose();scene.remove(root);}};
}
