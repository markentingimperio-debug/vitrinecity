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
  assert.ok(['bridge','spatial-live'].includes(item.mode));
  assert.equal(item.href.startsWith('/'),true);
  assert.equal(item.href.startsWith('//'),false);
  assert.equal(item.fallbackHref.startsWith('/'),true);
  assert.equal(isSafeDistrictHref(item.href),true);
  assert.equal(isSafeDistrictHref(item.fallbackHref),true);
  assert.equal(districtExperience(item.id),item);
  assert.equal(safeDistrictHref(item.id),item.href);
  const lower=item.href.toLowerCase();
  assert.equal(districtIntegrationBlockedPrefixes.some(prefix=>lower===prefix||lower.startsWith(prefix+'/')||lower.startsWith(prefix+'.')),false);
}

assert.equal(districtExperience('commerce').href,'/loja.html');
assert.equal(districtExperience('social').href,'/vitriny-multiverse-district.html?district=social');
assert.equal(districtExperience('social').fallbackHref,'/social.html');
assert.equal(districtExperience('creator').href,'/vitriny-multiverse-creator.html');
assert.equal(districtExperience('creator').fallbackHref,'/afiliados.html');
assert.equal(districtExperience('creator').mode,'spatial-live');
assert.equal(districtExperience('education').href,'/vitriny-multiverse-district.html?district=education');
assert.equal(districtExperience('education').fallbackHref,'/centro-educacional.html');
assert.equal(districtExperience('services').mode,'spatial-live');
assert.equal(districtExperience('food').href,'/vitriny-multiverse-food.html');
assert.equal(districtExperience('food').fallbackHref,'/cidade.html');
assert.equal(districtExperience('food').mode,'spatial-live');
assert.equal(districtExperience('business').href,'/vitriny-multiverse-business.html');
assert.equal(districtExperience('business').fallbackHref,'/para-empresas.html');
assert.equal(districtExperience('business').mode,'spatial-live');
assert.equal(districtExperience('entertainment').href,'/vitriny-multiverse-entertainment.html');
assert.equal(districtExperience('entertainment').fallbackHref,'/passeio-virtual.html');
assert.equal(districtExperience('entertainment').mode,'spatial-live');
assert.equal(districtExperience('commerce').mode,'bridge');
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

console.log(JSON.stringify({ok:true,districts:DISTRICT_INTEGRATIONS.length,live:DISTRICT_INTEGRATIONS.filter(item=>item.mode==='spatial-live').map(item=>item.id)}));
