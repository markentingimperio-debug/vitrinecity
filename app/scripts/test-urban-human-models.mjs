import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';

const source=readFileSync(new URL('../public/vitriny-urban-models.js',import.meta.url),'utf8');
const threeURL=import.meta.resolve('three');
const {createUrbanPerson,createUrbanCrowd}=await import('data:text/javascript;base64,'+Buffer.from(source.replaceAll("'/vendor/three/three.module.js'",JSON.stringify(threeURL))).toString('base64'));
const parts=person=>{const meshes=[];person.group.traverse(o=>{if(o.isMesh)meshes.push(o);});return meshes;};
const cost=person=>({parts:parts(person).length,triangles:parts(person).reduce((n,p)=>n+(p.geometry.index?.count??p.geometry.attributes.position.count)/3,0)});
const disposePerson=person=>new Set(Object.values(person.materials)).forEach(m=>m.dispose());

if(!process.argv.includes('--preview')){
  test('adult silhouette has seven head lengths, a continuous garment and restrained facial details',()=>{
    for(const detailed of [false,true]){
      const person=createUrbanPerson({detailed});person.group.updateMatrixWorld(true);
      const size=new THREE.Box3().setFromObject(person.group).getSize(new THREE.Vector3()),head=person.group.getObjectByName('face');
      head.geometry.computeBoundingBox();const headHeight=head.geometry.boundingBox.getSize(new THREE.Vector3()).y*head.scale.y;
      assert.ok(size.y>1.75&&size.y<1.85);assert.ok(size.x>.45&&size.x<.66);assert.ok(size.y/headHeight>=7&&size.y/headHeight<=7.6);
      assert.equal(parts(person).filter(p=>p.name==='tailored-shirt').length,1);
      for(const eye of parts(person).filter(p=>p.name==='eye'))assert.ok(eye.scale.x<.009&&eye.scale.z<.005);
      assert.equal(parts(person).filter(p=>p.name==='hand').length,2);assert.equal(parts(person).filter(p=>p.name==='shoe').length,2);
      assert.ok(parts(person).filter(p=>p.name==='hand').every(p=>p.scale.z<p.scale.x));disposePerson(person);
    }
  });

  test('shared continuous surfaces have finite outward normals and an integrated nose',()=>{
    for(const detailed of [false,true]){
      const person=createUrbanPerson({detailed}),geometries=new Set(parts(person).map(p=>p.geometry));assert.equal(geometries.size,4);
      for(const geometry of geometries){
        for(const a of Object.values(geometry.attributes))assert.ok([...a.array].every(Number.isFinite));
        const p=geometry.attributes.position,n=geometry.attributes.normal;let outward=0;
        for(let i=0;i<p.count;i++)outward+=p.getX(i)*n.getX(i)+p.getZ(i)*n.getZ(i);
        assert.ok(outward>0,'Surfaces face outward, not an invisible inside-out shell');
      }
      const face=person.group.getObjectByName('face').geometry.attributes.position;
      assert.ok(Math.max(...Array.from({length:face.count},(_,i)=>face.getZ(i)))>1,'Nose is part of the facial surface');disposePerson(person);
    }
  });

  test('LITE reduces both parts and triangles, disables pedestrian shadows and keeps four draw batches',()=>{
    const normal=createUrbanPerson(),lite=createUrbanPerson({detailed:false}),a=cost(normal),b=cost(lite);
    assert.ok(a.triangles<=6000);assert.ok(b.triangles<=2400);assert.ok(b.triangles/a.triangles<.45);assert.ok(b.parts<a.parts);
    for(const profileId of ['STANDARD','LITE']){
      const parent=new THREE.Group(),crowd=createUrbanCrowd({parent,count:40,profileId});assert.equal(crowd.people.length,40);assert.equal(parent.children.length,4);
      assert.ok(parent.children.every(p=>p.isInstancedMesh&&p.castShadow===(profileId!=='LITE')));
      assert.equal(parent.children.reduce((n,batch)=>n+batch.count,0),40*(profileId==='LITE'?b.parts:a.parts));crowd.dispose();
    }
    disposePerson(normal);disposePerson(lite);
  });

  test('a crowd shares geometry and palette, but visitor customization and other crowds remain independent',()=>{
    const parent=new THREE.Group(),a=createUrbanCrowd({parent,count:24}),b=createUrbanCrowd({parent,count:1});
    const all=a.people.flatMap(parts);assert.equal(new Set(all.map(p=>p.geometry)).size,4);
    assert.ok(new Set(all.map(p=>p.material)).size<=24);assert.equal(a.people[0].materials.skin,a.people[4].materials.skin);
    assert.equal(a.people[0].materials.shirt,a.people[6].materials.shirt);assert.notEqual(a.people[0].materials.skin,b.people[0].materials.skin);
    let otherDisposed=0;b.people[0].materials.skin.addEventListener('dispose',()=>otherDisposed++);
    a.dispose();a.dispose();assert.equal(otherDisposed,0);b.update();assert.equal(parent.children.length,4);b.dispose();assert.equal(otherDisposed,1);
    const first=createUrbanPerson(),second=createUrbanPerson();first.materials.skin.color.set('#ffffff');assert.notEqual(first.materials.skin.color.getHex(),second.materials.skin.color.getHex());disposePerson(first);disposePerson(second);
  });

  test('subtle articulated motion is deterministic, resets poses and preserves caller route, heading and identity',()=>{
    const person=createUrbanPerson();person.group.position.set(9,.35,-8);person.group.rotation.y=.73;person.group.userData={residentId:'fictional-fixture',simulated:true};
    const snapshot=()=>parts(person).map(p=>p.matrixWorld.toArray());
    for(const activity of ['','walk','talk','work'])for(const moving of [false,true])for(const phase of [0,.1,Math.PI/2,Math.PI,900]){
      person.pose(phase,moving,activity);person.group.updateMatrixWorld(true);const a=snapshot();person.pose(phase,moving,activity);person.group.updateMatrixWorld(true);assert.deepEqual(snapshot(),a);
      assert.deepEqual(person.group.position.toArray(),[9,.35,-8]);assert.equal(person.group.rotation.y,.73);assert.equal(person.group.userData.residentId,'fictional-fixture');
      const posture=person.group.getObjectByName('human-posture');assert.ok(posture.position.y<=.008);assert.ok(Math.abs(posture.rotation.z)<=.009);
      assert.ok(a.flat().every(Number.isFinite));
    }
    person.pose(Math.PI/2,true);assert.ok(person.knees.some(p=>p.rotation.x>.3));person.pose(0,false);
    assert.ok(person.knees.every(p=>p.rotation.x===0));assert.equal(person.group.getObjectByName('human-posture').position.y,0);disposePerson(person);
  });

  test('instancing preserves local/world transforms under a rotated interior and disposes only owned resources',()=>{
    const scene=new THREE.Scene(),parent=new THREE.Group();scene.add(parent);parent.position.set(10,2,-3);parent.rotation.y=.8;
    const crowd=createUrbanCrowd({parent,count:1,identities:[{appearance:{skinColor:'#87593d',outfitColor:'#507888'}}]});
    const person=crowd.people[0];person.group.position.set(1,.4,2);person.group.rotation.y=-.4;person.pose(1,true);crowd.update();scene.updateMatrixWorld(true);
    const byGeometry=new Map();for(const mesh of parts(person)){if(!byGeometry.has(mesh.geometry))byGeometry.set(mesh.geometry,[]);byGeometry.get(mesh.geometry).push(mesh);}
    for(const batch of parent.children)for(const [i,mesh] of byGeometry.get(batch.geometry).entries()){
      const actual=new THREE.Matrix4();batch.getMatrixAt(i,actual);actual.premultiply(batch.matrixWorld);const expected=mesh.matrixWorld.clone().premultiply(parent.matrixWorld);
      for(let j=0;j<16;j++)assert.ok(Math.abs(actual.elements[j]-expected.elements[j])<1e-5);
    }
    let geometriesDisposed=0;for(const geometry of byGeometry.keys())geometry.addEventListener('dispose',()=>geometriesDisposed++);
    crowd.dispose();crowd.update();assert.equal(parent.children.length,0);assert.equal(geometriesDisposed,0,'Shared immutable geometry survives another resident mount');
  });

  test('avatar construction performs no loading, random identity, task execution or texture allocation',()=>{
    assert.doesNotMatch(source,/\bfetch\s*\(|Math\.random\s*\(|TextureLoader|GLTFLoader|SkinnedMesh|\/api\/|https?:\/\//);
  });
}else{
  // Optional read-only visual harness; not a production route or a browser CI dependency.
  // node app/scripts/test-urban-human-models.mjs --preview
  const {default:http}=await import('node:http'),{execFileSync}=await import('node:child_process');
  const baseline=execFileSync('git',['show','289eed2138d3e191749e75d35b9b50e548ed3be4:app/public/vitriny-urban-models.js'],{cwd:new URL('../../',import.meta.url),encoding:'utf8'});
  const html=`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Avatares · comparação local</title>
  <style>body{margin:0;background:#e5e4dd;color:#26312f;font:16px system-ui}header{padding:18px 24px}h1{margin:0;font-size:20px}p{margin:6px 0}main{display:grid;grid-template-columns:1fr 1fr;gap:2px}section{min-width:0;background:#d8ddd7}h2{font-size:15px;margin:12px 20px}canvas{width:100%;height:560px;display:block}output{display:block;margin:12px 20px;font:12px monospace;overflow-wrap:anywhere}@media(max-width:700px){main{grid-template-columns:1fr}canvas{height:420px}}</style>
  <header><h1>Avatares da cidade · antes / depois</h1><p>Figurantes virtuais · comparação de modelo, não pessoas ou atividade reais. <a href="?lite=1">Modo LITE</a> · <a href="?close=1">Rosto</a> · <a href="?walk=1">Caminhada</a></p></header><main><section><h2>Antes · mesma luz e câmera</h2><canvas id="before"></canvas><output id="before-cost"></output></section><section><h2>Depois · mesma luz e câmera</h2><canvas id="after"></canvas><output id="after-cost"></output></section></main>
  <script type="module">
  import * as THREE from '/vendor/three/three.module.js';import * as before from '/before.js';import * as after from '/after.js';
  const query=new URLSearchParams(location.search),lite=query.has('lite'),close=query.has('close'),walk=query.has('walk');window.avatarPreview={};
  for(const [id,module] of [['before',before],['after',after]]){
    const canvas=document.getElementById(id),renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'low-power'});renderer.setPixelRatio(1);renderer.setSize(canvas.clientWidth,canvas.clientHeight,false);renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
    const scene=new THREE.Scene();scene.background=new THREE.Color('#d8ddd7');scene.add(new THREE.HemisphereLight('#eaf3f5','#777363',2.1));const light=new THREE.DirectionalLight('#fff4df',3);light.position.set(-3,5,5);scene.add(light);const rim=new THREE.DirectionalLight('#d8e9f3',1.5);rim.position.set(3,3,-2);scene.add(rim);
    const parent=new THREE.Group();scene.add(parent);const crowd=module.createUrbanCrowd({parent,count:close?1:3,profileId:lite?'LITE':'STANDARD'});
    const floor=new THREE.Mesh(new THREE.PlaneGeometry(20,20),new THREE.MeshStandardMaterial({color:'#c1c7bc',roughness:1}));floor.rotation.x=-Math.PI/2;floor.position.y=-.015;scene.add(floor);
    crowd.people.forEach((p,i)=>{p.group.position.x=close?0:(i-1)*.78;p.group.rotation.y=close?-.14:[.35,0,-.5][i];p.pose(walk?1.2+i*.4:0,walk);});crowd.update();
    const camera=new THREE.PerspectiveCamera(close?24:33,canvas.clientWidth/canvas.clientHeight,.05,30);camera.position.set(0,close?1.66:1.12,close?1.25:4.25);camera.lookAt(0,close?1.65:.94,0);renderer.render(scene,camera);
    const triangles=parent.children.reduce((n,b)=>n+b.count*(b.geometry.index?.count??b.geometry.attributes.position.count)/3,0);window.avatarPreview[id]={triangles,drawCalls:parent.children.length,parts:parent.children.reduce((n,b)=>n+b.count,0),profile:lite?'LITE':'STANDARD'};document.getElementById(id+'-cost').textContent=JSON.stringify(window.avatarPreview[id]);
  }
  window.avatarPreview.ready=true;
  </script></html>`;
  const routes=new Map([['/',html],['/before.js',baseline],['/after.js',source],['/vendor/three/three.module.js',readFileSync(new URL(threeURL))],['/vendor/three/three.core.js',readFileSync(new URL('./three.core.js',threeURL))]]);
  const server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://127.0.0.1').pathname;if(req.method!=='GET'||!routes.has(pathname)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',pathname==='/'?'text/html; charset=utf-8':'text/javascript');res.setHeader('Cache-Control','no-store');res.end(routes.get(pathname));});
  server.listen(0,'127.0.0.1',()=>console.log('Avatar QA fixture: http://127.0.0.1:'+server.address().port));
}
