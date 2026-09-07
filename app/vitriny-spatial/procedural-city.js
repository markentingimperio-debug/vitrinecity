import {createHash} from 'node:crypto';

const TEMPLATES=Object.freeze({
  retail:{width:[12,24],depth:[10,20],height:[8,22]},
  food:{width:[10,20],depth:[10,18],height:[7,16]},
  office:{width:[16,30],depth:[14,26],height:[18,52]},
  entertainment:{width:[22,42],depth:[20,40],height:[14,32]},
  education:{width:[20,36],depth:[18,34],height:[12,28]},
  services:{width:[12,26],depth:[12,24],height:[10,26]},
  residential:{width:[14,28],depth:[14,26],height:[14,44]}
});

function rng(seed){
  let x=parseInt(createHash('sha256').update(String(seed)).digest('hex').slice(0,8),16)>>>0;
  return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296;};
}
function between(random,[min,max]){return min+(max-min)*random();}
function category(value){const key=String(value||'retail').toLowerCase();return Object.hasOwn(TEMPLATES,key)?key:'retail';}

export function buildingTemplate(kind='retail'){return TEMPLATES[category(kind)];}

export function generateBuilding({id,kind='retail',seed='vitriny',lot={x:0,z:0,width:28,depth:28},storeId=null,label=''}={}){
  const random=rng(`${seed}:${id}:${kind}`),template=buildingTemplate(kind);
  const margin=2+random()*3,width=Math.min(Number(lot.width)||28,between(random,template.width)),depth=Math.min(Number(lot.depth)||28,between(random,template.depth));
  const height=between(random,template.height),floors=Math.max(1,Math.round(height/3.4));
  return Object.freeze({
    id:String(id),kind:category(kind),storeId:storeId==null?null:String(storeId),label:String(label||id).slice(0,100),
    position:{x:Number(lot.x)||0,y:0,z:Number(lot.z)||0},size:{width:Math.max(4,width-margin),depth:Math.max(4,depth-margin),height},floors,
    facadeVariant:Math.floor(random()*6),roofVariant:Math.floor(random()*4),windowDensity:Number((.35+random()*.5).toFixed(2)),
    emissiveAccent:Number((.08+random()*.28).toFixed(2))
  });
}

export function generateBlock({worldKey='root',chunkX=0,chunkZ=0,chunkSize=128,grid=3,seed='vitriny',mix=['retail','food','office','services']}={}){
  const count=Math.max(1,Math.min(6,Math.trunc(grid)||3)),cell=chunkSize/count,buildings=[];
  for(let gx=0;gx<count;gx++)for(let gz=0;gz<count;gz++){
    const id=`${worldKey}:${chunkX}:${chunkZ}:${gx}:${gz}`,random=rng(`${seed}:${id}`),kind=mix[Math.floor(random()*mix.length)]||'retail';
    const lot={x:chunkX*chunkSize+gx*cell+cell/2,z:chunkZ*chunkSize+gz*cell+cell/2,width:cell*.82,depth:cell*.82};
    buildings.push(generateBuilding({id,kind,seed,lot,label:`Vitriny ${kind}`}));
  }
  return {worldKey,chunkX,chunkZ,chunkSize,buildings};
}

export const spatialBuildingTemplates=TEMPLATES;
