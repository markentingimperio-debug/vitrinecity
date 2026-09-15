import * as THREE from '/vendor/three/three.module.js';
import {createUrbanCrowd} from './vitriny-urban-models.js?v=20260915-residents-2';
import {createResidentCatalog,residentPose,residentDesk,residentVisibleRoster,RESIDENT_DEPARTMENTS} from './vitriny-city-residents-core.js?v=20260915-residents-2';

export function mountResidentPavilion({building,architecture:a}){
  const venue=new THREE.Group();venue.position.set(building.position.x,0,building.position.z);
  venue.name=`resident-venue-${building.id}`;venue.userData={store:true,reference:venue.name,label:building.name,href:building.href};
  const part=(material,x,y,z,w,h,d)=>a.part(venue,material,x,y,z,w,h,d);
  // The only new interiors are explicitly built here. Door has no glass plane;
  // desk aisles and route coordinates share residentDesk() from the catalog.
  part(a.stone,0,.15,0,30,.3,27);part(a.wood,0,.32,0,28,.04,24);
  part(a.wood,0,4.7,-12.5,29,9.4,.28);
  for(const x of [-14.5,14.5])part(a.glass,x,4.5,0,.035,8.5,25);
  for(const x of [-8.25,8.25])part(a.glass,x,4.5,12.5,12.5,8.5,.035);
  for(const x of [-14.5,-2,2,14.5])part(a.brass,x,4.7,12.6,.13,9.4,.13);
  for(const x of [-14.5,14.5])part(a.graphite,x,4.7,-12.5,.25,9.4,.25);
  part(a.graphite,0,9.5,0,31,.7,27);part(a.stone,0,9.95,0,31,.2,27);
  part(a.warm,0,9.05,12.8,29,.055,.08);part(a.stone,0,8.25,13.1,30,.3,3);
  a.textSign(venue,building.name,{width:26,height:1.25,y:9.4,z:13.8,subtitle:'EQUIPE VIRTUAL · ROTINAS SIMULADAS'});
  for(let slot=0;slot<8;slot++){
    const desk=residentDesk(slot);part(a.wood,desk.x,1.15,desk.z,3.2,.14,1.4);
    for(const dx of [-1.2,1.2])part(a.graphite,desk.x+dx,.7,desk.z,.1,.9,1);
    part(a.graphite,desk.x,1.72,desk.z-.14,1.45,.9,.09);part(a.glass,desk.x,1.73,desk.z-.08,1.3,.75,.02);
    part(a.graphite,desk.x,1.26,desk.z+.38,1.1,.04,.32);
  }
  // Warm ceiling strips light the work banks, without extra point lights.
  for(const x of [-7,7])part(a.warm,x,8.7,-.5,8,.035,.3);
  if(building.id==='studio')for(const [i,label] of ['YouTube','Instagram','TikTok'].entries()){const sign=a.textSign(venue,label,{width:8,height:1.1,y:7,z:12.8});sign.position.x=(i-1)*9;}
  a.batch?.(venue);return venue;
}

// This scene has no task executor. Its only live actions are directory selection
// and navigation handled by the existing city. Movement is explicitly fictional.
export function mountCityResidents({scene,architecture,profileId='STANDARD'}){
  const root=new THREE.Group();root.name='virtual-residents-simulation';scene.add(root);
  let catalog=createResidentCatalog(),crowd=null,visible=[],selectedId='',elapsed=0,posed=false;
  const lite=profileId==='LITE',limit=lite?16:40;
  const venues=[];
  for(const building of RESIDENT_DEPARTMENTS.filter(d=>d.newBuilding)){
    const venue=mountResidentPavilion({building,architecture});
    scene.add(venue);venues.push(venue);
  }
  const marker=new THREE.Mesh(new THREE.RingGeometry(1.1,1.35,24),new THREE.MeshBasicMaterial({color:'#e6c985',side:THREE.DoubleSide}));
  marker.rotation.x=-Math.PI/2;marker.visible=false;root.add(marker);
  function rebuild(){
    crowd?.dispose();
    visible=residentVisibleRoster(catalog,selectedId,limit);
    crowd=createUrbanCrowd({parent:root,count:visible.length,identities:visible});posed=false;
  }
  function tick(dt,{paused=false}={}){
    if(paused&&posed)return;posed=true;if(!paused)elapsed+=Math.min(Math.max(dt,0),.1);
    for(const [i,person] of visible.entries()){
      const building=catalog.departments.find(b=>b.id===person.departmentId),pose=residentPose(person,building,elapsed),model=crowd.people[i];
      model.group.position.set(pose.x,.35,pose.z);model.group.rotation.y=pose.yaw;model.pose(paused?0:elapsed*5.8,pose.moving&&!paused,pose.action);
      model.group.name=`resident-${person.id}`;model.group.userData={residentId:person.id,simulated:true};
      if(person.id===selectedId){marker.visible=true;marker.position.set(pose.x,.33,pose.z);}
    }
    crowd.update();
  }
  rebuild();tick(0,{paused:true});
  return {venues,tick,setCatalog(value){catalog=value;rebuild();tick(0,{paused:true});},select(id){selectedId=id;marker.visible=false;rebuild();tick(0,{paused:true});const p=catalog.residents.find(p=>p.id===id);return p?residentPose(p,catalog.departments.find(d=>d.id===p.departmentId),elapsed):null;},dispose(){crowd?.dispose();marker.geometry.dispose();marker.material.dispose();scene.remove(root);}};
}
