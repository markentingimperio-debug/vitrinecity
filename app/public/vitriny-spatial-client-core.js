const WORLD=/^[a-z0-9:_-]{1,180}$/i;

function finite(value,label){const n=Number(value);if(!Number.isFinite(n))throw new Error(`${label} inválido.`);return n;}
function integer(value,min,max,label){const n=Math.trunc(finite(value,label));if(n<min||n>max)throw new Error(`${label} fora do limite.`);return n;}
function hash32(input){let h=2166136261>>>0;for(const ch of String(input)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
function rng(seed){let x=hash32(seed)||0x9e3779b9;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296;};}

export function spatialChunkCoords(position,{chunkSize=128}={}){
  const size=integer(chunkSize,16,2048,'chunkSize');
  return{x:Math.floor(finite(position?.x,'x')/size),z:Math.floor(finite(position?.z,'z')/size),chunkSize:size};
}

export function spatialChunkId(worldKey,coords){
  const world=String(worldKey||'root').replace(/[^a-z0-9:_-]/gi,'').slice(0,180)||'root';
  if(!WORLD.test(world))throw new Error('worldKey inválido.');
  return`${world}@${Math.trunc(coords.x)},${Math.trunc(coords.z)}`;
}

export function desiredSpatialChunks(position,{worldKey='br:go:vitrine-city',chunkSize=128,radius=1,ahead=null}={}){
  const center=spatialChunkCoords(position,{chunkSize}),r=integer(radius,0,4,'radius'),ids=new Set();
  for(let dx=-r;dx<=r;dx++)for(let dz=-r;dz<=r;dz++)ids.add(spatialChunkId(worldKey,{x:center.x+dx,z:center.z+dz}));
  if(ahead&&Number.isFinite(Number(ahead.x))&&Number.isFinite(Number(ahead.z))){
    const look=spatialChunkCoords({x:Number(position.x)+Number(ahead.x)*chunkSize,z:Number(position.z)+Number(ahead.z)*chunkSize},{chunkSize});
    ids.add(spatialChunkId(worldKey,look));
  }
  return{center,ids};
}

export function diffSpatialChunks(current,desired){
  const a=current instanceof Set?current:new Set(current||[]),b=desired instanceof Set?desired:new Set(desired||[]);
  return{load:[...b].filter(id=>!a.has(id)),unload:[...a].filter(id=>!b.has(id)),keep:[...b].filter(id=>a.has(id))};
}

export function parseSpatialChunkId(id){
  const match=String(id||'').match(/^([a-z0-9:_-]{1,180})@(-?\d+),(-?\d+)$/i);if(!match)throw new Error('Chunk id inválido.');
  return{worldKey:match[1],x:Number(match[2]),z:Number(match[3])};
}

export function generateSpatialChunk(id,{chunkSize=128,grid=3,seed='vitriny'}={}){
  const parsed=parseSpatialChunkId(id),size=integer(chunkSize,16,2048,'chunkSize'),cells=integer(grid,1,5,'grid'),cell=size/cells,buildings=[];
  const kinds=['retail','food','office','services','education','entertainment'];
  for(let gx=0;gx<cells;gx++)for(let gz=0;gz<cells;gz++){
    const key=`${seed}:${id}:${gx}:${gz}`,random=rng(key),kind=kinds[Math.floor(random()*kinds.length)],margin=cell*(.12+random()*.12);
    const width=Math.max(8,cell-margin),depth=Math.max(8,cell-margin),height=8+random()*42;
    buildings.push({id:`${id}:${gx}:${gz}`,kind,position:{x:parsed.x*size+gx*cell+cell/2,y:0,z:parsed.z*size+gz*cell+cell/2},size:{width,depth,height},accentIndex:Math.floor(random()*8),detail:random()});
  }
  return{id,worldKey:parsed.worldKey,x:parsed.x,z:parsed.z,chunkSize:size,buildings};
}

export function createSpatialClientRuntime({worldKey='br:go:vitrine-city',chunkSize=128,radius=1,maxLoaded=25,loader=generateSpatialChunk,onUnload=()=>{}}={}){
  const loaded=new Map(),limit=integer(maxLoaded,1,100,'maxLoaded');
  async function update(position,ahead=null){
    const desired=desiredSpatialChunks(position,{worldKey,chunkSize,radius,ahead}),changes=diffSpatialChunks(new Set(loaded.keys()),desired.ids);
    for(const id of changes.unload){const resource=loaded.get(id);try{await onUnload(id,resource);}finally{loaded.delete(id);}}
    for(const id of changes.load){if(loaded.size>=limit)break;loaded.set(id,await loader(id,{chunkSize}));}
    return{center:desired.center,changes,loaded:[...loaded.keys()],resources:[...loaded.values()]};
  }
  async function clear(){for(const [id,resource] of loaded){await onUnload(id,resource);loaded.delete(id);}return true;}
  return{update,clear,status:()=>({worldKey,chunkSize,radius,maxLoaded:limit,loaded:[...loaded.keys()]})};
}
