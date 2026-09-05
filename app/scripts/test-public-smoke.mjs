import assert from 'node:assert/strict';

const base=String(process.env.BASE_URL||'https://vitrinecity.com').replace(/\/$/,'');
const pages=['/','/descobrir','/buscar.html?q=curso','/loja','/entregas','/cidade-premium','/centro-educacional.html','/acessos.html','/recuperar-acesso.html'];
for(const path of pages){const response=await fetch(base+path,{redirect:'manual'});assert.equal(response.status,200,`${path} retornou ${response.status}`);assert.match(response.headers.get('content-type')||'',/text\/html/,`${path} não retornou HTML`)}
const discoverResponse=await fetch(base+'/api/discover'),discover=await discoverResponse.json();assert.equal(discoverResponse.status,200);for(const key of ['articles','books','courses','products'])assert.ok(Array.isArray(discover[key]),`api/discover sem ${key}`);
const searchResponse=await fetch(base+'/api/search?q=curso'),search=await searchResponse.json();assert.equal(searchResponse.status,200);for(const key of ['stores','products','contents','books','courses','services'])assert.ok(Array.isArray(search[key]),`api/search sem ${key}`);
const admin=await fetch(base+'/admin',{redirect:'manual'});assert.ok([302,303].includes(admin.status),'admin público não redirecionou para autenticação');
const invalidReset=await fetch(base+'/api/auth/password-reset/confirm',{method:'POST',headers:{'content-type':'application/json','origin':base},body:JSON.stringify({token:'invalid',password:'senha-invalida'})});assert.equal(invalidReset.status,400,'reset inválido deveria ser rejeitado');
console.log(`Smoke público aprovado em ${base}: ${pages.length} páginas e 3 contratos de API.`);
