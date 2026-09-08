import assert from 'node:assert/strict';
import {loadPremiumZoneAssignments,publicPremiumZoneAssignments,resolvePremiumZoneSlots,sanitizePremiumZoneAssignment} from '../vitriny-spatial/premium-zone-registry.js';

const now=Date.parse('2026-09-08T12:00:00Z');
const approved=sanitizePremiumZoneAssignment({
  slotId:'premium:vitrine-city:1',districtId:'commerce',status:'active',sponsor:'Loja Jardim',campaignRef:'campaign:123',approved:true,
  startsAt:'2026-09-08T00:00:00Z',endsAt:'2026-09-09T00:00:00Z'
},{now});
assert.equal(approved.status,'active');assert.equal(approved.sponsor,'Loja Jardim');assert.equal(approved.campaignRef,'campaign:123');assert.equal(approved.approved,true);
const approvedAgain=sanitizePremiumZoneAssignment(approved,{now});
assert.equal(approvedAgain.status,'active');assert.equal(approvedAgain.sponsor,'Loja Jardim');assert.equal(approvedAgain.approved,true);

const pending=sanitizePremiumZoneAssignment({slotId:'premium:vitrine-city:2',districtId:'social',status:'active',sponsor:'Marca X',approved:false},{now});
assert.equal(pending.status,'reserved');assert.equal(pending.sponsor,'');assert.equal(pending.approved,false);
const expired=sanitizePremiumZoneAssignment({slotId:'premium:vitrine-city:3',districtId:'food',status:'active',sponsor:'Marca Y',approved:true,endsAt:'2026-09-07T00:00:00Z'},{now});
assert.equal(expired.status,'reserved');
assert.equal(sanitizePremiumZoneAssignment({slotId:'premium:missing:1',districtId:'food',status:'active',approved:true},{now}),null);
assert.equal(sanitizePremiumZoneAssignment({slotId:'premium:vitrine-city:1',districtId:'private',status:'active',approved:true},{now}),null);

const loaded=loadPremiumZoneAssignments({now,env:{VITRINY_SPATIAL_PREMIUM_ZONES_JSON:JSON.stringify([
  {slotId:'premium:vitrine-city:1',districtId:'commerce',status:'active',sponsor:'Loja Jardim',approved:true},
  {slotId:'premium:vitrine-city:2',districtId:'social',status:'reserved'},
  {slotId:'premium:goiania:1',districtId:'business',status:'active',sponsor:'Empresa GO',approved:true}
])}});
assert.equal(loaded.length,3);assert.equal(loaded[0].approved,true);
assert.equal(loadPremiumZoneAssignments({env:{VITRINY_SPATIAL_PREMIUM_ZONES_JSON:'{'},now}).length,0);

const base=[
  {slotId:'premium:vitrine-city:1',districtId:'commerce',status:'available',sponsor:'',position:{x:1,y:0,z:2}},
  {slotId:'premium:vitrine-city:2',districtId:'social',status:'available',sponsor:'',position:{x:2,y:0,z:3}}
];
const resolved=resolvePremiumZoneSlots('vitrine-city',base,{assignments:loaded,now});
assert.equal(resolved[0].status,'active');assert.equal(resolved[0].sponsor,'Loja Jardim');assert.equal(resolved[1].status,'reserved');
const publicGoiania=publicPremiumZoneAssignments('goiania',{assignments:loaded,now});
assert.equal(publicGoiania[0].sponsor,'Empresa GO');assert.equal(Object.hasOwn(publicGoiania[0],'approved'),false);
assert.throws(()=>resolvePremiumZoneSlots('missing',base,{assignments:loaded,now}),/city_not_found/);

console.log(JSON.stringify({ok:true,assignments:loaded.length,active:resolved.filter(item=>item.status==='active').length,renormalization:true}));
