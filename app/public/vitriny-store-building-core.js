// Architectural presentation only. A building always retains its store's real destination.
export function storeBuildingIdentity(name='') {
  const label=String(name).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if(label.includes('agrotec'))return {style:'botanical',name:'AGROTÉCNICA',subtitle:'AGRO · CASA · JARDIM',towerHeight:27};
  if(label.includes('sertanej'))return {style:'country',name:'SERTANEJA',subtitle:'MODA COUNTRY',towerHeight:24};
  if(/educ|curso|escola/.test(label))return {style:'learning',name:'CENTRO EDUCACIONAL',subtitle:'VITRINECITY',towerHeight:35};
  if(/beemi|agencia|criador/.test(label))return {style:'creative',name:label.includes('beemi')?'BEEMI':String(name),subtitle:'',towerHeight:30};
  return {style:'gallery',name:String(name),subtitle:'',towerHeight:26};
}

// Four stores line the main avenue. Later stores occupy individual, spaced lots in
// the retail district, rather than sharing or overlapping another store's building.
export function arrangeStoreBuildings(entities=[]) {
  const unique=new Map();
  for(const entity of entities)if(entity?.reference&&!unique.has(entity.reference))unique.set(entity.reference,entity);
  return [...unique.values()].sort((a,b)=>a.reference.localeCompare(b.reference)).map((source,index)=>({
    ...source,
    position:{...source.position,x:index<4?-126:180+Math.floor((index-4)/4)*64,y:0,z:index<4?[145,13,75,-51][index]:-160+((index-4)%4)*64},
    size:{...source.size,width:24,depth:18,height:9},
    buildingIdentity:storeBuildingIdentity(source.name)
  }));
}

export function intersectsStoreBuilding(building,store) {
  if(!building?.position||!building?.size||!store?.position||!store?.size)return false;
  // Store fronts face west; swap depth and width in the world footprint and allow landscaping.
  return Math.abs(building.position.x-store.position.x)<building.size.width/2+store.size.depth/2+4
    &&Math.abs(building.position.z-store.position.z)<building.size.depth/2+store.size.width/2+4;
}
