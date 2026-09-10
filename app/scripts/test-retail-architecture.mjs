import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';

// Canvas pixels and network images are irrelevant to these geometry tests. The
// production kit and billboard builders still construct their real Three meshes.
const originalDocument=globalThis.document,originalImage=globalThis.Image;
function canvas(){
  const noop=()=>{},gradient=()=>({addColorStop:noop});
  const context=new Proxy({createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),createLinearGradient:gradient,createRadialGradient:gradient,measureText:text=>({width:String(text).length*15})},{get:(target,key)=>target[key]??noop});
  return {width:0,height:0,getContext:()=>context};
}
class TestImage{addEventListener(){}removeEventListener(){}set src(value){this.url=value;}}
globalThis.document={createElement:name=>name==='canvas'?canvas():new TestImage(),createElementNS:()=>new TestImage()};
globalThis.Image=TestImage;
after(()=>{globalThis.document=originalDocument;globalThis.Image=originalImage;});
const publicRoot=new URL('../public/',import.meta.url),modules=new Map(),threeUrl=import.meta.resolve('three');
function moduleUrl(name){
  if(modules.has(name))return modules.get(name);
  const source=readFileSync(new URL(name,publicRoot),'utf8').replace(/from\s+(['"])([^'"]+)\1/g,(match,quote,path)=>{
    if(path==='/vendor/three/three.module.js')return 'from '+JSON.stringify(threeUrl);
    if(path.startsWith('./'))return 'from '+JSON.stringify(moduleUrl(path.slice(2)));
    return match;
  });
  const url='data:text/javascript;base64,'+Buffer.from(source).toString('base64');modules.set(name,url);return url;
}
const {createArchitectureKit}=await import(moduleUrl('vitriny-premium-architecture.js'));
const {mountSpatialBillboards}=await import(moduleUrl('vitriny-spatial-billboards.js'));
const {arrangeStoreBuildings}=await import(moduleUrl('vitriny-store-building-core.js'));
const {dressRetailGallery}=await import(moduleUrl('vitriny-retail-architecture.js'));

function fixture(label='Agrotécnica',lite=false){
  const scene=new THREE.Scene(),architecture=createArchitectureKit({renderer:{capabilities:{getMaxAnisotropy:()=>4}},scene,lite});
  const store=arrangeStoreBuildings([{reference:'retail-geometry-fixture',name:label,href:'/loja/retail-geometry-fixture',interiorHref:'/vitriny-store-interior.html?store=retail-geometry-fixture',productCount:0}])[0];
  const parent=new THREE.Group();parent.position.set(store.position.x,0,store.position.z);parent.rotation.y=-Math.PI/2;
  parent.userData={store:true,href:store.href,interiorHref:store.interiorHref,reference:store.reference};scene.add(parent);
  const building=architecture.boutique(parent,{label,width:store.size.width,depth:store.size.depth,height:store.size.height,catalog:true});
  scene.updateMatrixWorld(true);
  return {scene,architecture,parent,building,store};
}
function cleanup({scene,architecture,billboards}){
  billboards?.dispose();architecture.dispose();const geometries=new Set(),materials=new Set(),textures=new Set();
  scene.traverse(object=>{if(object.geometry)geometries.add(object.geometry);for(const material of Array.isArray(object.material)?object.material:[object.material])if(material){materials.add(material);for(const value of Object.values(material))if(value?.isTexture)textures.add(value);}});
  for(const value of [...geometries,...materials,...textures])value.dispose();
}
function isWithin(object,parent){for(let current=object;current;current=current.parent)if(current===parent)return true;return false;}
function castLocal(parent,x,y,z,distance=100){
  const origin=parent.localToWorld(new THREE.Vector3(x,y,z)),direction=new THREE.Vector3(0,0,-1).transformDirection(parent.matrixWorld);
  return new THREE.Raycaster(origin,direction,0,distance).intersectObject(parent,true).filter(hit=>!hit.object.material.transparent);
}

test('all retail styles produce finite bounded geometry at full and light quality',()=>{
  for(const lite of [false,true])for(const [label,style] of [['Agrotécnica','botanical'],['Sertaneja','country'],['Centro Educacional','learning'],['Beemi','creative'],['Loja local','gallery']]){
    const f=fixture(label,lite);
    try{
      assert.equal(f.building.userData.architectureStyle,style);
      let entranceGlazed=false,upperGalleryGlazed=false,instances=0;
      f.building.traverse(object=>{
        if(!object.isMesh)return;
        for(const attribute of Object.values(object.geometry.attributes))assert.ok([...attribute.array].every(Number.isFinite),label+' has invalid geometry');
        assert.ok([...object.matrixWorld.elements].every(Number.isFinite));
        if(object.isInstancedMesh){instances+=object.count;assert.ok([...object.instanceMatrix.array].every(Number.isFinite));}
        if(object.material.transparent&&object.material.opacity<=.35){
          assert.equal(object.material.depthWrite,false);
          if(object.scale.z<.1&&object.scale.x>10){if(object.position.y<9)entranceGlazed=true;else upperGalleryGlazed=true;}
        }
      });
      const bounds=new THREE.Box3().setFromObject(f.building).getSize(new THREE.Vector3());
      assert.ok(bounds.y>23&&bounds.y<48);assert.ok(bounds.x<40&&bounds.z<40);
      assert.ok(entranceGlazed&&upperGalleryGlazed,'The entrance and upper gallery fronts retain transparent glazing');
      assert.ok(instances>40,'Repeated structural pieces are batched');
    }finally{cleanup(f);}
  }
});

test('gallery interiors retain measurable depth behind transparent facade panels',()=>{
  for(const lite of [false,true]){
    const f=fixture('Agrotécnica',lite);
    try{
      // Beside the portrait screen, above the furniture and away from mullions.
      const hits=castLocal(f.parent,8.7,12.05,f.store.size.depth/2+5);
      assert.ok(hits.length>0,'The room has a rear wall');
      assert.ok(hits[0].distance>10,'The upper gallery must not have an opaque block directly behind its glazing');
    }finally{cleanup(f);}
  }
});

test('architectural dressing preserves the real shop routes, entrance and catalog target',()=>{
  const f=fixture();
  try{
    const identity={...f.parent.userData};
    f.billboards=mountSpatialBillboards({scene:f.scene,architecture:f.architecture,active:false});
    const board=f.billboards.registerStore(f.parent,f.store,{roof:f.store.size.height});
    f.architecture.batch(f.parent);f.scene.updateMatrixWorld(true);f.billboards.tick(0,{paused:true});
    assert.deepEqual(f.parent.userData,identity);assert.equal(board.group.parent,f.parent);assert.equal(board.group.userData.billboard,true);
    assert.equal(board.group.userData.item.href,f.store.href);
    const closeHits=castLocal(f.parent,0,2.5,f.store.size.depth/2+3,3.3);
    assert.equal(closeHits.length,0,'The ground-floor center must remain clear of opaque upper-story decoration');
    const hits=castLocal(f.parent,0,16.4,f.store.size.depth/2+10);
    assert.ok(hits.length>0&&isWithin(hits[0].object,board.group),'The central catalog remains selectable through the glazing');
  }finally{cleanup(f);}
});

test('the full catalog photograph stays in front of slabs and its surrounding stone frame',()=>{
  const f=fixture();
  try{
    f.billboards=mountSpatialBillboards({scene:f.scene,architecture:f.architecture,active:false});
    const entry=f.billboards.registerStore(f.parent,f.store,{roof:f.store.size.height});f.scene.updateMatrixWorld(true);
    const screen=entry.group.children.find(object=>object.isMesh&&object.geometry.type==='PlaneGeometry'&&object.position.z>0);
    assert.ok(screen);const {width,height}=screen.geometry.parameters;
    assert.ok(Math.abs(width/height-entry.canvas.width/entry.canvas.height)<.002,'Catalog image canvas must match the physical display aspect ratio');
    const misses=[];
    for(const horizontal of [-.98,-.5,0,.5,.98])for(let row=0;row<=48;row++){
      const x=horizontal*width/2,y=(-.98+row/48*1.96)*height/2;
      const world=entry.group.localToWorld(new THREE.Vector3(x,y,15)),direction=new THREE.Vector3(0,0,-1).transformDirection(entry.group.matrixWorld);
      const hits=new THREE.Raycaster(world,direction).intersectObject(f.parent,true).filter(hit=>!(hit.object.material.transparent&&hit.object.material.opacity<.3));
      if(hits[0]?.object!==screen)misses.push({x:Number(x.toFixed(2)),y:Number((entry.group.position.y+y).toFixed(2)),occluder:hits[0]?.object.name||hits[0]?.object.geometry.type||'none'});
    }
    assert.equal(misses.length,0,'Stone or lighting obscures the real product photograph: '+JSON.stringify(misses.slice(0,12)));
  }finally{cleanup(f);}
});

test('terrace foliage remains outside the next gallery and clear of structural slabs',()=>{
  for(const lite of [false,true])for(const label of ['Agrotécnica','Sertaneja','Centro Educacional','Beemi','Loja local']){
    const f=fixture(label,lite),gallery=new THREE.Group(),trees=[];f.scene.add(gallery);
    try{
      const architecture={...f.architecture,tree:(parent,x,z,scale,y)=>{
        const group=f.architecture.tree(parent,x,z,scale,y);trees.push({group,x,y,z});return group;
      }};
      dressRetailGallery({group:gallery,architecture,width:24,depth:18,height:9,label,lite});f.scene.updateMatrixWorld(true);
      assert.ok(trees.length>0);
      const frontPanes=[];
      gallery.traverse(object=>{if(!object.isMesh||!object.material.transparent)return;const bounds=new THREE.Box3().setFromObject(object),size=bounds.getSize(new THREE.Vector3());if(size.z<.2&&size.x>10)frontPanes.push(bounds);});
      for(const tree of trees){
        const treeBounds=new THREE.Box3().setFromObject(tree.group);
        for(const pane of frontPanes){
          const meetsHeight=treeBounds.min.y<pane.max.y&&treeBounds.max.y>pane.min.y,meetsWidth=treeBounds.min.x<pane.max.x&&treeBounds.max.x>pane.min.x;
          if(meetsHeight&&meetsWidth)assert.ok(treeBounds.min.z>pane.max.z,label+' has foliage inside the next gallery at '+JSON.stringify({x:tree.x,y:tree.y,z:tree.z,foliageMinZ:treeBounds.min.z,glazingMaxZ:pane.max.z}));
        }
        const origin=gallery.localToWorld(new THREE.Vector3(tree.x,tree.y+.03,tree.z));
        const hits=new THREE.Raycaster(origin,new THREE.Vector3(0,1,0),0,treeBounds.max.y-origin.y).intersectObject(gallery,true).filter(hit=>!hit.object.material.transparent&&!trees.some(candidate=>isWithin(hit.object,candidate.group)));
        assert.equal(hits.length,0,label+' has a tree intersecting a structural slab at '+JSON.stringify({x:tree.x,y:tree.y,z:tree.z}));
      }
    }finally{cleanup(f);}
  }
});
