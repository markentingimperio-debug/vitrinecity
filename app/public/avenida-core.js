import {normalizeSpatialStore} from './vitriny-spatial-store-registry.js';

export function normalizeAvenueStores(market=[],maps=[]){
  const byReference=new Map();
  for(const raw of [...maps,...market]){
    const store=normalizeSpatialStore(raw);
    if(store)byReference.set(store.reference,store);
  }
  return [...byReference.values()].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
}

export function filterAvenueStores(stores,query){
  const words=String(query||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').trim().split(/\s+/).filter(Boolean);
  return stores.filter(store=>{
    const haystack=[store.name,store.description,store.city,store.state,store.kind].join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
    return words.every(word=>haystack.includes(word));
  });
}
