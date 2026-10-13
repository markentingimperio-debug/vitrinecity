import {normalizeAvenueStores,filterAvenueStores} from './avenida-core.js';

const $=id=>document.getElementById(id);
const street=$('street'),list=$('storeList'),status=$('streetStatus'),count=$('resultCount'),empty=$('empty'),search=$('storeSearch'),tour=$('tour');
const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)');
let stores=[],visible=[],timer=null,displayCount=24;

async function requestStores(url){
  const response=await fetch(url,{headers:{accept:'application/json'},cache:'no-store',signal:AbortSignal.timeout(9000)});
  if(!response.ok)throw new Error(`Não foi possível carregar ${url}`);
  const result=await response.json();
  if(!Array.isArray(result.stores))throw new Error('Lista de lojas inválida');
  return result.stores;
}

function stopTour(){
  if(timer)clearInterval(timer);
  timer=null;tour.setAttribute('aria-pressed','false');tour.textContent='Iniciar passeio';
}

function activeIndex(){
  const cards=[...street.querySelectorAll('.building')];
  if(!cards.length)return -1;
  const x=street.scrollLeft+street.clientWidth/2;
  return cards.reduce((best,card,index)=>Math.abs(card.offsetLeft+card.offsetWidth/2-x)<Math.abs(cards[best].offsetLeft+cards[best].offsetWidth/2-x)?index:best,0);
}

function go(step){
  const cards=[...street.querySelectorAll('.building')];if(!cards.length)return;
  const targetIndex=Math.min(cards.length-1,Math.max(0,activeIndex()+step));
  const target=cards[targetIndex];
  target.scrollIntoView({block:'nearest',inline:'center',behavior:reduceMotion.matches?'instant':'smooth'});
  status.textContent=`${targetIndex+1} de ${visible.length} lojas na avenida`;
}

function storeCard(store,index){
  const building=document.createElement('article');building.className=`building building-${index%5}`;
  const roof=document.createElement('div');roof.className='roof';roof.setAttribute('aria-hidden','true');
  const facade=document.createElement('div');facade.className='facade';
  if(store.facadeUrl||store.logoUrl){const image=document.createElement('img');image.src=store.facadeUrl||store.logoUrl;image.alt='';image.loading=index<3?'eager':'lazy';image.decoding='async';facade.append(image);}
  else{const windows=document.createElement('div');windows.className='windows';windows.setAttribute('aria-hidden','true');windows.textContent='▦  ▦  ▦';facade.append(windows);}
  const sign=document.createElement('div');sign.className='sign';sign.textContent=store.name;
  const door=document.createElement('a');door.className='door';door.href=store.mapHref||store.href;door.textContent=`Entrar em ${store.name} →`;
  const caption=document.createElement('div');caption.className='building-caption';caption.textContent=[store.city,store.state].filter(Boolean).join(' · ')||'Loja da VitrineCity';
  building.append(roof,facade,sign,door,caption);
  return building;
}

function directoryLink(store){
  const link=document.createElement('a');link.href=store.mapHref||store.href;link.className='store-row';
  const title=document.createElement('strong');title.textContent=store.name;
  const place=document.createElement('span');place.textContent=[store.city,store.state].filter(Boolean).join(' · ')||'Visitar loja';
  const arrow=document.createElement('b');arrow.textContent='↗';arrow.setAttribute('aria-hidden','true');link.append(title,place,arrow);
  return link;
}

function render(){
  stopTour();visible=filterAvenueStores(stores,search.value);displayCount=24;
  renderBuildings();list.replaceChildren(...visible.map(directoryLink));
  empty.hidden=visible.length>0;count.textContent=`${visible.length} ${visible.length===1?'loja encontrada':'lojas encontradas'}`;
  status.textContent=visible.length?`${visible.length} ${visible.length===1?'fachada para explorar':'fachadas para explorar'} · deslize ou use as setas`:'Nenhuma loja corresponde à busca';
  $('previous').disabled=visible.length===0;$('next').disabled=visible.length===0;tour.disabled=visible.length<2||reduceMotion.matches;
}

function renderBuildings(){
  street.replaceChildren(...visible.slice(0,displayCount).map(storeCard));
  $('moreBuildings').hidden=displayCount>=visible.length;
}

search.addEventListener('input',render);
$('moreBuildings').addEventListener('click',()=>{stopTour();displayCount=Math.min(displayCount+24,visible.length);renderBuildings();status.textContent=`${displayCount} de ${visible.length} fachadas disponíveis para passear`;});
$('searchForm').addEventListener('submit',event=>{event.preventDefault();if(visible.length)street.scrollIntoView({block:'center',behavior:reduceMotion.matches?'instant':'smooth'});});
$('previous').addEventListener('click',()=>{stopTour();go(-1);});
$('next').addEventListener('click',()=>{stopTour();go(1);});
street.addEventListener('keydown',event=>{if(event.key==='ArrowRight'||event.key==='ArrowLeft'){event.preventDefault();stopTour();go(event.key==='ArrowRight'?1:-1);}});
street.addEventListener('pointerdown',stopTour);
tour.addEventListener('click',()=>{
  if(timer){stopTour();return;}
  if(reduceMotion.matches||visible.length<2)return;
  tour.setAttribute('aria-pressed','true');tour.textContent='Pausar passeio';
  timer=setInterval(()=>{if(document.hidden)return;if(activeIndex()>=street.children.length-1){stopTour();return;}go(1);},4500);
});
reduceMotion.addEventListener('change',()=>{stopTour();render();});
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopTour();});

Promise.allSettled([requestStores('/api/marketplace/stores'),requestStores('/api/maps/stores')]).then(results=>{
  if(results.every(result=>result.status==='rejected'))throw new Error('Não foi possível carregar as lojas.');
  stores=normalizeAvenueStores(results[0].status==='fulfilled'?results[0].value:[],results[1].status==='fulfilled'?results[1].value:[]);
  render();
}).catch(()=>{status.textContent='A avenida está indisponível agora. Use o catálogo de lojas.';count.textContent='';list.replaceChildren();empty.hidden=false;empty.innerHTML='Não foi possível carregar as lojas agora. <a href="/loja">Abrir catálogo de lojas</a>.';tour.disabled=true;});
