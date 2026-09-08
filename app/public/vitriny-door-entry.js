// Entry requires an actual walking step across the front of a door.
// Loading, camera jumps and returning from a shop do not trigger navigation.
export function createDoorEntryTracker(){
  let previous=null;
  return {reset(){previous=null;},step({position,moving,enabled,doors}){
    const before=previous;previous={x:position.x,y:position.y,z:position.z};
    if(!before||!enabled||!moving)return null;
    const distance=Math.hypot(position.x-before.x,position.z-before.z);
    if(distance<.001||distance>2)return null;
    for(const door of doors){
      if(!door.normal||!door.href)continue;
      const {anchor,normal}=door,dx=position.x-anchor.x,dz=position.z-anchor.z;
      if(Math.abs(position.y-anchor.y)>4||Math.hypot(dx,dz)>6)continue;
      const front=dx*normal.x+dz*normal.z,priorFront=(before.x-anchor.x)*normal.x+(before.z-anchor.z)*normal.z,lateral=dx*normal.z-dz*normal.x;
      if(priorFront>2&&front<=2&&front>=0&&Math.abs(lateral)<3)return door;
    }
    return null;
  }};
}
