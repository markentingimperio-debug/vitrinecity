import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';

const threeUrl=import.meta.resolve('three');
const code=readFileSync(new URL('../public/vitriny-spatial-premium-atmosphere.js',import.meta.url),'utf8')
  .replaceAll("'/vendor/three/three.module.js'",JSON.stringify(threeUrl));
const {createPremiumFacades}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));

function canvasDocument(){
  const canvases=[];
  return {canvases,createElement(tag){
    assert.equal(tag,'canvas');
    const draws=[],canvas={width:0,height:0,draws};
    const context={fillStyle:'',scale(...args){draws.push(['scale',...args]);},
      fillRect(...args){draws.push(['fill',typeof this.fillStyle==='string'?this.fillStyle:{stops:this.fillStyle.stops},...args]);},
      createLinearGradient(...args){const stops=[];draws.push(['gradient',...args,stops]);return {stops,addColorStop(...stop){stops.push(stop);}};}};
    canvas.getContext=kind=>{assert.equal(kind,'2d');return context;};canvases.push(canvas);return canvas;
  }};
}

test('facade atlas stays deterministic and adds recessed room planes, blinds and pane reflections without extra maps',()=>{
  const previous=globalThis.document;
  try{
    for(const mobile of [true,false]){
      const document=canvasDocument();globalThis.document=document;
      const first=createPremiumFacades({mobile}),second=createPremiumFacades({mobile});
      assert.equal(first.length,3);assert.equal(document.canvases.length,6);
      for(let i=0;i<3;i++){
        const material=first[i],texture=material.map,canvas=texture.image;
        assert.deepEqual([canvas.width,canvas.height],mobile?[256,512]:[512,1024]);
        assert.equal(material.name,'architectural-curtain-glass-'+i);assert.equal(material.transparent,false);
        assert.ok(material.metalness>=.4&&material.metalness<=.55);assert.ok(material.roughness>=.2&&material.roughness<=.3);
        assert.ok(material.envMapIntensity>1&&material.envMapIntensity<1.3);
        assert.equal(texture.colorSpace,THREE.SRGBColorSpace);assert.equal(texture.wrapS,THREE.RepeatWrapping);assert.equal(texture.wrapT,THREE.RepeatWrapping);
        assert.equal(material.emissiveMap,null);assert.equal(material.normalMap,null);assert.equal(material.roughnessMap,null);
        assert.deepEqual(canvas.draws,second[i].map.image.draws,'Identity and atlas variation must not change on refresh');
        const fills=canvas.draws.filter(draw=>draw[0]==='fill');
        assert.ok(fills.some(draw=>draw[1]==='rgba(10,22,32,.28)'),'mullion recess shadows');
        assert.ok(fills.some(draw=>draw[1]==='rgba(170,145,109,.20)'),'rear room planes');
        assert.ok(fills.some(draw=>draw[1]==='rgba(38,56,64,.12)'),'partial blind slats');
        assert.equal(canvas.draws.filter(draw=>draw[0]==='gradient').length,129,'one atmosphere plus two gradients per pane');
        assert.notDeepEqual(canvas.draws,first[(i+1)%3].map.image.draws,'facade variants stay distinct');
        material.map.dispose();material.dispose();second[i].map.dispose();second[i].dispose();
      }
    }
  }finally{globalThis.document=previous;}
});

test('standard and mobile facades use the same architectural pattern at the existing texture budgets',()=>{
  const previous=globalThis.document,document=canvasDocument();globalThis.document=document;
  try{
    const mobile=createPremiumFacades({mobile:true}),standard=createPremiumFacades();
    for(let i=0;i<3;i++){
      assert.deepEqual(mobile[i].map.image.draws.slice(1),standard[i].map.image.draws.slice(1));
      assert.equal(mobile[i].map.anisotropy,2);assert.equal(standard[i].map.anisotropy,4);
      for(const material of [mobile[i],standard[i]]){assert.ok(material.map.image.width*material.map.image.height<=512*1024);material.map.dispose();material.dispose();}
    }
  }finally{globalThis.document=previous;}
});
