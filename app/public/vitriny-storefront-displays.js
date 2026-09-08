import * as THREE from '/vendor/three/three.module.js';
import {billboardIndex,safeBillboardHref} from './vitriny-spatial-billboard-core.js';

// One catalog feeds the rooftop, storefront and accessible product directory.
export function mountStorefrontDisplays({architecture,directory,onVisit=()=>{}}){
  const displays=[],images=new Map();let elapsed=0,disposed=false;
  function picture(url){
    if(!url||images.has(url))return;
    const image=new Image();image.crossOrigin='anonymous';images.set(url,image);
    image.onload=()=>{if(!disposed)for(const display of displays)display.current=-1;};
    image.onerror=()=>{image.onload=null;};image.src=url;
  }
  function draw(display,item){
    const ctx=display.canvas.getContext('2d'),image=images.get(item.imageUrl);
    ctx.fillStyle='#f5f0e5';ctx.fillRect(0,0,640,640);
    if(image?.complete&&image.naturalWidth){
      // Contain the complete catalog photograph; never crop the product away.
      const scale=Math.min(584/image.naturalWidth,410/image.naturalHeight),w=image.naturalWidth*scale,h=image.naturalHeight*scale;
      ctx.drawImage(image,(640-w)/2,20+(410-h)/2,w,h);
    }else{
      ctx.fillStyle='#29474c';ctx.font='500 36px system-ui';ctx.textAlign='center';ctx.fillText(display.store.name,320,208,550);
      ctx.fillStyle='#6b7773';ctx.font='22px system-ui';ctx.fillText(item.kind==='product'?'Produto do catálogo':'Conheça nossa loja',320,250,550);
    }
    ctx.textAlign='left';ctx.fillStyle='#172f35';ctx.font='600 29px system-ui';
    const words=item.title.split(/\s+/);let line='',y=472;
    for(const word of words){const next=line?`${line} ${word}`:word;if(ctx.measureText(next).width>572&&line){ctx.fillText(line,34,y,572);line=word;y+=36;if(y>508)break;}else line=next;}if(y<=508)ctx.fillText(line,34,y,572);
    ctx.fillStyle='#46584e';ctx.font='500 26px system-ui';
    ctx.fillText(item.amountCents?(item.amountCents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}):display.store.name,34,553,572);
    ctx.fillStyle='#193b3c';ctx.fillRect(0,578,640,62);ctx.fillStyle='#f3dbab';ctx.font='600 24px system-ui';ctx.fillText(item.kind==='product'?'VER PRODUTO  →':'VISITAR LOJA  →',34,618,572);
    display.group.userData={storefrontItem:true,href:item.href,reference:display.store.reference,kind:item.kind};display.texture.needsUpdate=true;
  }
  return {
    registerStore(parent,store){
      const entries=[];
      for(const side of [-1,1]){
        const group=new THREE.Group();group.name=`storefront:${store.reference}:${side}`;group.position.set(side*store.size.width*.29,3.75,store.size.depth/2+.12);parent.add(group);
        architecture.part(group,architecture.wood,0,-2.65,-.1,5.6,.9,1.1);
        architecture.part(group,architecture.brass,0,0,-.12,5.45,5.45,.18);
        const canvas=document.createElement('canvas');canvas.width=canvas.height=1280;canvas.getContext('2d').scale(2,2);
        const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=8;
        group.add(new THREE.Mesh(new THREE.PlaneGeometry(5.2,5.2),new THREE.MeshBasicMaterial({map:texture,toneMapped:false})));
        const display={group,canvas,texture,store,items:[],offset:side===-1?0:1,current:-1};displays.push(display);entries.push(display);
      }
      const section=document.createElement('section'),heading=document.createElement('h3'),links=document.createElement('nav'),visit=document.createElement('button');heading.textContent=store.name;links.setAttribute('aria-label',`Vitrine de ${store.name}`);visit.type='button';visit.className='motion-toggle';visit.textContent='Ver vitrine na cidade';visit.setAttribute('aria-label',`Ver vitrine de ${store.name} na cidade`);visit.addEventListener('click',()=>onVisit(store));section.append(heading,visit,links);directory.append(section);
      return items=>{
        if(disposed)return;
        const safe=items.filter(item=>safeBillboardHref(item.href));for(const entry of entries){entry.items=safe;entry.current=-1;}
        links.replaceChildren();for(const item of safe){const link=document.createElement('a');link.href=item.href;link.textContent=item.kind==='product'?`${item.title}${item.amountCents?` · ${(item.amountCents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}`:''}`:'Visitar loja';links.append(link);}
      };
    },
    tick(dt,{paused=false}={}){if(!paused)elapsed+=dt;for(const display of displays){if(!display.items.length)continue;const index=billboardIndex({elapsed,offset:display.offset,count:display.items.length});if(index!==display.current){picture(display.items[index].imageUrl);picture(display.items[(index+1)%display.items.length].imageUrl);display.current=index;draw(display,display.items[index]);}}},
    dispose(){disposed=true;for(const image of images.values())image.onload=image.onerror=null;images.clear();}
  };
}
