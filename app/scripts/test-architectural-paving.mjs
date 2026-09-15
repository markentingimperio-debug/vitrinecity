import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';

const source=(await readFile(new URL('../public/vitriny-architectural-paving.js',import.meta.url),'utf8'))
  .replace("'/vendor/three/three.module.js'",JSON.stringify(import.meta.resolve('three')));
const {architecturalPavingPixels,createArchitecturalPavingMaps}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));

test('local paving has deterministic stone variation, staggered joints and bounded texture memory',()=>{
  for(const lite of [false,true]){
    const a=architecturalPavingPixels({color:'#8f8069',lite}),b=architecturalPavingPixels({color:'#8f8069',lite});
    assert.equal(a.size,lite?256:512);assert.deepEqual(a,b);
    assert.equal(a.albedo.byteLength,a.size*a.size*4);
    assert.equal(a.surface?.byteLength||0,lite?0:512*512*4);
    assert.ok(new Set(a.albedo.filter((_,i)=>i%4===0)).size>=10,'Stone should not be a flat repeated colour');
    for(let i=3;i<a.albedo.length;i+=4)assert.equal(a.albedo[i],255);
    const pixel=(x,y)=>a.albedo[(Math.floor(y*a.size)*a.size+Math.floor(x*a.size))*4];
    assert.ok(pixel(0,.0625)<pixel(.125,.0625),'First course starts at a joint');
    assert.ok(pixel(0,.1875)>pixel(.125,.1875),'Next course offsets joints by half a slab');
    if(a.surface){
      for(let i=0;i<a.surface.length;i+=4){assert.ok(a.surface[i]>=64&&a.surface[i]<=230);assert.ok(a.surface[i+1]>=200&&a.surface[i+1]<=245);assert.equal(a.surface[i+3],255);}
    }
  }
});

test('packed surface stays linear, shares UV changes and is omitted on shadowless LITE',()=>{
  const previous=globalThis.document;
  globalThis.document={createElement(){return {getContext(){return {createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){}};}};}};
  try{
    for(const lite of [false,true]){
      const {map,surface}=createArchitecturalPavingMaps({color:'#8f8069',lite,repeat:18,anisotropy:16});
      assert.equal(map.colorSpace,THREE.SRGBColorSpace);assert.equal(map.anisotropy,lite?2:8);
      assert.equal(map.wrapS,THREE.RepeatWrapping);assert.equal(map.wrapT,THREE.RepeatWrapping);
      if(lite)assert.equal(surface,null);
      else{assert.equal(surface.colorSpace,THREE.NoColorSpace);assert.equal(surface.repeat,map.repeat);map.repeat.set(18,54);assert.deepEqual(surface.repeat.toArray(),[18,54]);surface.dispose();}
      map.dispose();
    }
  }finally{globalThis.document=previous;}
});
