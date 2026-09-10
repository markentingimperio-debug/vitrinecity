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
  const {part,roundedPart,stone,graphite,brass,warm,wood,tree,shrubs,textSign,glass}=architecture;
  function material(options){const value=new THREE.MeshStandardMaterial(options);architecture.materials.add(value);return value;}
  function geometry(value){architecture.geometries.add(value);return value;}
  const porcelain=material({color:'#e9dfcf',roughness:.62,metalness:.025});
  const plaster=material({color:'#daceb7',roughness:.84,emissive:'#db9b49',emissiveIntensity:.11});
  const silk=material({color:'#bc9d77',roughness:.96});
  const darkGlass=material({color:'#496874',metalness:.78,roughness:.15,envMapIntensity:1.15});
  const spandrel=material({color:'#344e58',metalness:.64,roughness:.24});
  const upperGlass=(facade||architecture.curtain).clone();upperGlass.color.set('#c8d9de');upperGlass.metalness=.66;upperGlass.roughness=.19;upperGlass.emissiveIntensity=.22;architecture.materials.add(upperGlass);
  const pendantShape=geometry(new THREE.TorusGeometry(1,.028,6,32));
  const columnShape=geometry(new THREE.CylinderGeometry(1,1,1,12));

  // These open wall strips have no opaque caps. The entry is a room with depth,
  // not an illuminated photograph placed over a solid building.
  function contour(w,d,r,steps=8){
    const points=[];
    for(const [x,z,start] of [[w/2-r,d/2-r,0],[-w/2+r,d/2-r,Math.PI/2],[-w/2+r,-d/2+r,Math.PI],[w/2-r,-d/2+r,Math.PI*1.5]]){
      for(let i=0;i<=steps;i++){const a=start+i/steps*Math.PI/2;points.push(new THREE.Vector2(x+Math.cos(a)*r,z+Math.sin(a)*r));}
    }
    return points;
  }
  function wallStrip(points,height,{closed=true,repeat=1}={}){
    const positions=[],uv=[];let distance=0;const count=closed?points.length:points.length-1;
    for(let i=0;i<count;i++){
      const a=points[i],b=points[(i+1)%points.length],next=distance+a.distanceTo(b);
      for(const [p,y,u] of [[a,0,distance],[a,height,distance],[b,height,next],[a,0,distance],[b,height,next],[b,0,next]]){positions.push(p.x,y,p.y);uv.push(u/12*repeat,y/32);}
      distance=next;
    }
    const value=new THREE.BufferGeometry();value.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));value.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));value.computeVertexNormals();return geometry(value);
  }
  function shell(parent,points,y,height,mat){return part(parent,mat,0,y,0,1,1,1,wallStrip(points,height));}
  function rail(parent,{x=0,z=0,y,w,d,r=4}){
    const path=contour(w,d,r),g=new THREE.Group();g.position.set(x,y,z);parent.add(g);
    shell(g,path,0,1.12,glass);
    for(let i=0;i<path.length;i+=2){const a=path[i],b=path[(i+2)%path.length],length=a.distanceTo(b),bar=part(g,brass,(a.x+b.x)/2,1.16,(a.y+b.y)/2,length,.055,.055);bar.rotation.y=-Math.atan2(b.y-a.y,b.x-a.x);}
    return g;
  }
  function jointedPier(x,z,width,depth,height,start=14){
    part(group,stone,x,start+height/2,z,width,height,depth);
    for(let y=start+4.4;y<start+height;y+=4.4)part(group,graphite,x,y,z+depth/2+.012,width,.035,.035);
  }
  function planter(parent,{x=0,z=0,y=0,w=7,d=2,scale=.55}){
    roundedPart(parent,stone,x,y+.35,z,w,.7,d,.6);shrubs(parent,x,y+.72,z,w*.92,d*.9);
    tree(parent,x,z,scale,y+.7);
  }

  roundedPart(group,porcelain,0,.2,1,75,.4,63,8);
  // Four shallow steps lead to a 6 m opening between the vestibule doors.
  for(let i=0;i<4;i++)roundedPart(group,stone,0,.11+i*.12,32.6-i*.75,40,.22+i*.24,2.3,.65);
  roundedPart(group,porcelain,0,.67,1,62,.2,51,9);
  part(group,wood,0,6.35,-17,51,11.4,.5);
  part(group,plaster,0,11.85,2,50,.3,36);
  for(const side of [-1,1]){
    part(group,stone,side*28.9,6.25,0,1.8,11.5,32);
    part(group,glass,side*28.9,6.05,17,.06,10.4,7);
    part(group,brass,side*28.94,6.1,20.7,.1,10.5,.14);
    jointedPier(side*24.3,23.1,1.25,1.8,11.3,.8);
  }
  // Transparent panes flank the actual open entrance; their smaller divisions
  // and door handles set a readable human scale at street level.
  for(const side of [-1,1])for(let i=0;i<5;i++){
    const x=side*(4.8+i*3.8);
    part(group,glass,x,5.45,24.1,3.7,9.2,.045);
    part(group,brass,side*(3+i*3.8),5.45,24.15,.07,9.2,.1);
    part(group,brass,x,4.1,24.18,3.8,.06,.1);
  }
  for(const x of [-3,3]){part(group,brass,x,3.55,24.18,.1,5.5,.12);part(group,brass,x,1.85,24.33,.055,.75,.12);}
  part(group,glass,0,8.7,24.1,6,2.7,.04);
  part(group,brass,0,7.3,24.17,6,.08,.13);

  // A deep, curved portico carries the address; warm coves run under its edge.
  roundedPart(group,graphite,0,11.7,4,64,1.45,49,10);
  roundedPart(group,stone,0,12.65,4,65,.44,50,10);
  roundedPart(group,warm,0,12.36,4,64.5,.065,49.5,10);
  roundedPart(group,wood,0,10.93,17,52,.13,20,8);
  textSign(group,'VitrineCity',{width:31,height:3.35,y:10.75,z:28.64,color:'#d8efff'});
  // Reception, inset wall panels, stone sofas and suspended rings remain 3D.
  roundedPart(group,stone,0,1.27,5,8.5,1.1,2.1,.55);
  part(group,wood,0,1.88,5,8.8,.15,2.25);
  part(group,warm,0,1.5,6.07,7.7,.05,.04);
  for(let i=0;i<11;i++)part(group,brass,-20+i*4,6.2,-16.68,.055,10.1,.08);
  for(const side of [-1,1]){
    for(const z of [11,17.6]){
      roundedPart(group,silk,side*13,1.12,z,6.2,.72,1.55,.3);
      roundedPart(group,silk,side*13,1.77,z-.55,6.2,1,.45,.17);
      for(const x of [-2.8,2.8])roundedPart(group,silk,side*13+x,1.58,z,.55,.9,1.55,.18);
    }
    roundedPart(group,stone,side*13,1.07,14.6,3.6,.24,1.9,.7);
    part(group,brass,side*13,.88,14.6,.8,.4,.8);
    planter(group,{x:side*21,z:7,y:.75,w:2.7,d:2.7,scale:.8});
    for(const z of [3,17]){
      const ring=part(group,warm,side*12,9.1,z,2.1,2.1,2.1,pendantShape);ring.rotation.x=Math.PI/2;
      for(const x of [-1.5,1.5])part(group,brass,side*12+x,10.1,z,.025,2,.025);
    }
  }
  for(const x of [-18,-9,0,9,18])part(group,warm,x,11.5,4,4.2,.04,.32);
  // Slender round columns and a visible rear mezzanine continue the lobby depth.
  for(const x of [-19,19])for(const z of [-10,10])part(group,stone,x,6.3,z,.38,11.2,.38,columnShape);
  part(group,stone,0,6.15,-9.5,45,.26,12.5);
  part(group,glass,0,6.82,-3.22,43,1.05,.05);
  part(group,brass,0,7.39,-3.2,43,.05,.06);

  // One continuous bow-front tower replaces the repeated wedding-cake blocks.
  const body=new THREE.Group();body.position.set(-1,0,-1);group.add(body);
  const bodyPath=contour(48,37,11,10);
  shell(body,bodyPath,13,77,upperGlass);
  for(let floor=0;floor<18;floor++){
    const y=14+floor*4.35;
    roundedPart(body,spandrel,0,y,0,48.05,.18,37.05,11);
    if(floor%4===1){part(body,warm,-4,y+.18,18.53,20,.055,.05);}
  }
  // Projecting mullions create real shade and reflections at a 2.8 m module.
  for(let x=-11.2;x<=11.21;x+=2.8){part(body,brass,x,51.5,18.59,.09,77,.18);part(body,graphite,x,51.5,-18.58,.095,77,.17);}
  for(const side of [-1,1]){
    for(let z=-6.5;z<=6.51;z+=3.25)part(body,graphite,side*24.04,51.5,z,.18,77,.09);
    for(let i=1;i<6;i++){
      const a=i/6*Math.PI/2,x=side*(13+Math.sin(a)*11),z=7.5+Math.cos(a)*11;
      const mullion=part(body,brass,x,51.5,z,.08,77,.16);mullion.rotation.y=side*a;
    }
  }
  jointedPier(-20.8,15.1,1.25,3.7,79,13);
  jointedPier(11.75,18.8,2.25,4.15,79,13);
  part(group,brass,-20.06,52.5,17.03,.09,79,.12);

  // Two lower inhabited wings support gardens around the high atrium. Their
  // unequal heights leave the central glass volume legible from the promenade.
  for(const side of [-1,1]){
    const wing=new THREE.Group(),height=side<0?25:34;wing.position.set(side*30,0,-4);group.add(wing);
    roundedPart(wing,stone,0,height/2+.8,0,17,height,34,3.5);
    part(wing,darkGlass,0,height/2+1,17.04,12,height-3,.12);
    for(let y=5;y<height;y+=4.4)part(wing,brass,0,y,17.14,12,.08,.14);
    for(const x of [-4,0,4])part(wing,brass,x,height/2+1,17.17,.065,height-3,.1);
    roundedPart(wing,stone,0,height+1,0,18,.4,35,3.5);
    roundedPart(wing,warm,0,height+.72,0,18.05,.07,35.05,3.5);
    rail(wing,{y:height+1.2,w:16.5,d:33.5,r:3});
    for(const z of [-11,0,11])planter(wing,{x:0,z,y:height+1.2,w:9,d:3.2,scale:.72});
  }

  roundedPart(body,stone,0,90.25,0,49.5,.55,38.5,11);
  roundedPart(body,warm,0,89.93,0,49.6,.065,38.6,11);
  rail(body,{y:90.56,w:48,d:37,r:10.5});
  for(const x of [-13,-5,4])planter(body,{x,z:13,y:90.56,w:6.5,d:2.3,scale:.66});
  for(const z of [-11,-3,5])planter(body,{x:-20,z,y:90.56,w:2.4,d:5.5,scale:.58});

  // A compact glazed roof pavilion is recessed behind a planted terrace.
  const pavilion=new THREE.Group();pavilion.position.set(3,90.6,-5);group.add(pavilion);
  roundedPart(pavilion,plaster,0,.17,0,31,.34,24,7);
  part(pavilion,wood,0,4.3,-8,23,8,.25);
  shell(pavilion,contour(31,24,7),.35,8.3,glass);
  for(const x of [-9,-4.5,0,4.5,9])part(pavilion,brass,x,4.5,12.04,.07,8.3,.13);
  for(const side of [-1,1])part(pavilion,stone,side*14,4.5,0,.55,8.3,.55,columnShape);
  roundedPart(pavilion,stone,0,8.9,0,34,.38,26,7);
  roundedPart(pavilion,warm,0,8.66,0,33.8,.06,25.8,7);
  for(const x of [-8,0,8]){roundedPart(pavilion,stone,x,1.3,3,3.3,.18,1.5,.3);part(pavilion,warm,x,8.5,3,3.5,.04,.25);}

  // The narrow sail has a genuinely sloping crown and white structural edges.
  const sailShape=new THREE.Shape();sailShape.moveTo(0,13);sailShape.lineTo(7.6,13);sailShape.lineTo(7.6,119);sailShape.lineTo(5.7,119);sailShape.lineTo(0,111.5);sailShape.closePath();
  const sailGeometry=geometry(new THREE.ExtrudeGeometry(sailShape,{depth:4.6,bevelEnabled:false,steps:1}));
  part(group,darkGlass,13.7,0,16.7,1,1,1,sailGeometry);
  jointedPier(21.8,19.1,.8,5.3,106,13);
  jointedPier(13.36,19.1,.65,5.3,98.5,13);
  part(group,brass,21.24,66,21.41,.13,106,.12);
  part(group,warm,22.24,66,21.42,.055,106,.075);
  part(group,brass,17.6,64.5,21.39,.12,102,.14);
  for(let y=17;y<112;y+=4.35)part(group,brass,17.5,y,21.37,7.3,.065,.12);
  const crown=new THREE.Vector3(5.7,7.5,0),cap=part(group,stone,16.55,115.25,19, .55,crown.length(),5.3);cap.rotation.z=-Math.atan2(5.7,7.5);

  for(const side of [-1,1]){
    for(const z of [-23,-5,16])planter(group,{x:side*36,z,y:.4,w:4,d:4,scale:1.05});
    planter(group,{x:side*26,z:29,y:.4,w:8,d:3.2,scale:.84});
  }
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
