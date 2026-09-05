import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const admin=readFileSync(new URL('../public/admin-vitrine-ads.html',import.meta.url),'utf8');
const shop=readFileSync(new URL('../public/loja.html',import.meta.url),'utf8');
const globalBanner=readFileSync(new URL('../public/global-market-banner.js',import.meta.url),'utf8');
const outdoor=readFileSync(new URL('../public/market-outdoor.js',import.meta.url),'utf8');

for(const text of ['Aprovar','Recusar','Pausar','Cidade','Categoria','Slots','Agenda','Pesos do ranking','Auditoria','Impressões','Cliques','Conversões'])assert.match(admin,new RegExp(text));
assert.match(admin,/\/api\/admin\/vitrine-ads/);
assert.match(admin,/same-origin/);
assert.match(shop,/\/api\/marketplace\/sponsored/);
assert.match(shop,/>Patrocinado</);
assert.match(shop,/rel="nofollow sponsored"/);
assert.match(shop,/sponsoredProducts.*products|products.*sponsoredProducts/s);
assert.match(globalBanner,/vc-paid-sponsor-strip/);
assert.match(globalBanner,/Publicidade paga/);
assert.match(globalBanner,/nofollow sponsored/);
assert.match(outdoor,/Publicidade · Link de afiliado/);
assert.match(outdoor,/kind:'feature'/);
assert.doesNotMatch(outdoor,/rel='nofollow sponsored'/);
assert.doesNotMatch(globalBanner,/item\.institutional.*sponsored/);

console.log('vitrine-ads-ui: ok');
