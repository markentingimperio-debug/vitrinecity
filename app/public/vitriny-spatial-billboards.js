import * as THREE from '/vendor/three/three.module.js';
import {fetchBillboardPlaylist,fetchStoreBillboardPlaylist,storeBillboardPlaylist,billboardIndex,safeBillboardHref} from './vitriny-spatial-billboard-core.js';

export function mountSpatialBillboards({scene,architecture,active=false,cityName='Vitrine City'}){
  const group=new THREE.Group();group.name='city-digital-billboards';scene.add(group);
  const boards=[],images=new Map();let disposed=false,elapsed=0;
  let playlist=[{title:active?'Sua marca faz parte da cidade.':cityName,label:active?'VITRINE CITY':'PRÉVIA DA CIDADE',description:active?'Conheça nossas lojas, cursos e serviços.':'Uma nova cidade em preparação.',href:active?'/servicos-digitais.html':'/vitriny-multiverse-worlds.html',imageUrl:'',campaign:false}];
  function createBoard(parent,{x=0,y=10.6,z=0,ry=0,width=18,height=9,postHeight=y,heading='',items=null,portrait=false}={}){
    const index=boards.length,board=new THREE.Group();board.position.set(x,y,z);board.rotation.y=ry;board.userData={billboard:true,index};parent.add(board);
    for(const xx of (postHeight>0?[-width*.28,width*.28]:[]))architecture.part(board,architecture.graphite,xx,-postHeight/2,0,.28,postHeight,.28);
    architecture.part(board,architecture.graphite,0,0,0,width+.6,height+.6,.55);
    architecture.part(board,architecture.warm,0,-height/2-.22,.32,width+.4,.055,.06);
    const canvas=document.createElement('canvas');canvas.width=portrait?512:1024;canvas.height=portrait?Math.round(512*height/width):512;if(portrait)canvas.getContext('2d').scale(.5,.5);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
    const screen=new THREE.Mesh(new THREE.PlaneGeometry(width,height),new THREE.MeshBasicMaterial({map:texture,toneMapped:false}));screen.position.set(0,0,.3);board.add(screen);
    const rear=screen.clone();rear.position.z=-.3;rear.rotation.y=Math.PI;board.add(rear);
    const runner=architecture.part(board,architecture.warm,-width*.35,-height/2-.23,.36,width*.18,.085,.075);
    const entry={group:board,canvas,texture,index,current:-1,heading,items,portrait,runner,width};boards.push(entry);return entry;
  }
  const sites=[[-30,-38,.15],[32,-38,-.15],[76,64,-.65],[-75,24,.55]];
  for(const [x,z,ry] of sites)createBoard(group,{x,z,ry});
  function draw(board,item){
    const ctx=board.canvas.getContext('2d'),image=images.get(item.imageUrl),colors=['#17325e','#302049','#173c35','#482c21'],background=colors[board.index%colors.length];
    if(board.wideStore){
      const w=board.canvas.width,h=board.canvas.height,photoX=w*.63,photoWidth=w-photoX-16,photoHeight=h-32;
      const gradient=ctx.createLinearGradient(0,0,w,h);gradient.addColorStop(0,background);gradient.addColorStop(1,'#101c25');ctx.fillStyle=gradient;ctx.fillRect(0,0,w,h);
      ctx.fillStyle='#fff4d8';ctx.textAlign='left';ctx.font='600 34px system-ui';ctx.fillText(board.heading||item.label,30,53,w*.56);
      ctx.fillStyle='#fff';ctx.font='500 29px system-ui';const words=item.title.split(/\s+/);let line='',y=108;
      for(const word of words){const next=line?line+' '+word:word;if(ctx.measureText(next).width>w*.55&&line){ctx.fillText(line,30,y,w*.55);line=word;y+=35;if(y>h-105)break;}else line=next;}
      if(y<=h-105)ctx.fillText(line,30,y,w*.55);
      ctx.fillStyle='#dac79f';ctx.font='500 26px system-ui';ctx.fillText(item.amountCents?(item.amountCents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}):item.label||board.heading,30,h-67,w*.55);
      ctx.fillStyle='#a5e0d1';ctx.font='600 23px system-ui';ctx.fillText(item.kind==='product'?'CONHECER PRODUTO  →':'VISITAR LOJA  →',30,h-29,w*.55);
      ctx.fillStyle='#fff';ctx.fillRect(photoX,16,photoWidth,photoHeight);
      if(image?.complete&&image.naturalWidth){const scale=Math.min((photoWidth-24)/image.naturalWidth,(photoHeight-24)/image.naturalHeight),iw=image.naturalWidth*scale,ih=image.naturalHeight*scale;ctx.drawImage(image,photoX+(photoWidth-iw)/2,16+(photoHeight-ih)/2,iw,ih);}
      else {ctx.fillStyle=background;ctx.textAlign='center';ctx.font='500 22px system-ui';ctx.fillText('CONHEÇA NOSSA LOJA',photoX+photoWidth/2,h/2,photoWidth-20);}
      board.texture.needsUpdate=true;board.group.userData.item=item;return;
    }
    if(board.portrait){
      const H=board.canvas.height*2,photoTop=H*.145,photoHeight=H*.54;
      const gradient=ctx.createLinearGradient(0,0,1024,H);gradient.addColorStop(0,background);gradient.addColorStop(1,'#101c25');ctx.fillStyle=gradient;ctx.fillRect(0,0,1024,H);
      ctx.textAlign='center';ctx.fillStyle='#fff2c9';ctx.font=`600 ${Math.min(80,H*.055)}px system-ui`;ctx.fillText(board.heading||item.label,512,H*.094,920);
      ctx.fillStyle='#ffffff';ctx.fillRect(44,photoTop,936,photoHeight);
      // Canvas and physical display share an aspect ratio, so catalog photos keep
      // their proportions after projection onto the building facade.
      if(image?.complete&&image.naturalWidth){const scale=Math.min(880/image.naturalWidth,(photoHeight-56)/image.naturalHeight),w=image.naturalWidth*scale,h=image.naturalHeight*scale;ctx.drawImage(image,(1024-w)/2,photoTop+(photoHeight-h)/2,w,h);}else{ctx.fillStyle=background;ctx.font=`600 ${Math.min(70,H*.045)}px system-ui`;ctx.fillText('CONHEÇA NOSSA LOJA',512,photoTop+photoHeight*.5,850);}
      ctx.fillStyle='#fff';ctx.font=`500 ${Math.min(62,H*.043)}px system-ui`;const words=item.title.split(/\s+/);let line='',y=H*.757;for(const word of words){const next=line?line+' '+word:word;if(ctx.measureText(next).width>890&&line){ctx.fillText(line,512,y,890);line=word;y+=H*.052;if(y>H*.864)break;}else line=next;}if(y<=H*.864)ctx.fillText(line,512,y,890);
      ctx.fillStyle='#d7c294';ctx.font=`600 ${Math.min(50,H*.034)}px system-ui`;ctx.fillText('CONHECER PRODUTO →',512,H*.952,900);board.texture.needsUpdate=true;board.group.userData.item=item;return;
    }
    ctx.fillStyle=background;ctx.fillRect(0,0,1024,512);
    if(image?.complete&&image.naturalWidth){
      const scale=Math.min(420/image.naturalWidth,450/image.naturalHeight),w=image.naturalWidth*scale,h=image.naturalHeight*scale;
      ctx.save();ctx.beginPath();ctx.rect(584,0,440,512);ctx.clip();ctx.drawImage(image,584+(440-w)/2,(512-h)/2,w,h);ctx.restore();
      const gradient=ctx.createLinearGradient(535,0,650,0);gradient.addColorStop(0,background);gradient.addColorStop(1,background+'00');ctx.fillStyle=gradient;ctx.fillRect(535,0,115,512);
    }
    const width=image?.naturalWidth?530:900;ctx.fillStyle='#ffe4a2';ctx.font='750 38px system-ui';ctx.fillText(board.heading||item.label,48,61,920);
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
    registerStore(parent,store,{roof=9,onPlaylist=()=>{},layout=null}={}){
      const entry=createBoard(parent,{y:roof+7.4,z:Math.max(3,(store.size?.depth||13)/2+.75),width:9.8,height:12.2,postHeight:0,portrait:true,heading:store.name,items:storeBillboardPlaylist(store)});
      entry.setLayout=({width=9.8,height=12.2,y=roof+7.4,z=entry.group.position.z,portrait=true}={})=>{
        if(disposed||![width,height,y,z].every(Number.isFinite)||width<=0||height<=0)return;
        entry.group.scale.set(width/9.8,height/12.2,1);entry.group.position.set(0,y,z);
        entry.portrait=portrait;entry.wideStore=!portrait;
        const canvas=document.createElement('canvas');canvas.width=portrait?512:1024;canvas.height=Math.round(canvas.width*height/width);if(portrait)canvas.getContext('2d').scale(.5,.5);
        const old=entry.texture,texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
        entry.group.traverse(object=>{for(const material of Array.isArray(object.material)?object.material:[object.material])if(material?.map===old){material.map=texture;material.needsUpdate=true;}});
        entry.canvas=canvas;entry.texture=texture;entry.current=-1;old.dispose();
      };
      if(layout)entry.setLayout(layout);
      prepareImages(entry.items);onPlaylist(entry.items);fetchStoreBillboardPlaylist(store).then(items=>{if(!disposed&&items.length){entry.items=items;entry.current=-1;prepareImages(items);onPlaylist(items);}});return entry;
    },
    registerVenue(parent,{name,description,href,roof=9}){const items=storeBillboardPlaylist({name,href,description,reference:''});if(items.length)createBoard(parent,{y:roof+3.2,z:6,width:12,height:4.5,postHeight:3.2,heading:name,items});},
    registerCenter(parent,center){
      const entry=createBoard(parent,{y:21,z:18.2,width:18,height:9,postHeight:0,heading:center.name,items:storeBillboardPlaylist({name:center.title,href:center.href,description:'Explore os departamentos da nossa seleção afiliada.',reference:''})});
      const corner=createBoard(parent,{x:-25.4,y:23,z:-2,ry:-Math.PI/2,width:16,height:25,postHeight:0,heading:center.name,items:entry.items,portrait:true});
      entry.group.visible=false;corner.group.visible=false;
      fetch(`/api/affiliate-centers/${center.id}/products`,{credentials:'same-origin'}).then(response=>{if(!response.ok)throw Error('Catalogue unavailable');return response.json();}).then(data=>{
        if(disposed)return;
        const items=(Array.isArray(data.items)?data.items:[]).filter(p=>p.platform===center.id&&p.available&&/^\/ofertas\/[a-z0-9-]+$/.test(p.href)).slice(0,12).map(p=>({title:p.title,label:center.name,description:p.category,href:p.href,imageUrl:p.image||'',campaign:false}));
        if(items.length){entry.items=items;entry.current=-1;corner.items=items;corner.current=-1;entry.group.visible=true;corner.group.visible=true;prepareImages(items);}
      }).catch(()=>{});
    },
    tick(dt,{paused=false}={}){if(!paused)elapsed+=dt;for(const board of boards){if(!paused)board.runner.position.x=Math.sin(elapsed*.65+board.index)*board.width*.37;const items=board.items||playlist;if(!items.length)continue;const i=billboardIndex({elapsed,offset:board.index,count:items.length});if(board.current!==i){prepareImages([items[i],items[(i+1)%items.length]]);board.current=i;draw(board,items[i]);}}},
    activate(target){const item=target?.userData?.item;if(!item)return false;const href=safeBillboardHref(item.href,{campaign:item.campaign});if(!href)return false;location.assign(href);return true;},
    dispose(){disposed=true;for(const image of images.values()){image.onload=image.onerror=null;}images.clear();}};
}
