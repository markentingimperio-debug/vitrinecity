if (!location.pathname.startsWith('/admin') && !document.getElementById('vc-outdoor')) start();
async function start() {
  const get = async url => { try { const r=await fetch(url,{signal:AbortSignal.timeout(8000)}); return r.ok?await r.json():{}; } catch {return {};} };
  const [education,market,affiliates,promotions,localStores] = await Promise.all([get('/api/courses'),get('/api/marketplace/products'),get('/api/affiliate-highlights'),get('/api/promotions'),get('/api/marketplace/stores?delivery=local')]);
  const slug = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  const courses=(education.courses||[]).filter(p=>p.available && p.contentType==='original').slice(0,4).map(p=>({
    title:p.title,description:p.description,image:p.coverUrl,url:'/centro-educacional.html#'+encodeURIComponent(p.slug),label:'Aprenda algo novo',button:'Conhecer curso',kind:'course'}));
  const products=(market.products||[]).filter(p=>p.available && p.product_type!=='digital' && p.stock_quantity>0).slice(0,4).map(p=>({
    title:p.name,description:p.description,image:p.image_url,url:'/produto/'+p.id+'/'+slug(p.name),label:'Produtos das lojas',button:'Ver produto',kind:'product'}));
  const offers=(affiliates.items||[]).slice(0,4).map(p=>({...p,label:'Seleção · '+p.platform,button:'Conhecer oferta',kind:'affiliate'}));
  const stores=new Map((localStores.stores||[]).filter(s=>s.open).map(s=>[s.order_reference,s]));
  const delivery=(market.products||[]).filter(p=>p.available&&p.product_type!=='digital'&&p.stock_quantity>0&&stores.has(p.store_reference)).slice(0,4).map(p=>({
    title:p.name,description:'VC Entregas · '+stores.get(p.store_reference).city+'. Confira a área atendida e as condições na loja.',image:p.image_url,
    url:'/loja?delivery=local&q='+encodeURIComponent(p.name),label:'VC Entregas · '+p.store_name,button:'Consultar entrega local',kind:'delivery'}));
  const services=(promotions.items||[]).filter(p=>p.kind==='service').slice(0,4).map(p=>({...p,image:p.imageUrl,label:'Serviços para seu negócio',button:'Conhecer serviço'}));
  const brands=(promotions.items||[]).filter(p=>p.kind==='store').slice(0,4).map(p=>({...p,image:p.imageUrl,label:'Marcas da cidade',button:'Explorar marca'}));
  const features=[
    {title:'Encontre seu próximo passo',description:'Pesquise assuntos, produtos, cursos e negócios em um só lugar.',url:'/pesquisar.html',button:'Pesquisar na Vitrine',image:'/assets/vitriny-city-master.jpg'},
    {title:'Explore os negócios da cidade',description:'Conheça lojas no mapa e encontre os canais de contato de cada negócio.',url:'/mapa-real.html',button:'Abrir o mapa',image:'/assets/vitriny-city-master.jpg'},
    {title:'Compre perto de você',description:'Consulte lojas e produtos do VC Entregas. A disponibilidade da entrega depende do endereço e da loja.',url:'/entregas',button:'Conhecer o VC Entregas',image:'/assets/agrotecnica-premium-v2.webp'},
    {title:'Seu negócio pode fazer parte da cidade',description:'Conheça as opções para apresentar sua empresa, seus produtos e seus canais de atendimento na VitrineCity.',url:'/para-empresas.html',button:'Ver opções para empresas',image:'/assets/vitriny-city-master.jpg'}
  ].map(p=>({...p,label:'Conheça a plataforma',kind:'feature'}));
  const items=[],seen=new Set();for(let i=0;i<4;i++)for(const list of [courses,products,offers,delivery,brands,services,features])if(list[i]){
    const item=list[i];try{const u=new URL(item.url,location.origin);if(u.origin!==location.origin||seen.has(u.href))continue;seen.add(u.href);items.push(item);}catch{}
  }
  if(!items.length)return;
  const css=document.createElement('link');css.rel='stylesheet';css.href='/market-outdoor.css?v=1';document.head.append(css);
  const root=document.createElement('section');root.id='vc-outdoor';root.setAttribute('aria-roledescription','carrossel');root.setAttribute('aria-label','Destaques da VitrineCity');
  root.innerHTML='<div class="vc-od-heading"><div><span>EM DESTAQUE NA VITRINECITY</span><h2>Seu próximo achado está aqui.</h2></div><a href="/ofertas">Explorar ofertas ↗</a></div><div class="vc-od-stage"><div class="vc-od-copy"><span class="vc-od-label"></span><h3></h3><p class="vc-od-description"></p><p class="vc-od-disclosure"></p><a class="vc-od-cta"></a></div><div class="vc-od-visual"><img width="480" height="340" alt="" decoding="async"><span class="vc-od-fallback" hidden>VitrineCity</span></div></div><div class="vc-od-controls"><span class="vc-od-count" aria-live="off"></span><div><button type="button" data-action="prev" aria-label="Destaque anterior">←</button><button type="button" data-action="pause">Pausar</button><button type="button" data-action="next" aria-label="Próximo destaque">→</button></div></div>';
  const footer=document.querySelector('body > footer');
  if(footer)footer.before(root);else document.body.append(root);
  const banner=document.createElement('aside');banner.id='vc-global-market-banner';banner.setAttribute('aria-label','Destaques da VitrineCity');
  banner.innerHTML='<strong>VITRINECITY</strong><a class="vc-hb-link"><small></small><b></b></a><button type="button" aria-label="Pausar banner automático">Pausar</button>';
  document.querySelector('#marketTicker')?.remove();document.body.prepend(banner);
  let index=0, paused=matchMedia('(prefers-reduced-motion: reduce)').matches, hover=false, focused=false, visible=true;
  const motion=matchMedia('(prefers-reduced-motion: reduce)');
  const $=s=>root.querySelector(s), pause=$('[data-action="pause"]'), image=$('img');
  function draw(manual=false){
    const item=items[index];root.dataset.kind=item.kind;
    $('.vc-od-label').textContent=item.label; $('h3').textContent=item.title;
    $('.vc-od-description').textContent=item.description;
    $('.vc-od-disclosure').textContent=item.kind==='affiliate'?'Publicidade · Link de afiliado. Podemos receber comissão.':'Confira os detalhes e as condições na página.';
    const cta=$('.vc-od-cta');cta.textContent=item.button+' ↗';cta.href=item.url;
    banner.querySelector('small').textContent=item.kind==='affiliate'?'Publicidade · Afiliado':item.label;
    banner.querySelector('b').textContent=item.title;banner.querySelector('a').href=item.url;
    image.hidden=true;$('.vc-od-fallback').hidden=false;
    try { const url=new URL(item.image,location.origin);if(!item.image || url.protocol!=='https:')throw Error();image.src=url.href;image.alt=item.title; } catch {image.removeAttribute('src');}
    const count=$('.vc-od-count');count.setAttribute('aria-live',manual?'polite':'off');count.textContent=String(index+1).padStart(2,'0')+' / '+String(items.length).padStart(2,'0');
    pause.textContent=paused?'Reproduzir':'Pausar';pause.setAttribute('aria-label',paused?'Reproduzir destaques automaticamente':'Pausar destaques automáticos');
    banner.querySelector('button').textContent=paused?'Reproduzir':'Pausar';banner.querySelector('button').setAttribute('aria-label',paused?'Reproduzir banner automático':'Pausar banner automático');
  }
  image.addEventListener('load',()=>{image.hidden=false;$('.vc-od-fallback').hidden=true;});
  image.addEventListener('error',()=>{image.hidden=true;$('.vc-od-fallback').hidden=false;});
  root.addEventListener('click',e=>{const button=e.target.closest('button[data-action]');if(!button)return;
    if(button.dataset.action==='pause')paused=!paused;else{paused=true;index=(index+(button.dataset.action==='next'?1:-1)+items.length)%items.length;}draw(true);});
  root.addEventListener('mouseenter',()=>hover=true);root.addEventListener('mouseleave',()=>hover=false);
  banner.addEventListener('mouseenter',()=>hover=true);banner.addEventListener('mouseleave',()=>hover=false);
  banner.addEventListener('focusin',()=>focused=true);banner.addEventListener('focusout',()=>{focused=banner.contains(document.activeElement);});
  banner.querySelector('button').addEventListener('click',()=>{paused=!paused;draw(true);});
  root.addEventListener('focusin',()=>focused=true);root.addEventListener('focusout',()=>{focused=root.contains(document.activeElement);});
  motion.addEventListener('change',e=>{if(e.matches){paused=true;draw();}});
  let footerVisible=false,headerVisible=true;
  const observer=new IntersectionObserver(entries=>{for(const entry of entries){if(entry.target===root)footerVisible=entry.isIntersecting;else headerVisible=entry.isIntersecting;}visible=footerVisible||headerVisible;});observer.observe(root);observer.observe(banner);
  draw();setInterval(()=>{if(!paused&&!hover&&!focused&&visible&&!document.hidden){index=(index+1)%items.length;draw();}},7000);
}
