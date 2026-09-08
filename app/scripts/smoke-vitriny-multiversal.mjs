import assert from 'node:assert/strict';

const base=String(process.env.BASE_URL||'http://127.0.0.1:3000').replace(/\/$/,'');
const timeoutMs=Number(process.env.SMOKE_TIMEOUT_MS||8000);

async function request(path,{expectJson=false}={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetch(base+path,{redirect:'manual',cache:'no-store',signal:controller.signal});
    const contentType=response.headers.get('content-type')||'';
    const body=expectJson&&contentType.includes('application/json')?await response.json():null;
    return{response,contentType,body};
  }finally{clearTimeout(timer);}
}

async function expectHtml(path){
  const {response,contentType}=await request(path);
  assert.equal(response.status,200,`${path} retornou ${response.status}`);
  assert.match(contentType,/text\/html/,`${path} não retornou HTML`);
}

for(const path of [
  '/vitriny-multiverse-worlds.html',
  '/entrar-cidade.html',
  '/loja',
  '/mapa-real.html?cidade=vianopolis'
])await expectHtml(path);

for(const path of [
  '/vitriny-multiverse-explore.html?city=vitrine-city',
  '/vitriny-multiverse-explore.html?city=vianopolis',
  '/vitriny-multiverse-district.html?city=vitrine-city&district=commerce',
  '/vitriny-games.html',
  '/vitriny-mini-fazenda.html'
]){const {response}=await request(path);assert.equal(response.status,302,`${path} deve exigir login`);assert.ok(response.headers.get('location')?.startsWith('/entrar-cidade.html?returnTo='));}
assert.equal((await request('/api/games/farm')).response.status,401,'Progresso de jogo exige conta autenticada');
assert.equal((await request('/api/privacy/communications')).response.status,401,'Preferências de comunicação exigem conta autenticada');

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
  checks:{health:true,publicPages:4,memberPages:5,privateFarm:true,privatePreferences:true,spatialApi:true,activeCity:true,previewIsolation:true,premiumZones:true}
}));
