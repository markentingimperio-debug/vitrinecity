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
  const group=new THREE.Group();group.name='vitrine-city-headquarters';group.position.set(0,0,-154);group.userData={headquarters:true,label:'Torre VitrineCity'};
  const {part,stone,graphite,brass,warm,tree,textSign}=architecture;
  part(group,stone,0,.6,0,72,1.2,58);
  for(let i=0;i<4;i++)part(group,stone,0,.16+i*.15,31-i*1.3,44,.3+i*.3,2.7);
  part(group,graphite,0,6,0,60,10,43);
  const lobbyGlass=new THREE.MeshStandardMaterial({color:'#788c8d',metalness:.55,roughness:.18,emissive:'#e4b96f',emissiveIntensity:.18});
  part(group,lobbyGlass,0,5.5,22,48,8,.3);
  for(let x=-24;x<=24;x+=6)part(group,brass,x,5.5,22.4,.16,9,.2);
  part(group,graphite,0,10.3,27,64,.65,15);
  part(group,warm,0,10.15,34.4,63,.09,.09);
  textSign(group,'VITRINE CITY',{width:45,height:4,y:7,z:22.6,subtitle:'SEDE ADMINISTRATIVA · MULTIVERSAL'});
  const tierData=[{w:37,d:32,y:11,h:54},{w:31,d:27,y:65,h:47},{w:25,d:22,y:112,h:37},{w:19,d:17,y:149,h:24}];
  for(const [index,tier] of tierData.entries()){
    const geometry=new THREE.BoxGeometry(tier.w,tier.h,tier.d),uv=geometry.attributes.uv;
    for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*tier.w/12,uv.getY(i)*tier.h/24);
    const body=new THREE.Mesh(geometry,[facade,facade,graphite,graphite,facade,facade]);body.position.y=tier.y+tier.h/2;body.castShadow=shadows;body.receiveShadow=shadows;group.add(body);
    part(group,graphite,0,tier.y+tier.h,0,tier.w+2,.8,tier.d+2);
    for(const z of [-tier.d/2,tier.d/2]){
      part(group,warm,0,tier.y+tier.h+.5,z,tier.w+1,.12,.13);
      for(const x of [-tier.w/2,tier.w/2])part(group,brass,x,tier.y+tier.h/2,z,.65,tier.h,.65);
      // Diagonal external braces give the tower a distinct, structural silhouette.
      const length=Math.hypot(tier.w,tier.h),brace=part(group,brass,0,tier.y+tier.h/2,z+.3,.6,length,.65);brace.rotation.z=(index%2?1:-1)*Math.atan2(tier.w,tier.h);
    }
    if(index<3)for(const x of [-tier.w*.43,tier.w*.43])tree(group,x,0,.85,tier.y+tier.h+.4);
  }
  for(const x of [-9,9])part(group,brass,x,181,0,.7,18,15);
  part(group,graphite,0,190,0,20,1.1,17);
  part(group,warm,0,190.7,8.55,20,.13,.14);
  part(group,brass,0,200,0,.5,19,.5);
  part(group,warm,0,210,0,.35,1,.35);
  textSign(group,'VC',{width:12,height:6,y:158,z:11.2});
  for(const x of [-29,29])for(const z of [-18,0,18])tree(group,x,z,1.2,1.2);
  scene.add(group);return group;
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
