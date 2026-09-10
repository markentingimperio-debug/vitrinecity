import * as THREE from '/vendor/three/three.module.js';
import {storeBuildingIdentity} from './vitriny-store-building-core.js';

export const MODELED_RETAIL_ASSETS=Object.freeze({
  botanical:'/assets/architecture/vc-retail-botanical-v1.glb',
  country:'/assets/architecture/vc-retail-country-v1.glb',
  gallery:'/assets/architecture/vc-retail-gallery-v1.glb'
});
export const MODELED_RETAIL_LAYOUT=Object.freeze({width:20.8,height:6.8,y:21.3,z:9.55,portrait:false});
export const AGROTECNICA_STORE_SIGN=Object.freeze({label:'ADUBO PARA PLANTAS',action:'VER PRODUTOS →',width:21.4,height:2.2,y:26.4,z:9.64});
const accentColors={botanical:'#256348',country:'#a55738',learning:'#245d78',creative:'#714852',gallery:'#426b89'};

async function loadRetailModel(url){
  const {GLTFLoader}=await import('/vendor/three/addons/loaders/GLTFLoader.js');
  return new GLTFLoader().loadAsync(url);
}

// These files contain architecture only. Store references, catalog products and
// navigation remain owned by the live registry and its existing parent group.
export function validateModeledRetail(scene){
  if(!scene?.isObject3D)throw new Error('The architectural asset has no scene.');
  let meshes=0,triangles=0,drawCalls=0;
  scene.updateMatrixWorld(true);
  scene.traverse(object=>{
    if(!object.isMesh)return;
    if(object.isSkinnedMesh)throw new Error('Retail architecture must be a static model.');
    const positions=object.geometry?.getAttribute('position');
    if(!positions?.count||!object.matrixWorld.elements.every(Number.isFinite))throw new Error('Invalid architectural geometry.');
    for(const position of positions.array)if(!Number.isFinite(position))throw new Error('Invalid architectural geometry.');
    meshes++;
    const instances=object.isInstancedMesh?object.count:1;
    triangles+=(object.geometry.index?.count||positions.count)/3*instances;
    drawCalls+=Array.isArray(object.material)?Math.max(1,object.geometry.groups.length):1;
  });
  const bounds=new THREE.Box3().setFromObject(scene),size=bounds.getSize(new THREE.Vector3());
  if(!meshes||drawCalls>20||triangles>60000||size.x<12||size.x>28.1||size.z<8||size.z>22.1||size.y<12||bounds.max.y>30.1||bounds.min.y<-.15||Math.abs(bounds.getCenter(new THREE.Vector3()).x)>1||Math.abs(bounds.getCenter(new THREE.Vector3()).z)>2)throw new Error('The architectural asset is outside its retail lot contract.');
  return {meshes,triangles:Math.round(triangles),drawCalls,height:size.y};
}

function collectResources(group,resources){
  group.traverse(object=>{
    if(object.geometry)resources.add(object.geometry);
    for(const material of Array.isArray(object.material)?object.material:[object.material]){
      if(!material)continue;
      resources.add(material);
      for(const value of Object.values(material))if(value?.isTexture)resources.add(value);
    }
  });
}
function releaseResources(resources){
  const images=new Set();
  for(const item of resources){if(item.isTexture&&item.image?.close)images.add(item.image);item.dispose?.();}
  for(const image of images)image.close();
  resources.clear();
}

function createStoreName(parent,entity,{width,height,y,z}){
  const canvas=document.createElement('canvas');canvas.width=2048;canvas.height=Math.round(canvas.width*height/width);
  const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle='#fff3d3';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`500 ${Math.round(canvas.height*.72)}px system-ui`;
  ctx.fillText(String(entity.name),canvas.width/2,canvas.height/2,canvas.width*.94);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
  const sign=new THREE.Mesh(new THREE.PlaneGeometry(width,height),new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,toneMapped:false}));
  sign.position.set(0,y,z);parent.add(sign);
}

export function createAgrotecnicaStoreSign(parent,entity,{document=globalThis.document}={}){
  const href=typeof entity?.href==='string'?entity.href:'';
  if(entity?.reference!=='official_agrotecnica'||!href.startsWith('/')||href.startsWith('//')||/[\u0000-\u0020\u007f\\]/.test(href))return null;
  const {label,action,width,height,y,z}=AGROTECNICA_STORE_SIGN,canvas=document.createElement('canvas');
  canvas.width=2048;canvas.height=Math.round(canvas.width*height/width);
  const ctx=canvas.getContext('2d');ctx.fillStyle='#bd9a55';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle='#123b2b';ctx.fillRect(6,6,canvas.width-12,canvas.height-12);
  ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#fff5d7';ctx.font=`750 ${Math.round(canvas.height*.62)}px system-ui`;
  ctx.fillText(label,canvas.width/2,canvas.height*.39,canvas.width*.94);
  ctx.fillStyle='#d7e9c7';ctx.font=`600 ${Math.round(canvas.height*.19)}px system-ui`;
  ctx.fillText(action,canvas.width/2,canvas.height*.84,canvas.width*.8);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
  const group=new THREE.Group();group.name='store-sign:official_agrotecnica:adubo-para-plantas';group.position.set(0,y,z);
  group.userData={store:true,storeSign:true,reference:entity.reference,href,label,storeName:entity.name,action:'open-store'};
  const face=new THREE.Mesh(new THREE.PlaneGeometry(width,height),new THREE.MeshBasicMaterial({map:texture,toneMapped:false}));
  face.name='store-sign-face:official_agrotecnica:adubo-para-plantas';face.userData={...group.userData};group.add(face);parent.add(group);return group;
}

export function mountModeledBuildings({loadModel=loadRetailModel,shadows=false,createSign=createStoreName,disposeFallback=()=>{}}={}){
  const assets=new Map(),variants=new Map(),resources=new Set(),instances=new Set();
  let disposed=false;
  function asset(url){
    if(!assets.has(url))assets.set(url,Promise.resolve().then(()=>loadModel(url)).then(result=>{
      const model=result?.scene||result;
      const owned=new Set();
      if(model?.traverse)collectResources(model,owned);
      if(disposed){releaseResources(owned);return null;}
      try{
        const metrics=validateModeledRetail(model);
        for(const resource of owned)resources.add(resource);
        return {model,metrics};
      }catch(error){releaseResources(owned);throw error;}
    }));
    return assets.get(url);
  }
  function accentMaterial(material,color){
    if(!/^VC_Accent(?:\.\d+)?$/.test(material.name))return material;
    const key=material.uuid+':'+color;
    if(!variants.has(key)){
      const variant=material.clone();variant.color.set(color);
      variants.set(key,variant);resources.add(variant);
    }
    return variants.get(key);
  }
  return {
    async mountStore(parent,entity,fallback,{onReady=()=>{}}={}){
      if(disposed)return {status:'disposed'};
      const style=storeBuildingIdentity(entity.name).style,kind=style==='botanical'||style==='country'?style:'gallery',url=MODELED_RETAIL_ASSETS[kind];
      const wasAttached=Boolean(parent.parent);
      parent.userData.architecture={source:'procedural-fallback',status:'loading',style,asset:url};
      let modelGroup=null;
      try{
        const loaded=await asset(url);
        if(disposed||!loaded)return {status:'disposed'};
        // A removed store must never be mounted again when a late load completes.
        if(fallback.parent!==parent||(wasAttached&&!parent.parent))return {status:'detached'};
        const width=Number(entity.size?.width)||24,depth=Number(entity.size?.depth)||18;
        modelGroup=new THREE.Group();modelGroup.name='modeled-retail:'+entity.reference;
        modelGroup.scale.set(width/24,1,depth/18);
        const model=loaded.model.clone(true);modelGroup.add(model);
        model.traverse(object=>{
          if(!object.isMesh)return;
          object.material=Array.isArray(object.material)?object.material.map(material=>accentMaterial(material,accentColors[style])):accentMaterial(object.material,accentColors[style]);
          const materials=Array.isArray(object.material)?object.material:[object.material];
          object.castShadow=shadows&&materials.every(material=>!material.transparent);
          object.receiveShadow=shadows;
        });
        const signGroup=new THREE.Group();signGroup.name='modeled-store-name';modelGroup.add(signGroup);
        createSign(signGroup,entity,{width:20.4,height:1.35,y:17.05,z:9.62});
        createAgrotecnicaStoreSign(signGroup,entity);
        collectResources(signGroup,resources);
        modelGroup.userData={architectureSource:'blender-glb',architectureAsset:url,architectureStyle:style,...loaded.metrics};
        // The billboard stays registered to the same store and receives its
        // existing catalog playlist after changing only its physical layout.
        onReady({...MODELED_RETAIL_LAYOUT,width:MODELED_RETAIL_LAYOUT.width*width/24,z:MODELED_RETAIL_LAYOUT.z*depth/18});
        parent.add(modelGroup);instances.add(modelGroup);
        parent.remove(fallback);disposeFallback(fallback);
        parent.userData.architecture={source:'blender-glb',status:'ready',style,asset:url,...loaded.metrics};
        return {status:'ready',group:modelGroup,...loaded.metrics};
      }catch(error){
        if(modelGroup?.parent){modelGroup.removeFromParent();instances.delete(modelGroup);}
        if(!disposed)parent.userData.architecture={source:'procedural-fallback',status:'unavailable',style,asset:url};
        return {status:disposed?'disposed':'fallback'};
      }
    },
    dispose(){
      if(disposed)return;
      disposed=true;
      for(const instance of instances)instance.removeFromParent();
      instances.clear();releaseResources(resources);variants.clear();assets.clear();
    }
  };
}
