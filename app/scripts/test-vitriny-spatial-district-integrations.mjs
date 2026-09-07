import assert from 'node:assert/strict';
import {
  DISTRICT_INTEGRATIONS,districtExperience,safeDistrictHref,isSafeDistrictHref,
  districtIntegrationBlockedPrefixes,centralPlazaLayout
} from '../vitriny-spatial/index.js';

assert.equal(DISTRICT_INTEGRATIONS.length,8);
assert.equal(new Set(DISTRICT_INTEGRATIONS.map(item=>item.id)).size,8);
assert.equal(new Set(DISTRICT_INTEGRATIONS.map(item=>item.spatialPath)).size,8);
assert.equal(new Set(DISTRICT_INTEGRATIONS.map(item=>item.href)).size,8);

for(const item of DISTRICT_INTEGRATIONS){
  assert.equal(item.enabled,true);
  assert.equal(item.mode,'bridge');
  assert.equal(item.href.startsWith('/'),true);
  assert.equal(item.href.startsWith('//'),false);
  assert.equal(isSafeDistrictHref(item.href),true);
  assert.equal(districtExperience(item.id),item);
  assert.equal(safeDistrictHref(item.id),item.href);
  const lower=item.href.toLowerCase();
  assert.equal(districtIntegrationBlockedPrefixes.some(prefix=>lower===prefix||lower.startsWith(prefix+'/')||lower.startsWith(prefix+'.')),false);
}

assert.equal(districtExperience('commerce').href,'/loja.html');
assert.equal(districtExperience('social').href,'/social.html');
assert.equal(districtExperience('education').href,'/centro-educacional.html');
assert.equal(districtExperience('missing'),null);
assert.equal(safeDistrictHref('missing'),null);
assert.equal(isSafeDistrictHref('https://example.com'),false);
assert.equal(isSafeDistrictHref('//example.com'),false);
assert.equal(isSafeDistrictHref('/admin'),false);
assert.equal(isSafeDistrictHref('/checkout/order'),false);

const plaza=centralPlazaLayout();
for(const district of plaza.districts){
  const experience=districtExperience(district.id);
  assert.ok(experience);
  assert.equal(district.path,experience.spatialPath);
  assert.equal(district.experience.href,experience.href);
}

console.log(JSON.stringify({ok:true,districts:DISTRICT_INTEGRATIONS.length,bridges:DISTRICT_INTEGRATIONS.map(item=>({id:item.id,href:item.href}))}));
