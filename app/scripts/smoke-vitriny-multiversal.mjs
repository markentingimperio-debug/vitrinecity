import assert from 'node:assert/strict';

const base=String(process.env.BASE_URL||'http://127.0.0.1:3000').replace(/\/$/,'');
const timeoutMs=Number(process.env.SMOKE_TIMEOUT_MS||8000);

async function request(path,{expectJson=false,expectText=false}={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetch(base+path,{redirect:'manual',cache:'no-store',signal:controller.signal});
    const contentType=response.headers.get('content-type')||'';
    const body=expectJson&&contentType.includes('application/json')?await response.json():expectText?await response.text():null;
    return{response,contentType,body};
  }finally{clearTimeout(timer);}
}

async function expectHtml(path){
  const {response,contentType}=await request(path);
  assert.equal(response.status,200,`${path} retornou ${response.status}`);
  assert.match(contentType,/text\/html/,`${path} não retornou HTML`);
}

for(const path of [
  '/',
  '/pesquisar?q=plantas',
  '/multiverso?city=vitrine-city',
  '/multiverso?city=vianopolis',
  '/vitriny-multiverse-explore.html?city=vitrine-city',
  '/vitriny-multiverse-explore.html?city=vianopolis',
  '/vitriny-multiverse-district.html?city=vitrine-city&district=commerce',
  '/vitriny-multiverse-worlds.html',
  '/entrar-cidade.html',
  '/loja',
  '/centros/mercadolivre',
  '/centros/shopee',
  '/centros/cakto',
  '/centros/kiwify',
  '/centros/tiktok',
  '/musicas',
  '/cinema',
  '/mapa-real.html?cidade=vianopolis'
])await expectHtml(path);

for(const path of [
  '/jogos',
  '/mini-fazenda',
  '/arena-musical',
  '/sala-de-cinema',
  '/meus-creditos',
  '/vitriny-games.html',
  '/vitriny-mini-fazenda.html',
  '/vitriny-music-arena.html',
  '/vitriny-cinema.html',
  '/central-creditos.html'
]){const {response}=await request(path);assert.equal(response.status,302,`${path} deve exigir login`);assert.ok(response.headers.get('location')?.startsWith('/entrar-cidade.html?returnTo='));}
assert.equal((await request('/api/games/farm')).response.status,401,'Progresso de jogo exige conta autenticada');
assert.equal((await request('/api/privacy/communications')).response.status,401,'Preferências de comunicação exigem conta autenticada');
for(const path of ['/api/rewards/me','/api/city-chat/rooms','/api/affiliates/me/products'])assert.equal((await request(path)).response.status,401,path+' exige conta');
for(const scope of ['music','cinema']){const catalog=await request('/api/media/'+scope,{expectJson:true});assert.equal(catalog.response.status,200);assert.ok(Array.isArray(catalog.body.items));assert.ok(catalog.body.items.length<=24);for(const item of catalog.body.items)assert.ok(item.source.embedUrl.startsWith('https://www.youtube-nocookie.com/embed/'));}
const centers=await request('/api/affiliate-centers',{expectJson:true});assert.equal(centers.response.status,200);assert.deepEqual(centers.body.centers.map(center=>center.id),['mercadolivre','shopee','cakto','kiwify','tiktok']);
for(const center of centers.body.centers){const catalog=await request(`/api/affiliate-centers/${center.id}/products`,{expectJson:true});assert.equal(catalog.response.status,200);assert.ok(catalog.body.items.length<=24);assert.ok(catalog.body.items.every(item=>item.platform===center.id&&item.href.startsWith('/ofertas/')));assert.equal((await request(center.logo)).response.status,200);}

const home=await request('/',{expectText:true});assert.equal(home.response.status,200);assert.match(home.body,/vitrinecity-avenida-premium.webp/);assert.match(home.body,/Visite sem cadastro/);assert.match(home.body,/action="\/pesquisar"/);
for(const path of ['/assets/vitrinecity-avenida-premium.webp','/vitriny-city-guide.js','/vitriny-home.css'])assert.equal((await request(path)).response.status,200,path+' disponível');
const availability=await request('/api/marketplace/local-delivery/availability',{expectJson:true});assert.equal(availability.response.status,200);assert.equal(typeof availability.body.enabled,'boolean');assert.deepEqual(Object.keys(availability.body).sort(),['cities','enabled']);
const relatedSearch=await request('/api/discovery/search?q=plantas',{expectJson:true});assert.equal(relatedSearch.response.status,200);assert.ok(relatedSearch.body.contents.some(item=>item.url==='/guias/plantas-em-vasos.html'),'Busca inclui guia publicado da plataforma');

const health=await request('/api/health',{expectJson:true});
assert.equal(health.response.status,200,'/api/health deve responder 200');

const root=await request('/api/spatial/v1',{expectJson:true});
assert.equal(root.response.status,200,'Spatial API root deve responder 200');
assert.equal(root.body?.apiVersion,1);
assert.equal(root.body?.cityCount,5);
assert.ok(root.body?.capabilities?.includes('city-navigation-context'));

const active=await request('/api/spatial/v1/context?city=vitrine-city',{expectJson:true});
assert.equal(active.response.status,200);
assert.equal(active.body?.contextMode,'navigation-only');
assert.equal(active.body?.city?.id,'vitrine-city');
assert.equal(active.body?.city?.status,'active');
assert.equal(active.body?.modules?.every(item=>item.enabled),true);

const preview=await request('/api/spatial/v1/context?city=vianopolis',{expectJson:true});
assert.equal(preview.response.status,200);
assert.equal(preview.body?.contextMode,'navigation-only');
assert.equal(preview.body?.city?.id,'vianopolis');
assert.equal(preview.body?.city?.status,'preview');
assert.equal(preview.body?.capabilities?.social,true);
assert.equal(preview.body?.capabilities?.map,true);
assert.equal(preview.body?.capabilities?.marketplace,false);
assert.equal(preview.body?.capabilities?.deliveries,false);
assert.equal(preview.body?.modules?.find(item=>item.id==='marketplace')?.enabled,false);
assert.equal(preview.body?.modules?.find(item=>item.id==='deliveries')?.enabled,false);

const premium=await request('/api/spatial/v1/cities/vianopolis/premium-zones?profile=LITE',{expectJson:true});
assert.equal(premium.response.status,200);
assert.equal(premium.body?.cityId,'vianopolis');
assert.equal(premium.body?.profileId,'LITE');
assert.ok(Array.isArray(premium.body?.items));
assert.equal(premium.body?.count,premium.body?.items?.length);
for(const item of premium.body?.items||[]){
  assert.ok(['available','reserved','active'].includes(item.status),`status premium inválido: ${item.status}`);
  if(item.status==='reserved')assert.equal(Object.hasOwn(item,'sponsor'),false,'slot reservado não deve expor patrocinador');
}

const invalid=await request('/api/spatial/v1/context?city=missing',{expectJson:true});
assert.equal(invalid.response.status,404,'cidade desconhecida deve ser rejeitada');

console.log(JSON.stringify({
  ok:true,
  base,
  checks:{health:true,publicCityAndCommerce:true,publicMediaCatalogs:true,memberGamesAndArenas:true,privateFarm:true,privateRewards:true,privateChat:true,privatePartners:true,privatePreferences:true,spatialApi:true,activeCity:true,previewIsolation:true,premiumZones:true}
}));
