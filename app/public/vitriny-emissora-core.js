// A public editorial destination. The mast is architecture, not a live status.
export const EMISSORA_BUILDING=Object.freeze({
  reference:'vitrinecity-emissora',label:'Emissora VitrineCity',href:'/emissora',
  position:Object.freeze({x:50,y:0,z:230}),rotation:Math.PI,
  size:Object.freeze({width:58,depth:54}),
  entrance:Object.freeze({x:0,y:2,z:20})
});

export function intersectsEmissoraLot(building){
  const {position,size}=building||{},lot=EMISSORA_BUILDING;
  if(!position||!size||![position.x,position.z,size.width,size.depth].every(Number.isFinite)||size.width<=0||size.depth<=0)return false;
  return Math.abs(position.x-lot.position.x)<size.width/2+lot.size.width/2+4
    &&Math.abs(position.z-lot.position.z)<size.depth/2+lot.size.depth/2+4;
}
