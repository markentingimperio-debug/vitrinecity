import assert from 'node:assert/strict';
import {SPATIAL_WORLD_KEY,createSpatialReturnState,encodeSpatialReturnState,explorerReturnHref,isSafeInternalHref,isSafeSpatialPath,parseSpatialReturnState,storeInteriorHref} from '../public/vitriny-spatial-session.js';

const now=Date.parse('2026-09-07T18:00:00.000Z');
const state=createSpatialReturnState({spatialPath:'/v/br/go/vitrine-city/commerce/ref-1',districtId:'commerce',targetType:'store',targetId:'ref-1',position:{x:123.4,y:1.7,z:-44.2},yaw:3.1,pitch:-.2,createdAt:new Date(now)});
assert.equal(state.worldKey,SPATIAL_WORLD_KEY);
assert.equal(state.targetType,'store');
assert.equal(state.position.x,123.4);
assert.equal(parseSpatialReturnState(encodeSpatialReturnState(state),{now})?.targetId,'ref-1');
assert.equal(parseSpatialReturnState({...state,createdAt:'2026-09-07T10:00:00.000Z'},{now,maxAgeMs:60*60*1000}),null);
assert.equal(parseSpatialReturnState({...state,spatialPath:'/v/br/go/vitrine-city/admin'},{now}),null);
assert.equal(isSafeSpatialPath('/v/br/go/vitrine-city/social'),true);
assert.equal(isSafeSpatialPath('/v/br/go/vitrine-city/admin'),false);
assert.equal(isSafeInternalHref('/loja/ref-1/minha-loja'),true);
assert.equal(isSafeInternalHref('//evil.example'),false);
assert.equal(isSafeInternalHref('/pagamento.html'),false);
assert.equal(storeInteriorHref('ref 1','Café Árvore'),'/vitriny-store-interior.html?store=ref+1&name=Caf%C3%A9+%C3%81rvore');
assert.equal(explorerReturnHref(),'/vitriny-multiverse-explore.html?return=1');

console.log(JSON.stringify({ok:true,world:state.worldKey,returnHref:explorerReturnHref()}));
