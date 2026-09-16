import {AFFILIATE_CENTERS} from './vitriny-affiliate-centers-core.js';
import {DISTRICT_INTEGRATIONS} from './vitriny-district-integrations.js';

// Public fictional identities, versioned in code. No user records, agent prompts,
// task inference, traffic counters or paid services are consulted by this catalog.
export const RESIDENT_CATALOG_VERSION='2026-09-15-v2';
export const STUDIO_CHANNELS=Object.freeze([
  Object.freeze({id:'youtube',name:'YouTube · Agrotécnica',href:'https://www.youtube.com/@agrotecnica362'}),
  Object.freeze({id:'instagram',name:'Instagram · Agrotécnica',href:'https://www.instagram.com/agrotecniica/'}),
  Object.freeze({id:'tiktok',name:'TikTok · Agrotécnica',href:'https://www.tiktok.com/@agrotecnica5'})
]);
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const skins=['#e4b38f','#b57e59','#87593d','#583c30'];
const outfits=['#397c89','#ad7a38','#795b83','#587340','#9c5558','#455b80'];
export const RESIDENT_SPECIALTIES=freeze([
  {id:'coordination',label:'Coordenação'}, {id:'research',label:'Pesquisa'},
  {id:'writing',label:'Redação'}, {id:'design',label:'Design'},
  {id:'video',label:'Vídeo'}, {id:'review',label:'Revisão'},
  {id:'seo',label:'SEO'}, {id:'analysis',label:'Análise'}
]);
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
  department('studio','Estúdio de redes e vídeo','/social',-300,0,{newBuilding:true,description:'Explore o feed da Vitrine Social e consulte os canais oficiais de Instagram, TikTok e YouTube.',adminHref:'/admin-growth.html'}),
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
  ['noa','Noa','Guia de criação e vídeo','studio','Abra o feed da Vitrine Social ou consulte os canais oficiais. Esta personagem não publica nas redes.'],
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
const firstNames=['Aline','Bruno','Camila','Diego','Elisa','Felipe','Giovana','Hugo','Isabel','João','Karina','Lucas','Marina','Nicolas','Paula','Rafael','Sara','Tiago','Valéria','William','Yasmin','Zeca','Amanda','Vitor'];
const surnames=['Costa','Lima','Rocha','Alves','Reis','Moura','Prado','Duarte','Melo','Nunes','Freitas','Barros','Pires','Campos','Vieira','Ramos','Teixeira','Castro','Machado','Ribeiro','Dias','Azevedo','Monteiro'];
export const CITY_RESIDENTS=freeze([
  ...definitions.map(resident),
  ...RESIDENT_DEPARTMENTS.flatMap((d,index)=>RESIDENT_SPECIALTIES.map((specialty,slot)=>({
    ...resident([`${d.id}-specialist-${specialty.id}`,`${firstNames[(index*5+slot)%firstNames.length]} ${surnames[index]}`,
      `Especialista virtual · ${specialty.label}`,d.id,
      `Meu papel neste roteiro é ${specialty.label.toLowerCase()} em ${d.name}. Posso indicar o conteúdo, mas não estou executando tarefas nem aprendendo automaticamente.`]),
    specialty:specialty.id,slot
  })))
]);

export function residentVisibleRoster(catalog,selectedId,limit=40){
  const cap=limit===16?16:40,selected=catalog.residents.find(p=>p.id===selectedId);
  const mappedInteriors=new Set(catalog.departments.filter(d=>d.newBuilding).map(d=>d.id));
  const initialWorkers=catalog.residents.filter(p=>mappedInteriors.has(p.departmentId)&&p.specialty&&p.slot<(cap===16?2:4)),initialIds=new Set(initialWorkers.map(p=>p.id));
  const initial=[...initialWorkers,...catalog.residents.filter(p=>!initialIds.has(p.id))];
  const ordered=selected?[selected,...catalog.residents.filter(p=>p.id!==selectedId&&p.departmentId===selected.departmentId),...initial.filter(p=>p.departmentId!==selected.departmentId)]:initial;
  return ordered.slice(0,cap);
}

// Shared with the modeled pavilion: two banks of four desks, central aisle,
// unobstructed four-metre front doorway. Other buildings have no invented interior.
export function residentDesk(slot){const i=Math.max(0,Math.min(7,Number(slot)||0));return {x:i%2?7:-7,z:-7+Math.floor(i/2)*4.4};}
function alongPath(points,t){
  const lengths=points.slice(1).map((p,i)=>Math.hypot(p.x-points[i].x,p.z-points[i].z)),total=lengths.reduce((a,b)=>a+b,0);
  let distance=Math.max(0,Math.min(1,t))*total;
  for(let i=0;i<lengths.length;i++){if(distance<=lengths[i]||i===lengths.length-1){const a=points[i],b=points[i+1],f=lengths[i]?distance/lengths[i]:0;return {x:a.x+(b.x-a.x)*f,z:a.z+(b.z-a.z)*f,yaw:Math.atan2(b.x-a.x,b.z-a.z)};}distance-=lengths[i];}
  return {...points[0],yaw:0};
}

export function residentConversation(person,catalog,{crossDepartment=false}={}){
  if(crossDepartment){
    const index=catalog.departments.findIndex(d=>d.id===person.departmentId),destination=catalog.departments[(index+1)%catalog.departments.length],source=catalog.departments[index];
    const partner=catalog.residents.find(p=>p.departmentId===destination.id&&p.specialty==='coordination')||catalog.residents.find(p=>p.departmentId===destination.id);
    if(partner)return {simulated:true,departments:[source.id,destination.id],speakers:[person.name,partner.name],lines:[`${person.name} · ${source.name}: “Uma ideia para melhorar a cidade: organizar referências e facilitar o acesso aos conteúdos entre nossos departamentos.”`,`${partner.name} · ${destination.name}: “Podemos propor uma revisão conjunta de clareza e acessibilidade. É uma ideia deste roteiro; nenhuma tarefa foi criada ou executada.”`]};
  }
  const peers=catalog.residents.filter(p=>p.departmentId===person.departmentId&&p.id!==person.id),partner=peers.find(p=>p.specialty&&Math.floor(p.slot/2)===Math.floor((person.slot??-8)/2))||peers[0];
  return partner?{simulated:true,speakers:[person.name,partner.name],lines:[`${person.name}: “${person.line}”`,`${partner.name}: “Vamos consultar o conteúdo disponível? Esta conversa é um roteiro, não um registro de trabalho realizado.”`]}:{simulated:true,speakers:[person.name],lines:[`${person.name}: “${person.line}”`]};
}

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
  if(person.specialty&&building.newBuilding){
    const slot=person.slot,desk=residentDesk(slot),pair=Math.floor(slot/2),phase=(Math.max(0,Number(elapsed)||0)+pair*14)%56;
    const work={x:desk.x,z:desk.z+1.3},conversation={x:slot%2?2:-2,z:19+pair*.8};
    const lane=slot%2?.6:-.6;
    const path=[work,{x:lane,z:work.z},{x:lane,z:16},conversation];let local,action,activity;
    if(phase<16){local={...work,yaw:Math.PI};action='work';activity='Trabalho simulado na mesa';}
    else if(phase<28){local=alongPath(path,(phase-16)/12);action='walk';activity='Saída simulada pela entrada';}
    else if(phase<38){local={...conversation,yaw:slot%2?-Math.PI/2:Math.PI/2};action='talk';activity='Conversa simulada com colega';}
    else if(phase<50){local=alongPath([...path].reverse(),(phase-38)/12);action='walk';activity='Retorno simulado à mesa';}
    else{local={...work,yaw:Math.PI};action='reception';activity='Preparação simulada na mesa';}
    return {x:building.position.x+local.x,z:building.position.z+local.z,yaw:local.yaw,moving:action==='walk',phase,action,activity,interior:local.z<12.5};
  }
  const seed=residentHash(person.id),phase=(Math.max(0,Number(elapsed)||0)+seed%24)%24;
  const moving=phase<12,angle=moving?phase/12*Math.PI*2:0;
  const baseX=building.position.x+(seed%3-1)*1.8,baseZ=building.position.z+(building.newBuilding?20:0);
  return {x:baseX+Math.sin(angle)*2.2,z:baseZ+Math.cos(angle)*1.4,yaw:moving?angle+Math.PI/2:Math.PI,moving,phase,action:moving?'walk':person.specialty?'talk':'reception',interior:false,activity:moving?'Deslocamento simulado na recepção':person.specialty?'Conversa simulada na recepção':'Recepção simulada'};
}

export function intersectsResidentBuilding(building){
  if(!building?.position||!building?.size)return false;
  return RESIDENT_DEPARTMENTS.filter(d=>d.newBuilding).some(d=>Math.abs(d.position.x-building.position.x)<18+building.size.width/2&&Math.abs(d.position.z-building.position.z)<18+building.size.depth/2);
}
