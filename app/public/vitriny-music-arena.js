import {mountMediaRecommendations} from './vitriny-media-recommendations.js';
import {explorerReturnHref} from './vitriny-spatial-session.js';
import {youtubeSource} from './vitriny-music-core.js';
import {mountMediaPlayback} from './vitriny-music-playback.js';
const $=id=>document.getElementById(id),scope=document.body.dataset.mediaScope==='cinema'?'cinema':'music',player=$('musicPlayer'),status=$('playerStatus'),stop=$('stopPlayer');
const recommendations=mountMediaRecommendations($('mediaRecommendations'),{scope});
let page=1,pages=1,requestController,selected=null,catalogItems=[];
const playback=mountMediaPlayback({player,status,scope,onSelection:showSelection});
$('backCity').href=explorerReturnHref();
const node=(tag,text,className)=>{const element=document.createElement(tag);if(text)element.textContent=text;if(className)element.className=className;return element;};
function closePlayer(){playback.close();recommendations.clear();player.replaceChildren(node('p','Escolha uma seleção e toque em reproduzir.'));stop.hidden=true;$('selectedActions').hidden=true;selected=null;document.querySelectorAll('[data-media-slug]').forEach(b=>b.setAttribute('aria-pressed','false'));status.textContent='Player fechado. O som foi interrompido.';}
function openPlayer(item){playback.open(item,{initialItems:catalogItems});}
function showSelection(item,{scroll=true}={}){
  const source=youtubeSource(item.url,item.kind);if(!source)return;
  selected=item;recommendations.update(item);stop.hidden=false;$('selectedActions').hidden=false;
  $('selectionTitle').textContent=item.title;$('directVideo').href=source.url;$('selectionPage').href=item.pagePath;
  status.textContent=item.kind==='live'?'Rádio aberta. Toque em reproduzir; o canal informa se a transmissão está disponível.':item.label+' aberto. Toque em reproduzir no player do YouTube.';
  document.querySelectorAll('[data-media-slug]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mediaSlug===item.slug)));
  const next=new URL(location.href);next.searchParams.set('selecao',item.slug);history.replaceState(null,'',next.pathname+next.search);
  if(scroll)player.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
}
function render(items){
  catalogItems=items;
  const cards=items.map(item=>{const card=node('article',null,'media-card'),art=node('div',null,'card-art'+(scope==='cinema'?' cinema-art':''));art.setAttribute('aria-hidden','true');art.append(node('span',item.genreLabel),node('b',scope==='cinema'?'▻':'♫'));const copy=node('div',null,'card-copy');copy.append(node('small',item.label+' · '+item.artist),node('h3',item.title),node('p',item.description));const play=node('button',scope==='cinema'?'Assistir à sessão →':'Ouvir agora →','media-button');play.type='button';play.dataset.mediaSlug=item.slug;play.setAttribute('aria-label',(scope==='cinema'?'Assistir: ':'Ouvir: ')+item.title);play.setAttribute('aria-pressed',String(selected?.slug===item.slug));play.addEventListener('click',()=>openPlayer(item));copy.append(play);card.append(art,copy);return card;});
  $('mediaResults').replaceChildren(...(cards.length?cards:[node('p','Nenhuma seleção encontrada. Tente outra categoria ou palavra-chave.')]));
}
async function load(){
  requestController?.abort();const controller=new AbortController();requestController=controller;$('catalogStatus').textContent='Carregando seleções…';
  const params=new URLSearchParams(new FormData($('mediaFilters')));params.set('p',String(page));
  try{const response=await fetch('/api/media/'+scope+'?'+params,{signal:controller.signal});if(!response.ok)throw Error('Não foi possível carregar. Tente novamente.');const data=await response.json();if(controller.signal.aborted||requestController!==controller)return;
    if(!$('genreFilter').dataset.ready){for(const [value,label]of Object.entries(data.allGenres)){const option=node('option',label);option.value=value;$('genreFilter').append(option);}$('genreFilter').dataset.ready='true';for(const [value,label]of Object.entries(data.formats)){const option=node('option',label);option.value=value;$('kindFilter').append(option);}}
    page=data.page;pages=data.pages;render(data.items);$('catalogStatus').textContent=data.total+' seleções encontradas';$('pageStatus').textContent='Página '+page+' de '+pages;$('previousPage').disabled=page<=1;$('nextPage').disabled=page>=pages;
  }catch(error){if(error.name!=='AbortError'){$('catalogStatus').textContent=error.message;$('mediaResults').replaceChildren();}}
}
$('mediaFilters').addEventListener('submit',event=>{event.preventDefault();page=1;load();});
$('genreFilter').addEventListener('change',()=>{page=1;load();});$('kindFilter').addEventListener('change',()=>{page=1;load();});
$('previousPage').addEventListener('click',()=>{if(page>1){page--;load();}});$('nextPage').addEventListener('click',()=>{if(page<pages){page++;load();}});
$('shareSelection').addEventListener('click',async()=>{if(!selected)return;const url=new URL(selected.pagePath,location.origin).href;try{if(navigator.share)await navigator.share({title:selected.title,url});else{await navigator.clipboard.writeText(url);status.textContent='Link da página copiado.';}}catch(error){if(error.name!=='AbortError')status.textContent='Use o link “Página desta seleção” para copiar o endereço.';}});
$('directVideo').addEventListener('click',()=>closePlayer());
stop.addEventListener('click',closePlayer);addEventListener('pagehide',()=>{requestController?.abort();closePlayer();});
load();
// A shared page selects a card, but never loads third-party media on arrival.
const slug=new URLSearchParams(location.search).get('selecao');
if(slug&&/^[a-z0-9-]{1,100}$/.test(slug))fetch('/api/media/'+scope+'/'+slug).then(r=>r.ok?r.json():null).then(item=>{if(!item)return;const box=$('sharedSelection'),button=node('button',(scope==='cinema'?'Assistir: ':'Ouvir: ')+item.title,'media-button');button.type='button';button.addEventListener('click',()=>openPlayer(item));box.replaceChildren(node('p','Você escolheu · '+item.label),button);box.hidden=false;}).catch(()=>{});
