import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as THREE from 'three';

const source=(await readFile(new URL('../public/vitriny-architectural-paving.js',import.meta.url),'utf8'))
  .replace("'/vendor/three/three.module.js'",JSON.stringify(import.meta.resolve('three')));
// Test-only inspection stays outside the production module's public API.
const instrumented=source+'\nexport const inspectPavingPatterns=()=>[...pavingPatterns.values()];';
const {architecturalPavingPixels,createArchitecturalPavingMaps,inspectPavingPatterns}=await import('data:text/javascript;base64,'+Buffer.from(instrumented).toString('base64'));

test('all city pavement tints retain the exact original PR200 RGBA pixels',()=>{
  const fixtures=[
    [false,'#d1cbbb','e28e45ef834cab10a345994aab3546bfc26d96ab7f0ce637ecfedfdf0929320d'],
    [false,'#8f8069','7b726bda656ed0b7095be44376d74e232ded907bc2c3db10c10304fcd61c076c'],
    [false,'#d2c9b7','fa4387b0ded07fa6cf8879fe9a837ffb1f09cfce979fea3a44861e61053b80cb'],
    [true,'#d1cbbb','5e0fb82b1506664aa75cbce87cd098e23e113f692bdf95dbc74a4bccfe1bace3'],
    [true,'#8f8069','9b02ebcc376e57b6db4ff1bce146b8ba8aa35c564dfae6f93712206bf57ae503'],
    [true,'#d2c9b7','a7d3fcef4dcce846b5832eaed00108f8eb8c91e0b3b2eb5f4927429976b901d5']
  ];
  for(const [lite,color,expected] of fixtures){
    const {albedo,surface}=architecturalPavingPixels({color,lite});
    const hash=createHash('sha256').update(albedo);if(surface)hash.update(surface);
    assert.equal(hash.digest('hex'),expected,`${color} / ${lite?'LITE':'STANDARD'}`);
  }
});

test('pattern reuse is bounded to two resolutions and released after the synchronous build',async()=>{
  await Promise.resolve();assert.deepEqual(inspectPavingPatterns(),[]);
  const first=architecturalPavingPixels({color:'#d1cbbb'}),[pattern]=inspectPavingPatterns();
  architecturalPavingPixels({color:'#8f8069'});
  assert.equal(inspectPavingPatterns()[0],pattern,'Different tints reuse the same expensive pattern');
  architecturalPavingPixels({color:'#8f8069',lite:true});
  const cached=inspectPavingPatterns();assert.equal(cached.length,2);
  assert.equal(cached.reduce((sum,p)=>sum+p.shades.byteLength+(p.surface?.byteLength||0),0),3.5*1024*1024);
  await Promise.resolve();assert.deepEqual(inspectPavingPatterns(),[]);
  const rebuilt=architecturalPavingPixels({color:'#d1cbbb'});
  assert.notEqual(inspectPavingPatterns()[0],pattern);assert.deepEqual(rebuilt,first);
  await Promise.resolve();assert.deepEqual(inspectPavingPatterns(),[]);
});

test('each floor owns independent pixel buffers even when its pattern is reused',()=>{
  for(const lite of [false,true]){
    const first=architecturalPavingPixels({lite}),second=architecturalPavingPixels({lite});
    assert.notEqual(first.albedo.buffer,second.albedo.buffer);
    first.albedo.fill(0);if(first.surface){assert.notEqual(first.surface.buffer,second.surface.buffer);first.surface.fill(0);}
    assert.deepEqual(architecturalPavingPixels({lite}),second);
  }
});

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
