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
    const canvas=document.createElement('canvas');canvas.width=portrait?512:1024;canvas.height=portrait?1024:512;if(portrait)canvas.getContext('2d').scale(.5,.5);
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
    if(board.portrait){
      const gradient=ctx.createLinearGradient(0,0,1024,2048);gradient.addColorStop(0,background);gradient.addColorStop(1,'#080f22');ctx.fillStyle=gradient;ctx.fillRect(0,0,1024,2048);
      ctx.textAlign='center';ctx.fillStyle='#fff2c9';ctx.font='750 88px system-ui';ctx.fillText(board.heading||item.label,512,145,920);
      ctx.fillStyle='#ffffff';ctx.fillRect(44,260,936,1090);
      if(image?.complete&&image.naturalWidth){const scale=Math.min(880/image.naturalWidth,1020/image.naturalHeight),w=image.naturalWidth*scale,h=image.naturalHeight*scale;ctx.drawImage(image,(1024-w)/2,295+(1020-h)/2,w,h);}else{ctx.fillStyle=background;ctx.font='700 85px system-ui';ctx.fillText('DESCUBRA',512,745,850);ctx.fillText('SUA PRÓXIMA',512,850,850);ctx.fillText('ESCOLHA',512,955,850);}
      ctx.fillStyle='#fff';ctx.font='650 66px system-ui';const words=item.title.split(/\s+/);let line='',y=1490;for(const word of words){const next=line?line+' '+word:word;if(ctx.measureText(next).width>890&&line){ctx.fillText(line,512,y,890);line=word;y+=82;if(y>1736)break;}else line=next;}if(y<=1736)ctx.fillText(line,512,y,890);
      ctx.fillStyle='#a3e7dd';ctx.font='750 53px system-ui';ctx.fillText('TOQUE PARA CONHECER →',512,1940,900);board.texture.needsUpdate=true;board.group.userData.item=item;return;
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
    registerStore(parent,store,{roof=9,onPlaylist=()=>{}}={}){const entry=createBoard(parent,{y:roof+7.4,z:Math.max(3,(store.size?.depth||13)/2+.2),width:9.8,height:12.2,postHeight:0,portrait:true,heading:store.name,items:storeBillboardPlaylist(store)});prepareImages(entry.items);onPlaylist(entry.items);fetchStoreBillboardPlaylist(store).then(items=>{if(!disposed&&items.length){entry.items=items;entry.current=-1;prepareImages(items);onPlaylist(items);}});return entry;},
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
