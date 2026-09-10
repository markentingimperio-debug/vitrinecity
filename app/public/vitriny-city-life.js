import * as THREE from '/vendor/three/three.module.js';
import {createUrbanCrowd,createUrbanVehicle} from './vitriny-urban-models.js';

// These residents and vehicles are ambient scenery, never online visitor counts.
export function mountCityLife({scene,architecture,profileId='STANDARD'}){
  const lite=profileId==='LITE',group=new THREE.Group();group.name='city-ambient-life';scene.add(group);
  const {part,stone,graphite,brass,warm,wood,tree}=architecture;
  const asphalt=new THREE.MeshStandardMaterial({color:'#17232e',roughness:.72,metalness:.06}),paving=new THREE.MeshStandardMaterial({color:'#9da6ae',roughness:.72}),markings=new THREE.MeshBasicMaterial({color:'#ded3ae'});
  architecture.materials.add(asphalt);architecture.materials.add(paving);architecture.materials.add(markings);
  part(group,paving,0,.23,100,620,.2,25);part(group,asphalt,0,.36,100,620,.16,14);
  for(let x=-302;x<=302;x+=14)if(Math.abs(x)>11)part(group,markings,x,.453,100,5,.014,.15);
  for(let z=94;z<=106;z+=1.5)part(group,markings,0,.46,z,8,.018,.7);
  for(const z of [88,112])for(let x=-275;x<=275;x+=44){
    if(Math.abs(x)<25)continue;tree(group,x+5,z,.78,.3);part(group,graphite,x,3.8,z,.14,7.4,.14);part(group,brass,x+1.2,7.45,z,2.5,.1,.18);part(group,warm,x+1.2,7.32,z,2.2,.08,.3);
    const glow=new THREE.Mesh(new THREE.PlaneGeometry(9,6),new THREE.MeshBasicMaterial({color:'#ffd291',transparent:true,opacity:.06,depthWrite:false}));glow.rotation.x=-Math.PI/2;glow.position.set(x+1,.48,z);group.add(glow);
  }
  // A shallow reflecting fountain frames the existing civic landmark.
  const basin=new THREE.Mesh(new THREE.CylinderGeometry(12,12.5,.7,48),graphite);basin.position.y=.5;group.add(basin);
  const water=new THREE.Mesh(new THREE.CircleGeometry(11.7,48),new THREE.MeshStandardMaterial({color:'#427a87',metalness:.72,roughness:.18,transparent:true,opacity:.86}));water.rotation.x=-Math.PI/2;water.position.y=.88;group.add(water);
  for(const r of [11.8,12.4]){const edge=new THREE.Mesh(new THREE.TorusGeometry(r,.055,5,64),warm);edge.rotation.x=Math.PI/2;edge.position.y=.85;group.add(edge);}
  for(let i=0;i<8;i++){const a=i*Math.PI/4+.2,x=Math.cos(a)*32,z=Math.sin(a)*32;const bench=new THREE.Group();bench.position.set(x,.28,z);bench.rotation.y=-a+Math.PI/2;group.add(bench);part(bench,wood,0,.8,0,4.6,.22,1.1);part(bench,wood,0,1.26,-.43,4.6,.6,.13);for(const xx of [-1.6,1.6])part(bench,graphite,xx,.43,0,.16,.68,.85);part(bench,warm,0,.61,.5,4.3,.025,.035);}
  // An open lounge between the music arena and cinema establishes a walkable street edge.
  const lounge=new THREE.Group();lounge.position.set(4,.3,151);group.add(lounge);part(lounge,stone,0,.25,0,51,.5,29);
  for(const x of [-23,23])for(const z of [-12,12])part(lounge,brass,x,4.5,z,.18,8.5,.18);
  part(lounge,graphite,0,8.8,0,52,.45,30);part(lounge,warm,0,8.5,-15,51,.065,.065);
  for(let x=-24;x<25;x+=3)part(lounge,wood,x,8.48,0,.16,.3,29);
  for(const x of [-15,0,15])for(const z of [-5,6]){part(lounge,wood,x,1.25,z,3.4,.2,2.2);part(lounge,graphite,x,.65,z,.25,1.2,.25);for(const dx of [-2.3,2.3]){part(lounge,wood,x+dx,.75,z,1.2,.18,1.2);part(lounge,graphite,x+dx,.36,z,.12,.7,.12);}}
  for(const x of [-25,25])tree(lounge,x,0,1.2);
  const sign=architecture.textSign(lounge,'PRAÇA DE CONVIVÊNCIA',{width:32,height:2.2,y:7,z:-15.4,subtitle:'MÚSICA · ENCONTROS · DESCOBERTAS'});sign.rotation.y=Math.PI;
  const count=lite?12:24,crowd=createUrbanCrowd({parent:group,count});
  const cars=[];for(let i=0;i<(lite?3:6);i++){
    const car=createUrbanVehicle({architecture,color:['#a6acb7','#253c4f','#a88553','#374949','#74677d','#d2ccc0'][i],variant:i});
    car.userData.direction=i%2?1:-1;car.userData.avenue=false;
    car.rotation.y=i%2?Math.PI/2:-Math.PI/2;car.position.set(-290+i*97,.18,i%2?103.6:96.4);group.add(car);cars.push(car);
  }
  let elapsed=0,posed=false;
  function tick(dt,{paused=false}={}){
    if(paused&&posed)return;posed=true;
    if(!paused)elapsed+=dt;
    for(let i=0;i<count;i++){
      const direction=i%2?1:-1,angle=i*2.39996+elapsed*(.025+(i%4)*.004)*direction,r=22+(i%4)*4.5,along=(i*39+elapsed*(.75+(i%3)*.1))%600;
      const inAvenue=i<count*.7,x=inAvenue?(i%2?-147:-179)+Math.sin(i)*1.2:Math.cos(angle)*r,z=inAvenue?-125+(along<300?along:600-along):Math.sin(angle)*r,yaw=inAvenue?(along<300?0:Math.PI):-angle+(direction>0?Math.PI:0),walk=Math.sin(elapsed*5.8+i)*.32;
      const person=crowd.people[i];person.group.position.set(x,.28,z);person.group.rotation.y=yaw;person.pose(elapsed*5.8+i,true);
    }
    crowd.update();
    if(!paused)for(const [i,car] of cars.entries()){if(car.userData.avenue){car.position.z+=car.userData.direction*dt*6;if(car.position.z>173)car.position.z=-140;if(car.position.z<-140)car.position.z=173;}else{car.position.x+=car.userData.direction*dt*(7.8+i*.4);if(car.position.x>315)car.position.x=-315;if(car.position.x<-315)car.position.x=315;}}
  }
  tick(0,{paused:true});return {group,tick,dispose(){crowd.dispose();}};
}
