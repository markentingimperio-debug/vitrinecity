import * as THREE from '/vendor/three/three.module.js';
import {storeBuildingIdentity} from './vitriny-store-building-core.js';

export function storeArchitectureStyle(name=''){
  return storeBuildingIdentity(name).style;
}

// Add real architectural depth without replacing entrance anchors or catalogue meshes.
export function dressBoutique({group,architecture,width,depth,height,label,lite=false,catalog=false}){
  const a=architecture,w=width,d=depth,h=height,front=d/2,style=storeArchitectureStyle(label);
  group.userData.architectureStyle=style;
  const colors={botanical:['#6e8d71','#d9d3bb'],country:['#ae7850','#e1c49b'],learning:['#86acba','#dce4e4'],creative:['#b98f9e','#ddd1da'],gallery:['#8a999f','#cbd3d7']},[accent,trim]=colors[style];
  const frame=new THREE.MeshStandardMaterial({color:accent,metalness:.58,roughness:.3}),porcelain=new THREE.MeshStandardMaterial({color:trim,roughness:.55,metalness:.08}),windows=new THREE.MeshStandardMaterial({color:'#567d90',emissive:'#708d9b',emissiveIntensity:.1,metalness:.68,roughness:.18});
  for(const material of [frame,porcelain,windows])a.materials.add(material);
  // The upper volume is set back, leaving the roof line and shop sign unobstructed.
  a.part(group,porcelain,0,h+2,-d*.2,w*.72,3.8,d*.43);
  a.part(group,windows,0,h+2.05,d*.018,w*.66,3.15,.08);
  for(let i=-2;i<=2;i++)a.part(group,frame,i*w*.13,h+2.05,d*.027,.065,3.35,.1);
  a.part(group,a.warm,0,h+3.85,d*.028,w*.7,.065,.12);
  if(style==='botanical'){
    for(const x of [-w*.43,w*.43]){a.part(group,porcelain,x,h*.5,front-.3,1.1,h,1.4);for(let i=0;i<(lite?3:5);i++)a.tree(group,x,front-.3,.18,h*.18+i*1.4);}
    for(let x=-w*.44;x<=w*.44;x+=1.2)a.part(group,frame,x,h+4.05,-d*.18,.11,.2,d*.53);
    a.part(group,porcelain,0,h+4,-d*.18,w*.82,.23,d*.6);
  }else if(style==='country'){
    const pitch=Math.atan2(2.1,w*.42),length=Math.hypot(w*.42,2.1);
    for(const side of [-1,1]){const roof=a.part(group,a.wood,side*w*.21,h+4.9,-d*.18,length,.23,d*.64);roof.rotation.z=-side*pitch;}
    for(const x of [-w*.44,w*.44]){a.part(group,a.wood,x,h*.48,front-.05,.5,h-.4,.5);a.part(group,frame,x,h*.47,front+.25,.075,h-.5,.09);}
  }else if(style==='learning'){
    for(const side of [-1,1]){const wing=a.part(group,porcelain,side*w*.2,h+4.1,-d*.17,w*.45,.32,d*.65);wing.rotation.z=side*.055;}
    for(const x of [-w*.45,w*.45])a.part(group,porcelain,x,h*.5,front,.8,h,.7);
    a.part(group,frame,0,h+4.5,-d*.2,.2,1.8,d*.62);
  }else if(style==='creative'){
    const arch=new THREE.Mesh(new THREE.TorusGeometry(w*.34,.18,6,32,Math.PI),frame);arch.position.set(0,h+3.6,-d*.28);arch.scale.y=.36;group.add(arch);
    for(const x of [-w*.42,w*.42])a.part(group,frame,x,h*.5,front+.1,.2,h,.3);
    a.part(group,porcelain,w*.18,h+4.2,-d*.16,w*.56,.3,d*.65);
  }else{
    a.part(group,porcelain,0,h+4.1,-d*.17,w*.79,.3,d*.61);
    for(const x of [-w*.44,w*.44])a.part(group,frame,x,h*.5,front,.24,h,.3);
  }
  // Planters and recessed lighting create a recognisable, human-scale threshold.
  for(const x of [-w*.4,w*.4]){a.part(group,porcelain,x,.75,front+1.15,1.55,.75,.9);a.part(group,a.warm,x,.45,front+1.62,1.4,.035,.06);}
  if(catalog){
    const identity=storeBuildingIdentity(label),base=h+4.2,total=identity.towerHeight,tw=w*.88,td=d*.78,tz=-d*.1;
    group.name='store-building:'+label;group.userData.buildingHeight=base+total+5;
    const tiers=[{fraction:.42,scale:1},{fraction:.34,scale:.83},{fraction:.24,scale:.65}];
    let bottom=base;
    for(const [index,tier] of tiers.entries()){
      const height=total*tier.fraction,width=tw*tier.scale,depth=td*tier.scale,offset=(style==='creative'?1:-1)*index*w*.035;
      a.roundedPart(group,a.curtain,offset,bottom+height/2,tz,width,height,depth,style==='country'?1.2:2.6);
      for(const side of [-1,1]){
        // Paired structural piers frame recessed glazing on both street elevations.
        a.part(group,style==='country'?a.wood:porcelain,offset+side*width*.4,bottom+height/2,tz+depth/2,.48,height,.75);
        a.part(group,a.brass,offset+side*width*.4,bottom+height/2,tz+depth/2+.41,.055,height,.09);
      }
      for(let y=bottom+3.5;y<bottom+height-.8;y+=3.5){
        a.roundedPart(group,porcelain,offset,y,tz,width+.3,.13,depth+.3,2.3);
      }
      a.terrace(group,{x:offset,y:bottom+height+.14,z:tz,width:width+1.5,depth:depth+1.5,green:!lite||index===0});
      bottom+=height;
    }
    if(style==='botanical'){
      // Garden terraces and a light pergola distinguish the Agrotecnica building.
      for(const x of [-tw*.42,tw*.42])for(const y of [base+4,base+11])a.tree(group,x,tz+td/2,.35,y);
      for(let x=-tw*.26;x<=tw*.26;x+=1.4)a.part(group,a.brass,x,bottom+3.6,tz,.1,.18,td*.65);
      for(const x of [-tw*.28,tw*.28])a.part(group,porcelain,x,bottom+1.8,tz-td*.25,.22,3.6,.22);
    }else if(style==='country'){
      for(const side of [-1,1]){const roof=a.part(group,a.wood,side*tw*.17,bottom+2,tz,tw*.36,.22,td*.68);roof.rotation.z=-side*.15;}
    }else if(style==='learning'){
      for(const side of [-1,1]){const wing=a.part(group,porcelain,side*tw*.18,bottom+1.7,tz,tw*.4,.3,td*.75);wing.rotation.z=side*.13;}
    }else if(style==='creative'){
      a.roundedPart(group,frame,tw*.29,base+total*.55,tz,1.3,total*1.03,td*.65,.5);
    }
    const signY=base+total-1.6,signWidth=tw*.7,signHeight=2.5,front=tz+td*.65/2;
    a.roundedPart(group,a.graphite,0,signY,tz,signWidth,signHeight,td*.65+.6,1.3);
    const sign=a.textSign(group,identity.name,{width:signWidth-1,height:2.2,y:signY,z:front+.34,subtitle:identity.subtitle});
    const back=sign.clone();back.position.z=tz-td*.65/2-.34;back.rotation.y=Math.PI;group.add(back);
    for(const side of [-1,1]){const end=sign.clone();end.position.set(side*(signWidth/2+.02),signY,tz);end.rotation.y=side*Math.PI/2;end.scale.x=(td*.65-1)/(signWidth-1);group.add(end);}
  }
  return style;
}

export function dressCommercialCenter({group,architecture,center}){
  const a=architecture,h=center.height,accent=new THREE.MeshStandardMaterial({color:new THREE.Color(center.color).lerp(new THREE.Color("#b3b3a0"),.68),metalness:.6,roughness:.24}),glazing=new THREE.MeshStandardMaterial({color:'#486b80',metalness:.7,roughness:.18});
  a.materials.add(accent);a.materials.add(glazing);
  // Deep window bays establish individual floors instead of one stretched texture.
  for(let y=17;y<h-2;y+=5.6)for(const x of [-16,-8,0,8,16])a.part(group,a.brass,x,y,12.6,.085,4.7,.12);
  if(center.id==='mercadolivre'){
    for(const side of [-1,1]){a.part(group,a.stone,side*22,13,7,4,25,15);a.part(group,accent,side*23.3,13,14.6,.5,25,.3);}
    a.part(group,a.brass,0,h+1,-1,43,.6,34);
  }else if(center.id==='shopee'){
    for(let i=0;i<3;i++){const y=12+i*8;a.part(group,a.stone,0,y,13.5,44-i*2,.35,6);for(const x of [-17,17])a.tree(group,x,13,.4,y+.2);}
  }else if(center.id==='cakto'){
    for(const side of [-1,1]){a.part(group,a.graphite,side*19.5,h*.48,5,2.4,h*.86,19);for(let y=9;y<h;y+=7)a.tree(group,side*19.5,14,.48,y);}
  }else if(center.id==='kiwify'){
    const crown=new THREE.Mesh(new THREE.TorusGeometry(15,.35,8,48,Math.PI),accent);crown.position.set(0,h+1,1);crown.scale.y=.5;group.add(crown);
    for(const x of [-18,18])a.part(group,a.stone,x,18,12,1.3,32,2.5);
  }else if(center.id==='tiktok'){
    for(const [x,height,z]of [[-19,h+2,9],[19,h-2,4]]){a.part(group,a.stone,x,height/2,z,1.2,height,2);a.part(group,accent,x+.65,height/2,z+1.1,.09,height-2,.12);}
  }
  a.part(group,a.graphite,0,8.7,21.5,30,.35,9);a.part(group,a.warm,0,8.48,25.8,29,.065,.08);
}
