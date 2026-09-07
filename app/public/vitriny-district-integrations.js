const BLOCKED_PREFIXES=['/admin','/api/admin','/pagamento','/checkout','/wallet','/carteira'];

const DEFINITIONS=Object.freeze([
  {id:'commerce',label:'Commerce District',spatialPath:'/v/br/go/vitrine-city/commerce',href:'/loja.html',description:'Lojas, ofertas e marketplace da Vitrine City.'},
  {id:'social',label:'Social District',spatialPath:'/v/br/go/vitrine-city/social',href:'/social.html',description:'Rede social, perfis, conteúdo e comunidades.'},
  {id:'creator',label:'Creator District',spatialPath:'/v/br/go/vitrine-city/creator',href:'/afiliados.html',description:'Criadores, afiliados e oportunidades de conteúdo.'},
  {id:'food',label:'Food Avenue',spatialPath:'/v/br/go/vitrine-city/food',href:'/cidade.html',description:'Ponte atual para negócios e experiências locais da cidade.'},
  {id:'education',label:'Education District',spatialPath:'/v/br/go/vitrine-city/education',href:'/centro-educacional.html',description:'Cursos, aprendizagem e experiências educacionais.'},
  {id:'entertainment',label:'Entertainment District',spatialPath:'/v/br/go/vitrine-city/entertainment',href:'/passeio-virtual.html',description:'Passeios, entretenimento e experiências imersivas.'},
  {id:'business',label:'Business District',spatialPath:'/v/br/go/vitrine-city/business',href:'/para-empresas.html',description:'Soluções, presença digital e recursos para empresas.'},
  {id:'services',label:'Services District',spatialPath:'/v/br/go/vitrine-city/services',href:'/solucoes.html',description:'Serviços e soluções integradas da plataforma.'}
]);

function safePath(value,label='rota'){
  const path=String(value||'').trim();
  if(!path.startsWith('/')||path.startsWith('//')||/[\\\u0000-\u001f]/.test(path))throw new Error(`${label} inválida.`);
  const lower=path.toLowerCase();
  if(BLOCKED_PREFIXES.some(prefix=>lower===prefix||lower.startsWith(prefix+'/')||lower.startsWith(prefix+'.')))throw new Error(`${label} bloqueada para navegação espacial pública.`);
  return path;
}

export const DISTRICT_INTEGRATIONS=Object.freeze(DEFINITIONS.map(item=>Object.freeze({
  ...item,
  spatialPath:safePath(item.spatialPath,'Rota espacial'),
  href:safePath(item.href,'Destino'),
  mode:'bridge',
  enabled:true
})));

const BY_ID=new Map(DISTRICT_INTEGRATIONS.map(item=>[item.id,item]));

export function districtExperience(id){return BY_ID.get(String(id||'').trim().toLowerCase())||null;}
export function safeDistrictHref(id){return districtExperience(id)?.href||null;}
export function isSafeDistrictHref(value){try{return safePath(value,'Destino')===String(value||'').trim();}catch{return false;}}
export const districtIntegrationBlockedPrefixes=Object.freeze([...BLOCKED_PREFIXES]);
