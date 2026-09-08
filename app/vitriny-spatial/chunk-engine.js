function finite(value,label){const n=Number(value);if(!Number.isFinite(n))throw new Error(`${label} inválido.`);return n;}
function integer(value,min,max,label){const n=Math.trunc(finite(value,label));if(n<min||n>max)throw new Error(`${label} fora do limite.`);return n;}

export function chunkCoords(position,{chunkSize=128}={}){
  const size=integer(chunkSize,16,2048,'chunkSize');
  const x=finite(position?.x,'x'),z=finite(position?.z,'z');
  return {x:Math.floor(x/size),z:Math.floor(z/size),chunkSize:size};
}

export function chunkId(worldKey,coords){
  const world=String(worldKey||'root').replace(/[^a-z0-9:_-]/gi,'').slice(0,180)||'root';
  return `${world}@${Math.trunc(coords.x)},${Math.trunc(coords.z)}`;
}

export function desiredChunkSet(position,{worldKey='root',chunkSize=128,radius=1,ahead=null}={}){
  const center=chunkCoords(position,{chunkSize}),r=integer(radius,0,5,'radius'),ids=new Set();
  for(let dx=-r;dx<=r;dx++)for(let dz=-r;dz<=r;dz++)ids.add(chunkId(worldKey,{x:center.x+dx,z:center.z+dz}));
  if(ahead&&Number.isFinite(Number(ahead.x))&&Number.isFinite(Number(ahead.z))){
    const look=chunkCoords({x:Number(position.x)+Number(ahead.x)*chunkSize,z:Number(position.z)+Number(ahead.z)*chunkSize},{chunkSize});
    ids.add(chunkId(worldKey,look));
  }
  return {center,ids};
}

export function diffChunks(current,desired){
  const currentSet=current instanceof Set?current:new Set(current||[]),desiredSet=desired instanceof Set?desired:new Set(desired||[]);
  return {
    load:[...desiredSet].filter(id=>!currentSet.has(id)),
    unload:[...currentSet].filter(id=>!desiredSet.has(id)),
    keep:[...desiredSet].filter(id=>currentSet.has(id))
  };
}

export function createChunkEngine({chunkSize=128,radius=1,maxLoaded=36}={}){
  const loaded=new Map();
  const size=integer(chunkSize,16,2048,'chunkSize'),defaultRadius=integer(radius,0,5,'radius'),limit=integer(maxLoaded,1,256,'maxLoaded');
  async function update({position,worldKey='root',ahead=null,loadChunk,unloadChunk}={}){
    if(typeof loadChunk!=='function'||typeof unloadChunk!=='function')throw new TypeError('Chunk engine requer loadChunk e unloadChunk.');
    const desired=desiredChunkSet(position,{worldKey,chunkSize:size,radius:defaultRadius,ahead}),changes=diffChunks(new Set(loaded.keys()),desired.ids);
    for(const id of changes.unload){try{await unloadChunk(id,loaded.get(id));}finally{loaded.delete(id);}}
    for(const id of changes.load){
      if(loaded.size>=limit)break;
      const resource=await loadChunk(id);loaded.set(id,resource??true);
    }
    return {center:desired.center,loaded:[...loaded.keys()],...changes};
  }
  async function clear(unloadChunk=async()=>{}){for(const [id,resource] of loaded){await unloadChunk(id,resource);loaded.delete(id);}return true;}
  return {update,clear,status:()=>({chunkSize:size,radius:defaultRadius,maxLoaded:limit,loaded:[...loaded.keys()]})};
}
