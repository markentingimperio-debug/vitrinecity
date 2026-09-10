import * as THREE from '/vendor/three/three.module.js';
import {storeBuildingIdentity} from './vitriny-store-building-core.js';

// Upper galleries are scenery. Catalog photographs, prices, doors and links are
// supplied separately by the existing live store registry.
export function dressRetailGallery({group,architecture:a,width:w,depth:d,height:h,label,lite=false}){
  const identity=storeBuildingIdentity(label),style=identity.style,front=d/2;
  const material=options=>{const m=new THREE.MeshStandardMaterial(options);a.materials.add(m);return m;};
  const window=material({color:'#a4b7ba',metalness:.3,roughness:.1,transparent:true,opacity:.3,depthWrite:false});
  const sideGlazing=material({color:'#718995',metalness:.78,roughness:.16,envMapIntensity:1.3});
  const innerWall=material({color:style==='country'?'#94795d':'#a08e75',roughness:.91,emissive:'#e6b26c',emissiveIntensity:.035});
  const ceiling=material({color:'#bca78b',roughness:.78,emissive:'#e7a652',emissiveIntensity:.06});
  const linen=material({color:'#ede1ca',roughness:1}),leather=material({color:style==='creative'?'#787c70':'#aa7851',roughness:.72});
  const dark=material({color:'#30423e',roughness:.84});
  const cylinder=new THREE.CylinderGeometry(1,1,1,lite?12:20),cone=new THREE.CylinderGeometry(.5,1,1,16);
  const base=h+.22,stories=style==='learning'?5:style==='creative'?4:3,floorHeight=5.7,top=base+stories*floorHeight;
  const setbacks=style==='learning'?[0,0,1.4,1.4,3.2]:style==='creative'?[0,0,0,2.1]:[0,0,1.2];
  group.name='store-building:'+label;group.userData.architectureStyle=style;group.userData.buildingHeight=top+4;

  function furniture(parent,x,y,z,index){
    // Lounge furniture makes the internal depth and floor scale legible.
    const facing=index%2?1:-1;
    a.roundedPart(parent,leather,x,y+.47,z,2.6,.52,1.08,.16);
    a.roundedPart(parent,linen,x,y+.71,z+facing*.1,2.3,.17,.83,.11);
    a.roundedPart(parent,leather,x,y+1.01,z-facing*.47,2.6,.95,.17,.08);
    for(const side of [-1,1])a.roundedPart(parent,leather,x+side*1.24,y+.77,z,.18,.8,1.15,.08);
    a.roundedPart(parent,a.wood,x,y+.56,z+facing*1.6,1.8,.12,.9,.19);
    for(const side of [-1,1])a.part(parent,a.brass,x+side*.64,y+.3,z+facing*1.6,.045,.46,.045);
    a.part(parent,a.brass,x+1.9,y+1.17,z-.3,.04,2.1,.04,cylinder);
    a.part(parent,linen,x+1.9,y+2.18,z-.3,.41,.44,.41,cone);
    a.part(parent,a.warm,x+1.9,y+2.01,z-.3,.3,.045,.3,cylinder);
  }
  for(let level=0;level<stories;level++){
    const y=base+level*floorHeight,setback=setbacks[level],ww=w-setback*2,dd=d-setback*1.1,zz=-setback*.55;
    // Structural slabs, rear wall and side reveals enclose a genuinely open room.
    a.roundedPart(group,a.stone,0,y,zz,ww+1,.38,dd+1,2.3);
    a.roundedPart(group,a.wood,0,y+.23,zz,ww-1.5,.055,dd-1.5,1.6);
    a.roundedPart(group,ceiling,0,y+floorHeight-.22,zz,ww-.65,.12,dd-.65,1.8);
    a.part(group,innerWall,0,y+floorHeight/2,zz-dd/2+.3,ww-.7,floorHeight-.4,.45);
    for(const side of [-1,1]){
      a.part(group,a.stone,side*(ww/2-.2),y+floorHeight/2,zz-dd/2+.4,.5,floorHeight,.8);
      a.part(group,a.stone,side*(ww/2-.1),y+floorHeight/2,zz+dd/2-.6,.7,floorHeight,1.35);
      a.part(group,a.brass,side*(ww/2-.54),y+floorHeight/2,zz+dd/2+.11,.075,floorHeight,.12);
      a.part(group,sideGlazing,side*(ww/2+.015),y+floorHeight/2,zz,.04,floorHeight-.36,dd-1.8);
      for(let z=-dd/2+2.6;z<dd/2-1;z+=2.8)a.part(group,a.brass,side*(ww/2+.08),y+floorHeight/2,zz+z,.1,floorHeight-.3,.075);
      a.part(group,a.brass,side*(ww/2+.08),y+1.28,zz,.1,.065,dd-1.65);
    }
    // Full height panes carry real reflections while retaining views into rooms.
    const pane=a.part(group,window,0,y+floorHeight/2,zz+dd/2+.015,ww-1.1,floorHeight-.4,.045);pane.renderOrder=2;
    for(let x=-ww/2+2.7;x<ww/2-1;x+=2.8){a.part(group,a.brass,x,y+floorHeight/2,zz+dd/2+.065,.085,floorHeight-.35,.11);}
    a.part(group,a.brass,0,y+1.25,zz+dd/2+.06,ww-.8,.055,.085);
    a.roundedPart(group,a.stone,0,y+floorHeight,zz,ww+1.25,.48,dd+1.25,2.5);
    a.roundedPart(group,a.warm,0,y+floorHeight-.2,zz,ww+1.28,.045,dd+1.28,2.5);
    for(const side of [-1,1]){
      const x=side*ww*.26;
      furniture(group,x,y+.22,zz+dd*.03,level);
      // Recessed shelving and books are decorative, with no fictional offers.
      for(let shelf=0;shelf<3;shelf++){
        const yy=y+1.3+shelf*1.1;
        a.part(group,a.wood,x,yy,zz-dd/2+.8,ww*.35,.12,.8);
        a.part(group,a.warm,x,yy-.1,zz-dd/2+1.2,ww*.32,.025,.04);
        if(!lite)for(let item=0;item<4;item++)a.part(group,item%2?linen:dark,x-ww*.1+item*.62,yy+.29,zz-dd/2+.8,.21,.42+(item%2)*.2,.34);
      }
    }
    if(level===stories-1||setbacks[level+1]>setback){
      // Planters sit on the exposed slab, with foliage behind a glass balustrade.
      const finalRoof=level===stories-1;
      const thisEdge=zz+dd/2,nextEdge=d/2-(setbacks[level+1]||0)*1.1;
      const planterDepth=finalRoof?2:Math.max(.45,thisEdge-nextEdge-.25);
      const planterZ=finalRoof?zz+dd*.31:(thisEdge+nextEdge)/2;
      for(const side of [-1,1]){
        a.roundedPart(group,a.stone,side*ww*.33,y+floorHeight+.38,planterZ,ww*.2,.66,planterDepth,Math.min(.55,planterDepth*.4));
        for(let i=0;i<3;i++)a.tree(group,side*ww*.33+(i-1)*1.5,planterZ,finalRoof?.3+(i%2)*.08:Math.min(.25,planterDepth/3),y+floorHeight+.72);
      }
    }
  }
  // A solid pale frame surrounds the portrait catalog screen instead of an
  // office tower behind a freestanding billboard.
  const screenY=h+7.4;
  for(const side of [-1,1])a.part(group,a.stone,side*5.5,screenY,front+.65,.8,13.6,1.3);
  for(const side of [-1,1])a.part(group,a.stone,0,screenY+side*6.65,front+.65,11.8,.8,1.3);
  a.part(group,a.warm,0,screenY+6.21,front+1.3,10.2,.045,.08);
  a.roundedPart(group,a.stone,0,top+.4,-setbacks.at(-1)*.55,w-setbacks.at(-1)*2+1.6,.7,d-setbacks.at(-1)*1.1+1.6,2.5);
  const signWidth=w*.74;
  a.textSign(group,label,{width:signWidth,height:2.1,y:top-1.1,z:front-setbacks.at(-1)*1.1+.42,subtitle:''});
  if(style==='botanical'){
    for(const side of [-1,1])a.part(group,a.brass,side*w*.33,top+1.6,-d*.25,.12,2.8,.12);
    for(let x=-w*.36;x<=w*.36;x+=1.05)a.part(group,a.wood,x,top+3,-d*.22,.12,.2,d*.48);
  }else if(style==='country'){
    a.roundedPart(group,a.wood,w*.2,top+1.1,-d*.15,w*.45,.32,d*.5,1.2);
  }else if(style==='creative'){
    a.part(group,a.brass,w*.38,top*.55,-d*.17,.26,top*1.07,.3);
  }
  return style;
}
