import assert from 'node:assert/strict';
import {normalizeEntertainmentPost,mapEntertainmentToSpatialEntities,fetchSpatialEntertainment} from '../public/vitriny-spatial-entertainment-registry.js';

const raw=[
  {id:'p2',caption:'Vídeo dois',mediaType:'video',views:500,engagement:40,author:{handle:'criador-b'}},
  {id:'p1',caption:'Vídeo um',mediaType:'video',views:1200,engagement:90,author:{handle:'criador-a'}},
  {id:'',caption:''}
];
const normalized=normalizeEntertainmentPost(raw[0]);
assert.equal(normalized.entityType,'entertainment');
assert.equal(normalized.href,'/perfil/criador-b');
assert.equal(normalized.views,500);
assert.equal(normalizeEntertainmentPost({}),null);
const mapped=mapEntertainmentToSpatialEntities(raw,{limit:10});
assert.equal(mapped.length,2);
assert.equal(mapped[0].postId,'p1');
assert.equal(new Set(mapped.map(item=>`${item.position.x}:${item.position.z}`)).size,2);
let called=0;
const fetched=await fetchSpatialEntertainment({limit:1,fetchImpl:async(url,options)=>{called++;assert.equal(url,'/api/social/feed?limit=30');assert.equal(options.headers.accept,'application/json');return new Response(JSON.stringify({items:raw}),{status:200,headers:{'content-type':'application/json'}});}});
assert.equal(called,1);assert.equal(fetched.length,1);assert.equal(fetched[0].postId,'p1');
await assert.rejects(()=>fetchSpatialEntertainment({fetchImpl:async()=>new Response('{}',{status:503})}),/spatial_entertainment_503/);
console.log(JSON.stringify({ok:true,entities:mapped.length,first:mapped[0].href}));
