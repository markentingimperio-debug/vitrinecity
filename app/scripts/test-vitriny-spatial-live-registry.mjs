import assert from 'node:assert/strict';
import {fetchSpatialProfiles,fetchSpatialPromotions,mapProfilesToSpatialEntities,mapPromotionsToSpatialEntities,normalizeSpatialProfile,normalizeSpatialPromotion,spatialDistrictOrigins} from '../public/vitriny-spatial-live-registry.js';

const profile=normalizeSpatialProfile({id:7,handle:'Maria.Plantas',name:'Maria',bio:'Jardinagem',city:'Anápolis',followers:120});
assert.equal(profile.href,'/perfil/maria.plantas');
assert.equal(profile.district,'social');
assert.equal(profile.followers,120);
assert.equal(normalizeSpatialProfile({id:'x',handle:'a',name:'b'}),null);
const profiles=mapProfilesToSpatialEntities([{id:2,handle:'b',name:'B',followers:5},{id:1,handle:'a',name:'A',followers:50}],{limit:10});
assert.equal(profiles.length,2);
assert.equal(profiles[0].handle,'a');
assert.equal(new Set(profiles.map(item=>`${item.position.x}:${item.position.z}`)).size,2);
assert.ok(spatialDistrictOrigins.social);

const course=normalizeSpatialPromotion({kind:'course',title:'Curso de Plantas',description:'Aprenda',amountCents:2399,url:'/centro-educacional.html#curso'});
assert.equal(course.district,'education');
const service=normalizeSpatialPromotion({kind:'service',title:'Site Express',amountCents:9900,url:'/servicos-digitais.html?servico=site'});
assert.equal(service.district,'services');
assert.equal(normalizeSpatialPromotion({kind:'product',title:'Produto',url:'/produto/1/x'}),null);
assert.equal(normalizeSpatialPromotion({kind:'service',title:'Perigoso',url:'/checkout/agora'}),null);
const promotions=mapPromotionsToSpatialEntities([course,service].map(item=>({kind:item.entityType,title:item.title,description:item.description,amountCents:item.amountCents,url:item.href})),{limitPerDistrict:5});
assert.equal(promotions.length,2);
assert.deepEqual(new Set(promotions.map(item=>item.district)),new Set(['education','services']));

const fetchedProfiles=await fetchSpatialProfiles({limit:1,fetchImpl:async()=>new Response(JSON.stringify({suggestions:[{id:1,handle:'ana',name:'Ana',followers:3}]}),{status:200,headers:{'content-type':'application/json'}})});
assert.equal(fetchedProfiles.length,1);
const fetchedPromotions=await fetchSpatialPromotions({fetchImpl:async()=>new Response(JSON.stringify({items:[{kind:'course',title:'Curso A',url:'/centro-educacional.html#curso-a'},{kind:'service',title:'Serviço A',url:'/servicos-digitais.html?servico=a'}]}),{status:200,headers:{'content-type':'application/json'}})});
assert.equal(fetchedPromotions.length,2);
await assert.rejects(()=>fetchSpatialProfiles({fetchImpl:async()=>new Response('{}',{status:500})}),/spatial_profiles_500/);
await assert.rejects(()=>fetchSpatialPromotions({fetchImpl:async()=>new Response('{}',{status:503})}),/spatial_promotions_503/);

console.log(JSON.stringify({ok:true,profiles:profiles.length,promotions:promotions.length}));
