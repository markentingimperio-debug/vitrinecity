import {CITY_GUIDE_GROUPS,CITY_GUIDE_ITEMS,filterCityGuide} from './vitriny-city-guide-core.js';
import {toCleanPublicHref} from './vitriny-public-routes.js';

const dialog=document.getElementById('cityGuide'),openButton=document.getElementById('openCityGuide');
if(dialog&&openButton){
  const $=selector=>dialog.querySelector(selector),query=$('[data-guide-query]'),results=$('[data-guide-results]'),count=$('[data-guide-count]'),categories=$('[data-guide-groups]');
  const storageKey='vc-city-direct-entry-v1',preference=$('[data-direct-city]'),preferenceStatus=$('[data-preference-status]');
  let group='all',returnFocus=openButton,restoreFocus=true,pendingRefresh=false;
  function closeForAction(){restoreFocus=false;dialog.close();}
  const safeHref=href=>{try{if(typeof href!=='string'||!href.startsWith('/')||href.startsWith('//')||/[\\\u0000-\u001f]/.test(href))return null;const url=new URL(href,location.origin);return url.origin===location.origin?toCleanPublicHref(url.pathname+url.search+url.hash):null;}catch{return null;}};
  function storeItems(){return [...document.querySelectorAll('#storeLinks a')].map((a,index)=>({id:'store-'+index,title:a.textContent.trim(),description:'Conheça a loja, seus produtos e canais de atendimento.',group:'comprar',keywords:'loja vitrine produtos',landmark:'Avenida de Compras',href:safeHref(a.getAttribute('href')),storeReference:a.dataset.storeReference})).filter(item=>item.href);}
  function refreshPreference(){try{preference.checked=localStorage.getItem(storageKey)==='true';}catch{preference.checked=false;}}
  function canVisit(item){return document.documentElement.dataset.cityGuideReady==='true'&&(!item.storeReference||document.querySelector('#storeLinks a[data-store-reference="'+CSS.escape(item.storeReference)+'"]'))&&(item.place||item.storeReference);}
  function makeResult(item){
    const article=document.createElement('article'),copy=document.createElement('div'),title=document.createElement('h3'),description=document.createElement('p'),place=document.createElement('span'),actions=document.createElement('div');
    article.className='city-guide-result';copy.className='city-guide-result-copy';description.textContent=item.description;place.className='city-guide-place';place.textContent=item.landmark||CITY_GUIDE_GROUPS.find(g=>g.id===item.group)?.label||'VitrineCity';
    const chatReady=document.getElementById('loading')?.classList.contains('hide');
    const href=safeHref(item.action==='openCityChat'&&!chatReady?'/chat-social.html':item.href),target=document.getElementById(item.action);
    const primary=document.createElement((item.action==='openCityChat'&&chatReady)||(!href&&target)?'button':'a');
    primary.textContent=item.title;primary.className='city-guide-primary';
    if(primary.tagName==='A')primary.href=href||'/?inicio=1';
    else{primary.type='button';primary.addEventListener('click',()=>{
      closeForAction();
      if(item.action==='openCityChat'){const chat=document.querySelector('[data-city-chat] .city-chat');if(chat){chat.open=true;chat.querySelector('summary')?.focus();}}
      else target?.click();
    });}
    if(primary.tagName==='A')primary.addEventListener('click',()=>dispatchEvent(new CustomEvent('vitriny:guide-leave')));
    title.append(primary);copy.append(place,title,description);article.append(copy);
    if(canVisit(item)){
      const visit=document.createElement('button');visit.type='button';visit.className='city-guide-visit';visit.textContent='Ver na cidade';visit.setAttribute('aria-label','Ver '+item.title+' na cidade');
      visit.addEventListener('click',()=>{closeForAction();dispatchEvent(new CustomEvent('vitriny:guide-visit',{detail:{place:item.place,storeReference:item.storeReference,title:item.storeReference?item.title:item.landmark||item.title}}));});actions.append(visit);
    }
    if(item.action&&href&&target&&!target.hidden&&document.documentElement.dataset.cityGuideReady==='true'&&['openAvatar','openStorefronts','openCenters','openHeadquarters'].includes(item.action)){
      const button=document.createElement('button');button.type='button';button.className='city-guide-visit';button.textContent='Abrir opções';button.addEventListener('click',()=>{closeForAction();target.click();});actions.append(button);
    }
    if(actions.children.length){actions.className='city-guide-result-actions';article.append(actions);}return article;
  }
  function render(){
    const items=filterCityGuide(query.value,group,[...storeItems(),...CITY_GUIDE_ITEMS]);results.replaceChildren(...items.map(makeResult));
    count.textContent=items.length===1?'1 lugar encontrado':items.length+' lugares encontrados';
    if(!items.length){const empty=document.createElement('p');empty.className='city-guide-empty';empty.textContent='Nenhum lugar com esse nome. Tente “lojas”, “curso”, “música” ou procure na plataforma.';const link=document.createElement('a');link.href='/pesquisar?q='+encodeURIComponent(query.value.trim().slice(0,300));link.textContent='Pesquisar na VitrineCity →';empty.append(document.createElement('br'),link);results.append(empty);}
    for(const button of categories.querySelectorAll('button'))button.setAttribute('aria-pressed',String(button.dataset.group===group));
  }
  for(const category of [{id:'all',label:'Tudo'},...CITY_GUIDE_GROUPS]){const button=document.createElement('button');button.type='button';button.textContent=category.label;button.dataset.group=category.id;button.addEventListener('click',()=>{group=category.id;render();});categories.append(button);}
  function open(){restoreFocus=true;returnFocus=document.activeElement;dispatchEvent(new CustomEvent('vitriny:guide-open'));document.getElementById('cityTools').open=false;refreshPreference();render();dialog.showModal();query.focus();}
  openButton.addEventListener('click',open);document.getElementById('loadingGuide')?.addEventListener('click',open);document.getElementById('headquartersGuide')?.addEventListener('click',()=>{document.getElementById('headquartersDirectory').close();open();});
  $('[data-guide-close]').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>{if(restoreFocus)(returnFocus?.isConnected?returnFocus:openButton)?.focus();});
  dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();}});
  query.addEventListener('input',render);$('[data-guide-search]').addEventListener('submit',event=>event.preventDefault());
  preference.addEventListener('change',()=>{try{localStorage.setItem(storageKey,String(preference.checked));preferenceStatus.textContent=preference.checked?'Este navegador abrirá a cidade nas próximas visitas.':'Este navegador voltará a mostrar a página inicial.';}catch{preference.checked=false;preferenceStatus.textContent='Não foi possível salvar a preferência neste navegador.';}});
  function refreshResults(){if(!dialog.open)return;if(results.contains(document.activeElement)){pendingRefresh=true;return;}pendingRefresh=false;render();}
  results.addEventListener('focusout',()=>queueMicrotask(()=>{if(pendingRefresh)refreshResults();}));
  const stores=document.getElementById('storeLinks');if(stores)new MutationObserver(refreshResults).observe(stores,{childList:true});
  addEventListener('vitriny:city-ready',refreshResults);
  refreshPreference();
}
