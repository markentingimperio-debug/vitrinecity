import * as THREE from '/vendor/three/three.module.js';

// Directory links use the existing authenticated administration routes.
export const headquartersSectors=Object.freeze([
  ['Central do dia · conteúdo e divulgação','/admin-operacao'],['Direção e operação','/admin'],['Lojas e lojistas','/admin-lojas.html'],
  ['Finanças e pagamentos','/admin-pagamentos.html'],['Publicidade e campanhas','/admin-vitrine-ads.html'],
  ['Inteligência artificial · Jarvis','/admin-jarvis.html'],['Vitriny Neural','/admin-vitriny-neural.html'],
  ['Agentes e automação','/admin-agentes.html'],['Agentes de vendas','/admin-sales-agents.html'],
  ['Logística','/admin-logistica.html'],['Entregas locais','/admin-entregas.html'],
  ['Centro educacional','/admin-cursos.html'],['Serviços digitais','/admin-servicos.html'],
  ['Conteúdo e comunicação','/admin-conteudos.html'],['Editora','/admin-editora.html'],
  ['Estúdio de lives','/admin-live.html'],['Atendimento','/admin-chatbotx.html'],
  ['Afiliados','/admin-afiliados.html'],['Vendas afiliadas','/admin-vendas-afiliadas.html'],
  ['Captação','/admin-captacao.html'],['Prospecção','/admin-prospeccao.html'],
  ['Oportunidades','/admin-oportunidades.html'],['Inteligência de mercado','/admin-intelligence.html'],
  ['Integrações','/admin-integracoes.html'],['Métricas externas','/admin-metricas-externas.html'],
  ['Pesquisa e presença digital','/admin-google-search.html'],['Tendências','/admin-tendencias.html'],
  ['Identidade e acessos','/admin-identidade.html'],['Moderação','/admin-social-moderacao.html'],
  ['Segurança','/admin-security.html'],['Saúde da plataforma','/admin-saude.html'],['Jurídico','/admin-juridico.html']
]);

export function mountCityHeadquarters({scene,architecture,facade,shadows=false}){
  const group=new THREE.Group();group.name='vitrine-city-headquarters';group.position.set(-164,0,-220);group.userData={headquarters:true,label:'Torre VitrineCity'};
  const {part,roundedPart,terrace,stone,graphite,brass,warm,tree,textSign,curtain,glass}=architecture;
  roundedPart(group,stone,0,.55,0,72,1.1,58,7);
  for(let i=0;i<4;i++)roundedPart(group,stone,0,.16+i*.15,31-i*1.3,44,.3+i*.3,2.7,1);
  roundedPart(group,graphite,0,7,0,64,12,46,7);
  // Tall shopfront windows reveal a warm, recessed entrance hall.
  part(group,architecture.wood,0,5.6,18.8,49,9,.25);
  part(group,glass,0,5.8,23.3,48,9.5,.08);
  for(let x=-23;x<=23;x+=4.6)part(group,brass,x,5.8,23.5,.13,9.5,.3);
  for(const x of [-23,23])part(group,stone,x,6.2,23,1.6,10.6,3);
  roundedPart(group,stone,0,12.8,1,68,.75,49,7);
  roundedPart(group,warm,0,12.4,1,68.1,.08,49.1,7);
  textSign(group,'VitrineCity',{width:37,height:3.4,y:10.3,z:24.7});
  for(const x of [-14,0,14])part(group,warm,x,5,19,1.5,5,.1);
  const tiers=[{w:46,d:36,y:13,h:42,x:0,z:0},{w:38,d:30,y:55,h:34,x:2,z:-2},{w:29,d:24,y:89,h:27,x:4,z:-4}];
  for(const tier of tiers){
    roundedPart(group,curtain,tier.x,tier.y+tier.h/2,tier.z,tier.w,tier.h,tier.d,5);
    for(let y=tier.y+4;y<tier.y+tier.h-1;y+=4)roundedPart(group,graphite,tier.x,y,tier.z,tier.w+.08,.12,tier.d+.08,5);
    for(const side of [-1,1]){
      part(group,stone,tier.x+side*tier.w*.37,tier.y+tier.h/2,tier.z+tier.d/2,.9,tier.h,1);
      part(group,brass,tier.x+side*tier.w*.37,tier.y+tier.h/2,tier.z+tier.d/2+.55,.11,tier.h,.1);
      part(group,brass,tier.x+side*tier.w/2,tier.y+tier.h/2,tier.z,.14,tier.h,tier.d*.66);
    }
    terrace(group,{x:tier.x,y:tier.y+tier.h+.2,z:tier.z,width:tier.w+2,depth:tier.d+2});
    for(const x of [-tier.w*.28,tier.w*.28])tree(group,tier.x+x,tier.z-4,.72,tier.y+tier.h+.7);
  }
  roundedPart(group,curtain,4,121,-4,23,8,18,4);
  terrace(group,{x:4,y:125.4,z:-4,width:25,depth:20,green:false});
  // A slender asymmetric sail makes the civic tower recognisable from the avenue.
  part(group,stone,14,74,-2,1.3,139,18);
  part(group,brass,14.75,74,7.1,.12,139,.12);
  part(group,warm,14.8,74,7.25,.05,139,.06);
  for(const x of [-29,29])for(const z of [-18,0,18])tree(group,x,z,1.2,1.2);
  architecture.batch(group);scene.add(group);return group;
}

export function installHeadquartersDirectory(dialog){
  const nav=dialog.querySelector('nav');
  for(const [index,[label,href]] of headquartersSectors.entries()){
    const link=document.createElement('a');link.href=href;
    const number=document.createElement('span');number.textContent=String(index+1).padStart(2,'0');
    const name=document.createElement('strong');name.textContent=label;link.append(number,name);nav.append(link);
  }
  dialog.querySelector('[data-close]').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
}
