import * as THREE from '/vendor/three/three.module.js';
import {fetchBillboardPlaylist,fetchStoreBillboardPlaylist,storeBillboardPlaylist,billboardIndex,safeBillboardHref} from './vitriny-spatial-billboard-core.js';

export function mountSpatialBillboards({scene,architecture,active=false,cityName='Vitrine City'}){
  const group=new THREE.Group();group.name='city-digital-billboards';scene.add(group);
  const boards=[],images=new Map();let disposed=false,elapsed=0;
  let playlist=[{title:active?'Sua marca faz parte da cidade.':cityName,label:active?'VITRINE CITY':'PRÉVIA DA CIDADE',description:active?'Conheça nossas lojas, cursos e serviços.':'Uma nova cidade em preparação.',href:active?'/servicos-digitais.html':'/vitriny-multiverse-worlds.html',imageUrl:'',campaign:false}];
  function createBoard(parent,{x=0,y=10.6,z=0,ry=0,width=18,height=9,postHeight=y,heading='',items=null}={}){
    const index=boards.length,board=new THREE.Group();board.position.set(x,y,z);board.rotation.y=ry;board.userData={billboard:true,index};parent.add(board);
    for(const xx of [-width*.28,width*.28])architecture.part(board,architecture.graphite,xx,-postHeight/2,0,.28,postHeight,.28);
    architecture.part(board,architecture.graphite,0,0,0,width+.6,height+.6,.55);
    architecture.part(board,architecture.warm,0,-height/2-.22,.32,width+.4,.055,.06);
    const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=512;
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
    const screen=new THREE.Mesh(new THREE.PlaneGeometry(width,height),new THREE.MeshBasicMaterial({map:texture,toneMapped:false}));screen.position.set(0,0,.3);board.add(screen);
    const entry={group:board,canvas,texture,index,current:-1,heading,items};boards.push(entry);return entry;
  }
  const sites=[[-30,-38,.15],[32,-38,-.15],[76,64,-.65],[-75,24,.55]];
  for(const [x,z,ry] of sites)createBoard(group,{x,z,ry});
  function draw(board,item){
    const ctx=board.canvas.getContext('2d'),image=images.get(item.imageUrl);ctx.fillStyle='#12242e';ctx.fillRect(0,0,1024,512);
    if(image?.complete&&image.naturalWidth){
      const scale=Math.max(440/image.naturalWidth,512/image.naturalHeight),w=image.naturalWidth*scale,h=image.naturalHeight*scale;
      ctx.save();ctx.beginPath();ctx.rect(584,0,440,512);ctx.clip();ctx.drawImage(image,584+(440-w)/2,(512-h)/2,w,h);ctx.restore();
      const gradient=ctx.createLinearGradient(535,0,750,0);gradient.addColorStop(0,'#12242e');gradient.addColorStop(1,'#12242e00');ctx.fillStyle=gradient;ctx.fillRect(535,0,215,512);
    }
    const width=image?.naturalWidth?530:900;ctx.fillStyle='#d8bd80';ctx.font='600 23px system-ui';ctx.fillText(board.heading||item.label,48,60,920);
    ctx.fillStyle='#f2f0e6';ctx.font='600 54px system-ui';const words=item.title.split(/\s+/);let line='',y=144;
    for(const word of words){const next=line?`${line} ${word}`:word;if(ctx.measureText(next).width>width&&line){ctx.fillText(line,48,y,width);line=word;y+=63;if(y>340)break;}else line=next;}if(y<=340)ctx.fillText(line,48,y,width);
    ctx.fillStyle='#b4c6c6';ctx.font='25px system-ui';const copy=item.amountCents?(item.amountCents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}):item.description;ctx.fillText(copy||'',48,405,width);
    ctx.fillStyle='#9edacf';ctx.font='600 20px system-ui';ctx.fillText('CONHEÇA MAIS  →',48,470);board.texture.needsUpdate=true;board.group.userData.item=item;
  }
  function prepareImages(items=playlist){
    for(const item of items.slice(0,2)){if(!item.imageUrl||images.has(item.imageUrl))continue;const image=new Image();image.crossOrigin='anonymous';images.set(item.imageUrl,image);image.onload=()=>{if(!disposed)for(const board of boards)board.current=-1;};image.onerror=()=>{image.onload=null;};image.src=item.imageUrl;}
  }
  const ready=fetchBillboardPlaylist({active,city:active?'':cityName}).then(items=>{if(!disposed&&items.length){playlist=items;for(const board of boards)board.current=-1;prepareImages();}return items.length;}).catch(()=>0);
  return {group,get targets(){return boards.map(board=>board.group);},ready,
    registerStore(parent,store,{roof=9,onPlaylist=()=>{}}={}){const entry=createBoard(parent,{y:roof+4,z:0,width:17,height:7.5,postHeight:4,heading:store.name,items:storeBillboardPlaylist(store)});prepareImages(entry.items);onPlaylist(entry.items);fetchStoreBillboardPlaylist(store).then(items=>{if(!disposed&&items.length){entry.items=items;entry.current=-1;prepareImages(items);onPlaylist(items);}});return entry;},
    registerVenue(parent,{name,description,href,roof=9}){const items=storeBillboardPlaylist({name,href,description,reference:''});if(items.length)createBoard(parent,{y:roof+3.5,width:15,height:6.5,postHeight:3.5,heading:name,items});},
    tick(dt,{paused=false}={}){if(!paused)elapsed+=dt;for(const board of boards){const items=board.items||playlist;if(!items.length)continue;const i=billboardIndex({elapsed,offset:board.index,count:items.length});if(board.current!==i){prepareImages([items[i],items[(i+1)%items.length]]);board.current=i;draw(board,items[i]);}}},
    activate(target){const item=target?.userData?.item;if(!item)return false;const href=safeBillboardHref(item.href,{campaign:item.campaign});if(!href)return false;location.assign(href);return true;},
    dispose(){disposed=true;for(const image of images.values()){image.onload=image.onerror=null;}images.clear();}};
}
