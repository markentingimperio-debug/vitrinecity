import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {arrangeStoreBuildings} from '../public/vitriny-store-building-core.js';
import {createDoorEntryTracker} from '../public/vitriny-door-entry.js';

const variants=['botanical','country','gallery'];
const assets=new Map();
const limits={bytes:3*1024*1024,triangles:60000,meshes:40};

function inspectContainer(bytes){
  assert.equal(bytes.readUInt32LE(0),0x46546c67,'Asset must be binary glTF');
  assert.equal(bytes.readUInt32LE(4),2,'Asset must use glTF 2');
  assert.equal(bytes.readUInt32LE(8),bytes.length,'GLB length must match its header');
  assert.ok(bytes.length<=limits.bytes,'A single shop must remain within its download budget');
  let offset=12,json=null,binaryBytes=0;
  while(offset<bytes.length){
    const size=bytes.readUInt32LE(offset),kind=bytes.readUInt32LE(offset+4);
    assert.equal(size%4,0,'GLB chunks must be aligned');
    assert.ok(offset+8+size<=bytes.length,'GLB chunk cannot exceed the file');
    if(kind===0x4e4f534a)json=JSON.parse(bytes.subarray(offset+8,offset+8+size).toString('utf8').trim());
    if(kind===0x004e4942)binaryBytes+=size;
    offset+=8+size;
  }
  assert.ok(json&&binaryBytes>0,'GLB must embed both scene and mesh data');
  assert.equal(json.asset?.version,'2.0');
  assert.ok(json.scenes?.length>0&&json.meshes?.length>0);
  for(const buffer of json.buffers||[]){
    assert.equal(buffer.uri,undefined,'Model buffers must be embedded; no external network dependency');
    assert.ok(buffer.byteLength<=binaryBytes);
  }
  for(const view of json.bufferViews||[]){
    const buffer=json.buffers[view.buffer];
    assert.ok(buffer&&(view.byteOffset||0)+view.byteLength<=buffer.byteLength,'Buffer view must stay inside its buffer');
  }
  for(const image of json.images||[]){
    assert.equal(image.uri,undefined,'Texture images must be embedded');
    assert.ok(Number.isInteger(image.bufferView)&&json.bufferViews[image.bufferView]);
  }
  return json;
}

async function loadAsset(style){
  if(!assets.has(style))assets.set(style,(async()=>{
    const bytes=readFileSync(new URL(`../public/assets/architecture/vc-retail-${style}-v1.glb`,import.meta.url));
    const json=inspectContainer(bytes),loader=new GLTFLoader();
    // These tests inspect the real exported meshes. Node has no image decoder;
    // embedded texture byte ranges are checked above and pixels are browser QA.
    loader.register(()=>({name:'QA_EMBEDDED_TEXTURE',loadTexture:async()=>new THREE.Texture()}));
    const gltf=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
    gltf.scene.updateMatrixWorld(true);
    return {scene:gltf.scene,json,bytes:bytes.length};
  })());
  return assets.get(style);
}

function opaqueHits(scene,origin,direction,far){
  return new THREE.Raycaster(origin,direction,0,far).intersectObject(scene,true).filter(hit=>{
    const materials=Array.isArray(hit.object.material)?hit.object.material:[hit.object.material];
    const material=materials[hit.face?.materialIndex||0];
    return material&&material.visible!==false&&!(material.transparent&&material.opacity<.4);
  });
}

function verifyFrontRegion(scene,{name,x=0,y,z,width,height}){
  const blocked=[];
  for(const u of [-.98,-.75,-.5,-.25,0,.25,.5,.75,.98])for(const v of [-.98,-.75,-.5,-.25,0,.25,.5,.75,.98]){
    const xx=x+u*width/2,yy=y+v*height/2;
    const hits=opaqueHits(scene,new THREE.Vector3(xx,yy,35),new THREE.Vector3(0,0,-1),35-z-.015);
    if(hits.length)blocked.push({x:+xx.toFixed(2),y:+yy.toFixed(2),object:hits[0].object.name,z:+hits[0].point.z.toFixed(2)});
  }
  assert.equal(blocked.length,0,`${name} is obscured by model geometry: ${JSON.stringify(blocked.slice(0,8))}`);
}

function stoneShells(geometry){
  const positions=geometry.getAttribute('position'),normal=geometry.getAttribute('normal'),points=[],welded=new Map(),remap=[],parents=[],triangles=[];
  const find=i=>parents[i]===i?i:(parents[i]=find(parents[i]));
  // glTF duplicates vertices at hard shading seams. Weld those positions before
  // checking each independent closed stone volume, so one correct slab cannot
  // hide an inverted column elsewhere in the same merged material mesh.
  for(let i=0;i<positions.count;i++){
    const point=new THREE.Vector3().fromBufferAttribute(positions,i),key=point.toArray().map(v=>Math.round(v*100000)).join(',');
    if(!welded.has(key)){welded.set(key,points.length);parents.push(points.length);points.push(point);}
    remap.push(welded.get(key));
  }
  for(let i=0,count=geometry.index?.count??positions.count;i<count;i+=3){
    const raw=[0,1,2].map(j=>geometry.index?geometry.index.getX(i+j):i+j),ids=raw.map(j=>remap[j]);
    const [a,b,c]=ids.map(j=>points[j]);
    const face=new THREE.Vector3().subVectors(b,a).cross(new THREE.Vector3().subVectors(c,a));
    if(face.lengthSq()<1e-14)continue;
    assert.ok(normal,'Stone geometry must export surface normals');
    const shading=raw.reduce((sum,j)=>sum.add(new THREE.Vector3().fromBufferAttribute(normal,j)),new THREE.Vector3());
    assert.ok(face.dot(shading)>=-1e-6,'Exported stone normals oppose their triangle winding');
    parents[find(ids[1])]=find(ids[0]);parents[find(ids[2])]=find(ids[0]);triangles.push(ids);
  }
  const shells=new Map();
  for(const ids of triangles){
    const root=find(ids[0]);
    if(!shells.has(root))shells.set(root,{edges:new Map(),volume:0});
    const shell=shells.get(root),[a,b,c]=ids.map(j=>points[j]);
    shell.volume+=a.dot(new THREE.Vector3().crossVectors(b,c))/6;
    for(const [u,v] of [[ids[0],ids[1]],[ids[1],ids[2]],[ids[2],ids[0]]]){
      const key=u<v?u+':'+v:v+':'+u;shell.edges.set(key,(shell.edges.get(key)||0)+1);
    }
  }
  return [...shells.values()].map(shell=>({closed:[...shell.edges.values()].every(count=>count===2),volume:shell.volume}));
}

for(const style of variants){
  test(`${style}: exported GLB has valid bounded geometry and a browser asset budget`,async t=>{
    const {scene,json,bytes}=await loadAsset(style),bounds=new THREE.Box3().setFromObject(scene),size=bounds.getSize(new THREE.Vector3());
    let meshes=0,triangles=0;
    scene.traverse(object=>{
      assert.ok(object.matrixWorld.elements.every(Number.isFinite),'World transform must remain finite');
      if(!object.isMesh)return;
      meshes++;
      for(const attribute of Object.values(object.geometry.attributes))for(const value of attribute.array)assert.ok(Number.isFinite(value),'Vertex data must remain finite');
      triangles+=(object.geometry.index?.count??object.geometry.attributes.position.count)/3*(object.isInstancedMesh?object.count:1);
    });
    assert.ok(size.x>=23&&size.x<=28.05,`Width ${size.x} violates the reserved shop lot`);
    assert.ok(size.z>=17&&size.z<=22.05,`Depth ${size.z} violates the reserved shop lot`);
    assert.ok(size.y>=25&&bounds.max.y<=30.05,`Height ${bounds.max.y} violates the retail model contract`);
    assert.ok(bounds.min.y>=-.15&&bounds.min.y<=.2,'Building origin must sit at ground level');
    assert.ok(Math.abs((bounds.min.x+bounds.max.x)/2)<1,'Building must be centered on its lot');
    assert.ok(meshes<=limits.meshes,`Too many model meshes: ${meshes}`);
    assert.ok(triangles<=limits.triangles,`Too many model triangles: ${triangles}`);
    assert.ok((json.materials?.length||0)<=32,'Material count must remain bounded');
    t.diagnostic(JSON.stringify({style,bytes,meshes,triangles,size:size.toArray().map(n=>+n.toFixed(3))}));
  });

  test(`${style}: closed stone components face outward after export`,async t=>{
    const {scene}=await loadAsset(style),shells=[];
    scene.traverse(object=>{
      if(!object.isMesh||!/^VC_Stone(?:_Light)?(?:\.\d+)?$/.test(object.material?.name||''))return;
      assert.equal(object.material.side,THREE.FrontSide,'Opaque stone must use outward faces rather than conceal inverted surfaces');
      shells.push(...stoneShells(object.geometry));
    });
    const closed=shells.filter(shell=>shell.closed);
    assert.ok(closed.length>0,'Export must contain closed architectural stone volumes');
    for(const shell of closed)assert.ok(shell.volume>1e-6,`Inverted stone shell has signed volume ${shell.volume}`);
    t.diagnostic(JSON.stringify({stoneComponents:shells.length,closedOutwardComponents:closed.length}));
  });

  test(`${style}: real product screens and shop sign stay visible`,async()=>{
    const {scene}=await loadAsset(style);
    verifyFrontRegion(scene,{name:'Horizontal product screen',y:21.3,z:9.85,width:20.8,height:6.8});
    verifyFrontRegion(scene,{name:'Dynamic shop sign',y:17.05,z:9.62,width:20.4,height:1.35});
    for(const side of [-1,1])verifyFrontRegion(scene,{name:'Ground-floor product display',x:side*6.96,y:3.75,z:9.12,width:5.2,height:5.2});
  });

  test(`${style}: front entrance stays clear above its low architectural plinth`,async()=>{
    const {scene}=await loadAsset(style);
    verifyFrontRegion(scene,{name:'Front entrance passage',y:2.45,z:8.7,width:4.4,height:3.9});
    for(const x of [-1.8,0,1.8])for(const z of [8.75,9.4,10]){
      const hits=opaqueHits(scene,new THREE.Vector3(x,.6,z),new THREE.Vector3(0,-1,0),.6);
      assert.ok(!hits.length||hits[0].point.y<=.5,'Plinth must stay below the reserved doorway clearance');
    }
  });
}

test('modeled store lots preserve walking entry, return route and preview navigation',()=>{
  const stores=arrangeStoreBuildings([
    {reference:'official_agrotecnica',name:'Agrotecnica',href:'/loja/official_agrotecnica/agrotecnica',interiorHref:'/vitriny-store-interior.html?store=official_agrotecnica'},
    {reference:'official_sertaneja_moda_country',name:'Sertaneja Moda Country',href:'/loja/official_sertaneja_moda_country/sertaneja-moda-country'}
  ]);
  for(const store of stores){
    const parent=new THREE.Group();parent.position.set(store.position.x,0,store.position.z);parent.rotation.y=-Math.PI/2;parent.updateMatrixWorld(true);
    const door={anchor:parent.localToWorld(new THREE.Vector3(0,2.5,9.4)),normal:new THREE.Vector3(0,0,1).transformDirection(parent.matrixWorld),href:store.href,reference:store.reference};
    const tracker=createDoorEntryTracker(),at=distance=>door.anchor.clone().addScaledVector(door.normal,distance).setY(1.7);
    assert.equal(tracker.step({position:at(2.8),moving:false,enabled:true,doors:[door]}),null,'Camera arrival must not enter the shop');
    assert.equal(tracker.step({position:at(1.8),moving:true,enabled:true,doors:[door]}),door,'A walking step through the west-facing door must keep its real destination');
    tracker.reset();
    assert.equal(tracker.step({position:at(1.8),moving:false,enabled:true,doors:[door]}),null,'Returning from the shop must not immediately enter again');
    assert.equal(store.size.width,24);assert.equal(store.size.depth,18);
  }
});
