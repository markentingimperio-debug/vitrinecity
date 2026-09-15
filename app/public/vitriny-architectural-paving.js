import * as THREE from '/vendor/three/three.module.js';

// Local limestone atlas: a 2:1 running bond gives the boulevard a human scale.
// Height and roughness share one linear texture (R/G); LITE only needs colour.
export function architecturalPavingPixels({color='#aaa89b',lite=false}={}){
  const size=lite?256:512,albedo=new Uint8ClampedArray(size*size*4);
  const surface=lite?null:new Uint8ClampedArray(size*size*4);
  const hex=new THREE.Color(color).getHex(),base=[hex>>16,(hex>>8)&255,hex&255];
  const hash=(x,y)=>{let n=Math.imul(x+11,374761393)^Math.imul(y+7,668265263);n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967295;};
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const v=y/size*8,row=Math.floor(v),u=x/size*4+(row%2)*.5;
    const col=Math.floor(u)%4,fx=u-Math.floor(u),fy=v-row;
    const edge=Math.min(fx,1-fx,fy*.5,(1-fy)*.5);
    const joint=edge<.004,reveal=Math.min(1,edge/.02);
    const slab=hash(col,row),grain=hash(x,y)-.5;
    const mineral=Math.sin(fx*19+fy*7+slab*8)*Math.sin(fy*27-fx*4)*.006;
    const shade=joint?.82:(.965+slab*.07+grain*.018+mineral)*(.965+.035*reveal);
    const offset=(y*size+x)*4;
    for(let channel=0;channel<3;channel++)albedo[offset+channel]=Math.round(Math.min(255,base[channel]*shade));
    albedo[offset+3]=255;
    if(surface){
      surface[offset]=joint?64:Math.round(217+reveal*9+grain*3);
      surface[offset+1]=joint?245:Math.round(204+slab*23+grain*6);
      surface[offset+2]=0;surface[offset+3]=255;
    }
  }
  return {size,albedo,surface};
}

export function createArchitecturalPavingMaps({color,lite=false,repeat=12,anisotropy=1}={}){
  const pixels=architecturalPavingPixels({color,lite});
  function texture(data,colorSpace){
    const canvas=document.createElement('canvas');canvas.width=canvas.height=pixels.size;
    const context=canvas.getContext('2d'),image=context.createImageData(pixels.size,pixels.size);
    image.data.set(data);context.putImageData(image,0,0);
    const map=new THREE.CanvasTexture(canvas);map.colorSpace=colorSpace;
    map.wrapS=map.wrapT=THREE.RepeatWrapping;map.repeat.set(repeat,repeat);
    map.anisotropy=Math.max(1,Math.min(lite?2:8,anisotropy));
    return map;
  }
  const map=texture(pixels.albedo,THREE.SRGBColorSpace);
  const surface=pixels.surface?texture(pixels.surface,THREE.NoColorSpace):null;
  // Callers adjust the boulevard's aspect ratio through map.repeat. Both maps
  // must keep those exact UVs so the recessed joints and mineral colour align.
  if(surface)surface.repeat=map.repeat;
  return {map,surface};
}
