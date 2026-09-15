import {AFFILIATE_CENTERS} from './vitriny-affiliate-centers-core.js';
import {DISTRICT_INTEGRATIONS} from './vitriny-district-integrations.js';

// Public fictional identities, versioned in code. No user records, agent prompts,
// task inference, traffic counters or paid services are consulted by this catalog.
export const RESIDENT_CATALOG_VERSION='2026-09-15-v1';
export const STUDIO_CHANNELS=Object.freeze([
  Object.freeze({id:'youtube',name:'YouTube · Agrotécnica',href:'https://www.youtube.com/@agrotecnica362'}),
  Object.freeze({id:'instagram',name:'Instagram · Agrotécnica',href:'https://www.instagram.com/agrotecniica/'}),
  Object.freeze({id:'tiktok',name:'TikTok · Agrotécnica',href:'https://www.tiktok.com/@agrotecnica5'})
]);
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const skins=['#e4b38f','#b57e59','#87593d','#583c30'];
const outfits=['#397c89','#ad7a38','#795b83','#587340','#9c5558','#455b80'];
export function residentHash(value){let n=2166136261;for(const c of String(value))n=Math.imul(n^c.charCodeAt(0),16777619);return n>>>0;}
export function safeResidentHref(value){
  return typeof value==='string'&&value.startsWith('/')&&!value.startsWith('//')&&!/[\\\u0000-\u0020]/.test(value)&&!/^\/api(?:\/|$)/i.test(value);
}
function department(id,name,href,x,z,{newBuilding=false,description='',adminHref='/admin-agentes.html'}={}){
  return {id,name,href,position:{x,z},newBuilding,description,adminHref};
}
export const RESIDENT_DEPARTMENTS=freeze([
  department('headquarters','Torre VitrineCity','/como-funciona.html',-164,-185,{description:'Recepção, orientação e operação da cidade.'}),
  department('delivery','VC Entregas','/entregas',83,-62,{description:'Acesso às lojas e opções de entrega.',adminHref:'/admin-logistica.html'}),
  department('games','Prédio de jogos','/vitriny-games.html',-88,-72,{description:'Jogos e experiências da plataforma.'}),
  department('cinema','Cinema VitrineCity','/vitriny-cinema.html',116,123,{description:'Filmes, curtas e trailers disponíveis.'}),
  department('music','Pulse Arena','/vitriny-music-arena.html',-57,175,{description:'Seleções musicais e entretenimento.'}),
  department('emissora','Emissora VitrineCity','/emissora',50,198,{description:'Conteúdo editorial e notícias.',adminHref:'/admin-conteudos.html'}),
  department('credits','Banco VitrineCity','/central-creditos.html',113,-163,{description:'Saldo e condições de uso das Vitrine Coins.'}),
  department('neural','Vitrine Neural','/neural-workspace.html?personal=1',-300,-72,{newBuilding:true,description:'Abra o chat real. Operações pagas seguem as condições e confirmações do chat.',adminHref:'/admin-vitriny-neural.html'}),
  department('studio','Estúdio de redes e vídeo','/recursos-social.html',-300,0,{newBuilding:true,description:'Recursos para criadores e atalhos de pesquisa de Instagram, TikTok e YouTube.',adminHref:'/admin-growth.html'}),
  department('recipes','Casa de receitas','/receitas',-300,72,{newBuilding:true,description:'Receitas e conteúdo culinário publicado.',adminHref:'/admin-conteudos.html'}),
  ...AFFILIATE_CENTERS.map((c,i)=>department(`center-${c.id}`,c.title,c.href,-180,-115+i*64,{description:c.description,adminHref:'/admin-afiliados.html'})),
  ...DISTRICT_INTEGRATIONS.map((d,i)=>department(`district-${d.id}`,d.label,d.href,Math.cos(i*Math.PI/4)*80,Math.sin(i*Math.PI/4)*80,{description:d.description}))
]);
const definitions=[
  ['vera','Vera','Anfitriã da cidade','headquarters','Posso mostrar os acessos da cidade. Escolha um destino para continuar.'],
  ['lia','Lia','Agente virtual de vendas','headquarters','A loja oficial é o primeiro destino para conhecer nossos produtos.'],
  ['caio','Caio','Orientador de entregas','delivery','A disponibilidade real de entrega é consultada na página de cada loja.'],
  ['leo','Léo','Guia de jogos','games','Os jogos estão disponíveis no prédio de jogos. Vamos conhecer?'],
  ['ines','Inês','Guia de cinema','cinema','O catálogo indica os filmes, curtas e trailers disponíveis.'],
  ['rui','Rui','Guia musical','music','Escolha uma seleção na arena musical para abrir o player.'],
  ['helena','Helena','Guia editorial','emissora','A emissora reúne conteúdos publicados para você explorar.'],
  ['clara','Clara','Orientadora de Vitrine Coins','credits','Consulte seu saldo e as condições na central. Esta simulação não movimenta moedas.'],
  ['iris','Íris','Anfitriã da Vitrine Neural','neural','Sou uma personagem de orientação. Para uma resposta real, abra a Vitrine Neural.'],
  ['noa','Noa','Guia de criação e vídeo','studio','Pesquise referências ou abra os recursos para criadores. Não publico nas redes.'],
  ['olivia','Olívia','Guia da unidade YouTube','studio','O canal oficial da Agrotécnica pode ser consultado pelo link. Esta fala não é uma análise do canal.'],
  ['maya-social','Maya','Guia da unidade Instagram','studio','Abra o perfil oficial para consultar as publicações. Não leio dados privados nem envio mensagens.'],
  ['enzo','Enzo','Guia da unidade TikTok','studio','O perfil oficial está disponível no link. Não publico, sigo pessoas nem contabilizo visualizações.'],
  ['luna','Luna','Guia de receitas','recipes','Explore as receitas publicadas. As instruções completas ficam na página do conteúdo.'],
  ...AFFILIATE_CENTERS.map((c,i)=>[`centro-${c.id}`,['Davi','Maya','Theo','Bia','Nina'][i],'Guia de catálogo',`center-${c.id}`,'Conheça a seleção publicada neste centro. Minha presença não representa vínculo com a marca.']),
  ...DISTRICT_INTEGRATIONS.map((d,i)=>[`distrito-${d.id}`,['Eva','Alex','Cora','Bento','Sofia','Otto','Yara','Tom'][i],['Guia de compras','Guia de comunidade','Guia de criadores','Guia de alimentação','Orientadora de cursos','Guia de lazer','Guia de negócios','Guia de serviços'][i],`district-${d.id}`,'Este acesso leva ao departamento real. Minhas rotinas e falas são uma simulação visual.'])
];
function resident([id,name,profession,departmentId,line]){
  const seed=residentHash(id);return {id,name,profession,departmentId,line,appearance:{skinColor:skins[seed%skins.length],outfitColor:outfits[(seed>>>4)%outfits.length],variant:seed%6},status:'unconnected',taskLabel:'Sem tarefa registrada nesta visualização'};
}
export const CITY_RESIDENTS=freeze(definitions.map(resident));

export function createResidentCatalog(stores=[]){
  const departments=[...RESIDENT_DEPARTMENTS],residents=[...CITY_RESIDENTS],seen=new Set();
  // Store payloads are already public; retain only a bounded allowlist of fields.
  for(const store of (Array.isArray(stores)?[...stores]:[]).filter(s=>typeof s?.reference==='string').sort((a,b)=>a.reference.localeCompare(b.reference)).slice(0,64)){
    const reference=store.reference;if(!/^[\w-]{1,100}$/.test(reference)||seen.has(reference)||!safeResidentHref(store.href)||!Number.isFinite(store.position?.x)||!Number.isFinite(store.position?.z))continue;
    seen.add(reference);const id=`store-${reference}`,seed=residentHash(reference),name=['Ari','Ivo','Cris','Sol','Lu','Toni'][seed%6];
    departments.push(department(id,String(store.name||'Loja').slice(0,100),store.href,store.position.x-16,store.position.z,{description:'Loja pública conectada à cidade. O personagem é um guia virtual da plataforma, não um funcionário da loja.'}));
    residents.push(resident([`guide-${reference}`,`${name} · guia da loja`,'Guia virtual de vitrine',id,'Posso abrir a vitrine publicada. Não represento o lojista e não realizo compras.']));
  }
  return freeze({version:RESIDENT_CATALOG_VERSION,departments,residents});
}

export function residentPose(person,building,elapsed=0){
  const seed=residentHash(person.id),phase=(Math.max(0,Number(elapsed)||0)+seed%24)%24;
  const moving=phase<12,angle=moving?phase/12*Math.PI*2:0;
  const baseX=building.position.x+(seed%3-1)*1.8,baseZ=building.position.z+(building.newBuilding?20:0);
  return {x:baseX+Math.sin(angle)*2.2,z:baseZ+Math.cos(angle)*1.4,yaw:moving?angle+Math.PI/2:Math.PI,moving,phase,activity:moving?'Deslocamento simulado':'Recepção simulada'};
}

export function intersectsResidentBuilding(building){
  if(!building?.position||!building?.size)return false;
  return RESIDENT_DEPARTMENTS.filter(d=>d.newBuilding).some(d=>Math.abs(d.position.x-building.position.x)<18+building.size.width/2&&Math.abs(d.position.z-building.position.z)<18+building.size.depth/2);
}
