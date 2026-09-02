import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const admin=readFileSync(new URL('../public/admin-vitrine-ads.html',import.meta.url),'utf8');
const shop=readFileSync(new URL('../public/loja.html',import.meta.url),'utf8');
const globalBanner=readFileSync(new URL('../public/global-market-banner.js',import.meta.url),'utf8');

for(const text of ['Aprovar','Recusar','Pausar','Cidade','Categoria','Slots','Agenda','Pesos do ranking','Auditoria','Impressões','Cliques','Conversões'])assert.match(admin,new RegExp(text));
assert.match(admin,/\/api\/admin\/vitrine-ads/);
assert.match(admin,/same-origin/);
assert.match(shop,/\/api\/marketplace\/sponsored/);
assert.match(shop,/>Patrocinado</);
assert.match(shop,/rel="nofollow sponsored"/);
assert.match(shop,/sponsoredProducts.*products|products.*sponsoredProducts/s);
assert.match(globalBanner,/VitrineCity oficial/);
assert.match(globalBanner,/vc-institutional-footer/);
assert.match(globalBanner,/item\.kind==='service'\|\|item\.kind==='course'/);
assert.doesNotMatch(globalBanner,/item\.institutional.*sponsored/);

console.log('vitrine-ads-ui: ok');
